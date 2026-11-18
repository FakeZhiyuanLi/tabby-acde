// Page side of the russh stand-in. tabby-ssh imports 'russh', a native Rust module; on Dopame OS the
// host page registers this module under that name instead. It has russh's API (lib/index.d.ts) and
// runs each connection in the app's acde backend (backend/russhBridge.js) on ssh2, a pure-JS client.
// Implemented so far: socket transport, host key check, none/password/key/agent/keyboard-interactive
// auth, session channels with PTY, shell and exec, and SFTP. Not yet: jump hosts, remote port
// forwarding, proxies. Local and dynamic forwarding need a TCP listener, which acde backends lack.
import { Subject } from 'rxjs'

const API = '/api/russh'

export const OPEN_READ = 1
export const OPEN_WRITE = 2
export const OPEN_APPEND = 4
export const OPEN_CREATE = 8
export const OPEN_TRUNCATE = 16
export const SFTPFileType = { Directory: 0, File: 1, Symlink: 2, Other: 3 }
export const HashAlgorithm = { Sha1: 0, Sha256: 1, Sha512: 2 }

// What ssh2 supports, in russh's naming (tabby-ssh offers these in its algorithm settings).
const KEX = ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group18-sha512', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1']
const KEY_TYPES = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']
const CIPHERS = ['chacha20-poly1305@openssh.com', 'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr']
const MACS = ['hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512-etm@openssh.com', 'hmac-sha1-etm@openssh.com', 'hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
const COMPRESSION = ['none', 'zlib@openssh.com', 'zlib']

export const getSupportedKexAlgorithms = () => [...KEX]
export const getSupportedKeyTypes = () => [...KEY_TYPES]
export const getSupportedCiphers = () => [...CIPHERS]
export const getSupportedMACs = () => [...MACS]
export const getSupportedCompressionAlgorithms = () => [...COMPRESSION]
export const isPageantRunning = () => false

async function call (path, body) {
    const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    })
    if (response.status === 204) {
        return null
    }
    const answer = await response.json()
    if (!response.ok) {
        throw new Error(answer.error ?? response.statusText)
    }
    return answer
}

async function postBytes (url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body })
    if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText)
    }
}

function fromBase64 (text) {
    const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0))
    return globalThis.Buffer ? globalThis.Buffer.from(bytes) : bytes
}

function unsupported (what) {
    return new Error(`${what} is not supported on Dopame OS yet`)
}

class Destructible {
    destructed = false

    destruct () {
        this.destructed = true
    }

    assertNotDestructed () {
        if (this.destructed) {
            throw new Error('Object has been destructed')
        }
    }
}

export class SshPublicKey {
    constructor (algorithm, blob, fingerprint) {
        this._algorithm = algorithm
        this._blob = blob
        this._fingerprint = fingerprint
    }

    algorithm () {
        return this._algorithm
    }

    fingerprint () {
        return this._fingerprint
    }

    base64 () {
        return btoa(String.fromCharCode(...this._blob))
    }

    bytes () {
        return this._blob
    }
}

/** An OpenSSH public key line ("ssh-ed25519 AAAA... comment"). */
export function parsePublicKey (text) {
    const [algorithm, base64] = text.trim().split(/\s+/)
    if (!algorithm || !base64) {
        throw new Error('not an OpenSSH public key')
    }
    return new SshPublicKey(algorithm, fromBase64(base64), `${algorithm} ${base64.slice(-12)}`)
}

export class KeyPair {
    constructor (data, passphrase, algorithm) {
        this.data = data
        this.passphrase = passphrase
        this._algorithm = algorithm
    }

    get algorithm () {
        return this._algorithm
    }

    /** Throws when the key is invalid or encrypted with another passphrase, as russh does. */
    static async parse (data, passphrase) {
        const answer = await call('/keys/parse', { data, passphrase })
        if (answer.error) {
            throw new Error(answer.error)
        }
        return new KeyPair(data, passphrase, answer.algorithm)
    }
}

export class SshTransport {
    constructor (spec) {
        this.spec = spec
    }

    static async newSocket (address) {
        return new SshTransport({ kind: 'socket', address })
    }

    static async newCommand () {
        throw unsupported('A proxy command')
    }

    /** A jump host: the connection runs over a channel that another connection forwarded. */
    static async newSshChannel (inner) {
        return new SshTransport({ kind: 'channel', connection: inner.connection, channel: inner.channel })
    }

    static async newSocksProxy () {
        throw unsupported('A SOCKS proxy')
    }

    static async newHttpProxy () {
        throw unsupported('An HTTP proxy')
    }
}

/** The connection's NDJSON event stream, dispatched to the client and its channels. */
class ConnectionEvents {
    constructor (id) {
        this.id = id
        this.banner = new Subject()
        this.disconnect = new Subject()
        this.tcpChannelOpen = new Subject()
        this.channels = new Map()
        this.onHostKey = null
        this.read()
    }

    channel (id) {
        if (!this.channels.has(id)) {
            this.channels.set(id, { data: new Subject(), extendedData: new Subject(), eof: new Subject(), closed: new Subject() })
        }
        return this.channels.get(id)
    }

