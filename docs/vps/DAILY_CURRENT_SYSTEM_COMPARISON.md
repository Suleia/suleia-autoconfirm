# Daily current-system comparison

Date: 2026-07-27

Status: not executed.

The comparison implementation matches records only through exact technical
references. It classifies results as `MATCH`, `PARTIAL_MATCH`,
`EXPECTED_DIFFERENCE`, `UNEXPECTED_DIFFERENCE` or `INSUFFICIENT_DATA`.

The current system is explicitly treated as a non-authoritative cache and
cannot replace Shopify when proving that every order created today was
retrieved.

The mandatory Shopify preview gate failed before the current-system query.
Therefore no order-level comparison was attempted, no difference totals are
reported and no rule was changed.
