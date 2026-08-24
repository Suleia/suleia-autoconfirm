# Budget policy status

The requested deterministic budget rules belong to META-2 and are intentionally not implemented in META-0/META-1. The reader provides the exact inputs needed later: active status, real budget owner, budget period, budget in Meta minor units and EUR, Purchase ROAS, purchases, purchase value, spend, account timezone, and currency.

The future policy constants remain:

- scale only when Purchase ROAS is strictly greater than 4;
- add EUR 10 during the normal window;
- never exceed EUR 200 daily budget;
- null/invalid/ambiguous ROAS is `NO_DATA -> HOLD`;
- ROAS below 2 is `NEVER_SCALE_UP`;
- no real execution before explicit authorization.

No decision or target budget is emitted by META-1, preventing an unfinished policy from being mistaken for an executable instruction.
