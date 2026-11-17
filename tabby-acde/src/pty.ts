import { Injectable, NgZone } from '@angular/core'
import { terminal as acdeTerminal, TerminalEvent } from 'acde:terminal'
import { PTYInterface, PTYProxy } from 'tabby-local'

import { BufferedPTYProxy } from './bufferedPty'
import { AcdeSSHPTYProxy, SSH_COMMAND } from './ssh'

const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 30

interface SpawnOptions {
    cols?: number
    rows?: number
    cwd?: string
}

function shellQuote (value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

// acde:terminal reports home-relative working directories ("~/projects"), and Tabby opens new tabs
// in the current tab's directory, so a leading ~ must stay expandable by the shell.
function shellPath (path: string): string {
    if (path === '~') {
        return '"$HOME"'
    }
    if (path.startsWith('~/')) {
        return `"$HOME"/${shellQuote(path.slice(2))}`
    }
    return shellQuote(path)
}

/**
 * acde:terminal.open() always starts the user's default shell and takes no command or working
 * directory, so both are typed into the new shell as one line. The screen is cleared once the
 * directory change succeeds (a failed `cd` stays visible). The leading space keeps the line out of
 * the shell history where HISTCONTROL=ignorespace (the bash default on most distributions).
 */
export function startupInput (command: string, args: string[], cwd?: string): string {
    const steps: string[] = []
    if (cwd) {
        steps.push(`cd -- ${shellPath(cwd)} && clear`)
    } else if (command) {
        steps.push('clear')
    }
    if (command) {
        steps.push(`exec ${[command, ...args].map(shellQuote).join(' ')}`)
    }
    return steps.length ? ` ${steps.join('; ')}\r` : ''
}

/** A local shell running in an acde:terminal, in the shape tabby-local's session expects. */
export class AcdePTYProxy extends BufferedPTYProxy {
    private encoder = new TextEncoder()
    private decoder = new TextDecoder()
    private workingDirectory: string | null

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
}

/** Replaces tabby-electron's node-pty bridge: every local shell is an acde:terminal. */
@Injectable()
export class AcdePTYInterface extends PTYInterface {
    // acde calls back outside Angular's zone; running the events inside it lets Angular update the
    // tab title, colour and other bindings that terminal output changes.
    constructor (private zone: NgZone) {
        super()
    }

    async spawn (command: string, args: string[], options: SpawnOptions): Promise<PTYProxy> {
        if (command === SSH_COMMAND) {
            return AcdeSSHPTYProxy.open(this.zone, args?.[0] ?? '', options.cols ?? DEFAULT_COLUMNS, options.rows ?? DEFAULT_ROWS)
        }
        const { id } = await acdeTerminal.open(options.cols ?? DEFAULT_COLUMNS, options.rows ?? DEFAULT_ROWS)
        const proxy = new AcdePTYProxy(id, options.cwd ?? null)
        await acdeTerminal.subscribe(id, events => this.zone.run(() => proxy.handleEvents(events)))
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
