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
