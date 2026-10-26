#!/usr/bin/env bash
set -euo pipefail
umask 077

# Installs files only. Does not read secrets, start the bot or change webhooks.
if [[ ${1:-} != --install-only ]]; then
  echo 'Usage: sudo bash install.sh --install-only' >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
getent passwd suleiaops >/dev/null || { echo 'Provision service account suleiaops first.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) !== 22) process.exit(1)' || { echo 'Node 22 must be on the service PATH.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -e /opt/suleia-telegram && ! -L /opt/suleia-telegram ]]; then
  echo '/opt/suleia-telegram exists and is not a managed symlink; inspect it before installing.' >&2
  exit 1
fi
if systemctl is-active --quiet suleia-telegram; then
  echo 'Stop the existing Telegram service before updating its files.' >&2
  exit 1
fi
for file in config store api reports spanish controller service telegram-admin ads-gateway compact-reports meta-summary artifacts daily-reports order-alerts executive-reports autopilot-reports admin-link admin-link-observer; do
  node --check "$source_dir/$file.mjs"
done
systemd-analyze verify "$source_dir/suleia-telegram.service"
install -d -m 0755 /opt/suleia-telegram-releases
release_dir=$(mktemp -d /opt/suleia-telegram-releases/release.XXXXXXXX)
chmod 0755 "$release_dir"
for file in config store api reports spanish controller service telegram-admin ads-gateway compact-reports meta-summary artifacts daily-reports order-alerts executive-reports autopilot-reports admin-link admin-link-observer; do
  install -o root -g root -m 0644 "$source_dir/$file.mjs" "$release_dir/$file.mjs"
done
install -o root -g root -m 0644 "$source_dir/render-report.py" "$release_dir/render-report.py"
install -o root -g root -m 0644 "$source_dir/README.md" "$release_dir/README.md"
if [[ ! -d /etc/suleia ]]; then install -d -m 0700 /etc/suleia; fi
if [[ ! -e /etc/suleia/telegram.env ]]; then
  install -o root -g root -m 0600 "$source_dir/environment.example" /etc/suleia/telegram.env
fi
if [[ -f /etc/systemd/system/suleia-telegram.service ]]; then
  cp -p /etc/systemd/system/suleia-telegram.service "$release_dir/previous.service"
fi
install -o root -g root -m 0644 "$source_dir/suleia-telegram.service" /etc/systemd/system/suleia-telegram.service
link_tmp="/opt/.suleia-telegram-link-$$"
trap 'rm -f -- "$link_tmp"' EXIT
ln -s -- "$release_dir" "$link_tmp"
mv -Tf -- "$link_tmp" /opt/suleia-telegram
systemctl daemon-reload
echo 'Files installed. Service remains stopped. Configure secrets privately, then follow README cutover and verification.'
