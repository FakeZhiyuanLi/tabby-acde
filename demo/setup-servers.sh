#!/usr/bin/env bash
# Copies the demo project and fix agent to ~/tabby-demo on each server (needs ssh and node there).
#   ./setup-servers.sh server-a server-b
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[[ $# -gt 0 ]] || { echo "usage: $0 server..." >&2; exit 2; }
for server in "$@"; do
    tar -C "$HERE" -czf - checkout fix-agent.sh reset.sh | ssh "$server" 'mkdir -p ~/tabby-demo && tar -xzf - -C ~/tabby-demo'
    ssh "$server" 'command -v node >/dev/null || echo "warning: node is not installed on $(hostname)"'
    echo "set up ~/tabby-demo on $server"
done
