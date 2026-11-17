import { ChildProcess, PTYProxy } from 'tabby-local'

export type Handler = (...args: any[]) => void

/**
 * Event plumbing shared by the PTYs tabby-acde provides: output that arrives before tabby-local
 * subscribes is kept and replayed, and 'close' is emitted once.
 */
export abstract class BufferedPTYProxy extends PTYProxy {
    protected closed = false
    private handlers = new Map<string, Handler[]>()
    private pendingOutput: Uint8Array[] = []

    // Neither acde:terminal nor an SSH session exposes process IDs.
    async getPID (): Promise<number> {
        return 0
    }

    async getTruePID (): Promise<number> {
        return 0
    }

    async getChildProcesses (): Promise<ChildProcess[]> {
        return []
    }

    // Flow control is done by acde:terminal and by the SSH channel.
    ackData (_length: number): void { } // eslint-disable-line @typescript-eslint/no-empty-function

    subscribe (event: string, handler: Handler): void {
        this.handlers.set(event, [...this.handlers.get(event) ?? [], handler])
        if (event === 'data') {
            const pending = this.pendingOutput
            this.pendingOutput = []
            pending.forEach(chunk => handler(chunk))
        }
    }

    unsubscribeAll (): void {
        this.handlers.clear()
    }

    protected emitOutput (chunk: Uint8Array): void {
        if (!this.handlers.get('data')?.length) {
            this.pendingOutput.push(chunk)
            return
        }
        this.emit('data', chunk)
    }

    protected emit (event: string, ...args: any[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args)
        }
    }

    protected markClosed (): void {
        if (this.closed) {
            return
        }
        this.closed = true
        this.emit('close')
    }
}
