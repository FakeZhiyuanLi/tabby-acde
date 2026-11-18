# Demo: an agent works through Tabby

Claude Code drives Tabby through `acde mcp`: it opens tabs, runs the tests, reads the failure from
the screen and starts a fix agent. Tabby turns the fix agent's tab amber and shows "(1 waiting)" when
it needs approval. Only the person approves; the conductor never does. Take 2 does the same on two
SSH servers at once, over Tabby's own SSH plugin.

| File | What it is |
|---|---|
| `checkout/` | A tiny project with one bug (`lineTotal` adds instead of multiplying); `node --test` |
| `fix-agent.sh` | A scripted agent: prints what real agent CLIs print, asks for approval, then fixes the bug |
| `reset.sh` | Puts the bug back |
| `CLAUDE.template.md`, `configure.sh` | The conductor's rules; `configure.sh` writes `CLAUDE.md` for this checkout |
| `setup-servers.sh` | Copies the project and fix agent to `~/tabby-demo` on SSH servers (take 2) |
| `.mcp.json` | Starts `acde mcp` for Claude Code in this folder only |

## Set up once

```sh
cd demo
./configure.sh                       # take 1 only
./configure.sh server-a server-b     # or with the servers for take 2
./setup-servers.sh server-a server-b # take 2: needs ssh access and node on each server
```

For take 2, create a Tabby SSH profile named exactly like each server (Settings → Profiles &
connections → New profile → SSH).

## Before each take

```sh
./reset.sh                                                    # take 1
for s in server-a server-b; do ssh "$s" tabby-demo/reset.sh; done   # take 2
```

Start Tabby with no saved tabs: with `acde dev` running in `acde-app/`, run
`acde eval tabby 'localStorage.setItem("tabsRecovery", "[]")'`, then stop `acde dev` (Ctrl-C) and
start it again.

## The take

1. A terminal window on the left, Tabby on the right.
2. `cd demo && claude` (approve the `acde` MCP server the first time Claude Code asks).
3. Take 1, type: **Checkout tests are failing. Use Tabby to find out why, put the fix agent on it,
   and tell me when it needs me. Once it is done, check the tests again.**
   Take 2, type: **Checkout tests are failing on server-a and server-b. Use Tabby to open both
   servers, put a fix agent on each, and tell me which ones need me. Once they are done, check the
   tests on both again.**
4. When a Fix agent tab turns amber and Claude says it is waiting for you, click that tab, type `1`
   and press Enter.
5. Claude re-runs the tests and reports 3 of 3 passing.

Dry runs on macOS with a script standing in for the person: about 1 minute 45 seconds (take 1) and
1 minute (take 2).

The Claude Code session also loads your own global instructions (`~/.claude/CLAUDE.md`); if they are
long, the conductor may mention unrelated things. The demo rules ask it not to.
