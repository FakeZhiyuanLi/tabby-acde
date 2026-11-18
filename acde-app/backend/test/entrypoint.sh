#!/bin/sh
# Sets the per-run test password, makes a passphrase-protected test key, shares the host key, runs sshd.
set -eu
echo "tester:$TEST_PASSWORD" | chpasswd
ssh-keygen -q -t ed25519 -N "$TEST_KEY_PASSPHRASE" -f /shared/test_key
install -d -m 700 -o tester -g tester /home/tester/.ssh
install -m 600 -o tester -g tester /shared/test_key.pub /home/tester/.ssh/authorized_keys
cp /etc/ssh/ssh_host_ed25519_key.pub /shared/host_key.pub
chmod a+r /shared/*
exec /usr/sbin/sshd -D -e
