# Demo script: Tabby on Dopame OS

About three minutes. Each step names what to show, what to say, and the fallback screenshot in
`docs/screenshots/` if a live step misbehaves.

## Before the demo

- Build: `node scripts/build-acde.mjs` (typings, bundles, assemble), then `cd acde-app && acde dev`
  (or `acde dev --desktop` to show it inside the Dopame desktop).
- Start from a clean session: remove the app's saved tab state so only one tab opens.
- Have a second terminal ready to send a run request (see step 5).
- Keep `scripts/demo-agent.sh` handy; `DEMO_AGENT_STEP_SECONDS=1.5` gives a readable pace.

## 1. It is Tabby, running natively (20 s)

Show the start page, then **File › New terminal**. Run `echo hello && uname -sr`.

> "This is Tabby, a 75,000-star terminal, running as a Dopame OS app. No Electron and no node-pty:
> the shell comes from `acde:terminal`, and Tabby's own xterm.js draws it."

Fallback: `phase4-shell.png`.

## 2. Everyday terminal features still work (30 s)

**View › Split right**; open **Profiles & connections › Projects folder**; open a new tab and show it
inherits the folder. Open **Settings**, change a setting, mention it is saved in the app's private
folder through `acde:fs`.

> "Tabs, splits, profiles and settings are upstream Tabby. I replaced only the platform layer, so the
> port keeps Tabby's behaviour."

Fallback: `phase5-split.png`, `phase5-profile-folder.png`.

## 3. Agents can drive it (20 s)

From another terminal run `acde inspect` and point at the named buttons ("New terminal", "Profiles &
connections", "Settings") and the File and View menus.

> "I added accessible names to Tabby's icon buttons and a native menu bar, so an agent using acde's
> inspect API can operate Tabby as reliably as a person can."

## 4. Tabby tells you when an agent needs you (40 s)

In a tab run `DEMO_AGENT_STEP_SECONDS=1.5 scripts/demo-agent.sh`. The tab turns blue while it works,
then amber, a notification appears, and the window title reads "(1 waiting) …". Type `1`, Enter: the
tab turns green when it finishes.

> "On an agent OS, many agents run at once. Tabby now recognises coding-agent CLIs and tells you
> which one is waiting on you, even when its tab is in the background."

Fallback: `phase6-agent-waiting.png`, `phase6-agent-done.png`.

## 5. Any agent can hand Tabby a command; only you can run it (40 s)

From another app (or `acde eval tabby` in a second terminal):

```js
import('acde:open').then(({ open }) =>
  open('tabby', { kind: 'run', command: 'git log --oneline -5', cwd: '~/projects', title: 'Agent: show recent commits' }))
```

A titled tab opens with the command typed but not run. Press Enter to run it.

> "This is the Dopame-native part: other apps and agents can send Tabby work through `open()`
> requests. Tabby validates the request, types the command, and waits for you, so an agent can never
> run something in your shell on its own."

Fallback: `phase6-run-request-staged.png`.

## 6. Close (20 s)

> "The port replaced node-pty, Electron's window and config layers, and native process tools with
> acde system modules; found and worked around a runtime bug that breaks every Angular app; and added
> agent features that only make sense on an agent OS. The write-up lists the platform feedback."

Show `docs/PLATFORM-FEEDBACK.md` item 1 (the zone.js bug) if there is time for questions.

> Note: in the agent-driven demos, the conducting agent leaves approvals to you because its
> instructions say so; Tabby itself enforces this for run requests.
