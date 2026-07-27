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

HARDENING_CONFIG="/etc/ssh/sshd_config.d/00-suleia-hardening.conf"
LEGACY_HARDENING_CONFIG="/etc/ssh/sshd_config.d/99-suleia-hardening.conf"

cat > "${HARDENING_CONFIG}" <<'EOF'
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

rm -f "${LEGACY_HARDENING_CONFIG}"
sshd -t
systemctl reload ssh

if [[ "$(sshd -T | awk '/^permitrootlogin / {print $2}')" != "no" ]] \
  || [[ "$(sshd -T | awk '/^passwordauthentication / {print $2}')" != "no" ]] \
  || [[ "$(sshd -T | awk '/^kbdinteractiveauthentication / {print $2}')" != "no" ]]; then
  echo "SSH hardening validation failed." >&2
  exit 1
fi

echo "SSH hardening completed and validated."
