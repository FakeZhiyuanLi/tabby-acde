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
| `russh` (SSH, in `tabby-ssh`) | yes (Rust) | a stand-in with the same API (`acde-app/src/russh.js`) running `ssh2` (pure JS) in the app backend |
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

- Serial and telnet: serial ports and raw sockets.
- SFTP, port forwarding, jump hosts and X11 from `tabby-ssh`: its UI is tied to the `russh` API.
  SSH shell sessions are back through the backend (below).
- Plugin manager, auto-updater, docking, touch bar, Windows UAC: no equivalent on Dopame OS.

## Platform feedback for Return AI

See `WORKLOG.md` for the running list.

## SSH through the acde backend

A page cannot open TCP connections, but an acde app can have a Node.js or Bun backend, and talking
to other hosts needs no capability. `acde-app/backend/` runs SSH sessions with `ssh2`, a pure-JS
client, in place of the native `russh` that `tabby-ssh` uses:

- A local profile with command `acde-ssh` and one argument (a host or `~/.ssh/config` alias) opens an
  SSH tab instead of a shell (`tabby-acde/src/ssh.ts`). Tabby's tabs, splits and agent status work
  on it unchanged.
- Hosts resolve through `~/.ssh/config` (HostName, User, Port, IdentityFile, HostKeyAlias). Host
  keys must already be in `~/.ssh/known_hosts` (plain or hashed); unknown, changed or revoked keys
  are refused.
- Authentication tries "none" (Tailscale SSH), then an SSH agent if the backend has one, then key
  files without a passphrase. acde starts backends with a clean environment, so there is usually no
  agent. Passphrase and password prompts are not implemented yet.
- Output streams to the page in a `fetch` response; keystrokes and resizes are small POSTs (acde
  Node.js backends have no WebSocket upgrade).
- `cpu-features`, an optional native add-on of `ssh2`, is replaced by a stub
  (`backend/stubs/cpu-features`). `backend/cjsGlobals.js` defines `__dirname` and `__filename`,
  which `ssh2` reads and the ES module bundle that acde builds does not have.

Verified on macOS (Apple Silicon) against three Linux servers over Tailscale. Config and host key
checks have unit tests (`node --test backend/ssh.test.js`). Not tested in the offline sandbox.

## Tabby's own SSH plugin on a russh stand-in

`tabby-ssh` (3,617 lines) is built and loaded unchanged. Its only native dependency is `russh`, a
Rust module it loads by name at run time, so the host page registers a stand-in with the same API
under that name (`acde-app/src/russh.js`). Each connection runs in the app's acde backend on
`ssh2` (`backend/russhBridge.js`, `backend/russhSftp.js`, routes in `backend/russhRoutes.js`); the
page talks to it with `fetch` and one NDJSON event stream per connection.

Ported (Tabby's own UI): SSH profiles and tabs, Tabby's host key dialog and known hosts, sign-in with
none, password, private keys with passphrases, keyboard-interactive and the SSH agent, the SFTP panel
(browse, upload, download, rename, permissions), jump hosts, and remote port forwarding.

Host pieces the plugin expects from Node.js:

- `process.env.SSH_AUTH_SOCK`: acde starts backends with a clean environment, so the backend asks
  launchd (`launchctl getenv SSH_AUTH_SOCK`) and the page sets it at start (`src/sshHost.js`).
- `fs.stat` / `fs/promises.stat`: the backend answers with the file type only, never contents
  (used for the agent socket check).
- `net.Socket` (`src/net.js`): outgoing sockets opened by the backend (`backend/netSockets.js`), which
  tabby-ssh uses to connect a remote forward to its local target.

Not ported: local and dynamic (SOCKS) forwarding, because acde turns every backend `listen()` into a
private Unix socket that nothing else can reach (`net.createServer` throws with that reason); proxy
commands and SOCKS/HTTP proxies (skipped); X11 forwarding and Pageant (no X server or Pageant).

Tests: `acde-app/backend/test/run.sh` (rack-laptop, Podman) starts two throwaway OpenSSH servers in
a private pod with no published ports and per-run credentials, and runs 8 integration tests against
the bridge: host keys and rejecting them, none/password, keyboard-interactive, a passphrase-protected
key, an SFTP round trip, a jump host, a remote forward and a backend socket. Verified by hand in
Tabby on macOS against three servers over Tailscale: agent sign-in, host key dialogs (fingerprints
checked against the Mac's known_hosts), SFTP listing, a download and an upload (byte-identical),
and a jump host (rack2 reached through rack1).

The simpler `acde-ssh` profiles (one shell over `backend/sessions.js`) remain as a lighter option.
