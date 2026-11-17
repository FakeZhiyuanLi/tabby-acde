import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { window as acdeWindow } from 'acde:window'
import { AgentState, agentName, lastSignal, stripAnsi } from './detector'

// An agent that printed nothing for this long after working is treated as finished.
const QUIET_MS = 4000
// The end of the previous chunk is kept so a phrase split across two chunks still matches.
const CONTEXT_CHARS = 200
const DEFAULT_AGENT_NAME = 'Agent'

const TAB_COLORS: Record<AgentState, string | null> = {
    idle: null,
    working: '#3b82f6',
    waiting: '#f59e0b',
    done: '#22c55e',
}

type TerminalTab = BaseTerminalTabComponent<any>

interface TrackedTab {
    state: AgentState
    agent: string | null
    tail: string
    quietTimer: ReturnType<typeof setTimeout> | null
}

/** Agent state for every terminal tab: tab colours, notifications and a waiting count. */
@Injectable({ providedIn: 'root' })
export class AgentStatusService {
    private tabs = new Map<TerminalTab, TrackedTab>()
    private waitingCount = new BehaviorSubject<number>(0)

    get waitingCount$ (): Observable<number> {
        return this.waitingCount
    }

    track (terminal: TerminalTab): void {
        this.tabs.set(terminal, { state: 'idle', agent: null, tail: '', quietTimer: null })
    }

    untrack (terminal: TerminalTab): void {
        const tracked = this.tabs.get(terminal)
        if (tracked?.quietTimer) {
            clearTimeout(tracked.quietTimer)
        }
        this.tabs.delete(terminal)
        this.publishWaitingCount()
    }

    handleOutput (terminal: TerminalTab, data: string): void {
        const tracked = this.tabs.get(terminal)
        if (!tracked) {
            return
        }
        const text = tracked.tail + stripAnsi(data)
        tracked.tail = text.slice(-CONTEXT_CHARS)
        tracked.agent = tracked.agent ?? agentName(text)

        const signal = lastSignal(text)
        if (signal) {
            this.setState(terminal, tracked, signal)
        }
        this.restartQuietTimer(terminal, tracked)
    }

    // Looking at a finished agent's tab acknowledges it.
    handleFocus (terminal: TerminalTab): void {
        const tracked = this.tabs.get(terminal)
        if (tracked?.state === 'done') {
            this.setState(terminal, tracked, 'idle')
        }
    }

    private restartQuietTimer (terminal: TerminalTab, tracked: TrackedTab): void {
        if (tracked.quietTimer) {
            clearTimeout(tracked.quietTimer)
        }
        tracked.quietTimer = setTimeout(() => {
            tracked.quietTimer = null
            if (tracked.state === 'working') {
                this.setState(terminal, tracked, 'done')
            }
        }, QUIET_MS)
    }

    private setState (terminal: TerminalTab, tracked: TrackedTab, state: AgentState): void {
        if (tracked.state === state) {
            return
        }
        tracked.state = state
        const headerTab = terminal.parent ?? terminal
        headerTab.color = TAB_COLORS[state]

        const agent = tracked.agent ?? DEFAULT_AGENT_NAME
        if (state === 'waiting') {
            this.notify(`${agent} needs your input`, terminal.title)
            void acdeWindow.requestAttention()
        } else if (state === 'done') {
            this.notify(`${agent} finished`, terminal.title)
        }
        this.publishWaitingCount()
    }

    private publishWaitingCount (): void {
        const count = [...this.tabs.values()].filter(tab => tab.state === 'waiting').length
        if (count !== this.waitingCount.value) {
            this.waitingCount.next(count)
        }
    }

    private notify (title: string, body: string): void {
        try {
            new Notification(title, { body }) // eslint-disable-line no-new
        } catch (error) {
            console.warn('tabby-acde: could not show a notification', error)
        }
    }
}

/** Feeds every terminal tab's output and focus into AgentStatusService. */
@Injectable()
export class AgentStatusDecorator extends TerminalDecorator {
    constructor (private agents: AgentStatusService) {
        super()
    }

    attach (terminal: TerminalTab): void {
        this.agents.track(terminal)
        this.subscribeUntilDetached(terminal, terminal.output$.subscribe(data => this.agents.handleOutput(terminal, data)))
        this.subscribeUntilDetached(terminal, terminal.focused$.subscribe(() => this.agents.handleFocus(terminal)))
    }

    detach (terminal: TerminalTab): void {
        this.agents.untrack(terminal)
        super.detach(terminal)
    }
}
