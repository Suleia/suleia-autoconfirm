#!/usr/bin/env bash
set -Eeuo pipefail

ADMIN_USER="${SULEIA_ADMIN_USER:-suleiaops}"
INSTALL_ROOT="${SULEIA_INSTALL_ROOT:-/opt/suleia-operations}"
PUBLIC_KEY="${SULEIA_SSH_PUBLIC_KEY:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ ! "${PUBLIC_KEY}" =~ ^ssh-(ed25519|rsa)[[:space:]] ]]; then
  echo "SULEIA_SSH_PUBLIC_KEY must contain a valid SSH public key." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y \
  ca-certificates \
  curl \
  fail2ban \
  git \
  gnupg \
  jq \
  rsync \
  ufw \
  unattended-upgrades

if ! id "${ADMIN_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${ADMIN_USER}"
fi

usermod -aG sudo "${ADMIN_USER}"
printf '%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "${ADMIN_USER}" \
  > "/etc/sudoers.d/90-${ADMIN_USER}"
chmod 0440 "/etc/sudoers.d/90-${ADMIN_USER}"
visudo -cf "/etc/sudoers.d/90-${ADMIN_USER}"

install -d -m 700 -o "${ADMIN_USER}" -g "${ADMIN_USER}" \
  "/home/${ADMIN_USER}/.ssh"
printf '%s\n' "${PUBLIC_KEY}" \
  > "/home/${ADMIN_USER}/.ssh/authorized_keys"
chown "${ADMIN_USER}:${ADMIN_USER}" \
  "/home/${ADMIN_USER}/.ssh/authorized_keys"
chmod 600 "/home/${ADMIN_USER}/.ssh/authorized_keys"

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

usermod -aG docker "${ADMIN_USER}"

install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF
systemctl enable --now docker
systemctl restart docker

install -d -m 0750 -o "${ADMIN_USER}" -g "${ADMIN_USER}" "${INSTALL_ROOT}"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone UTC

cat <<EOF
Phase one completed.

Next:
1. Keep this session open.
2. Test key login in a second terminal:
   ssh -i <private-key> ${ADMIN_USER}@<server-ip>
3. Only after that succeeds, run finalize-ssh-hardening.sh.

Ports 80 and 443 remain closed.
EOF
