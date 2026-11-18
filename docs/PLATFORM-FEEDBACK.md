# acde platform feedback

Issues found while porting Tabby to Dopame OS with acde 0.0.11 (Linux x86_64, Intel Iris Xe,
headless sessions in a container). Each has what happened, how to reproduce it, and a suggestion.
Ordered by impact.

## 1. DOM classes have non-enumerable prototype methods (breaks zone.js, so Angular apps)

**What happens.** In acdert, methods such as `MutationObserver.prototype.observe` are
non-enumerable class methods. WebIDL (and every browser) defines operations as enumerable. zone.js,
which every Angular app loads, wraps `MutationObserver`, `IntersectionObserver` and `FileReader`
by copying the instance's enumerable members, so the wrapped classes have **no methods at all**.
In Tabby this crashed xterm.js (`r.observe is not a function` in its RenderService), Polymer, and
also acde's own frame code (`Frame.followScheme` rejects with `observe is not a function` once the
page's zone.js has replaced the global).

**Reproduce.** In any acde page:

```js
Object.keys(MutationObserver.prototype).length   // 0 in acdert; browsers list observe, disconnect, takeRecords
for (const k in new MutationObserver(() => {})) console.log(k)   // prints nothing in acdert
```

Then load zone.js and call `new MutationObserver(() => {}).observe(document.body, { childList: true })`.

**Workaround used.** `window.__Zone_disable_MutationObserver = true` (and the same for
`IntersectionObserver` and `FileReader`) before zone.js loads.

**Suggestion.** Define DOM operations as enumerable, per WebIDL. Separately, acde's own frame code
could keep a private reference to the original `MutationObserver` so page scripts cannot break it.

## 2. `acde:terminal.open()` cannot start a specific program

**What happens.** `open(cols, rows)` always starts the user's default shell. There is no command,
arguments, working directory or environment, and no process ID or signal. Terminal apps (Tabby
profiles: "open in folder", "run htop", SSH hosts) and agent tools that want to run one command all
need these.

**Workaround used.** Type ` cd -- <dir> && clear; exec <command> <args>` into the new shell. It works,
but the line can flash on screen, depends on the shell, and cannot set the environment.

**Suggestion.** `open({ cols, rows, command?, args?, cwd?, env? })`, and expose `pid` plus a
`signal(id, name)` so apps can ask "is something still running in this tab?".

## 3. `acde:terminal` `cwd` events report home-relative paths

