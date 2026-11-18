// Outgoing TCP sockets for the page's net.Socket stand-in (src/net.js). tabby-ssh uses them to connect a
// remote port forward to its local target. Events stream as NDJSON, data as base64.
import { randomUUID } from 'node:crypto'
import { Socket } from 'node:net'

const sockets = new Map()

class PageSocket {
    constructor (host, port) {
        this.id = randomUUID()
        this.queue = []
        this.wake = null
        this.closed = false
        this.socket = new Socket()
            .on('connect', () => this.emit({ type: 'connect' }))
            .on('data', data => this.emit({ type: 'data', data: data.toString('base64') }))
            .on('end', () => this.emit({ type: 'end' }))
            .on('error', error => this.emit({ type: 'error', message: error.message, code: error.code }))
            .on('close', () => this.finish())
        this.socket.connect(port, host)
    }

    emit (event) {
        this.queue.push(JSON.stringify(event) + '\n')
        this.wake?.()
    }

    finish () {
        if (this.closed) {
            return
        }
        this.emit({ type: 'close' })
        this.closed = true
        this.wake?.()
        sockets.delete(this.id)
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
            cancel: () => this.socket.destroy(),
        })
    }

    write (data) {
        return new Promise((resolve, reject) => this.socket.write(data, error => (error ? reject(error) : resolve())))
    }

    end () {
        this.socket.end()
    }

    destroy () {
        this.socket.destroy()
    }
}

export function openSocket (host, port) {
    const socket = new PageSocket(host, port)
    sockets.set(socket.id, socket)
    return socket
}

export function getSocket (id) {
    return sockets.get(id) ?? null
}
