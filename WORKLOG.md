# Tabby → Dopame OS (acde): work log

## Main goal

Produce a **demo and a pitch** to send with the deliverable for the Return AI / Dopame OS
interview challenge. Everything below should move that forward.

Deliverables the brief asks for:

- [ ] Code repository (this fork, upstream history kept, work on branch `acde`)
- [ ] A build artifact Dopame OS can load directly (a pure JS bundle)
- [ ] Project write-up with porting notes (`PORTING.md`)
- [ ] Pitch deck

Demo and pitch material to collect as we go:

- [ ] Screenshots of Tabby running inside acde (boot, shell tab, splits, settings)
- [ ] Recording of the main flow (`acde test --video=on` or a live run)
- [ ] Before/after table of replaced dependencies
- [ ] Agent features demo: another app sends a `run` request; agent status badge; notification
- [ ] Platform feedback list for Return AI

Plan: 7 phases, the spike (phases 2–3) ends in a go/no-go. Fallback on no-go: ACP agent console.
Plan page: https://claude.ai/artifact/4VyKDQQrcCmePXuxayb9gx

## Environment

- Runs only in the offline Podman sandbox `acde-sandbox` on rack-laptop (acde 0.0.11, Bun 1.4.4,
  Node 22). Dependencies are installed by a separate networked container that never runs acde code.
- Upstream: https://github.com/Eugeny/tabby at `467ce8e` (v1.0.238), MIT.

## Log

### 2026-11-17

- **Phase 1, set up the fork.** Cloned upstream with full history (6,586 commits, 250 tags) into
  `~/acde-sandbox/projects/tabby-acde`; branch `acde` from `467ce8e` ("xterm 6", v1.0.238);
  remote renamed to `upstream`. Added `WORKLOG.md` (this file) and `PORTING.md`.
- Earlier the same day (before the fork): source review and runtime probes in acde 0.0.11.
  `eval`/`new Function`, custom elements + shadow DOM, WebGL 2, observers, clipboard and
  notifications all work; Web Workers missing; `acde:terminal.open()` takes no command/cwd/env.
