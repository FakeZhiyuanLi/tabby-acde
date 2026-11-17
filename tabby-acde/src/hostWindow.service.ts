import { Injectable } from '@angular/core'
import { HostWindowService } from 'tabby-core'
import { window as acdeWindow } from 'acde:window'

const DEFAULT_TITLE = 'Tabby'

/** The Tabby window as an acde window: title, fullscreen, minimize and close go to acde:window. */
@Injectable()
export class AcdeHostWindow extends HostWindowService {
    get isFullscreen (): boolean {
        return acdeWindow.state === 'fullscreen'
    }

    constructor () {
        super()
        this.windowShown.next()
        this.windowFocused.next()
        acdeWindow.on('activate', () => this.windowFocused.next())
    }

    reload (): void {
        location.reload()
    }

    setTitle (title?: string): void {
        const text = title ?? DEFAULT_TITLE
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
