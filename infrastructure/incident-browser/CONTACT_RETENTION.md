# Completed-order contact retention

Owner authorized deletion and recurring execution every three days on 2026-10-20.
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

Full paginated order, issue and contact inventories are mandatory. A contact
needs an exact order reference and matching phone. Completed delivery qualifies;
a rejection or return request does not. Returned parcels require an explicit
return timestamp from order details. Other nonterminal orders or unresolved
issues protect the contact. Unknown states and ambiguous matches are retained.
Before each deletion, reload the contact and order and check newly created
orders. Full inventories refresh at least every minute during execution.

Backups of contact metadata and order evidence are private mode-0600 files under
`/state/contact-retention/`, not Git. They are not backups of conversation history.
Deletion is irreversible through this job. Its pending journal prevents blind
retries. Absence is verified against a complete contact inventory after the
first deletion and each batch of ten. `latest.json`, `failure.json` and
`schedule.json` expose counts, safe failure codes and the next due time.

An API cannot make a contact deletion and an order creation transaction atomic.
The fresh reads reduce this race; unverified or conflicting evidence blocks
deletion. Contacts not safely attributable to a completed order remain intact.
