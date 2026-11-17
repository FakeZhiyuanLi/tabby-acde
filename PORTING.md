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

_In progress. Filled in phase by phase._

## Dependencies replaced

| Upstream dependency | Native | Replacement |
| --- | --- | --- |
| `node-pty` (via Electron IPC) | yes | `acde:terminal` |
| `native-process-working-directory` | yes | `acde:terminal` `cwd` events |
| Electron config, window and shell APIs | no | `acde:fs`, `acde:window`, `acde:open` |

## System capabilities used

_To be filled in: terminal, fs, openFiles, window requests._

## Cut, and why

- Native SSH and SFTP (`russh`, a Rust module), serial, telnet: native code or raw sockets.
- Plugin manager, auto-updater, docking, touch bar, Windows UAC: no equivalent on Dopame OS.

## Platform feedback for Return AI

See `WORKLOG.md` for the running list.
