// node --test backend/: SSH config resolution and host key checks for Tabby's acde backend.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkHostKey } from './knownHosts.js'
import { resolveHost } from './sshConfig.js'

const dir = mkdtempSync(join(tmpdir(), 'tabby-acde-ssh-'))
const KEY = Buffer.from('server-key-blob')
const OTHER_KEY = Buffer.from('another-key-blob')

function file (name, text) {
    const path = join(dir, name)
    writeFileSync(path, text)
    return path
}

function hashed (host) {
    const salt = Buffer.from('0123456789abcdefghij')
    const hash = createHmac('sha1', salt).update(host).digest('base64')
    return `|1|${salt.toString('base64')}|${hash}`
}

const config = file('config', [
    'Host *',
    '  User fallback',
    '  ServerAliveInterval 30',
    'Host rack1',
    '  HostName rack1.example.ts.net',
    '  User zhiyuan',
    '  Port 2222',
    '  IdentityFile ~/.ssh/rack1_key',
    '  HostKeyAlias rack1',
].join('\n'))

test('the first value for each option wins, as in OpenSSH', () => {
    const host = resolveHost('rack1', config)
    assert.equal(host.hostname, 'rack1.example.ts.net')
    assert.equal(host.user, 'fallback')
    assert.equal(host.port, 2222)
    assert.equal(host.hostKeyAlias, 'rack1')
    assert.match(host.identityFiles[0], /\.ssh\/rack1_key$/)
})

test('an alias not in the config is used as the host name on port 22', () => {
    const host = resolveHost('elsewhere.example', config)
    assert.equal(host.hostname, 'elsewhere.example')
    assert.equal(host.port, 22)
})

test('a negated pattern excludes a host', () => {
    const ops = file('ops-config', 'Host *.internal !secret.internal\n  User ops\n')
    assert.equal(resolveHost('build.internal', ops).user, 'ops')
    assert.notEqual(resolveHost('secret.internal', ops).user, 'ops')
})

test('a listed key matches, for plain and hashed host entries', () => {
    const known = file('known_plain', `rack1 ssh-ed25519 ${KEY.toString('base64')}\n`)
    assert.equal(checkHostKey('rack1', 22, KEY, known), 'match')
    const knownHashed = file('known_hashed', `${hashed('rack1')} ssh-ed25519 ${KEY.toString('base64')}\n`)
    assert.equal(checkHostKey('rack1', 22, KEY, knownHashed), 'match')
})

test('a host on another port is listed as [host]:port', () => {
    const known = file('known_port', `[rack1]:2222 ssh-ed25519 ${KEY.toString('base64')}\n`)
    assert.equal(checkHostKey('rack1', 2222, KEY, known), 'match')
    assert.equal(checkHostKey('rack1', 22, KEY, known), 'unknown')
})

test('a different key for a listed host is a mismatch', () => {
    const known = file('known_other', `rack1 ssh-ed25519 ${OTHER_KEY.toString('base64')}\n`)
    assert.equal(checkHostKey('rack1', 22, KEY, known), 'mismatch')
})

test('a revoked key is refused even when also listed', () => {
    const known = file('known_revoked', [
        `@revoked rack1 ssh-ed25519 ${KEY.toString('base64')}`,
        `rack1 ssh-ed25519 ${KEY.toString('base64')}`,
    ].join('\n'))
    assert.equal(checkHostKey('rack1', 22, KEY, known), 'mismatch')
})

test('an unlisted host or a missing file is unknown', () => {
    const known = file('known_unrelated', `other ssh-ed25519 ${KEY.toString('base64')}\n`)
    assert.equal(checkHostKey('rack1', 22, KEY, known), 'unknown')
    assert.equal(checkHostKey('rack1', 22, KEY, join(dir, 'missing')), 'unknown')
})

test("Tabby's algorithm choices are cut to what ssh2 supports, keeping their order", async () => {
    const { preferredAlgorithms } = await import('./russhBridge.js')
    const algorithms = preferredAlgorithms({
        kex: ['not-a-kex', 'curve25519-sha256'],
        key: ['ssh-ed25519', 'rsa-sha2-512'],
        ciphers: ['aes256-gcm@openssh.com', 'made-up-cipher'],
        mac: ['made-up-mac'],
    })
    assert.deepEqual(algorithms.kex, ['curve25519-sha256'])
    assert.deepEqual(algorithms.serverHostKey, ['ssh-ed25519', 'rsa-sha2-512'])
    assert.deepEqual(algorithms.cipher, ['aes256-gcm@openssh.com'])
    assert.equal(algorithms.hmac, undefined, 'nothing usable: ssh2 keeps its defaults')
    assert.deepEqual(preferredAlgorithms(undefined), {})
})
