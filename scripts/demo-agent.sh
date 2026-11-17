#!/usr/bin/env bash
# A stand-in coding agent for demos and tests of Tabby's agent status on Dopame OS. It prints the
# phrases real agent CLIs show (working: "esc to interrupt"; waiting: "Do you want to proceed?"),
# asks for approval, then finishes. No model is called.
#
#   demo-agent.sh ["task"]      DEMO_AGENT_STEP_SECONDS=0.5 speeds it up (default 2)
set -euo pipefail

TASK=${1:-"Fix the flaky login test"}
STEP_SECONDS=${DEMO_AGENT_STEP_SECONDS:-2}

working () {
    printf '\r\033[K\033[36m✻\033[0m %s… \033[2m(esc to interrupt)\033[0m' "$1"
    sleep "$STEP_SECONDS"
    printf '\n'
}

printf '\033[1mdemo-agent\033[0m · %s\n\n' "$TASK"
working "Reading 14 files"
working "Editing src/auth/session.ts"
working "Running the test suite"

printf '\n\033[33mDo you want to proceed?\033[0m Apply the changes to 3 files\n'
printf '❯ 1. Yes\n  2. No\n'
read -r answer

if [[ ${answer:-1} == 2* || ${answer,,} == n* ]]; then
    printf '\n\033[31m✗ Stopped without applying changes\033[0m\n'
    exit 1
fi
working "Applying changes"
printf '\033[32m✓ Done:\033[0m 3 files changed, 42 tests passed\n'
