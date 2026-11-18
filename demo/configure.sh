#!/usr/bin/env bash
# Writes CLAUDE.md for this checkout: the demo folder's path, and the SSH servers the conductor may
# open. Each server needs a Tabby SSH profile with the same name and the demo set up on it
# (setup-servers.sh).
#   ./configure.sh                 local demo only
#   ./configure.sh server-a server-b
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
servers=""
if [[ $# -gt 0 ]]; then
    names=$(printf '**%s**, ' "$@"); names=${names%, }
    servers="## Servers

- The same project is in \`~/tabby-demo\` on ${names}.
- Open a server with the **Profiles & connections** button, then the SSH profile with the server's name.
- On a server: tests \`cd ~/tabby-demo/checkout && node --test\`; fix agent \`~/tabby-demo/fix-agent.sh\`.
  Run the fix agent in the server's own tab; its tab is then titled \"Fix agent · <server>\".

"
fi
python3 - "$HERE" "$servers" <<'PY'
import sys
here, servers = sys.argv[1], sys.argv[2]
text = open(f'{here}/CLAUDE.template.md').read()
open(f'{here}/CLAUDE.md', 'w').write(text.replace('@DEMO_DIR@', here).replace('@SERVERS@', servers))
PY
echo "wrote $HERE/CLAUDE.md"
