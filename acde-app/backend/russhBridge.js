// Server side of the russh stand-in (src/russh.js): tabby-ssh's SSH connections, run on ssh2.
// russh authenticates one method per call after the handshake; ssh2 asks for each method through
// authHandler. A connection keeps ssh2's pending authHandler callback and feeds it one method per
// request, then answers with what ssh2 did next: 'ready' (success), another authHandler call
// (failure) or a keyboard-interactive prompt. Everything the server sends arrives as NDJSON events.
import { createHash, randomUUID } from 'node:crypto'
import ssh2 from 'ssh2'
import ssh2Constants from 'ssh2/lib/protocol/constants.js'

import { EventQueue } from './eventQueue.js'
import { SftpSession } from './russhSftp.js'

const { Client, utils } = ssh2
// ssh2's readyTimeout runs until authentication succeeds, which in russh's model includes the
// person answering Tabby's host key, password and passphrase dialogs.
const READY_TIMEOUT_MS = 10 * 60 * 1000
const SECONDS = 1000
// PAM usually re-prompts a few times before the server fails the method.
const MAX_ABANDON_ROUNDS = 5
const connections = new Map()

function keyAlgorithm (blob) {
    const length = blob.readUInt32BE(0)
    return blob.subarray(4, 4 + length).toString()
}

