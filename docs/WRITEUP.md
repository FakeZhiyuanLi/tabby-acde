# Tabby on Dopame OS

A port of [Tabby](https://github.com/Eugeny/tabby), the open-source terminal (MIT, about 75,000
GitHub stars), to Dopame OS with the acde toolkit, plus agent features that only make sense on an
agent operating system.

Challenge track: **Port + Extend.**

## Deliverables

| Deliverable | Where |
| --- | --- |
| Code repository | This repository, branch `acde` (full upstream history, 6,586 commits, kept) |
| Bundle Dopame OS loads | GitHub Release [`v1.0.238-acde.1`](https://github.com/FakeZhiyuanLi/tabby-acde/releases/tag/v1.0.238-acde.1): the `acde build` output, with its SHA-256 and commit |
| Write-up with porting notes | This file and [`PORTING.md`](../PORTING.md) |
| Pitch deck | Shared separately |

To build, run and test it yourself, see [`GETTING-STARTED.md`](GETTING-STARTED.md).

## What it is

Tabby is an Angular app that normally runs in Electron, with native modules for terminals
(`node-pty`), SSH (`russh`, written in Rust), process information, fonts and password storage. On
Dopame OS it runs as an acde app with no Electron and no native modules: shells come from
`acde:terminal`, the window from `acde:window`, settings live in the app's private folder through
`acde:fs`, and SSH runs in the app's own backend on `ssh2`, a pure-JavaScript client.

Tabby's own SSH plugin (3,617 lines of TypeScript) runs unchanged: it loads `russh` by name, so the
app registers a stand-in with the same API. Its SSH profiles, host-key dialog, SFTP panel, jump
hosts and remote port forwarding all work.

On top of the port, Tabby gains features for a desktop where agents do much of the work:

- **Agent status.** Tabby recognises coding-agent CLIs (Claude Code, Codex, Gemini CLI) from what
  they print and marks each tab working, waiting for input, or done: a coloured tab, a system
  notification, and "(N waiting)" in the window title.
- **Run requests.** Any app or agent can hand Tabby a command with
  `open('tabby', { kind: 'run', command, cwd, title })`. Tabby opens a titled tab and types the
  command without running it. Control characters are refused in every field, so a request cannot
  press Enter for the user.
- **Readable by agents.** Terminal text is in the accessibility tree, so an agent using `acde mcp`
  can read what a command printed, not only press buttons. (Screen readers benefit too.)

## How the port works

Tabby already separates its platform layer: shared plugins depend on abstract services, and
`tabby-electron` or `tabby-web` provide them. The port adds a third platform:

```
tabby-core · tabby-terminal · tabby-settings · tabby-local · tabby-ssh
(upstream; unchanged except accessible names for icon buttons in tabby-core)
            │ PlatformService, HostWindowService, PTYInterface, ShellProvider, 'russh'
   ┌────────┴────────┬───────────────────┐
tabby-electron     tabby-web           tabby-acde (new) + acde-app (new)
(Electron, node-pty, (browser)          acde:terminal, acde:window, acde:fs, agents;
 russh)                                 russh stand-in -> ssh2 in the acde backend
```

- **`tabby-acde/`** (new plugin): local shells on `acde:terminal`, the window on `acde:window`, a
  native File/View menu bar, the default shell, and the agent features in `src/agents/`.
- **`acde-app/`** (new): the acde project. Its page hosts Tabby's web build and registers the
  modules Tabby expects from Node.js; `src/russh.js` is the SSH stand-in and `backend/` runs SSH
  sessions, SFTP and outgoing sockets.
- **`scripts/`**: `install-acde-deps.mjs` and `build-acde.mjs` install and build only what the port
  uses.

Every replaced dependency and each upstream change is listed in [`PORTING.md`](../PORTING.md).

## What it took

- Two small fixes to Tabby's own web build (load the Angular compiler first; expose
  `window.pluginModules`) and accessible names for Tabby's icon buttons. All three are useful
  upstream.
