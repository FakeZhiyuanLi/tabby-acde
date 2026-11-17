import { BaseTerminalTabComponent, TerminalDecorator, XTermFrontend } from 'tabby-terminal'

type TerminalTab = BaseTerminalTabComponent<any>

/**
 * Makes terminal text readable to agents and screen readers. xterm draws its rows on a canvas;
 * screen reader mode adds them as text to the accessibility tree, which is what acde's snapshot
 * (and so acde mcp) reads.
 */
export class ReadableTerminalDecorator extends TerminalDecorator {
    attach (terminal: TerminalTab): void {
        const enable = () => {
            if (terminal.frontend instanceof XTermFrontend) {
                terminal.frontend.xterm.options.screenReaderMode = true
            }
        }
        if (terminal.frontend) {
            enable()
            return
        }
        this.subscribeUntilDetached(terminal, terminal.frontendReady$.subscribe(enable))
    }
}
