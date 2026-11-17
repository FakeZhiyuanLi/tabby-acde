import { Injectable } from '@angular/core'
import { TranslateService } from 'tabby-core'
import { Shell, ShellProvider } from 'tabby-local'

/**
 * The shell acde:terminal starts: the user's default shell. An empty command tells AcdePTYInterface
 * not to exec anything else in it.
 */
@Injectable()
export class AcdeDefaultShellProvider extends ShellProvider {
    constructor (private translate: TranslateService) {
        super()
    }

    async provide (): Promise<Shell[]> {
        return [{
            id: 'acde-default',
            name: this.translate.instant('Default shell'),
            command: '',
            args: [],
            env: {},
            shellType: 'unix',
        }]
    }
}
