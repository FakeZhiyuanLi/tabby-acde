// The parts of the acde modules this plugin uses (acde 0.0.11). The host page registers the real
// modules with Tabby's loader under the same names.

declare module 'acde:terminal' {
    export type TerminalEvent =
        | { type: 'output', data: string }
        | { type: 'cwd', path: string }
        | { type: 'exit', code: number | null, signal: number | null }

    export interface AcdeTerminals {
        open (cols: number, rows: number): Promise<{ id: string }>
        subscribe (id: string, callback: (events: TerminalEvent[]) => void): Promise<void>
        input (id: string, data: string): Promise<{ ok: true }>
        resize (id: string, cols: number, rows: number): Promise<{ cols: number, rows: number }>
        close (id: string): Promise<{ closed: string }>
    }

    export const terminal: AcdeTerminals
}

declare module 'acde:window' {
    export type WindowState = 'normal' | 'minimized' | 'filled' | 'fullscreen'

    export interface AppMenuItem {
        id: string
        label: string
        shortcut?: string
        checked?: boolean
        disabled?: boolean
        onSelect? (): void | Promise<void>
    }

    export interface AppMenu {
        id: string
        label: string
        items: ({ type: 'separator' } | AppMenuItem)[]
    }

    export interface AcdeWindow {
        readonly state: WindowState
        setTitle (title: string): void
        setMenus (menus: readonly AppMenu[]): void
        requestState (state: WindowState): void
        minimize (): Promise<void>
        close (): Promise<boolean>
        on (name: 'activate' | 'deactivate', handler: () => void): () => boolean
    }

    export const window: AcdeWindow
}
