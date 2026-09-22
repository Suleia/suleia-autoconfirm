# AUSENTE correction and activation boundary

This change corrects RECIPIENT_ABSENT interpretation and presentation. It does
not activate a sender, modify a native Chatby flow, or enable a logistics writer.

- Policy, dashboard scope, attempt filters and counts use canonical attempt
  evidence. Queue hints are not first-attempt evidence. Conflicting structured
  and governed carrier evidence require review.
- Upper bounds, lower bounds, ranges and negative availability are parsed
  separately. Missing dates are not invented. A later correlated AM/PM correction
  supersedes the unexecuted proposal.
- AUSENTE history reads explicitly include bot messages, use the documented
  inclusive time cursor, deduplicate IDs and reject incomplete history. Other
  workflow readers retain their existing behavior.
- A newly created 48-hour timer requires an observed v3 notification and message
  identifier; the incident creation time and a legacy notice are insufficient.
- The approved v3 remains unchanged: Chatby 1552419, Meta 1123671516755556,
  es_ES/UTILITY. The owner chose its three approved buttons. Prepared secondary
  choices include another date, address details and agency pickup.
- The existing immutable SHADOW policy document/hash remains unchanged. Input
  snapshots include implementation version ABSENT_INTERPRETER_20260922 so new
  decisions do not reuse the previous implementation's identifier.

`absent-live-gates.mjs` is preflight validation, not a runtime sender or a
persistent delivery ledger. Its green synthetic test is not proof that the
production callback, native ownership, transactional claim, rollback or canary
requirements have been met. Logistics proposals contain no invented payload;
execution stays HUMAN_LOGISTICS_EXECUTION_REQUIRED.

Validation at implementation: 1060/1060 local tests. Exact image tests run again
before deployment. The SHADOW deployment helper backs up configuration and
database, preserves existing environments/mounts, replaces only API/MCP/worker,
and runs no migrations. Its rollback restores the three original containers
without deleting decision history. LIVE flags are not changed.

Outstanding activation gates: inspect the native AUSENTE configuration, preserve
its original mapping, verify real callbacks and exclusive ownership, validate
new-case restrictions/idempotency and run a real new-case canary. Approval of the
template alone is not approval of those operational gates.
