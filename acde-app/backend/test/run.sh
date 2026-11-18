#!/usr/bin/env bash
# Integration tests for the russh stand-in against a throwaway OpenSSH server (rack-laptop, Podman).
# The server runs in a private pod with no published ports; the test credentials are made per run.
set -euo pipefail
APP=$(cd "$(dirname "$0")/../.." && pwd)
POD=tabby-ssh-test-$$
SHARED=$(mktemp -d)
cleanup () {
    podman pod rm -f "$POD" >/dev/null 2>&1 || true
    podman unshare rm -r -f "$SHARED"
}
trap cleanup EXIT
TEST_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
TEST_KEY_PASSPHRASE=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
export TEST_PASSWORD TEST_KEY_PASSPHRASE
podman build -q -t localhost/tabby-ssh-test-server "$APP/backend/test" >/dev/null
podman pod create --name "$POD" >/dev/null
for port in 22 2222; do
    podman run -d --pod "$POD" -e TEST_PASSWORD -e TEST_KEY_PASSPHRASE -e SSHD_PORT="$port" \
      -v "$SHARED":/shared:z localhost/tabby-ssh-test-server >/dev/null
done
for _ in $(seq 1 50); do [ -s "$SHARED/host_key_22.pub" ] && [ -s "$SHARED/host_key_2222.pub" ] && break; sleep 0.2; done
sleep 1
podman run --rm --pod "$POD" \
  -e TEST_PASSWORD -e TEST_KEY_PASSPHRASE -e TEST_SHARED=/shared \
  -v "$SHARED":/shared:z -v "$APP":/app:ro,z -w /app docker.io/library/node:22-bookworm-slim \
  node --test backend/test/russh.integration.mjs
