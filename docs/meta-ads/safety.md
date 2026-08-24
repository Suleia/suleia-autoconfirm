# Meta Ads safety boundary

META-0/META-1 are fail-closed:

- execution mode must equal `SIMULATION`;
- all three write/send flags must be absent or exactly `false`;
- the client exposes only named GET readers and no generic request/mutation method;
- the transport permits only GET/HEAD, exact HTTPS host `graph.facebook.com`, and the configured API-version path;
- request bodies and URL tokens are blocked;
- pagination cannot change host or API version and strips any token Meta includes in a next link;
- currency must be EUR, timezone must be Europe/Madrid, account must be active, and `ads_read` must be granted;
- missing, invalid, or ambiguous ROAS remains null;
- campaign/ad-set budget ownership is read from fields, never inferred from names;
- output errors do not include provider payloads or tokens;
- there is no database writer, Telegram sender, scheduler, budget writer, or production mode.

Deployment remains blocked until a dedicated read-scoped token replaces the historical broader credential. Future writes require separate authorization, an execution gateway, policy tests, durable idempotency, locks, reconciliation, audit storage, and rollback.
