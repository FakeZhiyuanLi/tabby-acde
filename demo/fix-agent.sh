#!/usr/bin/env bash
# A scripted coding agent for the demo. It prints the phrases real agent CLIs show (working:
# "esc to interrupt"; waiting: "Do you want to proceed?"), asks for approval, and only then
# applies its one-line fix to checkout/cart.mjs. No model is called.
#
#   fix-agent.sh                FIX_AGENT_STEP_SECONDS=1 speeds it up (default 2)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
CART="$HERE/checkout/cart.mjs"
STEP_SECONDS=${FIX_AGENT_STEP_SECONDS:-2}

working () {
    printf '\r\033[K\033[36m*\033[0m %s… \033[2m(esc to interrupt)\033[0m' "$1"
    sleep "$STEP_SECONDS"
    printf '\n'
}

printf "\033]0;Fix agent · %s\007" "$(hostname -s)"
printf '\033[1mdemo-agent\033[0m · Fix the failing checkout tests\n\n'
working "Reading checkout/cart.mjs and its tests"
working "Found it: lineTotal adds price and quantity"
working "Preparing the fix"

printf '\n  checkout/cart.mjs\n'
printf '\033[31m  -    return item.price + item.qty\033[0m\n'
printf '\033[32m  +    return item.price * item.qty\033[0m\n'
printf '\n\033[33mDo you want to proceed?\033[0m Apply this change to checkout/cart.mjs\n'
printf '> 1. Yes\n  2. No\n'
read -r answer

if [[ ${answer:-1} == 2* || ${answer:-1} == [nN]* ]]; then
    printf '\n\033[31m✗ Stopped without changing anything\033[0m\n'
    exit 1
fi
working "Applying the change"
perl -pi -e 's/return item\.price \+ item\.qty/return item.price * item.qty/' "$CART"
printf '\033[32m✓ Done:\033[0m 1 file changed\n'
