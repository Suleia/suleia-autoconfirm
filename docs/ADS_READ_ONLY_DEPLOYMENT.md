# Read-only panel deployment

The existing API login has `default_transaction_read_only=on`. Grants on new
Ads tables alone do not permit report snapshot persistence. Do not relax the
operational login or silently create another production login.

`ADS_REPORT_READ_ONLY=true` serves the same canonical Meta report from bounded
GET requests and a two-minute memory cache, without saving snapshots. Existing
history remains readable. The ledger fails closed on mutation methods;
proposal/diagnosis save controls are disabled. Meta LIVE remains uncompiled.

The owner has authorized displaying campaigns. A dedicated Ads SQL connection,
durable proposals and the Command Center 2.0 deployment require their concrete
review/approval. The candidate dedicated connection may write only new Ads
tables and read the existing HMAC reference projection; it must not acquire
finance/logistics writes or change the operational read-only role.

Rollback switches only API image and the two Ads JavaScript assets back to the
previous immutable artifacts. Existing protected runtime configuration and
operational files must be preserved. No operational rows are changed.
