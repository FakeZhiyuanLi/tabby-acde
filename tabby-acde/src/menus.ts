import { Injectable } from '@angular/core'
import { AppService, HostWindowService, SplitDirection, SplitTabComponent, TranslateService } from 'tabby-core'
import { TerminalService } from 'tabby-local'
import { SettingsTabComponent } from 'tabby-settings'
import { window as acdeWindow } from 'acde:window'

/**
 * The window's menu bar on Dopame OS (acde:window), built on Tabby's public services. On Dopame OS
 * the desktop shows the focused window's menus; agents can choose items with `acde act`.
 */
@Injectable({ providedIn: 'root' })
export class AcdeMenus {
    constructor (
        private app: AppService,
        private hostWindow: HostWindowService,
        private terminal: TerminalService,
        private translate: TranslateService,
    ) { }

    install (): void {
        const t = (text: string) => this.translate.instant(text)
        acdeWindow.setMenus([
            {
                id: 'file',
                label: t('File'),
                items: [
                    { id: 'new-terminal', label: t('New terminal'), onSelect: () => this.openTerminal() },
                    { id: 'settings', label: t('Settings'), onSelect: () => this.openSettings() },
                    { type: 'separator' },
                    { id: 'close-tab', label: t('Close tab'), onSelect: () => this.closeActiveTab() },
                    { id: 'close-window', label: t('Close window'), onSelect: () => this.hostWindow.close() },
                ],
            },
            {
                id: 'view',
                label: t('View'),
                items: [
                    { id: 'split-right', label: t('Split right'), onSelect: () => this.split('r') },
                    { id: 'split-down', label: t('Split down'), onSelect: () => this.split('b') },
                    { type: 'separator' },
                    { id: 'fullscreen', label: t('Toggle fullscreen'), onSelect: () => this.hostWindow.toggleFullscreen() },
                ],
            },
        ])
    }

    private async openTerminal (): Promise<void> {
        await this.terminal.openTab()
    }

    // Same behaviour as tabby-settings' toolbar button: reuse an open settings tab.
    private openSettings (): void {
        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsTabComponent)
        if (settingsTab) {
            this.app.selectTab(settingsTab)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent })
        }
    }

    private async closeActiveTab (): Promise<void> {
        const tab = this.app.activeTab
        if (tab) {
            await this.app.closeTab(tab, true)
        }
    }

    private async split (direction: SplitDirection): Promise<void> {
        const tab = this.app.activeTab
        if (!(tab instanceof SplitTabComponent)) {
            return
        }
        const focused = tab.getFocusedTab()
        if (focused) {
            await tab.splitTab(focused, direction)
        }
    }
}
