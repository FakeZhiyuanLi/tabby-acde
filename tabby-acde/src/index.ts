import { NgModule } from '@angular/core'
import { HostWindowService } from 'tabby-core'
import { PTYInterface, ShellProvider } from 'tabby-local'

import { AcdeHostWindow } from './hostWindow.service'
import { AcdeMenus } from './menus'
import { AcdePTYInterface } from './pty'
import { AcdeDefaultShellProvider } from './shells'

/**
 * Dopame OS platform plugin. Loaded after tabby-web, whose browser services it keeps (context
 * menus, message boxes, clipboard), and overrides what acde does natively: local shells and the
 * window. Config persistence lives in the host page's connector (acde:fs).
 */
@NgModule({
    providers: [
        { provide: HostWindowService, useClass: AcdeHostWindow },
        { provide: PTYInterface, useClass: AcdePTYInterface },
        { provide: ShellProvider, useClass: AcdeDefaultShellProvider, multi: true },
    ],
})
export default class AcdeModule {
    constructor (menus: AcdeMenus) {
        menus.install()
    }
}