**What happens.** The `cwd` event reports `~/projects` rather than `/home/ubuntu/projects`. Apps that
pass the path on (Tabby opens new tabs in the current tab's directory) must expand `~` themselves,
and a quoted `'~/projects'` fails in the shell.

**Suggestion.** Report absolute paths, or document the format.

## 4. `acde dev` reloads when any file in the project changes

**What happens.** Writing screenshots or logs anywhere under the project folder (here
`acde-app/screenshots/`) triggers "rebuilt, reloading" mid-test, and the window briefly disappears,
so scripted checks fail with "no window w1".

**Suggestion.** Watch only the files the build reads, or honour `.gitignore` / a `watch.ignore`
config field.

## 5. Backend fails with a bare `EACCES` when `XDG_RUNTIME_DIR` is missing

**What happens.** In a container without `/run/user/<uid>`, the app backend logs
`EACCES: /run/user/1000/acde: Permission denied` and the office bridge fails the same way. Nothing
says that `XDG_RUNTIME_DIR` is the fix.

**Suggestion.** Fall back to a private temp directory, or name the variable in the error.

## 6. Documentation mismatches

| Where | Says | Actual (0.0.11) |
| --- | --- | --- |
| Challenge brief | `bun create acde`, `acde desktop`, `acde app` | `acde new`, `acde dev`, `acde dev --desktop`; no `create-acde` package on npm |
| Web compatibility | `getContext('webgl2')` returns `null` | Returns a working WebGL 2 context on Linux (clear + `readPixels` verified) |
| Testing guide | `--trace` writes `trace.html` | Writes `trace.txt` |
| Bundled skill | "as shipped with acde 0.0.9" | Ships inside 0.0.11 |
| `acde:terminal` reference | Interface only | No import line; the export is `terminal` (easy to guess `terminals`) |

## 7. acde callbacks run outside zone.js (Angular apps do not re-render)

**What happens.** Callbacks from acde modules (`acde:window` menu `onSelect`, `request` events,
`acde:terminal` subscriptions) are not scheduled through anything zone.js patches, so Angular does not
run change detection afterwards. In Tabby, choosing File › Settings set the window title but left the
old view on screen, and a run request opened a tab that did not appear, until some unrelated click.

**Workaround used.** Wrap every acde callback in `NgZone.run()`.

**Suggestion.** Document this for framework users (Angular, and anything else relying on zone.js), or
invoke callbacks from a task source zone.js already patches (for example a resolved promise).

## 8. `keyboard.type` in tests reorders shifted characters in xterm.js

**What happens.** `app.keyboard.type('echo ok > "$HOME/x"')` into a focused xterm.js terminal arrived as
`echo ok " $HOME/x"`: `>` was dropped and the `"` characters moved. Unshifted text typed correctly.
`keyboard.insertText()` delivers the same string intact. Not yet reduced to a minimal page, so it may be
in acde's key synthesis or in how xterm.js handles the resulting events.

## 9. Headless needs a hardware Vulkan GPU on Linux

`acde test` cannot run on typical Linux CI runners. A software-renderer fallback for headless
sessions (even if slow) would let projects run their end-to-end tests in CI.

## 10. Smaller observations

- A `<input type="number">` (Tabby's "Minimum contrast ratio") drew as an empty box although its
  value was 4. Not yet reduced to a minimal case.
- `acde.config.jsonc` accepts an unknown `icon` value with only a warning; the valid names appear only
  in that warning.

## 11. snapshot hides the focused input when it is transparent

**Seen:** xterm (and most terminal and code-editor widgets) take keyboard input through a hidden,
fully transparent textarea. A normal `snapshot` leaves it out; it appears only with `all`
(`textbox "Terminal input" [focused] [transparent]`). An agent driving Tabby through `acde mcp`
then tries to type into an output line or clicks the canvas before finding the real input with
`query`.

**Suggested fix:** always list the focused element, even when it is transparent, or mark the
focused input in the window line so `act type` has an obvious target.

## 12. No font fallback for symbols on macOS

**Seen:** in Tabby on acdert for macOS (Apple Silicon), characters the terminal font lacks, such as
`✻` and `❯`, render as empty boxes instead of falling back to a system font that has them. Real
agent CLIs (Claude Code among them) print exactly these symbols.

**Suggested fix:** fall back through the system font list (Core Text cascade list on macOS) for
missing glyphs, as browsers do.

## 13. The backend bundler fails on optional native add-ons

**Seen:** `ssh2` loads its optional native add-on `cpu-features` inside `try/catch` and works
without it. `acde build` and `acde dev` resolve the `require` statically and stop with
`UNRESOLVED_IMPORT ... cpufeatures.node`. Leaving optional dependencies out (`--omit=optional`)
also removes the bundler's own platform binary, so that is no way out either.

**Workaround:** a stub package named `cpu-features` that throws (`acde-app/backend/stubs`).

**Suggested fix:** treat a `require` inside `try/catch` that cannot be resolved as an external that
throws at run time (as esbuild does with `--packages` options), or let `acde.config.jsonc` list
backend externals.

## 14. The backend bundle has no `__dirname` or `__filename`

**Seen:** the backend is bundled into one ES module, but CommonJS packages in it (here `ssh2`) still
read `__dirname`. The backend crashes at start with `ReferenceError` (`ERR_AMBIGUOUS_MODULE_SYNTAX`
on Node.js 22), and the runtime log only says `stopped (exit 1)`; the error appears only when the
built backend is run by hand.

**Workaround:** `acde-app/backend/cjsGlobals.js`, imported first, defines both.

**Suggested fix:** inject `__dirname`/`__filename` shims for CommonJS modules in the bundle, and
print the backend's stderr in `acde dev` when it exits during start.

## 15. Backends cannot listen on a TCP port

**Seen:** acde turns every backend `listen()` into a Unix socket in a private directory. That keeps
apps apart, but it rules out anything that must accept local TCP connections: Tabby's local and
dynamic (SOCKS) SSH port forwarding, dev servers a user wants to open in a browser, local proxies.

**Suggested fix:** a capability (for example `"listen": ["127.0.0.1"]`) that lets an app open a
loopback TCP port the user can see in the app's permissions, with the private socket as the default.

## 16. Backends start without the user's SSH agent

**Seen:** a backend's environment is built from scratch, so `SSH_AUTH_SOCK` is missing even when the
user has an agent. Tabby's SSH plugin then cannot sign in with keys the agent holds (often the only
place they are usable, for example with a macOS Keychain passphrase). The backend works around it
with `launchctl getenv SSH_AUTH_SOCK` on macOS; there is no equivalent on Linux.

**Suggested fix:** pass `SSH_AUTH_SOCK` through like the proxy variables, or offer it as a
capability.
