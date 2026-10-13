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
docker network inspect suleia-incident-browser >/dev/null 2>&1 || docker network create suleia-incident-browser >/dev/null
docker run -d --name suleia-incident-browser --restart unless-stopped --init \
 --network suleia-incident-browser --user 1000:1000 --cap-drop ALL \
 --security-opt no-new-privileges --security-opt seccomp="$PWD/seccomp_profile.json" \
 --memory 2g --cpus 1.5 --pids-limit 256 --shm-size 512m \
 -p 127.0.0.1:16080:6080 \
 -v "$PWD/state:/state" -v "$PWD/evidence:/evidence" \
 --log-opt max-size=5m --log-opt max-file=2 \
 suleia-incident-browser:20261013