    async read () {
        try {
            const response = await fetch(`${API}/connections/${this.id}/events`)
            const reader = response.body.getReader()
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
                lines.filter(Boolean).forEach(line => this.dispatch(JSON.parse(line)))
            }
        } catch (error) {
            console.error('russh stand-in: event stream failed', error)
        }
        this.finish()
    }

    dispatch (event) {
        if (event.type === 'hostKey') {
            this.onHostKey?.(new SshPublicKey(event.algorithm, fromBase64(event.base64), event.fingerprint))
        } else if (event.type === 'banner') {
            this.banner.next(event.text)
        } else if (event.type === 'tcpChannelOpen') {
            const { targetAddress, targetPort, clientAddress, clientPort } = event
            this.tcpChannelOpen.next({ channel: new NewChannel({ connection: this.id, channel: event.channel }), targetAddress, targetPort, clientAddress, clientPort })
        } else if (event.type === 'data') {
            this.channel(event.channel).data.next(fromBase64(event.data))
        } else if (event.type === 'extendedData') {
            this.channel(event.channel).extendedData.next([event.ext, fromBase64(event.data)])
        } else if (event.type === 'eof') {
            this.channel(event.channel).eof.next()
        } else if (event.type === 'close') {
            const channel = this.channel(event.channel)
            channel.closed.next()
            channel.closed.complete()
            this.channels.delete(event.channel)
        } else if (event.type === 'disconnect') {
            this.finish()
        }
    }

    finish () {
        if (this.disconnect.closed) {
            return
        }
        for (const channel of this.channels.values()) {
            channel.closed.next()
            channel.closed.complete()
        }
        this.channels.clear()
        this.disconnect.next()
        this.disconnect.complete()
    }
}

export class SSHClient extends Destructible {
    constructor (id, events) {
        super()
        this.id = id
        this.events = events
        this.disconnect$ = events.disconnect.asObservable()
        this.banner$ = events.banner.asObservable()
    }

    static async connect (transport, serverKeyCallback, config) {
        const { id } = await call('/connections', { transport: transport.spec, config })
        const events = new ConnectionEvents(id)
        events.onHostKey = async key => {
            let accept = false
            try {
                accept = Boolean(await serverKeyCallback(key))
            } finally {
                await call(`/connections/${id}/host-key`, { accept })
            }
        }
        await call(`/connections/${id}/handshake`)
        return new SSHClient(id, events)
    }

    async authenticateNone (username) {
        return this.authenticate({ type: 'none', username })
    }

    async authenticateWithPassword (username, password) {
        return this.authenticate({ type: 'password', username, password })
    }

    async authenticateWithKeyPair (username, keyPair) {
        return this.authenticate({ type: 'publickey', username, key: keyPair.data, passphrase: keyPair.passphrase })
    }

    async authenticateWithAgent (username, connection) {
        if (connection?.kind !== 'unix-socket') {
            return { remainingMethods: [] }
        }
        return this.authenticate({ type: 'agent', username, agentPath: connection.path })
    }

    // ssh2 offers every agent identity in turn, so a specific identity uses the same path.
    async authenticateWithAgentIdentity (username, connection) {
        return this.authenticateWithAgent(username, connection)
    }

    async startKeyboardInteractiveAuthentication (username) {
        return this.keyboardInteractiveState(await call(`/connections/${this.id}/auth`, { method: { type: 'keyboard-interactive', username } }))
    }

    async continueKeyboardInteractiveAuthentication (responses) {
        return this.keyboardInteractiveState(await call(`/connections/${this.id}/keyboard-interactive`, { responses }))
    }

    async disconnect () {
        await call(`/connections/${this.id}/disconnect`)
    }

    async authenticate (method) {
        this.assertNotDestructed()
        const answer = await call(`/connections/${this.id}/auth`, { method })
        if (answer.result === 'success') {
            return this.intoAuthenticated()
        }
        if (answer.result === 'error') {
            throw new Error(answer.message)
        }
        return { remainingMethods: answer.remainingMethods ?? [] }
    }

    keyboardInteractiveState (answer) {
        if (answer.result === 'success') {
            return this.intoAuthenticated()
        }
        if (answer.result === 'infoRequest') {
            return { state: 'infoRequest', name: answer.name, instructions: answer.instructions, prompts: () => answer.prompts }
        }
        if (answer.result === 'error') {
            throw new Error(answer.message)
        }
        return { state: 'failure', remainingMethods: answer.remainingMethods ?? [] }
    }

    intoAuthenticated () {
        this.destruct()
        return new AuthenticatedSSHClient(this.id, this.events)
    }
}

export class NewChannel {
    constructor (inner) {
        this.inner = inner
    }

    take () {
        if (!this.inner) {
            throw new Error('Channel already taken')
        }
        const inner = this.inner
        this.inner = null
        return inner
    }
}

export class Channel extends Destructible {
    constructor (connectionId, id, subjects) {
        super()
        this.connectionId = connectionId
        this.id = id
        this.data$ = subjects.data.asObservable()
        this.extendedData$ = subjects.extendedData.asObservable()
        this.eof$ = subjects.eof.asObservable()
        this.closed$ = subjects.closed.asObservable()
        this.writes = Promise.resolve()
    }

