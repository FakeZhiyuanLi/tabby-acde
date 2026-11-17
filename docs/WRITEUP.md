# Tabby on Dopame OS

A port of [Tabby](https://github.com/Eugeny/tabby), the open-source terminal (MIT, about 75,000
GitHub stars), to Dopame OS with the acde toolkit, plus agent features that only make sense on an
agent operating system.

Challenge track: **Port + Extend.**

## What it is

Tabby is an Angular app that normally runs in Electron, with native modules for terminals
(`node-pty`), process information, fonts and password storage. On Dopame OS it now runs as a
regular acde app: one JS bundle, no Electron and no native modules. Shells come from
`acde:terminal`, the window from `acde:window`, and settings live in the app's private folder
through `acde:fs`.

On top of the port, Tabby gains two Dopame-native features:

- **Agent status.** Tabby recognises coding-agent CLIs (Claude Code, Codex, Gemini CLI and others)
  from what they print, and marks each tab working, waiting for input, or done: a coloured tab, a
  system notification, and "(N waiting)" in the window title.
- **Run requests.** Any app or agent on Dopame OS can hand Tabby a command with
  `open('tabby', { kind: 'run', command, cwd, title })`. Tabby opens a titled tab and types the
  command without running it, so the user stays in control of their shell.

## How the port works

Tabby already separates its platform layer: shared plugins (`tabby-core`, `tabby-terminal`,
`tabby-settings`, `tabby-local`) depend on abstract services, and `tabby-electron` or `tabby-web`
provide them. The port adds a third platform:

```
tabby-core · tabby-terminal · tabby-settings · tabby-local     (upstream, unchanged)
            │ PlatformService, HostWindowService, PTYInterface, ShellProvider
   ┌────────┴────────┬───────────────────┐
tabby-electron     tabby-web           tabby-acde (new)
(Electron, node-pty) (browser)          acde:terminal, acde:window, acde:fs, agents
```

- **`tabby-acde/`** (new plugin): `AcdePTYInterface` runs every local shell on `acde:terminal`;
  `AcdeHostWindow` maps title, fullscreen and close to `acde:window`; a native File/View menu bar;
  the default shell provider; and the agent features in `src/agents/`.
- **`acde-app/`** (new): the acde project. Its page hosts Tabby's web build, registers the acde
  modules with Tabby's module loader, and saves config through `acde:fs`.
- **`scripts/build-acde.mjs`** (new): builds the kept packages and assembles them into the app.

Full porting notes, including every replaced dependency and each upstream change, are in
[`PORTING.md`](../PORTING.md).

## What it took

- Two small fixes to Tabby's own web build (load the Angular compiler first; expose
  `window.pluginModules`) and accessible names for Tabby's icon buttons. All three are useful
  upstream.
- Workarounds for platform gaps, each documented with a suggested fix in
  [`PLATFORM-FEEDBACK.md`](PLATFORM-FEEDBACK.md). The main one: acdert's DOM classes have
  non-enumerable methods, so zone.js (used by every Angular app) produces observers with no
  `observe()`. It crashed xterm.js and acde's own frame code until diagnosed.
- `acde:terminal` cannot start a specific program or folder, so profiles type
  `cd -- <dir> && clear; exec <command>` into the new shell.

## Testing

End-to-end tests in `acde-app/e2e/tabby.e2e.ts` run with `acde test` (each test in a fresh, isolated
session with its own HOME):

| Test | Checks |
| --- | --- |
| starts with its toolbar and named buttons | Tabby boots in acde; buttons have accessible names |
| runs a command in a local shell on acde:terminal | A command typed in a new tab writes a file in the session's HOME |
| opens settings from the File menu | The native menu bar drives Tabby |
| splits the terminal from the View menu | Split panes create a second terminal |
| stages a run request without running it until the user presses Enter | A request opens a titled tab; nothing runs until Enter |
| rejects a run request whose command contains a newline | Control characters cannot smuggle in an Enter |
| shows a waiting agent in the window title until it is answered | The demo agent sets "(1 waiting)", cleared after approval |

All 7 pass (27 s for the suite on an Intel Iris Xe GPU, headless). `acde test --trace --video=on`
saves a step-by-step trace and a recording for each test.

## Build and run

```sh
yarn install --ignore-scripts      # root, app/, web/ and the kept plugins (see WORKLOG.md)
node scripts/build-acde.mjs        # typings, bundles, assemble into acde-app/public/tabby
cd acde-app && npm install && acde dev
acde test --trace                  # end-to-end tests (needs Bun and a GPU)
acde build                         # the bundle Dopame OS loads
```

## Limits

- Cut: native SSH and SFTP (`russh`), serial, telnet, plugin manager, auto-updater. An SSH host can
  be a local profile that runs the system `ssh`.
- Terminals do not survive an app restart (Tabby restores the tabs, with new shells).
- Process information is not available from `acde:terminal`, so "a program is still running"
  prompts never appear.
- Agent detection reads screen text; agents that report their state natively would be more precise.

## Credits

Tabby is © Eugeny and Tabby contributors, MIT license (upstream `LICENSE` kept). This port is
based on v1.0.238 (`467ce8e`) with full upstream history; porting work is on branch `acde`.
