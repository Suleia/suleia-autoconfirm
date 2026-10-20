# Completed-order contact retention

Owner authorized deletion and recurring execution every three days on 2026-10-20.
The owner subsequently explicitly added definitively cancelled orders and
ERROR/REJECTED orders without other active orders or unresolved incidents.
Rejected orders are recorded separately, never misreported as completed returns.
This job does not change templates, flows, confirmation logic or Dropea orders.

Run `node --test infrastructure/incident-browser/contact-retention.test.mjs`.
Deploy the runtime and policy together into the persistent container mount
`/state/contact-retention-code/`. Install the supplied systemd units on the VPS.
Run without arguments for a dry run; `--execute --due` enables deletion.

The timer checks every 15 minutes, but the private durable schedule only permits
a completed cleanup every 72 hours. Reboots retain the due date. Failures retry
on the next check, except ambiguous mutations fail closed pending reconciliation.
The systemd unit and flock prevent overlapping invocations. To stop, disable
`suleia-contact-retention.timer` and stop its service.

Full paginated order, issue and contact inventories are mandatory. An order
reference and matching phone bind contacts where reference fields exist.
Fieldless historical contacts qualify only when every order for that phone is
in an owner-authorized terminal category. Conflicting references remain blocked.
Completed delivery and definitive cancellation qualify, as does separately
authorized ERROR/REJECTED. A return request alone does not qualify. Returned
parcels require an explicit return timestamp. Other nonterminal orders or
unresolved incidents protect the contact. A confirmed delivery supersedes only
incidents whose last change demonstrably predates that delivery.
Before each deletion, reload the contact and order and check newly created
orders. Full inventories refresh at least every minute during execution.

Backups of contact metadata and order evidence are private mode-0600 files under
`/state/contact-retention/`, not Git. They are not backups of conversation history.
Deletion is irreversible through this job. Its pending journal prevents blind
retries. Absence is verified against a complete contact inventory after the
first deletion and each batch of 25. Calls are spaced at least eight seconds.
HTTP 429 preserves the provider's retry time in the durable schedule. An
explicitly throttled DELETE is not marked accepted; ambiguous outcomes still
require reconciliation before retry. `latest.json`, `failure.json` and
`schedule.json` expose counts, safe failure codes and the next due time.

An API cannot make a contact deletion and an order creation transaction atomic.
The fresh reads reduce this race; unverified or conflicting evidence blocks
deletion. Contacts not safely attributable to a completed order remain intact.