    path (op) {
        return `/connections/${this.connectionId}/channels/${this.id}/${op}`
    }

    async take () {
        throw unsupported('Using an SSH channel as a transport')
    }

    async requestPTY (term, size) {
        await call(this.path('pty'), { term, size })
    }

    async requestShell () {
        await call(this.path('shell'))
    }

    async requestExec (command) {
        await call(this.path('exec'), { command })
    }

    // Agent forwarding and X11 need an agent and an X server in the backend; neither is there yet.
    async requestAgentForwarding () {
        console.warn('russh stand-in: agent forwarding is not supported yet')
    }

    async requestX11Forwarding () {
        throw unsupported('X11 forwarding')
    }

    async resizePTY (size) {
        await call(this.path('resize'), { size })
    }

    // Writes are sent one after another so they reach the server in order.
    async write (data) {
        const body = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
        const sent = this.writes.then(() => postBytes(API + this.path('write'), body))
        // A failed write is reported to its caller only, so later writes still go out.
        this.writes = sent.catch(() => null)
        await sent
    }

    async eof () {
        await call(this.path('eof'))
    }

    async close () {
        await call(this.path('close'))
    }
}

export class AuthenticatedSSHClient extends Destructible {
    constructor (id, events) {
        super()
        this.id = id
        this.events = events
        this.disconnect$ = events.disconnect.asObservable()
        this.x11ChannelOpen$ = new Subject().asObservable()
        this.tcpChannelOpen$ = events.tcpChannelOpen.asObservable()
        this.agentChannelOpen$ = new Subject().asObservable()
    }

    async openSessionChannel () {
        const { channel } = await call(`/connections/${this.id}/channels`)
        return new NewChannel({ connection: this.id, channel })
    }

    /** A direct-tcpip channel through this server: a jump host's transport or a local forward. */
    async openTCPForwardChannel (options) {
        const { channel } = await call(`/connections/${this.id}/forward-channel`, { options })
        return new NewChannel({ connection: this.id, channel })
    }

    /** Remote forwarding: the server listens; connections arrive on tcpChannelOpen$. */
    async forwardTCPPort (address, port) {
        return (await call(`/connections/${this.id}/forward-port`, { address, port })).port
    }

    async stopForwardingTCPPort (address, port) {
        await call(`/connections/${this.id}/stop-forward`, { address, port })
    }

    async activateChannel (newChannel) {
        const { channel } = newChannel.take()
        const subjects = this.events.channel(channel)
        await call(`/connections/${this.id}/channels/${channel}/activate`)
        return new Channel(this.id, channel, subjects)
    }

    async activateSFTP (newChannel) {
        const { channel } = newChannel.take()
        await call(`/connections/${this.id}/sftp/${channel}/activate`)
        return new SFTP(this.id, channel, this.events.disconnect)
    }

    async disconnect () {
        await call(`/connections/${this.id}/disconnect`)
    }
}

export class SSHAgentStream {
    static async connect () {
        throw unsupported('Agent forwarding')
    }
}

/** An open remote file; reads and writes continue from the backend's position. */
export class SFTPFile {
    constructor (base) {
        this.base = base
    }

    async read (length) {
        const response = await fetch(`${API}${this.base}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ length }),
        })
        if (!response.ok) {
            throw new Error((await response.json()).error ?? response.statusText)
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        return globalThis.Buffer ? globalThis.Buffer.from(bytes) : bytes
    }

    async writeAll (data) {
        const response = await fetch(`${API}${this.base}/write`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data })
        if (!response.ok) {
            throw new Error((await response.json()).error ?? response.statusText)
        }
    }

    // ssh2 writes each chunk before answering, so there is nothing left to flush.
    async flush () { } // eslint-disable-line @typescript-eslint/no-empty-function

    async shutdown () {
        await call(`${this.base}/close`)
    }
}

export class SFTP extends Destructible {
    constructor (connectionId, channel, disconnect) {
        super()
        this.base = `/connections/${connectionId}/sftp/${channel}`
        const closed = new Subject()
        disconnect.subscribe({ complete: () => closed.next() })
        this.closedSubject = closed
        this.closed$ = closed.asObservable()
    }

    op (name, body) {
        return call(`${this.base}/${name}`, body)
    }

    createDirectory (path) {
        return this.op('createDirectory', { path })
    }

    removeDirectory (path) {
        return this.op('removeDirectory', { path })
    }

    removeFile (path) {
        return this.op('removeFile', { path })
    }

    async readlink (path) {
        return (await this.op('readlink', { path })).target
    }

    rename (src, dst) {
        return this.op('rename', { src, dst })
    }

    stat (path) {
        return this.op('stat', { path })
    }

    readDirectory (path) {
        return this.op('readDirectory', { path })
    }

    chmod (path, mode) {
        return this.op('chmod', { path, mode })
    }

    async open (path, mode) {
        const { file } = await this.op('open', { path, mode })
        return new SFTPFile(`${this.base}/files/${file}`)
    }

    async close () {
        await this.op('close')
        this.closedSubject.next()
    }
}
