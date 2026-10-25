# Personal OAuth return recovery

Owner requested on 2026-10-25 after the panel remained at login. A sanitized
Keycloak audit recorded `CODE_TO_TOKEN_ERROR / invalid_code` and an adjacent
already-used-code warning. A new legitimate authorization through the existing
personal SSO restored access; no credential was read or copied.

The panel now removes one-time OAuth callback parameters from browser history
before configuration/exchange work. It retains the parameters in the current
call for the existing state/PKCE verification. Reloading after an interrupted
exchange cannot submit the consumed code again. Other query context and the
section hash remain intact.

Configuration, code exchange and refresh have a 15-second deadline including
their response body. Failure returns a usable new-login link and an explicit
message. Definitive 400/401 refresh rejection removes that invalid refresh
credential. Concurrent refresh coalescing and token rotation are retained.

No issuer/client, scope, redirect allowlist, user role, session duration, PKCE,
state check, TLS or server security setting is relaxed. The access fix changes
two static assets over the deployed Ads reference release. The same follow-up
refreshes overview sparklines from the completed shared trend (the initial
report may have no daily rows) and uses an amber historical-freshness indicator.
It makes no extra report request or freshness override. Tests exercise full
startup, return links, invalid nonce/missing PKCE, interrupted/rejected exchange,
body/header timeouts, refresh concurrency/rotation and unauthorized access.
