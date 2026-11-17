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
- **Phase 2, offline build: passed.** Installed dependencies for the root, `app/`, `web/` and the
  seven kept plugins with `yarn install --ignore-scripts --frozen-lockfile` in the npm-only container
  (Yarn 1.22.22, all OK), then symlinked the plugins into `node_modules` as `install-deps.mjs` does.
  Added `scripts/build-acde.mjs` (typings + webpack for the kept packages only) and ran it in a node
  container with `--network none`: typings OK; bundles for tabby-core, -settings, -terminal, -local,
  -web, -community-color-schemes, -linkifier and the `web` entry compiled in 30 s, warnings only.
- Cut `tabby-auto-sudo-password` too: it imports `tabby-ssh`.
- Workarounds so far: none beyond skipping install scripts and native builds (the only upstream patch
  is for electron-builder, not needed).
- **Phase 3, boot gate: PASSED (GO).** Added `acde-app/` (acde project hosting Tabby's web build:
  `index.html` with Tabby's page structure, `src/main.js` that loads the plugin bundles and calls
  `Tabby.bootstrap()` with a stub connector) and an `assemble` step in `build-acde.mjs` that copies the
  web entry and plugin bundles into `acde-app/public/tabby`. Tabby boots in acdert with **no console
  errors**; `acde act` on "Settings" opens the full settings tab (10 sections). Screenshots:
  `acde-app/.acde/boot-5.png` (start page) and `boot-6-settings.png` (Mac copies in
  `~/Downloads/project-checkpoints/tabby-acde/`).
- Problems found on the way and how each was fixed:
  1. Upstream web build: `@angular/cdk` and `@angular/common` were evaluated before `@angular/compiler`
     (the web webpack config has no Angular linker), so `web/polyfills.ts` now imports the compiler first.
  2. Upstream web build: `web/entry.ts` never set `window.pluginModules`, which
     `ConfigService.enabledServices()` reads; it now does, as `app/src/entry.ts` does.
  3. Plugin bundles (webpack 5.110, node target) require `node:url`; the host page registers a stand-in.
  4. **acde runtime bug:** acdert's `MutationObserver` methods are non-enumerable class methods, so the
     zone.js wrapper (which copies enumerable members) has no `observe()`. This broke Polymer and acde's
     own `Frame.followScheme`. Workaround: `window.__Zone_disable_MutationObserver = true`.
  5. `tabby-local` needs a `ShellProvider` and `PTYInterface` (normally from tabby-electron), so it is
     left out until phase 4.
- Possible acde rendering glitch: the "Minimum contrast ratio" number input draws as an empty box
  although its value is 4. To confirm later.
- Helper fix: `acde-sb start-dev` log path now replaces "/" in project names.
- **Demo and pitch material so far:** boot and settings screenshots; the MutationObserver and zone.js
  bug as a strong platform-feedback item; two small upstream web-build fixes worth offering to Tabby.
- Next: phase 4, the `tabby-acde` plugin (PTY on `acde:terminal`, config in the private folder,
  window and platform services), then re-enable `tabby-local`.
