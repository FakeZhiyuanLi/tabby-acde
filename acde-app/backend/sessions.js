// SSH shell sessions over ssh2 (pure JS). Each session collects its output in a queue that one
// streaming response drains; status and errors are written into the same stream as text, so the
// terminal shows them like ssh would. The shell is paused while the queue is over HIGH_WATER_BYTES.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'

import { HIGH_WATER_BYTES } from './eventQueue.js'
import { checkHostKey } from './knownHosts.js'
import { resolveHost } from './sshConfig.js'

const { Client, utils } = ssh2
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'].map(name => join(homedir(), '.ssh', name))
const READY_TIMEOUT_MS = 20000
const KEEPALIVE_MS = 30000

const sessions = new Map()

function usableKeys (paths) {
    const keys = []
    for (const path of [...new Set(paths)]) {
        let text
        try {
            text = readFileSync(path)
        } catch {
            continue
        }
        const parsed = utils.parseKey(text)
        if (!(parsed instanceof Error)) {
            keys.push({ path, key: text })
        }
    }
    return keys
}

function authMethods (target) {
    const methods = [{ type: 'none', username: target.user }]
    if (process.env.SSH_AUTH_SOCK) {
        methods.push({ type: 'agent', username: target.user, agent: process.env.SSH_AUTH_SOCK })
    }
    for (const { key } of usableKeys([...target.identityFiles, ...DEFAULT_KEYS])) {
        methods.push({ type: 'publickey', username: target.user, key })
    }
    return methods
}

class Session {
    constructor (alias, cols, rows) {
        this.id = randomUUID()
        this.target = resolveHost(alias)
        this.size = { cols, rows }
        this.queue = []
        this.queuedBytes = 0
        this.wake = null
        this.closed = false
        this.stream = null
        this.client = new Client()
    }

    push (chunk) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        this.queue.push(bytes)
        this.queuedBytes += bytes.length
        if (this.queuedBytes > HIGH_WATER_BYTES) {
            this.setPaused(true)
        }
        this.wake?.()
    }

    setPaused (paused) {
        for (const source of [this.stream, this.stream?.stderr]) {
            if (paused) {
                source?.pause()
            } else {
                source?.resume()
            }
        }
    }

    note (text) {
        this.push(`\r\n\x1b[2m${text}\x1b[0m\r\n`)
    }

    end (reason) {
        if (this.closed) {
            return
        }
        if (reason) {
            this.note(reason)
        }
        this.closed = true
        this.wake?.()
        this.client.end()
        sessions.delete(this.id)
    }

    connect () {
        const { target } = this
        const keyHost = target.hostKeyAlias ?? target.hostname
        if (!target.user) {
            this.end(`No user name for ${target.alias}: add a User line for it to ~/.ssh/config`)
            return
        }
        this.note(`Connecting to ${target.user}@${target.hostname}:${target.port} with pure-JS SSH (ssh2) in the acde backend`)
        const methods = authMethods(target)
        this.client
            .on('banner', text => this.push(text.replace(/\r?\n/g, '\r\n')))
            .on('ready', () => this.openShell())
            .on('error', error => this.end(`SSH error: ${error.message}`))
            .on('close', () => this.end('Connection closed'))
            .connect({
                host: target.hostname,
                port: target.port,
                username: target.user,
                readyTimeout: READY_TIMEOUT_MS,
                keepaliveInterval: KEEPALIVE_MS,
                authHandler: (_methodsLeft, _partial, next) => next(methods.shift() ?? false),
                hostVerifier: key => {
                    const result = checkHostKey(keyHost, target.port, key)
                    if (result !== 'match') {
                        this.note(result === 'mismatch'
                            ? `Host key for ${keyHost} does NOT match ~/.ssh/known_hosts. Refusing to connect.`
                            : `${keyHost} is not in ~/.ssh/known_hosts. Connect once with ssh to trust it.`)
                    }
                    return result === 'match'
                },
            })
    }

    openShell () {
        const { cols, rows } = this.size
        this.client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
            if (error) {
                this.end(`Could not open a shell: ${error.message}`)
                return
            }
            this.stream = stream
            stream.on('data', data => this.push(data))
            stream.stderr.on('data', data => this.push(data))
            stream.on('close', () => this.end())
        })
    }

    input (data) {
        this.stream?.write(data)
    }

    resize (cols, rows) {
        this.size = { cols, rows }
        this.stream?.setWindow(rows, cols, 0, 0)
    }

    /** A ReadableStream of everything the session prints, until it ends. */
    output () {
        if (this.streaming) {
            throw new Error('this session already has an output reader')
        }
        this.streaming = true
        return new ReadableStream({
            pull: async controller => {
                while (!this.queue.length && !this.closed) {
                    await new Promise(resolve => { this.wake = resolve })
                }
                if (this.queue.length) {
                    const output = Buffer.concat(this.queue.splice(0))
                    this.queuedBytes = 0
                    this.setPaused(false)
                    controller.enqueue(new Uint8Array(output))
                } else {
                    controller.close()
                }
            },
            cancel: () => this.end(),
        })
    }
}

export function openSession (alias, cols, rows) {
    const session = new Session(alias, cols, rows)
    sessions.set(session.id, session)
    try {
        session.connect()
    } catch (failure) {
        session.end(`SSH error: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    return session
}

export function getSession (id) {
    return sessions.get(id) ?? null
}
