#!/usr/bin/env bash
set -Eeuo pipefail

ADMIN_USER="${SULEIA_ADMIN_USER:-suleiaops}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ "${CONFIRM_KEY_LOGIN:-no}" != "yes" ]]; then
  echo "Refusing to harden SSH before key login is confirmed." >&2
  echo "Run with CONFIRM_KEY_LOGIN=yes only after a separate key login works." >&2
  exit 1
fi

AUTHORIZED_KEYS="/home/${ADMIN_USER}/.ssh/authorized_keys"
if [[ ! -s "${AUTHORIZED_KEYS}" ]]; then
  echo "No authorized key found for ${ADMIN_USER}." >&2
  exit 1
fi

cat > /etc/ssh/sshd_config.d/99-suleia-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
MaxAuthTries 3
LoginGraceTime 30
EOF

sshd -t
systemctl reload ssh

echo "SSH hardening completed. Root and password login are disabled."

