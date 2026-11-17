import { terminal as acdeTerminal, TerminalEvent } from 'acde:terminal'
import { ChildProcess, PTYInterface, PTYProxy } from 'tabby-local'

const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 30

interface SpawnOptions {
    cols?: number
    rows?: number
    cwd?: string
}

type Handler = (...args: any[]) => void

function shellQuote (value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * acde:terminal.open() always starts the user's default shell and takes no command or working
 * directory, so both are typed into the new shell. The leading space keeps the lines out of the
 * shell history where HISTCONTROL=ignorespace (the bash default on most distributions).
 */
export function startupInput (command: string, args: string[], cwd?: string): string {
    const lines: string[] = []
    if (cwd) {
        lines.push(` cd -- ${shellQuote(cwd)}`)
    }
    if (command) {
        lines.push(` exec ${[command, ...args].map(shellQuote).join(' ')}`)
    }
    return lines.map(line => `${line}\r`).join('')
}

/** A local shell running in an acde:terminal, in the shape tabby-local's session expects. */
export class AcdePTYProxy extends PTYProxy {
    private handlers = new Map<string, Handler[]>()
    private pendingOutput: Uint8Array[] = []
    private encoder = new TextEncoder()
    private decoder = new TextDecoder()
    private workingDirectory: string | null
    private closed = false

    constructor (private id: string, initialCWD: string | null) {
        super()
        this.workingDirectory = initialCWD
    }

    handleEvents (events: TerminalEvent[]): void {
        for (const event of events) {
            if (event.type === 'output') {
                this.emitOutput(this.encoder.encode(event.data))
            } else if (event.type === 'cwd') {
                this.workingDirectory = event.path
            } else {
                this.emit('exit')
                this.markClosed()
            }
        }
    }

    getID (): string {
        return this.id
    }

    // acde:terminal does not expose process IDs.
    async getPID (): Promise<number> {
        return 0
    }

    async getTruePID (): Promise<number> {
        return 0
    }

    async getChildProcesses (): Promise<ChildProcess[]> {
        return []
    }

    async getWorkingDirectory (): Promise<string | null> {
        return this.workingDirectory
    }

    async resize (columns: number, rows: number): Promise<void> {
        await acdeTerminal.resize(this.id, columns, rows)
    }

    async write (data: Buffer): Promise<void> {
        await acdeTerminal.input(this.id, this.decoder.decode(data, { stream: true }))
    }

    async kill (_signal?: string): Promise<void> {
        if (this.closed) {
            return
        }
        await acdeTerminal.close(this.id)
        this.markClosed()
    }

    // acde:terminal applies its own flow control.
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

    private emitOutput (chunk: Uint8Array): void {
        if (!this.handlers.get('data')?.length) {
            this.pendingOutput.push(chunk)
            return
        }
        this.emit('data', chunk)
    }

    private emit (event: string, ...args: any[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args)
        }
    }

    private markClosed (): void {
        if (this.closed) {
            return
        }
        this.closed = true
        this.emit('close')
    }
}

/** Replaces tabby-electron's node-pty bridge: every local shell is an acde:terminal. */
export class AcdePTYInterface extends PTYInterface {
    async spawn (command: string, args: string[], options: SpawnOptions): Promise<PTYProxy> {
        const { id } = await acdeTerminal.open(options.cols ?? DEFAULT_COLUMNS, options.rows ?? DEFAULT_ROWS)
        const proxy = new AcdePTYProxy(id, options.cwd ?? null)
        await acdeTerminal.subscribe(id, events => proxy.handleEvents(events))
        const input = startupInput(command, args ?? [], options.cwd)
        if (input) {
            await acdeTerminal.input(id, input)
        }
        return proxy
    }

    // Terminals do not survive an app restart in acde, so there is nothing to restore.
    async restore (_id: string): Promise<PTYProxy | null> {
        return null
    }
}
