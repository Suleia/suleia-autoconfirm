Dedicated VPS browser for incident evidence

This component runs and stores its profile on the existing VPS. It does not
depend on the operator's desktop. It is a session-setup component, not yet an
enabled incident executor. Browser running does NOT mean incident automation is
ready. No real provider writes are implemented or enabled by this component.

Build with Docker. Run as pwuser with the vendor Playwright seccomp profile,
--init, --cap-drop ALL, --security-opt no-new-privileges, --memory 2g,
--cpus 1.5, --pids-limit 256 and --shm-size 512m. Bind /state and /evidence to
private directories owned by uid 1000 with mode 0700. Keep evidence out of Git.
Use a dedicated Docker network. Publish only 127.0.0.1:16080:6080; never expose
VNC, CDP, Playwright or noVNC publicly. Access the desktop via authenticated SSH
local port forwarding. Close the tunnel after login. Do not copy general browser
cookies or session files. Authenticate the dedicated profile interactively.
The launcher adds chroot to the vendor syscall allowlist for Chromium's private
user namespace, without adding host capabilities. /tmp is disposable on restart.

Health is private /state/health.json. runtime-selftest.png proves only that the
server can render and capture; it is NOT customer evidence. Site UI detection is
not account identity verification. Verify the correct accounts before enabling
any worker. A missing/expired session must block writes and generate an alert.

The dedicated profile additionally saves only Chatby/Dropea session cookies
and per-tab session storage in /state/dedicated-session.json (0600), because
ordinary Chromium profile persistence does not retain every session cookie.
This is scoped to the server profile authenticated by the owner. Never import
the operator's desktop session or include this file in logs, archives or Git.
The launcher execs Node so Docker SIGTERM reaches the graceful browser close.
Unexpected browser closure terminates the container process for restart.

A private /state/capture-request.json runs a READ-ONLY exact-message capture.
Its input requires order, conversation, numeric message id, exact text, time,
phone and customer name obtained from fresh authorized provider reads. A
capture succeeds only when phone, date, time and message are all visible.
Diagnostics and images stay under private /evidence. This queue cannot submit
an incident. retry-policy.mjs contains the tested policy/execution boundary;
production UI write adapters and scheduling are still pending validation.

Remaining execution gates: exact current-order conversation, current pending
incident, future unambiguous date/window, later-message checks, prior-return
guard, shared Supabase incident claim, actual phone/date/message screenshot,
evidence attachment, one save, provider readback and persisted evidence.
Unknown writes retain the claim and require reconciliation. Existing Render
automations remain the owners of templates, discounts and silent returns.

Stop/rollback: docker stop suleia-incident-browser. Preserve private profile
and evidence; do not touch the existing Operations containers.

Official references:
https://playwright.dev/docs/docker
https://playwright.dev/docs/auth
