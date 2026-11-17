import { Injectable } from '@angular/core'
import { debounceTime, first } from 'rxjs'
import { TerminalService } from 'tabby-local'
import { window as acdeWindow } from 'acde:window'

const MAX_COMMAND_LENGTH = 4000
// Wait for the new shell to finish printing its prompt before typing the command.
const PROMPT_SETTLE_MS = 300
// Any control character (newline, carriage return, escape...) could submit or alter the command.
const CONTROL_CHARACTERS = /[\x00-\x08\x0a-\x1f\x7f]/

export interface RunRequest {
    kind: 'run'
    command: string
    cwd?: string
    title?: string
}

/** Validates a request from another app; returns null for anything that is not a usable run request. */
export function parseRunRequest (request: unknown): RunRequest | null {
    if (typeof request !== 'object' || request === null) {
        return null
    }
    const { kind, command, cwd, title } = request as Record<string, unknown>
    if (kind !== 'run' || typeof command !== 'string') {
        return null
    }
    if (!command.trim() || command.length > MAX_COMMAND_LENGTH || CONTROL_CHARACTERS.test(command)) {
        return null
    }
    if (cwd !== undefined && typeof cwd !== 'string') {
        return null
    }
    if (title !== undefined && typeof title !== 'string') {
        return null
    }
    return { kind, command, cwd, title }
}

/**
 * Lets other apps and agents hand Tabby a command: open('tabby', { kind: 'run', command, cwd, title }).
 * The command is typed into a new tab but not run. The user reviews it and presses Enter, so no app
 * can execute commands in the user's shell on its own.
 */
@Injectable({ providedIn: 'root' })
export class AcdeRunRequests {
    constructor (private terminal: TerminalService) { }

    install (): void {
        acdeWindow.on('request', (request: unknown) => {
            const run = parseRunRequest(request)
            if (!run) {
                console.warn('tabby-acde: ignored a request that is not a valid run request', request)
                return
            }
            this.stage(run).catch(error => console.error('tabby-acde: could not open a tab for a run request', error))
        })
    }

    private async stage (run: RunRequest): Promise<void> {
        const tab = await this.terminal.openTab(null, run.cwd ?? null)
        if (!tab) {
            return
        }
        if (run.title) {
            tab.customTitle = run.title
        }
        tab.output$.pipe(debounceTime(PROMPT_SETTLE_MS), first()).subscribe(() => tab.sendInput(run.command))
    }
}
