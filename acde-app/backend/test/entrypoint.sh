#!/bin/sh
# Sets the per-run test password, gives this server its own host key, shares it, runs sshd on SSHD_PORT.
# The server on port 22 also makes the passphrase-protected test key; the one on 2222 is the jump host.
set -eu
PORT=${SSHD_PORT:-22}
echo "tester:$TEST_PASSWORD" | chpasswd
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
ssh-keygen -A >/dev/null
if [ "$PORT" = 22 ]; then
    ssh-keygen -q -t ed25519 -N "$TEST_KEY_PASSPHRASE" -f /shared/test_key
    install -d -m 700 -o tester -g tester /home/tester/.ssh
    install -m 600 -o tester -g tester /shared/test_key.pub /home/tester/.ssh/authorized_keys
fi
cp /etc/ssh/ssh_host_ed25519_key.pub "/shared/host_key_$PORT.pub"
chmod a+r /shared/*
exec /usr/sbin/sshd -D -e -p "$PORT"
