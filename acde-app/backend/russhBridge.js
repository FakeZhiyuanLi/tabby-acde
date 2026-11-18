// Server side of the russh stand-in (src/russh.js): tabby-ssh's SSH connections, run on ssh2.
// russh authenticates one method per call after the handshake; ssh2 asks for each method through
// authHandler. A connection keeps ssh2's pending authHandler callback and feeds it one method per
// request, then answers with what ssh2 did next: 'ready' (success), another authHandler call
// (failure) or a keyboard-interactive prompt. Everything the server sends arrives as NDJSON events.
import { createHash, randomUUID } from 'node:crypto'
import ssh2 from 'ssh2'

const { Client, utils } = ssh2
// ssh2's readyTimeout runs until authentication succeeds, which in russh's model includes the
// person answering Tabby's host key, password and passphrase dialogs.
const READY_TIMEOUT_MS = 10 * 60 * 1000
const SECONDS = 1000
const connections = new Map()

function keyAlgorithm (blob) {
    const length = blob.readUInt32BE(0)
    return blob.subarray(4, 4 + length).toString()
}

function fingerprint (blob) {
    return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
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
        this.queue = []
        this.wake = null
        this.closed = false
        this.channels = new Map()
        this.nextChannel = 1
        this.verifyHostKey = null
        this.authCallback = null
        this.authWaiter = null
        this.keyboardFinish = null
        this.handshake = new Promise((resolve, reject) => { this.handshakeDone = resolve; this.handshakeFailed = reject })
        this.handshake.catch(() => null)
    }

    emit (event) {
        this.queue.push(JSON.stringify(event) + '\n')
        this.wake?.()
    }

    events () {
        const encoder = new TextEncoder()
        return new ReadableStream({
            pull: async controller => {
                while (!this.queue.length && !this.closed) {
                    await new Promise(resolve => { this.wake = resolve })
                }
                if (this.queue.length) {
                    controller.enqueue(encoder.encode(this.queue.splice(0).join('')))
                } else {
                    controller.close()
                }
            },
            cancel: () => this.end(),
        })
    }

    start (transport, config) {
        if (transport?.kind !== 'socket') {
            throw new Error(`transport ${transport?.kind} is not supported yet`)
        }
        const { host, port } = splitAddress(transport.address)
        this.client
            .on('banner', text => this.emit({ type: 'banner', text }))
            .on('ready', () => this.settleAuth({ result: 'success' }))
            .on('error', error => {
                this.emit({ type: 'error', message: error.message })
                this.handshakeFailed(error)
                this.settleAuth({ result: 'error', message: error.message })
            })
            .on('close', () => this.end())
            .connect({
                host,
                port,
                // ssh2 requires a username up front; russh only learns it with the first auth
                // method, and every method below carries its own username, which ssh2 uses.
                username: 'russh-stand-in',
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

    authenticate (method) {
        const next = this.authCallback
        if (!next) {
            return Promise.resolve({ result: 'error', message: 'not waiting for authentication' })
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
                this.attach(id, stream)
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

    attach (id, stream) {
        stream.on('data', data => this.emit({ type: 'data', channel: id, data: data.toString('base64') }))
        stream.stderr?.on('data', data => this.emit({ type: 'extendedData', channel: id, ext: 1, data: data.toString('base64') }))
        stream.on('end', () => this.emit({ type: 'eof', channel: id }))
        stream.on('close', () => {
            this.emit({ type: 'close', channel: id })
            this.channels.delete(id)
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

    end () {
        if (this.closed) {
            return
        }
        this.closed = true
        this.emit({ type: 'disconnect' })
        this.wake?.()
        this.client.end()
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
    connections.set(connection.id, connection)
    connection.start(transport, config)
    return connection
}

export function getConnection (id) {
    return connections.get(id) ?? null
}
