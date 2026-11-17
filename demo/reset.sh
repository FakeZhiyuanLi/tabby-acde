#!/usr/bin/env bash
# Puts the demo back to its starting state: the bug in checkout/cart.mjs.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
perl -pi -e 's/return item\.price \* item\.qty/return item.price + item.qty/' "$HERE/checkout/cart.mjs"
grep -n "return item" "$HERE/checkout/cart.mjs"
