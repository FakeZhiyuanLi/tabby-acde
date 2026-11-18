// The 'net' module for plugins, as far as a page can have it: outgoing sockets only, opened by the
// app's acde backend (backend/netSockets.js). tabby-ssh uses Socket to connect a remote port forward
// to its local target. Listening (createServer) is not possible: acde turns every backend listen()
// into a private Unix socket, so nothing else could connect to it.
const API = '/api/russh/sockets'
const WAIT_FOR_ID_MS = 20
const WAIT_FOR_ID_TRIES = 100

function toBuffer (bytes) {
    return globalThis.Buffer ? globalThis.Buffer.from(bytes) : bytes
}

class Emitter {
    handlers = new Map()

    on (event, listener) {
        this.handlers.set(event, [...this.handlers.get(event) ?? [], listener])
        return this
    }

    once (event, listener) {
        const wrapped = (...args) => {
            this.off(event, wrapped)
            listener(...args)
        }
        return this.on(event, wrapped)
    }

    off (event, listener) {
        this.handlers.set(event, (this.handlers.get(event) ?? []).filter(l => l !== listener))
        return this
    }

    removeListener (event, listener) {
        return this.off(event, listener)
    }

    emit (event, ...args) {
        for (const listener of this.handlers.get(event) ?? []) {
            listener(...args)
        }
        return true
    }
}

export class Socket extends Emitter {
    id = null
    writes = Promise.resolve()
    destroyed = false

    connect (port, host = '127.0.0.1') {
        this.open(String(host), Number(port)).catch(error => this.emit('error', error))
        return this
    }

    async open (host, port) {
        const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port }) })
        const answer = await response.json()
        if (!response.ok) {
            throw new Error(answer.error ?? response.statusText)
        }
        this.id = answer.id
        await this.readEvents()
    }

    async readEvents () {
        const reader = (await fetch(`${API}/${this.id}/events`)).body.getReader()
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
    }

    dispatch (event) {
        if (event.type === 'data') {
            this.emit('data', toBuffer(Uint8Array.from(atob(event.data), c => c.charCodeAt(0))))
        } else if (event.type === 'error') {
            this.emit('error', Object.assign(new Error(event.message), { code: event.code }))
        } else if (event.type === 'close') {
            this.destroyed = true
            this.emit('close', false)
        } else {
            this.emit(event.type)
        }
    }

    // Writes go out one after another, in order, once the socket exists.
    write (data, callback) {
        const body = typeof data === 'string' ? new TextEncoder().encode(data) : data
        this.writes = this.writes.then(() => this.send('write', body)).then(() => callback?.(), error => callback?.(error))
        return true
    }

    end () {
        this.writes = this.writes.then(() => this.send('end'))
        return this
    }

    destroy (error) {
        if (error) {
            this.emit('error', error)
        }
        this.writes = this.writes.then(() => this.send('destroy'))
        return this
    }

    async send (op, body) {
        for (let attempt = 0; !this.id && attempt < WAIT_FOR_ID_TRIES; attempt++) {
            await new Promise(resolve => setTimeout(resolve, WAIT_FOR_ID_MS))
        }
        if (!this.id) {
            return
        }
        await fetch(`${API}/${this.id}/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body })
    }
}

export function connect (port, host) {
    return new Socket().connect(port, host)
}

export const createConnection = connect

function noListening () {
    throw new Error('Listening for connections is not possible on Dopame OS: acde turns backend listen() into a private Unix socket')
}

export const createServer = noListening

export class Server {
    constructor () {
        noListening()
    }
}
