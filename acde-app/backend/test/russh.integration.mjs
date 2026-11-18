// Integration tests for the russh stand-in's backend against a throwaway OpenSSH server.
// Run with backend/test/run.sh, which starts the server and sets TEST_PASSWORD,
// TEST_KEY_PASSPHRASE and TEST_SHARED (host key and test key from the server).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { openSocket } from '../netSockets.js'
import { connect, parseKey } from '../russhBridge.js'

const ADDRESS = '127.0.0.1:22'
const JUMP_ADDRESS = '127.0.0.1:2222'
const USER = 'tester'
const { TEST_PASSWORD, TEST_KEY_PASSPHRASE, TEST_SHARED } = process.env
const OPEN_READ = 1
const OPEN_WRITE = 2
const OPEN_CREATE = 8
const WAIT_MS = 10000
// A flood the reader falls behind on, how long it stops reading, and how much it reads afterwards.
const FLOOD_BYTES = 200 * 1024 * 1024
const BEHIND_MS = 2000
const RESUMED_BYTES = 20 * 1024 * 1024
// The queue's limit (1 MiB) plus what was already on its way when the channel paused.
const MAX_QUEUED_BYTES = 2 * 1024 * 1024

function shared (name) {
    return readFileSync(join(TEST_SHARED, name), 'utf8')
}

/** Reads a connection's NDJSON events and lets a test wait for one. */
function eventReader (connection) {
    const seen = []
    const waiters = []
    ;(async () => {
        const reader = connection.eventStream().getReader()
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

async function open ({ acceptHostKey = true, transport = { kind: 'socket', address: ADDRESS } } = {}) {
    const connection = connect(transport, {})
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
    assert.equal(hostKey.base64, shared('host_key_22.pub').split(/\s+/)[1])
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

async function signIn (options) {
    const opened = await open(options)
    await opened.connection.handshake
    const result = await opened.connection.authenticate({ type: 'password', username: USER, password: TEST_PASSWORD })
    assert.equal(result.result, 'success')
    return opened
}

test('a jump host forwards a channel that the next connection runs over', async () => {
    const jump = await signIn({ transport: { kind: 'socket', address: JUMP_ADDRESS } })
    assert.equal(jump.hostKey.base64, shared('host_key_2222.pub').split(/\s+/)[1])
    const channel = await jump.connection.openTCPForwardChannel({
        addressToConnectTo: '127.0.0.1',
        portToConnectTo: 22,
        originatorAddress: '127.0.0.1',
        originatorPort: 0,
    })
    const target = await signIn({ transport: { kind: 'channel', connection: jump.connection.id, channel } })
    assert.equal(target.hostKey.base64, shared('host_key_22.pub').split(/\s+/)[1])
    assert.equal((await exec(target.connection, target.events, 'echo through-the-jump-host')).trim(), 'through-the-jump-host')
    target.connection.end()
    jump.connection.end()
})

test('a remote forward brings the server-side connection back as a channel', async () => {
    const { connection, events } = await signIn()
    const port = await connection.forwardTCPPort('127.0.0.1', 0)
    assert.ok(port > 0)
    const output = exec(connection, events, `bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}; printf ping >&3; head -c 4 <&3'`)
    const opened = await events.next(e => e.type === 'tcpChannelOpen')
    assert.equal(opened.targetPort, port)
    connection.activateChannel(opened.channel)
    const ping = await events.next(e => e.type === 'data' && e.channel === opened.channel)
    assert.equal(Buffer.from(ping.data, 'base64').toString(), 'ping')
    connection.write(opened.channel, Buffer.from('pong'))
    connection.eof(opened.channel)
    assert.equal(await output, 'pong')
    await connection.stopForwardingTCPPort('127.0.0.1', port)
    connection.end()
})

test('a backend socket for the page connects and reads', async () => {
    const socket = openSocket('127.0.0.1', 22)
    const reader = socket.eventStream().getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('"data"')) {
        const { done, value } = await reader.read()
        assert.ok(!done, 'the socket closed before sending data')
        text += decoder.decode(value)
    }
    const data = JSON.parse(text.split('\n').find(line => line.includes('"data"'))).data
    assert.match(Buffer.from(data, 'base64').toString(), /^SSH-2\.0-/)
    socket.destroy()
})

test('dismissing a keyboard-interactive prompt still lets password sign-in work', async () => {
    const { connection } = await open()
    await connection.handshake
    const prompt = await connection.authenticate({ type: 'keyboard-interactive', username: USER })
    assert.equal(prompt.result, 'infoRequest')
    const result = await connection.authenticate({ type: 'password', username: USER, password: TEST_PASSWORD })
    assert.equal(result.result, 'success')
    connection.end()
})

test('closing a connection answers a handshake that is still pending', async () => {
    const connection = connect({ kind: 'socket', address: ADDRESS }, {})
    connection.end()
    await assert.rejects(connection.handshake, /closed/)
})

test('a fast server is paused while the reader is behind, then resumes', async () => {
    const connection = connect({ kind: 'socket', address: ADDRESS }, {})
    try {
        const reader = connection.eventStream().getReader()
        const decoder = new TextDecoder()
        let text = ''
        while (!text.includes('"hostKey"')) {
            text += decoder.decode((await reader.read()).value)
        }
        connection.answerHostKey(true)
        await connection.handshake
        assert.equal((await connection.authenticate({ type: 'password', username: USER, password: TEST_PASSWORD })).result, 'success')
        const channel = connection.openSessionChannel()
        await connection.requestExec(channel, `head -c ${FLOOD_BYTES} /dev/zero`)

        await new Promise(resolve => setTimeout(resolve, BEHIND_MS))
        const queued = connection.events.queuedBytes ?? connection.events.lines.join('').length
        assert.ok(queued < MAX_QUEUED_BYTES, `${queued} bytes queued while the reader was behind`)

        let read = 0
        while (read < RESUMED_BYTES) {
            const { done, value } = await reader.read()
            assert.ok(!done, 'the stream ended before the server resumed')
            read += value.length
        }
    } finally {
        connection.end()
    }
})
