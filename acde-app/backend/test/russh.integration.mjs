// Integration tests for the russh stand-in's backend against a throwaway OpenSSH server.
// Run with backend/test/run.sh, which starts the server and sets TEST_PASSWORD,
// TEST_KEY_PASSPHRASE and TEST_SHARED (host key and test key from the server).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { connect, parseKey } from '../russhBridge.js'

const ADDRESS = '127.0.0.1:22'
const USER = 'tester'
const { TEST_PASSWORD, TEST_KEY_PASSPHRASE, TEST_SHARED } = process.env
const OPEN_READ = 1
const OPEN_WRITE = 2
const OPEN_CREATE = 8
const WAIT_MS = 10000

function shared (name) {
    return readFileSync(join(TEST_SHARED, name), 'utf8')
}

/** Reads a connection's NDJSON events and lets a test wait for one. */
function eventReader (connection) {
    const seen = []
    const waiters = []
    ;(async () => {
        const reader = connection.events().getReader()
        const decoder = new TextDecoder()
        let buffered = ''
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }
            buffered += decoder.decode(value, { stream: true })
            const lines = buffered.split('\n')
            buffered = lines.pop()
            for (const event of lines.filter(Boolean).map(line => JSON.parse(line))) {
                seen.push(event)
                waiters.filter(w => w.match(event)).forEach(w => w.resolve(event))
            }
        }
    })()
    return {
        seen,
        next (match) {
            const found = seen.find(match)
            if (found) {
                return Promise.resolve(found)
            }
            return new Promise((resolve, reject) => {
                waiters.push({ match, resolve })
                setTimeout(() => reject(new Error('timed out waiting for an event')), WAIT_MS)
            })
        },
    }
}

async function open ({ acceptHostKey = true } = {}) {
    const connection = connect({ kind: 'socket', address: ADDRESS }, {})
    const events = eventReader(connection)
    const hostKey = await events.next(e => e.type === 'hostKey')
    connection.answerHostKey(acceptHostKey)
    return { connection, events, hostKey }
}

async function exec (connection, events, command) {
    const channel = connection.openSessionChannel()
    await connection.requestExec(channel, command)
    await events.next(e => e.type === 'close' && e.channel === channel)
    return events.seen
        .filter(e => e.type === 'data' && e.channel === channel)
        .map(e => Buffer.from(e.data, 'base64').toString())
        .join('')
}

test('the host key is the server key, and a rejected key ends the connection', async () => {
    const { connection, hostKey } = await open()
    assert.equal(hostKey.algorithm, 'ssh-ed25519')
    assert.equal(hostKey.base64, shared('host_key.pub').split(/\s+/)[1])
    assert.match(hostKey.fingerprint, /^SHA256:/)
    await connection.handshake
    connection.end()

    const rejected = await open({ acceptHostKey: false })
    await assert.rejects(rejected.connection.handshake)
})

test('none fails with the remaining methods; a wrong password fails; the right one signs in', async () => {
    const { connection, events } = await open()
    await connection.handshake
    const none = await connection.authenticate({ type: 'none', username: USER })
    assert.equal(none.result, 'failure')
    assert.ok(none.remainingMethods.includes('password'))
    assert.ok(none.remainingMethods.includes('publickey'))
    const wrong = await connection.authenticate({ type: 'password', username: USER, password: 'not-the-password' })
    assert.equal(wrong.result, 'failure')
    const right = await connection.authenticate({ type: 'password', username: USER, password: TEST_PASSWORD })
    assert.equal(right.result, 'success')
    assert.equal((await exec(connection, events, 'echo signed-in-as-$(whoami)')).trim(), 'signed-in-as-tester')
    connection.end()
})

test('keyboard-interactive asks for the password and signs in with the answer', async () => {
    const { connection } = await open()
    await connection.handshake
    const prompt = await connection.authenticate({ type: 'keyboard-interactive', username: USER })
    assert.equal(prompt.result, 'infoRequest')
    assert.match(prompt.prompts[0].prompt, /password/i)
    assert.equal(prompt.prompts[0].echo, false)
    const done = await connection.continueKeyboardInteractive([TEST_PASSWORD])
    assert.equal(done.result, 'success')
    connection.end()
})

test('a key with a passphrase needs the right passphrase, then signs in', async () => {
    const key = shared('test_key')
    assert.equal(parseKey(key).encrypted, true)
    assert.ok(parseKey(key, 'wrong passphrase').error)
    assert.equal(parseKey(key, TEST_KEY_PASSPHRASE).algorithm, 'ssh-ed25519')

    const { connection, events } = await open()
    await connection.handshake
    const result = await connection.authenticate({ type: 'publickey', username: USER, key, passphrase: TEST_KEY_PASSPHRASE })
    assert.equal(result.result, 'success')
    assert.equal((await exec(connection, events, 'echo key-ok')).trim(), 'key-ok')
    connection.end()
})

test('SFTP writes, lists, reads, renames and removes files', async () => {
    const { connection } = await open()
    await connection.handshake
    assert.equal((await connection.authenticate({ type: 'password', username: USER, password: TEST_PASSWORD })).result, 'success')
    const channel = connection.openSessionChannel()
    await connection.activateSFTP(channel)
    const sftp = connection.sftp(channel)
    const dir = `/home/${USER}/tabby-sftp-test`
    const content = Buffer.from('hello from the russh stand-in\n'.repeat(5000))

    await sftp.createDirectory(dir)
    const writer = await sftp.openFile(`${dir}/a.txt`, OPEN_WRITE | OPEN_CREATE)
    await sftp.writeFile(writer, content.subarray(0, 70000))
    await sftp.writeFile(writer, content.subarray(70000))
    await sftp.closeFile(writer)

    const stats = await sftp.stat(`${dir}/a.txt`)
    assert.equal(stats.size, content.length)
    assert.equal(stats.type, 1)
    assert.equal(stats.permissions & 0o600, 0o600)
    const entries = await sftp.readDirectory(dir)
    assert.deepEqual(entries.map(e => e.name), ['a.txt'])
    assert.equal(entries[0].metadata.user, USER)

    const reader = await sftp.openFile(`${dir}/a.txt`, OPEN_READ)
    const chunks = []
    for (let chunk = await sftp.readFile(reader, 65536); chunk.length; chunk = await sftp.readFile(reader, 65536)) {
        chunks.push(chunk)
    }
    await sftp.closeFile(reader)
    assert.ok(Buffer.concat(chunks).equals(content))

    await sftp.rename(`${dir}/a.txt`, `${dir}/b.txt`)
    assert.equal((await sftp.stat(`${dir}/b.txt`)).size, content.length)
    await sftp.chmod(`${dir}/b.txt`, '640')
    assert.equal((await sftp.stat(`${dir}/b.txt`)).permissions, 0o640)
    await sftp.removeFile(`${dir}/b.txt`)
    await sftp.removeDirectory(dir)
    assert.equal((await sftp.stat(`/home/${USER}`)).type, 0)
    await connection.closeSFTP(channel)
    connection.end()
})
