# Trendtrack phase 1 — manual connection check

Node 22, no dependencies, no timer, no daemon, no database access.
Only `GET https://api.trendtrack.io/v1/me` and `/v1/usage` are allowed.
Both are unmetered according to the official billing documentation:
https://app.trendtrack.io/en/docs/guides/credits-and-billing

Requests use Bearer authentication, a 10-second timeout, no redirects and no
automatic retries. Errors omit provider bodies and request details. Identity
responses are not printed. The checker prints status, balance and usage cost.
Paid endpoints are blocked before network access. Unexpected nonzero usage
headers stop execution; this cannot reverse a provider charge if pricing changes.

## Tests

```sh
node --test infrastructure/trendtrack/client.test.mjs
```

## Manual installation (requires owner approval)

Copy these files to `/opt/suleia-trendtrack-phase1`, owned by root, and record the
Git revision in `REVISION`. Do not edit existing Compose files or services.
Transfer the key over SSH to `/etc/suleia/trendtrack.env`, owned by root, mode
0600. Never place secret values in shell arguments, source control or logs.
The file must contain the `TRENDTRACK_API_KEY` assignment; it is parsed as data,
never sourced as a shell script. Environment-variable injection is also supported.

```sh
sudo node --test /opt/suleia-trendtrack-phase1/client.test.mjs
sudo node /opt/suleia-trendtrack-phase1/check.mjs /etc/suleia/trendtrack.env
```

Success requires both HTTP 200 and a valid balance from `/v1/usage`.
This does not activate commercial intelligence, paid queries or automation.

## Rollback

No existing service needs restarting. After verifying these exact paths belong
only to this installation, remove the isolated installation directory and its
dedicated credentials file. If replacing a previous installation, preserve it
and restore its files and key permissions instead of deleting them.
