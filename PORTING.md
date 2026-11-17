# Porting notes: Tabby on Dopame OS

This branch ports [Tabby](https://github.com/Eugeny/tabby) to Dopame OS using the acde toolkit.
Everything outside `tabby-acde/`, `acde-app/`, `scripts/build-acde.mjs`, `WORKLOG.md` and this
file is upstream Tabby code.

## Upstream

| | |
| --- | --- |
| Repository | https://github.com/Eugeny/tabby |
| Version | v1.0.238, commit `467ce8ebfa467fb88cf6d154c9a5891e3d3647f0` |
| License | MIT (upstream `LICENSE` kept unchanged) |
| History | Full upstream history kept; porting work is on branch `acde` |

## Target

Dopame OS, built and tested with acde 0.0.11. The deliverable is a pure JS bundle produced by
`acde build`, with no native modules.

## What changed

New code (the port):

- `acde-app/`: the acde project. `index.html` hosts Tabby's web build; `src/main.js` loads the
  plugin bundles and starts Tabby with a connector.
- `scripts/build-acde.mjs`: builds typings and bundles for the kept packages and assembles them
  into `acde-app/public/tabby`.
- `tabby-acde/`: the platform plugin. Local shells on `acde:terminal`, a default shell provider,
  the window on `acde:window`, and a native menu bar (File, View). Loaded after `tabby-web`, whose
  browser services it keeps.
- `tabby-acde/src/agents/`: the Dopame OS extension. Agent status for every terminal (working,
  waiting, done; tab colour, notifications, "(N waiting)" in the title) and `run` requests that let
  other apps and agents stage a command in a new tab for the user to run.
- `scripts/demo-agent.sh`: a stand-in agent CLI for offline demos and tests.

Upstream files changed (small fixes to Tabby's web build, both also useful upstream):

- `web/polyfills.ts`: import `@angular/compiler` first, so partially compiled Angular packages
  can JIT-compile when the web bundle is built without the Angular linker.
- `web/entry.ts`: set `window.pluginModules`, which `ConfigService.enabledServices()` reads.

- `tabby-core/src/components/appRoot.component.pug`, `tabHeader.component.pug`: accessible names
  (`aria-label`) for icon-only toolbar and tab buttons, so screen readers and agents can use them.

Host-level workarounds (in `acde-app`, no upstream change):

- `fs` stand-in that treats every path as a folder: `tabby-local` validates working directories
  with `fs.statSync`, which a page cannot do; the shell's `cd` reports a missing folder instead.

- `node:url` stand-in for plugin bundles built for webpack's node target.
- `window.__Zone_disable_{MutationObserver,IntersectionObserver,FileReader} = true`: acdert's DOM
  classes have non-enumerable prototype methods, so the zone.js wrappers would lose `observe()`,
  `readAsText()` and the rest.
- `window.process.platform = 'linux'`: Tabby's web preload reports macOS; acde behaves like Linux.
- `acde:terminal.open()` takes no command or working directory, so `tabby-acde` types
  ` cd -- '<dir>'` and ` exec <cmd>` into the new shell instead.

## Dependencies replaced

| Upstream dependency | Native | Replacement |
| --- | --- | --- |
| `node-pty` (via Electron IPC, `tabby-electron/src/pty.ts`) | yes | `acde:terminal` (`tabby-acde/src/pty.ts`) |
| `native-process-working-directory` | yes | `acde:terminal` `cwd` events |
| `ps-node`, `macos-native-processlist`, Windows process tree | yes | none: child-process info is stubbed |
| `fontmanager-redux`, `keytar` | yes | not needed for local shells |
| Electron shell detection (`/etc/passwd`, registry) | no | `AcdeDefaultShellProvider`: the shell acde starts |
| Electron window (`ElectronHostWindow`) | no | `acde:window` (`tabby-acde/src/hostWindow.service.ts`) |
| Config file via Electron main process | no | `acde:fs` private folder (`tabby/config.yaml`, in the host connector) |

## System capabilities used

| Capability | Used for |
| --- | --- |
| `terminal` | Every local shell tab (`acde:terminal`) |
| `fs` | Tabby's config file in the app's private folder |
| `acde:window` (no capability needed) | Window title, fullscreen, minimize, close, menu bar, attention |
| `open: ["tabby"]` | A page or test can send Tabby a `run` request |
| `requests: ["run"]` | Other apps and agents stage commands in a new tab |

## Profiles

Local profiles work as in Tabby: a working directory, a command and arguments. Because
`acde:terminal.open()` starts the default shell and takes no command, the profile is applied by
typing one line into the new shell: `cd -- <dir> && clear; exec <command> <args>`. An SSH host can
be a local profile with command `ssh` and args `[user@host]`, using the system ssh client.

## Cut, and why

- Native SSH and SFTP (`russh`, a Rust module), serial, telnet: native code or raw sockets.
- Plugin manager, auto-updater, docking, touch bar, Windows UAC: no equivalent on Dopame OS.

## Platform feedback for Return AI

See `WORKLOG.md` for the running list.
