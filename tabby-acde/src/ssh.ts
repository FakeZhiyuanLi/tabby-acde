import { NgZone } from '@angular/core'

import { BufferedPTYProxy } from './bufferedPty'

/**
 * A profile whose command is this opens an SSH session instead of a local shell; its first argument
 * is the host or ~/.ssh/config alias. The session runs in the app's acde backend on ssh2 (pure JS),
 * because a page cannot open TCP connections.
 */
export const SSH_COMMAND = 'acde-ssh'

const SESSIONS_URL = '/api/ssh/sessions'

/** An SSH shell in the app's backend, in the shape tabby-local's session expects. */
export class AcdeSSHPTYProxy extends BufferedPTYProxy {
    private writes: Promise<unknown> = Promise.resolve()

    private constructor (private id: string, private zone: NgZone) {
        super()
    }

    static async open (zone: NgZone, host: string, cols: number, rows: number): Promise<AcdeSSHPTYProxy> {
        const response = await fetch(SESSIONS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, cols, rows }),
        })
        const body = await response.json()
        if (!response.ok) {
            throw new Error(`SSH to ${host}: ${body.error ?? response.statusText}`)
        }
        const proxy = new AcdeSSHPTYProxy(body.id, zone)
        proxy.readOutput()
        return proxy
    }

    getID (): string {
        return this.id
    }

    // The working directory is on the remote host, so new tabs cannot start in it.
    async getWorkingDirectory (): Promise<string | null> {
        return null
    }

    async resize (columns: number, rows: number): Promise<void> {
        await this.post('resize', JSON.stringify({ cols: columns, rows }), 'application/json')
    }

    // Keystrokes are sent one request after another, so they arrive in order.
    async write (data: Buffer): Promise<void> {
        const sent = this.writes.then(() => this.post('input', new Uint8Array(data), 'application/octet-stream'))
        // A failed write is reported to its caller only, so later keystrokes still go out.
        this.writes = sent.catch(() => null)
        await sent
    }

    async kill (_signal?: string): Promise<void> {
        if (this.closed) {
            return
        }
        await fetch(`${SESSIONS_URL}/${this.id}`, { method: 'DELETE' }).catch(() => null)
        this.markClosed()
    }

    private async post (action: string, body: BodyInit, contentType: string): Promise<void> {
        if (this.closed) {
            return
        }
        const response = await fetch(`${SESSIONS_URL}/${this.id}/${action}`, { method: 'POST', headers: { 'Content-Type': contentType }, body })
        if (!response.ok) {
            throw new Error(`SSH ${action} failed (${response.status})`)
        }
    }

    // acde delivers the stream outside Angular's zone; running the output inside it lets Angular
    // update the tab title and agent status that terminal output changes.
    private async readOutput (): Promise<void> {
        try {
            const response = await fetch(`${SESSIONS_URL}/${this.id}/output`)
            const reader = response.body!.getReader()
            for (;;) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }
                this.zone.run(() => this.emitOutput(value))
            }
        } catch (error) {
            const message = `\r\nSSH stream failed: ${error instanceof Error ? error.message : String(error)}\r\n`
            this.zone.run(() => this.emitOutput(new TextEncoder().encode(message)))
        }
        this.zone.run(() => {
            this.emit('exit')
            this.markClosed()
        })
    }
}