- Workarounds for platform gaps, each written up with a reproduction and a suggested fix in
  [`PLATFORM-FEEDBACK.md`](PLATFORM-FEEDBACK.md) (16 items). The main one: acdert's DOM classes have
  non-enumerable methods, so zone.js (used by every Angular app) produces observers with no
  `observe()`. It crashed xterm.js and acde's own frame code until diagnosed.
- `acde:terminal` cannot start a specific program or folder, so profiles type
  `cd -- <dir> && clear && exec <command>` into the new shell.
- SSH needed a stand-in for `russh`'s API and an SSH bridge in the backend (host keys, every
  sign-in method, channels, SFTP, jump hosts, remote forwards), plus page-side `net` and `fs.stat`
  answered by the backend.

## Testing

| Suite | Tests | Runs with |
| --- | --- | --- |
| End-to-end, in acde | 9 | `acde test` |
| Backend unit (SSH config, known_hosts, algorithm choices) | 9 | `node --test backend/ssh.test.js` |
| SSH integration, against two throwaway OpenSSH servers | 10 | `bash backend/test/run.sh` (Podman) |

End-to-end tests (`acde-app/e2e/tabby.e2e.ts`), each in a fresh session with its own HOME:

| Test | Checks |
| --- | --- |
| starts with its toolbar and named buttons | Tabby boots in acde; buttons have accessible names |
| runs a command in a local shell on acde:terminal | A command typed in a new tab writes a file in the session's HOME |
| opens settings from the File menu | The native menu bar drives Tabby |
| splits the terminal from the View menu | Split panes create a second terminal |
| stages a run request without running it until the user presses Enter | A request opens a titled tab; nothing runs until Enter |
| rejects a run request whose command contains a newline | Control characters cannot smuggle in an Enter |
| rejects a run request whose folder contains control characters | Nor can a folder name |
| shows a waiting agent in the window title until it is answered | The demo agent sets "(1 waiting)", cleared after approval |
| recognises a Codex approval prompt as waiting | Codex's "Would you like to make the following edits?" sets "(1 waiting)" |

The SSH integration tests cover host keys (and rejecting them), none and password sign-in,
keyboard-interactive, a passphrase-protected key, an SFTP round trip, a jump host, a remote port
forward, backend sockets, recovery after a dismissed prompt, and a connection closing mid-handshake.

Also checked by hand on macOS (Apple Silicon) against three servers over Tailscale: Tabby's SSH tab
and host-key dialog, agent sign-in, SFTP listing, a byte-identical download and upload, a jump host,
and three Codex agents working at once, one per server.

## Limits

- Local and SOCKS port forwarding: acde backends cannot listen on a TCP port.
- Not ported: SSH proxies, X11 forwarding, Pageant, serial, telnet, the plugin manager, the
  auto-updater.
- acde has no sandbox: pages and backends run with the user's permissions. The app declares what it
  needs (terminals, its private files, run requests); enforcing that is up to Dopame OS.
- In the agent demos, the conducting agent does not approve prompts because its instructions say
  so. Tabby itself enforces this only for run requests, which never run without the user's Enter.
- Terminals do not survive an app restart (Tabby restores the tabs, with new shells), and "a program
  is still running" prompts never appear (no process IDs from `acde:terminal`).
- Agent detection reads screen text, so a new agent CLI can need new patterns (Codex did); agents
  reporting their state natively, for example over ACP, would be more precise. A dismissed approval
  prompt can leave a tab amber until the agent prints again.
- Shortcuts are Linux-style on every platform. Tested with acde 0.0.11 on macOS and Linux; not yet
  run or measured on Dopame OS hardware.

## Credits

Tabby is © Eugeny and Tabby contributors, MIT license (upstream `LICENSE` kept). This port is
based on v1.0.238 (`467ce8e`) with full upstream history; porting work is on branch `acde`.
