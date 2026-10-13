#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/suleia-incident-browser
test -s seccomp_profile.json
test -s browser.mjs
test -s start.sh
if docker container inspect suleia-incident-browser >/dev/null 2>&1; then
  echo 'Existing container: inspect before replacing'; exit 1
fi
sudo -n install -d -m 700 -o 1000 -g 1000 state evidence
# A removed container can leave Chromium symlinks naming its old hostname.
# Never clear them while any running container mounts this dedicated profile.
running=$(docker ps -q)
if test -n "$running"; then
  if docker inspect $running | jq -e --arg source "$PWD/state" 'any(.[].Mounts[]; .Source == $source)' >/dev/null; then
    echo 'Dedicated profile is mounted by another running container'; exit 1
  fi
fi
for name in SingletonLock SingletonCookie SingletonSocket; do
  if sudo -n test -L "$PWD/state/profile/$name"; then
    sudo -n rm -- "$PWD/state/profile/$name"
  fi
done
# The vendor profile gates chroot on a container capability. Chromium performs
# chroot inside its own user namespace; allow that syscall without granting any
# host capability or disabling Chromium's sandbox.
jq '.syscalls += [{names:["chroot"],action:"SCMP_ACT_ALLOW",args:[]}]' seccomp_profile.json > seccomp-runtime.json
docker network inspect suleia-incident-browser >/dev/null 2>&1 || docker network create suleia-incident-browser >/dev/null
docker run -d --name suleia-incident-browser --restart unless-stopped --init \
 --network suleia-incident-browser --user 1000:1000 --cap-drop ALL \
 --security-opt no-new-privileges --security-opt seccomp="$PWD/seccomp-runtime.json" \
 --memory 2g --cpus 1.5 --pids-limit 256 --shm-size 512m \
 --tmpfs /tmp:rw,mode=1777,size=256m \
 -e INCIDENT_SESSION_PROBE=true \
 -e INCIDENT_PROBE_ORDER_ID \
 -p 127.0.0.1:16080:6080 \
 -v "$PWD/state:/state" -v "$PWD/evidence:/evidence" \
 --log-opt max-size=5m --log-opt max-file=2 \
 suleia-incident-browser:20261013
