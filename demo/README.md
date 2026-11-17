# Demo: an agent works through Tabby

Claude Code drives Tabby through `acde mcp`: it opens tabs, runs the tests, reads the failure
from the screen and starts a fix agent. Tabby turns the fix agent's tab amber and shows
"(1 waiting)" when it needs approval. Only the person approves; the conductor never does.

| File | What it is |
|---|---|
| `checkout/` | A tiny project with one bug (`lineTotal` adds instead of multiplying); `node --test` |
| `fix-agent.sh` | A scripted agent: prints what real agent CLIs print, asks for approval, then fixes the bug |
| `reset.sh` | Puts the bug back |
| `CLAUDE.md` | The conductor's rules: act only through acde tools, never answer approval prompts |
| `.mcp.json` | Starts `acde mcp` for Claude Code in this folder only |

## Before each take (Mac Terminal)

```sh
# 1. Put the bug back
~/Downloads/project-checkpoints/tabby-acde/demo/reset.sh

# 2. Start Tabby with no saved tabs (skip the eval on the very first run)
cd ~/Downloads/project-checkpoints/tabby-acde/mac-native/acde-app
acde eval tabby 'localStorage.setItem("tabsRecovery", "[]")'   # while the old session runs
# stop the old acde dev (Ctrl-C), then:
acde dev
```

## The take

1. Second Terminal window, left half of the screen; Tabby on the right half.
2. `cd ~/Downloads/project-checkpoints/tabby-acde/demo && claude`
   (approve the `acde` MCP server the first time Claude Code asks).
3. Type: **Checkout tests are failing. Use Tabby to find out why, put the fix agent on it,
   and tell me when it needs me. Once it is done, check the tests again.**
4. When the Fix agent tab turns amber and Claude says it is waiting for you, click that tab,
   type `1` and press Enter.
5. Claude re-runs the tests and reports 3 of 3 passing.

Dry run on macOS (headless, with a script standing in for the person): about 1 minute 45 seconds
end to end.

## Take 2: agents on your servers

The same project and fix agent are in `~/tabby-demo` on rack1 and rack2. Claude opens each server
in a Tabby tab over pure-JS SSH (`ssh2` in Tabby's acde backend, no `ssh` program), starts a fix
agent on each, and tells you which servers are waiting; the title shows "(2 waiting)".

1. Reset both servers: `for h in rack1 rack2; do ssh $h tabby-demo/reset.sh; done`, then restart
   Tabby with no saved tabs as above.
2. In the Claude Code window, type: **Checkout tests are failing on rack1 and rack2. Use Tabby to
   open both servers, put a fix agent on each, and tell me which ones need me. Once they are done,
   check the tests on both again.**
3. When both Fix agent tabs turn amber, approve each one (`1`, Enter).
