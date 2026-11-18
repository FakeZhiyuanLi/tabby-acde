# Getting started: Tabby on Dopame OS (acde)

How to build, run and test the acde port of Tabby from a clean checkout of branch `acde`. For what
changed and why, see [PORTING.md](../PORTING.md); for issues found in acde, see
[PLATFORM-FEEDBACK.md](PLATFORM-FEEDBACK.md).

## Before you start

- **acde runs code without a sandbox.** acde 0.0.11 pages and backends run with your user's
  permissions ("Pages have no security sandbox", acde's web compatibility notes). Tabby's shells are
  real shells on your machine. During development we evaluated acde inside a rootless Podman
  container with no network; the macOS runs were native.
- Tested on macOS 27 (Apple Silicon) and Linux x86_64 (Ubuntu 26.04 in Podman) with acde 0.0.11.

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| acde | 0.0.11 (`curl -fsSL https://pkgs.dopame.ai/acde/install.sh \| sh`) | running, testing and building the app |
| Node.js | 22.3 or newer | builds, the app backend, unit tests |
| Yarn | 1.22 (fetched with `npx` if missing) | Tabby's dependencies |
| Bun | 1.4 or newer | `acde test` only |
| Podman | any recent | SSH integration tests only |

## Build

From the repository root, on branch `acde`:

```sh
node scripts/install-acde-deps.mjs   # yarn installs, install scripts off; needs network
node scripts/build-acde.mjs          # typings, plugin bundles, web entry; copies them into acde-app/public/tabby
cd acde-app
npm ci --ignore-scripts              # the app's own dependencies, from its lockfile
```

`install-acde-deps.mjs` installs only what the port uses (the root, `app/`, `web/` and the plugins
listed in `scripts/acde-plugins.mjs`) and never runs package install scripts, so no native modules
are built. The build takes a few minutes.

## Run

```sh
cd acde-app
acde dev          # opens Tabby in an acde window; rebuilds the app's own files on change
```

`acde dev` does not watch `public/tabby`: after rebuilding plugins with `build-acde.mjs`, restart it.

### SSH

Create an SSH profile in **Settings → Profiles & connections → New profile → SSH**. Sign-in uses, in
order: none, your SSH agent, the profile's private keys, password and keyboard-interactive prompts.

- acde starts the app backend without `SSH_AUTH_SOCK`. On macOS the backend finds your agent through
  launchd; on Linux, set `ssh.agentPath` in Tabby's config to your agent socket.
- Host keys are checked by Tabby's own dialog and known-hosts list, as in desktop Tabby.
- Local and SOCKS port forwarding cannot work on acde (backends cannot listen on a TCP port). SSH
  proxies, X11 and Pageant are not ported.

A lighter option needs no Tabby SSH profile: a local profile with command `acde-ssh` and one
argument (a host or `~/.ssh/config` alias) opens a plain SSH shell over the same backend.

## Test

| Suite | Command (from `acde-app/`) | Needs |
| --- | --- | --- |
| End-to-end (11 tests: shells, menus, splits, run requests, agent status) | `acde test` | Bun 1.4+ |
| Backend unit tests (SSH config, known_hosts, algorithm choices) | `node --test backend/ssh.test.js` | Node.js |
| SSH integration (11 tests against two throwaway OpenSSH servers) | `bash backend/test/run.sh` | Podman, network for the first image build |

`run.sh` starts the servers in a private Podman pod with no published ports, makes a random password
and a passphrase-protected key for each run, and removes the pod afterwards.

## Package

```sh
cd acde-app
acde build        # writes .acde/: the manifest, web files and the backend, with no native files
```

## Demo

See [demo/README.md](../demo/README.md): Claude Code drives Tabby through `acde mcp`, on this machine
and on SSH servers of your choice.

## Known differences from desktop Tabby

- Shortcuts are Linux-style (Ctrl-based) on every platform; hotkeys are not covered by tests.
- Folder and command profiles are started by typing `cd … && clear; exec …` into a new shell, because
  `acde:terminal.open()` cannot start a program.
- No "process still running" prompt when closing a tab (acde exposes no process IDs).
- Symbols the terminal font lacks show as empty boxes on macOS (no font fallback in acdert).
- Not ported: serial, telnet, the plugin manager, the auto-updater.
