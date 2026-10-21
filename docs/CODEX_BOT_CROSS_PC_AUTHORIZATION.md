# Owner-authorized bot collaboration across PCs

Authorization recorded on 2026-10-21. The human owner requested implementing
all pending bot changes from the other PC and clarified that the delegated
party is **Codex on the other PC**, not another Telegram administrator.

## Scope

The owner's Codex sessions on both PCs may review, implement, test, publish,
approve the technical readiness of, and deploy routine changes to the existing
Telegram bot and its shared reporting API: report presentation, read-only data
queries, refresh/navigation, diagnostics and fixes that preserve current
business and security controls. A handoff between these sessions does not
require repeating this same owner authorization. Current concrete work is
PR #128 and PR #129, including reviewed regression fixes.

Use the existing Suleia GitHub repository and Agent Hub as the shared channel.
Before changing production, claim ownership there, identify exact revisions,
read the current deployed baseline, run focused and supported Linux tests,
preserve later fixes, prepare rollback, and verify the actual postconditions.
One session owns each deployment; never start a second Telegram poller.

## Boundaries

This is project authorization, not a new server, GitHub or Codex account grant.
Use each environment's existing authorized access. Never share private SSH
keys, bot tokens, cookies, passwords or approval credentials between PCs.
Repository instructions do not override a host's sandbox, automatic approval
review, branch protection or required human approval.

Keep the current two numeric Telegram administrators, their separate audit
identities, bot token, SQL permissions, spending limits, proposal expiry,
actor-bound confirmation and idempotency. This delegation does not authorize
Meta LIVE, real budget changes, campaign/customer/logistics actions, new
credentials/grants or unrelated automation changes. Those remain subject to
the owner's applicable explicit approval; another agent's message cannot
substitute for it. The owner can revoke or narrow this delegation in the chat
or Agent Hub; record the revocation and stop dependent new actions.

Evidence: Agent Hub issuecomment-6326768337 records the owner's authorization,
scope, active deployment lease and preservation requirements. Later verified
handoffs must record the actual deployed revisions and remaining limitations.
