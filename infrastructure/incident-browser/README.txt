Dedicated VPS browser for incident evidence

This component runs and stores its profile on the existing VPS. It does not
depend on the operator's desktop. It defaults to OBSERVE_ONLY. Execution is
controlled by private /state/retry-control.json: AUTO_CANARY processes at most
one eligible retry per 30-minute cycle and promotes to AUTO only after API and
attachment verification. Browser running alone does not prove execution works.

Build with Docker. Run as uid/gid 1000 with the vendor Playwright seccomp profile,
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
any worker. A missing/expired session blocks writes and records a private error.

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
an incident. retry-policy.mjs contains the tested policy/execution boundary.
The scheduler reads pending incidents and replies every 30 minutes using scoped
credentials in /state/provider-env.json. runtime.mjs connects the shared claim,
capture, UI attachment/save and API plus persisted evidence verification.
Inspect /state/observer-health.json and /state/retry-observation.json for actual
cycle results. A running timer alone does not prove that provider reads succeed.
It runs immediately on startup and every 30 minutes, 24/7, without overlapping
cycles. Private health includes the last trigger and next scheduled run in UTC.
Docker must be enabled at host boot; run.sh uses restart unless-stopped. No
desktop session, SSH tunnel or Codex conversation is needed for routine cycles.
Readiness allows 30 minutes between starts plus the 25-minute cycle watchdog
and a 5-minute reporting margin; errors and missing sessions still block READY.

Build preparation: export the deployed autoconfirm/src revision into the ignored
runtime-src directory before docker build; never copy .env or customer data.
Runtime uses uid/gid 1000 explicitly, including its private configuration path.
Private capture requests and provider configuration must be readable only by
that UID. No real actions are performed by probe or observer queues.

Mandatory execution gates: exact current-order conversation, current pending
incident, future unambiguous date/window, later-message checks, prior-return
guard, shared Supabase incident claim, actual phone/date/message screenshot,
evidence attachment, one save, provider readback and persisted evidence.
Unknown writes retain the claim and require reconciliation. Existing Render
automations remain the owners of templates, discounts and silent returns.

A screenshot self-test and local file-input test are not a real provider write.
The first naturally eligible live retry remains the end-to-end canary. Do not
invent a customer request, replay a resolved case or claim live success before
that canary is verified. /state/retry-reconcile.json blocks further writes after
an uncertain execution. Preserve the shared claim while investigating.

Dropea date input must use its calendar; text fill was observed to clear on blur.
Evidence visibility checks include scroll-container clipping and occlusion.
Routine Dropea recovery may submit only the already-filled dedicated login form
for the owner email in /state/dropea-login-identity.json. Passwords are never
extracted. Missing autofill or account mismatch requires interactive renewal.

Owner rule added 2026-10-13: a short unconditional desire for the current order,
without any customer date/window preference, requests next business morning.
The plan records OWNER_NEXT_BUSINESS_MORNING so this is never presented as a
customer-selected date. The one-hour wait and all claim/evidence checks remain.
Partial dates, time constraints, address changes and earlier preferences block
the default. Existing explicit-date parsing is unchanged.
The business calendar covers weekends and BOE national/regional holidays for
2026/2027, using the destination postcode. Unknown regions/years and island or
Aran mappings block this default. Municipal holidays are not yet in the table;
the requested retry is subject to carrier availability, not a delivery promise.
Sources: https://www.boe.es/buscar/doc.php?id=BOE-A-2025-21667
https://www.boe.es/buscar/doc.php?id=BOE-A-2026-21254

Owner rule added 2026-10-14: an unconditional request to receive the order in
the morning/afternoon, missing only the date, keeps that window on the next
business day. The plan records OWNER_NEXT_BUSINESS_CUSTOMER_WINDOW. Only
responses younger than 24 hours qualify; other dates, precise times, conditions,
earlier preferences and discount dependencies remain blocked. A factual past
absence alone does not negate an explicit request for a new delivery. The
one-hour wait, exact customer evidence, screenshot and all write gates remain.

Stop/rollback: docker stop suleia-incident-browser. Preserve private profile
and evidence; do not touch the existing Operations containers.

Operational audit hardening (2026-10-13): readiness now requires fresh successful
cycles and visible sessions; cycle history distinguishes configuration from
actual execution. Network calls have bounded timeouts, session persistence is
serialized and a stuck cycle restarts after 25 minutes. A durable pre-save
journal survives restart. Recovery only reads Dropea and verifies the saved
evidence; it never submits an uncertain retry again. Errors before Save retain
any acquired case claim but do not stop unrelated incidents.

Each cycle follows verified retries through delivery/return/reopening and saves
private feedback locally and in Supabase vps_retry_feedback_v1. Feedback does not
train a model or rewrite business rules; improvements require reviewed tests.
The Render DETAILS capability can be reconciled without resending when its
exact outgoing text, conversation, attempt window and provider WAMID match.
The message/action ledgers and capability state use compare-and-swap updates.

Official references:
https://playwright.dev/docs/docker
https://playwright.dev/docs/auth