function fingerprint (blob) {
    return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

// Tabby's algorithm settings name the algorithms to offer, in russh's naming; ssh2 rejects names it
// does not support, so the lists are cut to ssh2's. An empty result keeps ssh2's defaults.
const SUPPORTED = {
    kex: ssh2Constants.SUPPORTED_KEX,
    serverHostKey: ssh2Constants.SUPPORTED_SERVER_HOST_KEY,
    cipher: ssh2Constants.SUPPORTED_CIPHER,
    hmac: ssh2Constants.SUPPORTED_MAC,
    compress: ssh2Constants.SUPPORTED_COMPRESSION,
}

export function preferredAlgorithms (preferred) {
    const wanted = { kex: preferred?.kex, serverHostKey: preferred?.key, cipher: preferred?.ciphers, hmac: preferred?.mac, compress: preferred?.compression }
    const algorithms = {}
    for (const [name, list] of Object.entries(wanted)) {
        const usable = (Array.isArray(list) ? list : []).filter(algorithm => SUPPORTED[name].includes(algorithm))
        if (usable.length) {
            algorithms[name] = usable
        }
    }
    return algorithms
}

function splitAddress (address) {
    const match = address.match(/^\[(.+)\]:(\d+)$/) ?? address.match(/^(.+):(\d+)$/)
    if (!match) {
        throw new Error(`not a host:port address: ${address}`)
    }
    return { host: match[1], port: Number(match[2]) }
}

class Connection {
    constructor () {
        this.id = randomUUID()
        this.client = new Client()
        this.events = new EventQueue()
        this.closed = false
        this.channels = new Map()
        this.sftpSessions = new Map()
        this.nextChannel = 1
        this.verifyHostKey = null
        this.authCallback = null
        this.authWaiter = null
        this.keyboardFinish = null
        this.handshake = new Promise((resolve, reject) => { this.handshakeDone = resolve; this.handshakeFailed = reject })
        this.handshake.catch(() => null)
    }

    emit (event) {
        this.events.push(event)
    }

    /** The connection's event stream; it has one reader, and ends the connection when cancelled. */
    eventStream () {
        return this.events.stream(() => this.end())
    }

    // A socket address, or (for a jump host) a forwarded channel of another connection.
    target (transport) {
        if (transport?.kind === 'socket') {
            return splitAddress(transport.address)
        }
        if (transport?.kind === 'channel') {
            const jump = connections.get(transport.connection)
            if (!jump) {
                throw new Error('the jump host connection is gone')
            }
            return { sock: jump.takeStream(transport.channel) }
        }
        throw new Error(`transport ${transport?.kind} is not supported yet`)
    }

    start (transport, config) {
        const target = this.target(transport)
        this.client
            .on('tcp connection', (info, accept) => this.onForwardedConnection(info, accept()))
            .on('banner', text => this.emit({ type: 'banner', text }))
            .on('ready', () => this.settleAuth({ result: 'success' }))
            .on('error', error => {
                this.emit({ type: 'error', message: error.message })
                this.handshakeFailed(error)
                this.settleAuth({ result: 'error', message: error.message })
            })
            .on('close', () => this.end())
            .connect({
                ...target,
                // ssh2 requires a username up front; russh only learns it with the first auth
                // method, and every method below carries its own username, which ssh2 uses.
                username: 'russh-stand-in',
                algorithms: preferredAlgorithms(config?.preferred),
                readyTimeout: READY_TIMEOUT_MS,
                keepaliveInterval: (config?.keepaliveIntervalSeconds ?? 0) * SECONDS,
                keepaliveCountMax: config?.keepaliveCountMax ?? 3,
                hostVerifier: (key, verify) => {
                    this.verifyHostKey = verify
                    this.emit({ type: 'hostKey', algorithm: keyAlgorithm(key), base64: key.toString('base64'), fingerprint: fingerprint(key) })
                },
                authHandler: (methodsLeft, _partialSuccess, next) => this.onAuthStep(methodsLeft, next),
            })
    }

    answerHostKey (accept) {
        const verify = this.verifyHostKey
        this.verifyHostKey = null
        verify?.(Boolean(accept))
    }

    // ssh2 asks for the next method: the handshake is done (first call) or the last method failed.
    onAuthStep (methodsLeft, next) {
        this.authCallback = next
        this.handshakeDone()
        this.settleAuth({ result: 'failure', remainingMethods: methodsLeft ?? [] })
    }

    settleAuth (outcome) {
        const waiter = this.authWaiter
        this.authWaiter = null
        waiter?.(outcome)
    }

    async authenticate (method) {
        if (!this.authCallback && this.keyboardFinish) {
            await this.abandonKeyboardInteractive()
        }
        const next = this.authCallback
        if (!next) {
            return { result: 'error', message: 'not waiting for authentication' }
        }
        this.authCallback = null
        return new Promise(resolve => {
            this.authWaiter = resolve
            next(this.toSsh2Method(method))
        })
    }

    toSsh2Method (method) {
        const { type, username } = method
        if (type === 'password') {
            return { type, username, password: method.password }
        }
        if (type === 'publickey') {
            return { type, username, key: method.key, passphrase: method.passphrase }
        }
        if (type === 'agent') {
            return { type, username, agent: method.agentPath }
        }
        if (type === 'keyboard-interactive') {
            return {
                type,
                username,
                prompt: (name, instructions, _lang, prompts, finish) => {
                    this.keyboardFinish = finish
                    this.keyboardPromptCount = prompts.length
                    this.settleAuth({ result: 'infoRequest', name, instructions, prompts: prompts.map(p => ({ prompt: p.prompt, echo: Boolean(p.echo) })) })
                },
            }
        }
        return { type: 'none', username }
    }

    continueKeyboardInteractive (responses) {
        const finish = this.keyboardFinish
        this.keyboardFinish = null
        if (!finish) {
            return Promise.resolve({ result: 'error', message: 'no keyboard-interactive prompt is open' })
        }
        return new Promise(resolve => {
            this.authWaiter = resolve
            finish(responses)
        })
    }

    // Tabby moves on to another method when the person dismisses a keyboard-interactive prompt, but
    // ssh2 still waits for answers: answer each prompt with an empty string (one answer per prompt, or
    // the server rejects the reply) until the server gives up on this method.
    async abandonKeyboardInteractive () {
        for (let round = 0; round < MAX_ABANDON_ROUNDS && this.keyboardFinish; round++) {
            await this.continueKeyboardInteractive(new Array(this.keyboardPromptCount ?? 0).fill(''))
        }
    }

    openSessionChannel () {
        const id = this.nextChannel++
        this.channels.set(id, { pty: false, stream: null })
        return id
    }

    channel (id) {
        const channel = this.channels.get(id)
        if (!channel) {
            throw new Error(`no channel ${id}`)
        }
        return channel
    }

    requestPTY (id, { term, columns, rows, pixWidth, pixHeight }) {
        this.channel(id).pty = { term, cols: columns, rows, width: pixWidth, height: pixHeight }
    }

    // ssh2 opens a session channel and starts the shell or command in one call.
    openStream (id, open) {
        const channel = this.channel(id)
        return new Promise((resolve, reject) => {
            open(channel.pty, (error, stream) => {
                if (error) {
                    reject(error)
                    return
                }
                channel.stream = stream
                this.activateChannel(id)
                resolve()
            })
        })
    }

    requestShell (id) {
        return this.openStream(id, (pty, done) => this.client.shell(pty, done))
    }

    requestExec (id, command) {
        return this.openStream(id, (pty, done) => this.client.exec(command, { pty }, done))
    }

    /** A direct-tcpip channel to address:port through this server (local forward or jump host). */
    openTCPForwardChannel ({ addressToConnectTo, portToConnectTo, originatorAddress, originatorPort }) {
        return new Promise((resolve, reject) => {
            this.client.forwardOut(originatorAddress ?? '127.0.0.1', originatorPort ?? 0, addressToConnectTo, portToConnectTo, (error, stream) => {
                if (error) {
                    reject(error)
                    return
                }
                const id = this.nextChannel++
                this.channels.set(id, { pty: false, stream, attached: false })
                resolve(id)
            })
        })
    }

    /** Starts sending a channel's data as events; a channel used as a transport is never activated. */
    activateChannel (id) {
        const channel = this.channel(id)
        if (channel.stream && !channel.attached) {
            channel.attached = true
            this.attach(id, channel.stream)
        }
    }

    /** Hands a forwarded channel's stream to another connection as its socket (jump host). */
    takeStream (id) {
        const channel = this.channel(id)
        if (!channel.stream || channel.attached) {
            throw new Error(`channel ${id} cannot be used as a transport`)
        }
        this.channels.delete(id)
        return channel.stream
    }

    /** Asks the server to listen on address:port and forward connections back; the bound port. */
    forwardTCPPort (address, port) {
        return new Promise((resolve, reject) => {
            this.client.forwardIn(address, port, (error, boundPort) => (error ? reject(error) : resolve(boundPort || port)))
        })
    }

    stopForwardingTCPPort (address, port) {
        return new Promise((resolve, reject) => {
            this.client.unforwardIn(address, port, error => (error ? reject(error) : resolve()))
        })
    }

    onForwardedConnection (info, stream) {
        const id = this.nextChannel++
        this.channels.set(id, { pty: false, stream, attached: false })
        this.emit({
            type: 'tcpChannelOpen',
            channel: id,
            targetAddress: info.destIP,
            targetPort: info.destPort,
            clientAddress: info.srcIP,
            clientPort: info.srcPort,
        })
    }

    attach (id, stream) {
        const sources = [stream, stream.stderr].filter(Boolean)
        sources.forEach(source => this.events.addSource(source))
        stream.on('data', data => this.emit({ type: 'data', channel: id, data: data.toString('base64') }))
        stream.stderr?.on('data', data => this.emit({ type: 'extendedData', channel: id, ext: 1, data: data.toString('base64') }))
        stream.on('end', () => this.emit({ type: 'eof', channel: id }))
        stream.on('close', () => {
            this.emit({ type: 'close', channel: id })
            this.channels.delete(id)
            sources.forEach(source => this.events.removeSource(source))
        })
    }

    write (id, data) {
        this.channel(id).stream?.write(data)
    }

    resize (id, { columns, rows, pixWidth, pixHeight }) {
        this.channel(id).stream?.setWindow(rows, columns, pixHeight ?? 0, pixWidth ?? 0)
    }

    eof (id) {
        this.channel(id).stream?.end()
    }

    closeChannel (id) {
        this.channels.get(id)?.stream?.close()
    }

    // ssh2 opens its own session channel for SFTP, so the placeholder channel only names it.
    async activateSFTP (id) {
        this.channel(id)
        this.sftpSessions.set(id, await SftpSession.open(this.client))
    }

    sftp (id) {
        const session = this.sftpSessions.get(id)
        if (!session) {
            throw new Error(`no SFTP session on channel ${id}`)
        }
        return session
    }

    async closeSFTP (id) {
        const session = this.sftpSessions.get(id)
        this.sftpSessions.delete(id)
        this.channels.delete(id)
        await session?.close()
    }

    end () {
        if (this.closed) {
            return
        }
        this.closed = true
        for (const session of this.sftpSessions.values()) {
            session.close().catch(() => null)
        }
        this.sftpSessions.clear()
        this.emit({ type: 'disconnect' })
        this.events.close()
        // Requests still waiting on the handshake, a sign-in step or a host key get an answer.
        this.handshakeFailed(new Error('the connection closed'))
        this.settleAuth({ result: 'error', message: 'the connection closed' })
        this.answerHostKey(false)
        this.client.end()
        this.client.destroy?.()
        connections.delete(this.id)
    }
}

/**
 * The SSH agent socket. acde starts backends with a clean environment, so SSH_AUTH_SOCK is usually
 * missing; on macOS, launchd still knows the user's agent.
 */
export async function findAgentSocket () {
    if (process.env.SSH_AUTH_SOCK) {
        return process.env.SSH_AUTH_SOCK
    }
    if (process.platform !== 'darwin') {
        return null
    }
    const { execFile } = await import('node:child_process')
    return new Promise(resolve => {
        execFile('/bin/launchctl', ['getenv', 'SSH_AUTH_SOCK'], (error, stdout) => resolve(error ? null : stdout.trim() || null))
    })
}

/** The type of a file, without its contents, for tabby-ssh's agent socket check. */
export async function statPath (path) {
    const { stat } = await import('node:fs/promises')
    try {
        const info = await stat(path)
        return { exists: true, socket: info.isSocket(), file: info.isFile(), directory: info.isDirectory() }
    } catch (error) {
        return { exists: false, code: error.code ?? 'ENOENT' }
    }
}

/** { algorithm } for a private key, or { error, encrypted } when it cannot be parsed. */
export function parseKey (data, passphrase) {
    const parsed = utils.parseKey(data, passphrase || undefined)
    if (parsed instanceof Error) {
        return { error: parsed.message, encrypted: /encrypt|passphrase|decrypt/i.test(parsed.message) }
    }
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    return { algorithm: key.type }
}

/** Starts connecting; the page answers the host key from the event stream, then awaits the handshake. */
export function connect (transport, config) {
    const connection = new Connection()
    connection.start(transport, config)
    connections.set(connection.id, connection)
    return connection
}

export function getConnection (id) {
    return connections.get(id) ?? null
}
