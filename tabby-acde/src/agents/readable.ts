import { fromEvent } from 'rxjs'
import { BaseTerminalTabComponent, TerminalDecorator, XTermFrontend } from 'tabby-terminal'

type TerminalTab = BaseTerminalTabComponent<any>

/**
 * Makes terminal text readable to agents and screen readers. xterm draws its rows on a canvas;
 * screen reader mode adds them as text to the accessibility tree, which is what acde's snapshot
 * (and so acde mcp) reads.
 *
 * In screen reader mode xterm ignores text that arrives as an input event (insertText) and only
 * takes typed characters from keypress. acde's act type, and assistive tools, send input events,
 * so those are forwarded here unless a keypress with a character already delivered the text.
 */
export class ReadableTerminalDecorator extends TerminalDecorator {
    attach (terminal: TerminalTab): void {
        const enable = () => {
            if (!(terminal.frontend instanceof XTermFrontend)) {
                return
            }
            const xterm = terminal.frontend.xterm
            xterm.options.screenReaderMode = true
            if (xterm.textarea) {
                this.forwardInputEvents(terminal, xterm.textarea)
            }
        }
        if (terminal.frontend) {
            enable()
            return
        }
        this.subscribeUntilDetached(terminal, terminal.frontendReady$.subscribe(enable))
    }

    private forwardInputEvents (terminal: TerminalTab, textarea: HTMLTextAreaElement): void {
        let keypressDelivered = false
        this.subscribeUntilDetached(terminal, fromEvent<KeyboardEvent>(textarea, 'keydown').subscribe(() => {
            keypressDelivered = false
        }))
        this.subscribeUntilDetached(terminal, fromEvent<KeyboardEvent>(textarea, 'keypress').subscribe(event => {
            keypressDelivered = event.charCode > 0
        }))
        this.subscribeUntilDetached(terminal, fromEvent<InputEvent>(textarea, 'input').subscribe(event => {
            const delivered = keypressDelivered
            keypressDelivered = false
            if (event.inputType !== 'insertText' || !event.data || event.isComposing || delivered) {
                return
            }
            terminal.sendInput(event.data)
            textarea.value = ''
        }))
    }
}
