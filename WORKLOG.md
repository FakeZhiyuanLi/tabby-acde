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

- Runs only in the offline Podman sandbox `acde-sandbox` on a Linux workstation (acde 0.0.11, Bun 1.4.4,
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
- **Phase 4, `tabby-acde` platform plugin: core done.** New plugin `tabby-acde/`:
  `AcdePTYInterface`/`AcdePTYProxy` (local shells on `acde:terminal`: open, input, resize, close,
  output/cwd/exit events; folder and command applied by typing ` cd -- '<dir>'` and ` exec <cmd>`
  because `acde:terminal.open()` takes neither), `AcdeDefaultShellProvider` ("Default shell") and
  `AcdeHostWindow` (`acde:window`: title, fullscreen, minimize, close). The host page registers
  `acde:terminal` and `acde:window` with Tabby's module loader (the bundle declares `acde:*` external),
  and the connector now saves Tabby's config as `tabby/config.yaml` in the app's private folder
  (`acde:fs`). `tabby-local` is back in the plugin list; `process.platform` is reported as linux.
- Verified in the sandbox, driven with `acde act`/`acde query` like an agent would:
  1. "New terminal" opens a shell tab; the window title follows the shell (`ubuntu@acde-sandbox: ~`).
  2. Typed `echo hello-from-tabby-on-acde && uname -sr && ls ~/projects` into xterm's input
     (`acde query "textarea.xterm-helper-textarea"`): output, colours and prompt render correctly.
     Screenshot: `acde-app/.acde/phase4-shell.png` (Mac: `~/Downloads/project-checkpoints/tabby-acde/`).
  3. Toggling a setting writes `files/tabby/tabby/config.yaml` (3,764 bytes); after restarting the
     app the setting is still off and the shell tab is restored. No console errors anywhere.
- **acde runtime bug, wider than first thought:** none of acdert's DOM classes have enumerable
  prototype methods (WebIDL requires them), so every class zone.js wraps loses its methods:
  `MutationObserver`, `IntersectionObserver` (crashed xterm.js' RenderService) and `FileReader`.
  Workaround now disables all three zone.js patches in `acde-app/index.html`.
- Found for phase 6: Tabby's toolbar buttons are icon-only with no accessible names, so agents using
  `acde inspect` cannot tell them apart. Adding names is part of the "agent-readable UI" work.
- Not yet tested: split panes and live resize. To cover in phase 5 and the e2e tests.
- **Demo and pitch material:** the shell screenshot is the hero shot for the deck; "an agent typed
  this command through acde's inspect API" is a good live-demo beat.
- Next: phase 5 (profiles with folder/command, SSH via system ssh, menus, renderer setting).
- **Phase 5, profiles and polish: done.** (User went to bed and asked me to keep working; no
  outward-facing steps taken.)
  - Folder profiles: `tabby-local` validates working directories with `fs.statSync`, which the web
    preload mocks so every folder was dropped. The host page now provides an `fs` stand-in that
    treats paths as folders (the shell's own `cd` reports missing ones).
  - acde's `cwd` event reports home-relative paths (`~/projects`); Tabby passes them to new tabs, and
    quoting stopped `~` expanding. `startupInput` now expands `~` to `"$HOME"`, runs everything on one
    line, and clears the screen once `cd` succeeds, so new tabs open clean.
  - Command profiles: ` exec <cmd> <args>` after the `cd`; verified with a `bash -c` profile.
  - Window menu bar on `acde:window` (`tabby-acde/src/menus.ts`): File (New terminal, Settings, Close
    tab, Close window) and View (Split right, Split down, Toggle fullscreen), all via Tabby's public
    services (`TerminalService.openTab`, `SplitTabComponent.splitTab`, `AppService`).
  - Accessible names (upstream-friendly template change in `tabby-core`): toolbar buttons now carry
    `aria-label` from their tooltip ("New terminal", "Profiles & connections", "Settings"), and tab
    buttons are "Tab options" / "Close tab". Before, agents saw unnamed buttons and a "×".
  - App icon fixed: `term` (acde warned that `terminal` is not one of its icon names).
- Verified, driven by name through `acde act`: Projects folder profile opens in `~/projects`; a new
  tab inherits `~/projects`; the command profile prints `command-profile-ok` and leaves a shell;
  View › Split right gives two clean panes. No console errors. Screenshots in `docs/screenshots/`
  (phase5-profile-folder, -inherited, -profile-command, -split).
- Lessons: `acde dev` watches the project folder, so writing screenshots inside `acde-app/` triggers a
  rebuild and reload mid-test (the window briefly disappears). Screenshots now go to `docs/screenshots/`.
  Element refs change when tabs are restored, so tests must find elements by name, never by ref.
- SSH: not built as a separate feature. A local profile with command `ssh` and args `[user@host]` runs
  the system ssh through the same `exec` path (documented in PORTING.md); the sandbox has no network,
  so it is untested. Waiting for the user's decision on whether that is enough for the demo.
- For demos: tab recovery accumulates tabs across restarts (8 tabs now); reset the recovery state
  before recording.
- Next: phase 6, agent features (run requests from other apps, agent status badges, notifications).
- **Phase 6, agent features (the Extend part): core done.**
  - Agent status (`tabby-acde/src/agents/detector.ts`, `agentStatus.ts`): a `TerminalDecorator` reads
    every terminal's output, strips ANSI codes and looks for the phrases agent CLIs print: working
    ("esc to interrupt") and waiting ("Do you want to proceed?", "Allow command", "(y/n)"...). Only
    new output counts, so old lines do not re-trigger. States: working (blue tab), waiting (amber),
    done after 4 s of quiet (green), back to idle when the tab is focused. Waiting and done raise a
    system notification; waiting also calls `acde:window.requestAttention()` and the window title
    shows "(N waiting)" (via `AcdeHostWindow`).
  - Run requests (`agents/runRequests.ts`): `open('tabby', { kind: 'run', command, cwd, title })` from
    any app or agent opens a titled tab in `cwd` and **types the command without running it**; the
    user reviews it and presses Enter. Requests are validated (strings only, max 4,000 chars, no
    control characters, so a newline cannot press Enter). `acde.config.jsonc` declares
    `requests: ["run"]` and `open: ["tabby"]` (so a page or test can send Tabby a request).
  - `scripts/demo-agent.sh`: a stand-in agent that prints working lines, asks "Do you want to proceed?",
    and finishes after approval. No model calls, so demos and tests are offline and repeatable.
- Verified in the sandbox:
  1. demo-agent in a tab: title becomes "(1 waiting) ubuntu@acde-sandbox: ~/projects" while it asks,
     the tab turns amber, then green after typing 1 + Enter and "✓ Done". Screenshots
     `docs/screenshots/phase6-agent-{working,waiting,done}.png`.
  2. Run request sent with `acde eval` (`import('acde:open')` then `open(...)`): tab "Agent: show recent
     commits" opens in `~/projects` with the command typed but not run
     (`phase6-run-request-staged.png`). A request with a newline in the command is rejected with a
     console warning.
  3. No console errors.
- Not verifiable headless: whether system notifications appear (there is no desktop in the sandbox to
  show them). The tab colour is a thin underline; making the state more visible is a polish item.
- **Pitch lines from this phase:** "Any agent can hand Tabby a command, but only you can run it";
  "Tabby tells you which agent needs you, even when its tab is in the background".
- Next: phase 7, `acde test` end-to-end tests, `acde build` bundle, write-up, deck material.
- **Phase 7, tests, bundle and write-up: done (deck still to make).**
  - `acde-app/e2e/tabby.e2e.ts`: 7 end-to-end tests (boot + named buttons; command in a local shell
    writes a file in the session HOME; File › Settings; View › Split right; run request staged and
    only run after Enter; run request with a newline rejected; demo agent sets "(1 waiting)" until
    answered). **7/7 pass, 27 s for the suite.**
  - First run: 4/7. Two root causes, both fixed:
    1. acde callbacks (menu `onSelect`, `request` events, `acde:terminal` events) run outside
       Angular's zone, so views did not update (Settings set the title but kept the old page; a run
       request's tab did not appear). Every acde callback now goes through `NgZone.run()`.
    2. `keyboard.type` delivered shifted characters out of order into xterm.js
       (`> "$HOME/x"` became `" $HOME/x"`); tests now use `keyboard.insertText`.
  - `acde check` passes; `acde build` produces `.acde/` (manifest + `web/`, 53 MB, **no native files**).
    Packaged as `dist-artifacts/tabby-acde-1.0.238-acde.tar.gz` (19 MB, sha256 2ba8c904…744f; not in
    git). The app now bootstraps Angular in production mode outside `acde dev`.
  - Docs for the deliverable: `docs/WRITEUP.md` (project write-up with test table), `docs/DEMO.md`
    (3-minute demo script with fallbacks), `docs/PLATFORM-FEEDBACK.md` (10 items, repro + suggestion
    each), test recordings in `docs/recordings/` (animated PNGs).
- Deliverables checklist now: repo (local fork, branch `acde`; public fork waits for the user's OK),
  bundle (done), write-up with porting notes (done), pitch deck (next).
- Next: pitch deck; a fresh clean-state demo recording; update the plan page.
- **Pitch deck: done (draft).** 11 slides in a private Slides artifact:
  https://claude.ai/artifact/XL9nduHKJ7FkuuuPBY8Ldx (downloads as .pptx or PDF from its page).
  Cover, why Tabby, what I built, running shell, architecture, replaced dependencies, agent status,
  run requests, platform findings, evidence numbers, next steps; speaker notes on every slide.
  Placeholder to fill: [Your name] on the cover. Built without a design system (the account only has
  an unrelated one). Not yet checked visually in the deck viewer.
- **Deliverables status:** repo (local fork, branch acde) done; bundle done
  (dist-artifacts/tabby-acde-1.0.238-acde.tar.gz); write-up + porting notes done (docs/WRITEUP.md,
  PORTING.md); pitch deck draft done; demo script done (docs/DEMO.md).
- **Waiting on the user:** OK to publish a public GitHub fork; whether SSH-as-a-profile is enough;
  which machine runs the live demo; name for the cover slide.
- **Live demo over VNC.** The sandbox now also runs a virtual X display (TigerVNC Xvnc) that listens
  only on a Unix socket, with TCP turned off; the sandbox itself is still `--network none`. A
  separate noVNC bridge container is the only networked piece, and it is bound to the private
  network only. Tabby runs with `acde dev` on that display, so it can be used live from a browser.
  acdert needed the X11 client libraries (Xcursor, Xrandr, Xi, ...) that winit loads at runtime.
- **Public fork.** Branch `acde` is pushed to a public GitHub fork of Eugeny/tabby.
- **Demo hero spike: an agent drives Tabby through acde mcp (passed).** New `ReadableTerminalDecorator`
  turns on xterm screen reader mode, so terminal rows appear as text in acde snapshot. A headless
  Claude Code session limited to the acde MCP tools (no shell, no files) opened a Tabby tab, ran
  `sw_vers && uptime`, read the output from the screen and reported it correctly in 53 s, natively
  on macOS (Apple Silicon). Friction: its first `act type` into the terminal did not reach the shell;
  it recovered with key presses. To look at before the recording.
- **Typing fix for agents.** xterm ignores input events (insertText) in screen reader mode, which is
  how `act type` delivers text, so typed commands never reached the shell. `ReadableTerminalDecorator`
  now forwards those events to the session unless a keypress with a character already delivered the
  text (real typing, IME and paste use other paths). Verified on macOS: `act type` + Enter ran once.
  Second agent run: 38 s, typing worked first time; it still had to search for the hidden input
  (platform feedback item 11). Real keyboard typing still needs a manual check.
- **Hero demo scenario built (`demo/`).** Claude Code, limited to the acde MCP tools, drives Tabby:
  runs the checkout tests, reads the failure from the screen, starts `fix-agent.sh` in its own tab
  ("Fix agent"), reports that it is waiting and does not approve; the person approves; Claude
  re-runs the tests (3/3). Dry run on macOS with a stand-in script for the person: 1 min 47 s, file
  patched, title showed "(1 waiting)". Runbook in `demo/README.md`. Found: no glyph fallback on
  macOS (platform feedback item 12); the fix agent now prints plain `*` and `>`.
- **SSH step A (system ssh profiles) on macOS: works.** Local profiles `rack1`, `rack2`, `rack-laptop`
  (group Servers, command `ssh <alias>`) connect over Tailscale with the Mac SSH config, keys and
  agent. Agent status works over SSH: a waiting prompt printed on rack2 turned its tab amber and
  the title showed "(1 waiting)" while another tab was focused. Next: step B, pure-JS SSH in the
  acde backend.
- **SSH step B (pure-JS SSH in the acde backend): works on macOS.** `acde-app/backend/` runs `ssh2`
  sessions; profiles with command `acde-ssh` open them in Tabby tabs. Verified against rack1, rack2
  and rack-laptop over Tailscale: connect, host key check against known_hosts, typing, initial size
  and live resize, agent status ("(1 waiting)"). Build fixes: a stub for the native `cpu-features`
  add-on, and `__dirname` for the ES module bundle. 8 backend unit tests; 7/7 e2e still pass in the
  sandbox after the PTY refactor (shared `BufferedPTYProxy`).
- **Demo take 2: agents on two servers over pure-JS SSH (dry run passed).** The demo project is also
  in `~/tabby-demo` on rack1 and rack2. Claude Code (acde mcp only) opened `rack1 · JS SSH` and
  `rack2 · JS SSH`, started a fix agent in each ("Fix agent · <server>" tabs), the title showed
  "(2 waiting)", it did not approve, a stand-in script approved both, and it re-ran the tests: 3/3
  on each server. 58 s end to end.
- **Full SSH port, spike: passed.** Tabby's own `tabby-ssh` plugin (3,617 lines, unchanged) now
  builds into the acde app and runs. Its native `russh` module is replaced by a stand-in with the
  same API (`acde-app/src/russh.js`), registered under the name `russh`; it runs each connection
  in the backend on ssh2 (`backend/russhBridge.js`, `backend/russhRoutes.js`). Verified on macOS
  against rack1: Tabby's SSH profile and tab UI, Tabby's host key dialog (fingerprint matched the
  Mac's known_hosts), sign-in through the macOS SSH agent (found with launchctl; the page gets it as
  SSH_AUTH_SOCK, and `fs.stat` asks the backend for the real file type), PTY, typing and size.
  Done so far: socket transport, host key, none/password/key/agent/keyboard-interactive auth,
  session channels (PTY, shell, exec). Not yet: SFTP, jump hosts, remote forwarding, proxies.
  Local and dynamic forwarding cannot work while acde turns every backend listen() into a private
  Unix socket. 7/7 e2e still pass in the sandbox with tabby-ssh loaded.
