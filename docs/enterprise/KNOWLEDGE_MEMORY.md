# Knowledge Memory design

Knowledge Memory records typed business knowledge with provenance. Allowed
kinds are FACT, POLICY, OBSERVATION, HYPOTHESIS, RECOMMENDATION, DECISION,
RESULT and LESSON.

Each item declares `knowledge_id`, `kind`, `subject_ids`, structured content,
evidence event ids, source, author role, confidence, freshness, validity,
created time, superseding item and schema version.

It covers rule creation and modification, reason, before/after result,
economic impact, avoided errors, human overrides, relevant incidents, carrier
or source changes, architecture decisions and migrations.

An observation or hypothesis cannot become a policy. Promotion requires a
separate versioned proposal, QA, review and explicit lifecycle transition.
Free text is minimized and no chain-of-thought is stored.
