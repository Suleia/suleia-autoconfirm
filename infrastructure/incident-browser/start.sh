#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
Xvfb :99 -screen 0 1600x1100x24 -nolisten tcp &
xvfb=$!
trap 'kill "$xvfb" 2>/dev/null || true' EXIT
for i in {1..30}; do test -S /tmp/.X11-unix/X99 && break; sleep 0.2; done
openbox >/tmp/openbox.log 2>&1 &
# VNC is reachable only by the in-container websocket proxy. The container web
# port MUST be published on host loopback and accessed through authenticated SSH.
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 -o /tmp/vnc.log &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
node /app/browser.mjs
