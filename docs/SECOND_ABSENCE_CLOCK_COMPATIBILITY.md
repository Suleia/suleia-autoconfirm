# Compatibility with the second-absence notice

The owner authorized a separate notice for a new failed second delivery attempt
on 2026-10-22. The VPS controller reuses the approved v3 template. Render's
absence-only discount clock must keep its first current-order v3 receipt.

The shared delivery helper intentionally returns the latest receipt for other
workflows. Keep it unchanged. The absence policy individually verifies v3
receipts, scopes them after order creation, chooses the earliest and still
blocks unknown/future receipt times and every later customer interaction.
The second notice cannot renew the original 24-hour deadline or erase a reply.

No template/flow, amount, discount support owner, returns, confirmations or
other notification rules change. This companion deployment is required before
re-enabling the VPS second-notice flag in PR137. Existing address revision gates
must follow the fully regression-tested Render commit; all other settings stay
unchanged. Rollback must disable new second notices before restoring the older
Render policy and retain all existing provider receipts and claims.
