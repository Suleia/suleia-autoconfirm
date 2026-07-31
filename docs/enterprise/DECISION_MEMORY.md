# Decision Memory design

Decision Memory is an immutable record of what was known, proposed, reviewed
and observed later. It stores structured evidence, not chain-of-thought.

## Contract

`decision_id`, masked `order_id`, `canonical_order_id`, `business_context`,
`snapshot_version`, `facts_available`, `facts_rejected`, `sources`,
`freshness`, `policies_considered`, `policy_selected`, `policies_rejected`,
`alternatives`, `proposed_action`, `route`, `risk`, `qa`, `compliance`,
`confidence`, `human_review`, `human_decision`, `override_reason`,
`action_result`, `final_order_outcome`, `economic_result`,
`lessons_generated`, `created_at`, `completed_at`, `policy_versions` and
`schema_version`.

Facts and free text pass through the central minimizer. Human corrections are
typed outcomes and reason codes. Missing later outcomes remain `UNKNOWN`; they
are never inferred from silence.

## Queries supported later

- reconstruct a decision at its original snapshot;
- explain selected and rejected policies and alternatives;
- compare human overrides with subsequent outcomes;
- calculate cost, recovery and policy influence;
- resimulate the same immutable facts under another policy version.

Similarity is initially exact or rule-based on typed dimensions. Embeddings
and external AI are out of scope.
