# Business Graph design

## Storage model

The first implementation is relational PostgreSQL. Proposed logical tables
are `business_entities`, `business_relationships` and typed read views. A
recursive CTE may traverse bounded paths; materialized views may serve stable
summaries. No Neo4j or additional service is required.

## Entity contract

Each entity has `entity_id`, `entity_type`, `canonical_technical_id`,
`valid_from`, `valid_until`, `source`, `freshness`, `evidence_event_ids`,
`created_at` and `schema_version`. Initial types are Customer, Order, Product,
SKU, Campaign, Advertisement, Channel, Carrier, Shipment, Incident,
Conversation, Message, Discount, Policy, Decision, Agent, Department, Review,
Supplier, Warehouse, DeliveryAttempt, AgencyPickup, Return, Cost, Revenue,
Margin and MigrationComponent.

## Relationship contract

Required fields are `relationship_id`, `source_entity_id`, `target_entity_id`,
`relationship_type`, `valid_from`, `valid_until`, `confidence`,
`evidence_event_ids`, `source`, `freshness`, `created_at` and
`schema_version`. Initial relationship types:

- CUSTOMER_PLACED_ORDER, ORDER_CONTAINS_PRODUCT and
  ORDER_ORIGINATED_FROM_CAMPAIGN;
- ORDER_ASSIGNED_TO_CARRIER, ORDER_HAS_SHIPMENT and SHIPMENT_HAS_INCIDENT;
- CUSTOMER_PARTICIPATED_IN_CONVERSATION and CONVERSATION_HAS_MESSAGE;
- DECISION_APPLIED_TO_ORDER, DECISION_USED_POLICY and
  AGENT_PROPOSED_DECISION;
- HUMAN_REVIEW_OVERRULED_DECISION and POLICY_CHANGED_OUTCOME;
- ORDER_RECEIVED_DISCOUNT, ORDER_RESULTED_IN_RETURN and
  ORDER_RESULTED_IN_DELIVERY;
- DECISION_GENERATED_COST, DECISION_GENERATED_REVENUE and
  SOURCE_PROVIDED_EVIDENCE.

## Integrity and privacy

Foreign keys must reference existing technical entities. Evidence is
append-only and relations are temporally versioned rather than overwritten.
Names, phones, email, addresses and fuzzy similarity are forbidden correlation
keys. Unknown or conflicting identity routes to review and creates no edge.

Suggested indexes cover entity type plus canonical id, both relationship
endpoints plus type, validity ranges, freshness and evidence-event lookup.
