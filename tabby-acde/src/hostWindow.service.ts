import { Injectable, NgZone } from '@angular/core'
import { HostWindowService } from 'tabby-core'
import { window as acdeWindow } from 'acde:window'
import { AgentStatusService } from './agents/agentStatus'

const DEFAULT_TITLE = 'Tabby'

/**
 * The Tabby window as an acde window: title, fullscreen, minimize and close go to acde:window. The
 * title also counts agents waiting for input, so the desktop shows it even when Tabby is behind.
 */
@Injectable()
export class AcdeHostWindow extends HostWindowService {
    private baseTitle = DEFAULT_TITLE
    private waitingAgents = 0

    get isFullscreen (): boolean {
        return acdeWindow.state === 'fullscreen'
    }

    constructor (agents: AgentStatusService, zone: NgZone) {
        super()
        this.windowShown.next()
        this.windowFocused.next()
        acdeWindow.on('activate', () => zone.run(() => this.windowFocused.next()))
        agents.waitingCount$.subscribe(count => {
            this.waitingAgents = count
            this.renderTitle()
        })
    }

    reload (): void {
        location.reload()
    }

    setTitle (title?: string): void {
        this.baseTitle = title ?? DEFAULT_TITLE
        this.renderTitle()
    }

    private renderTitle (): void {
        const text = this.waitingAgents > 0 ? `(${this.waitingAgents} waiting) ${this.baseTitle}` : this.baseTitle
        document.title = text
        acdeWindow.setTitle(text)
    }

    toggleFullscreen (): void {
        acdeWindow.requestState(this.isFullscreen ? 'normal' : 'fullscreen')
    }

    minimize (): void {
        void acdeWindow.minimize()
    }

    isMaximized (): boolean {
        return acdeWindow.state === 'filled' || acdeWindow.state === 'fullscreen'
    }

    toggleMaximize (): void {
        acdeWindow.requestState(this.isMaximized() ? 'normal' : 'filled')
    }

    close (): void {
        void acdeWindow.close()
    }
}
