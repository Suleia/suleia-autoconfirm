# Local ingestion pipeline

The current prototype accepts only `SHOPIFY`, `DROPEA`, `CHATBY`, `GLS` and `FIXTURE` source labels. It performs the following steps before an event reaches the Event Store:

1. validate the source and required identifiers;
2. hash the source record identifier;
3. mask names, contact details, addresses and secrets;
4. reject the record if a direct PII pattern remains;
5. generate a deterministic deduplication key;
6. append an immutable simulation event;
7. return `actions_executed=0`.

There are no network connectors in this package. Live polling, webhooks and production imports remain disabled. The first authorized rehearsal must use one masked record only and pass the same PII and deduplication gates.
