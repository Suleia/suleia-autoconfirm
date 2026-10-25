# Replies to the order reminder

Owner-authorized on 2026-10-25. Replies to `dropea_pedido_reminder_v1`
enter the existing order confirmation evaluator and executor. The approved
quick reply is `CONFIRMAR MI PEDIDO`; no callback route is changed.

The ordinary top-level Chatby message representation is retained. For genuine
inbound messages with empty top-level content, the order reader also accepts
visible postback/button titles or text-message text/body in `payload`. Opaque
callback IDs, templates, outbound/agent/echo messages cannot supply this fallback.
This same reader runs at initial evaluation and at the final fresh read.

The reminder itself is not consent and does not start/reset a confirmation
timer. Customer consent starts the existing one-hour delay. Exact current-order
binding, duplicate protection, fresh pending Dropea state, complete fresh
conversation, later cancellation/address/conditional holds and post-action
verification remain unchanged. There is no extra sender, executor or timer.

Validation: 716 worker tests passed in isolated Node 22 with no network or
production credentials (67 files, no failures/skips). Synthetic tests include
existing text/buttons, payload-only replies, timer origin, final read and
later contradictions. Production catalogue was read without modification.
At the initial read-only cohort audit, eleven verified reminders had no later
customer reply; no real customer was confirmed merely to test this change.
