# Incident question loop containment

Owner requested an immediate production correction on 31 October 2026 after
repeated scheduling questions. The existing delivery-reply gateway and its
clarification/status switches were temporarily parked between cycles; other
controls, lifecycle templates, claims and incident workers were retained.

The legacy clarification key included both administrative issue and reason.
Changing either permitted another question about the same order. In addition,
LIVE V3 could return the legacy question when its own decision required human
review. A future date without a structured morning/afternoon value was also
incorrectly described as expired.

Corrections:

- LIVE V3 can authorize only its own admitted reply. Human review, waiting or
  an unclassified decision cannot fall back to a legacy clarification.
- A clarification reserves the existing durable ledger key
  `incident_delivery_clarify_v2` for the exact order, independent of issue,
  reason or conversation version. At most one automated clarification per
  order; further uncertainty is handed to a person. This is a conservative
  customer-experience limit, not an authorization to cancel an order.
- Legacy clarification reservations, including unknown outcomes, are read
  across the order. Prior verified free-text questions in the exact current
  conversation also prevent repeating the same topic. Other orders and
  lifecycle templates are excluded. Claims are never reset or deleted.
- Future approximate noon availability is preserved literally. No exact time
  or carrier promise is invented. A missing window alone is not an expired day.
- Short frustrated/disengaging replies block questions for human review; they
  do not become a new delivery confirmation or automatic return.
- Existing master/capability controls are re-read during revalidation and at
  the final queue fetch. Legacy generic clarification text cannot dispatch.
  The same queue performs at most one guarded text POST; uncertain outcomes
  retain reservations and use history-only reconciliation.

This change does not alter pricing, discounts, their support email/evidence
owner, confirmations, lifecycle templates, returns, GLS pickup or schedulers.
Synthetic regression fixtures do not contain the actual customer transcript.
Private replay and before/after control receipts remain on the VPS.
