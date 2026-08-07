BEGIN;

ALTER TABLE integration.dropea_orders
  ADD COLUMN IF NOT EXISTS customer_identity_hash text;

ALTER TABLE read_models.operations_order_records
  ADD COLUMN IF NOT EXISTS customer_identity_hash text;

ALTER TABLE integration.dropea_orders
  DROP CONSTRAINT IF EXISTS dropea_orders_customer_identity_hash_check;
ALTER TABLE integration.dropea_orders
  ADD CONSTRAINT dropea_orders_customer_identity_hash_check
  CHECK (customer_identity_hash IS NULL OR customer_identity_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE read_models.operations_order_records
  DROP CONSTRAINT IF EXISTS operations_order_customer_identity_hash_check;
ALTER TABLE read_models.operations_order_records
  ADD CONSTRAINT operations_order_customer_identity_hash_check
  CHECK (customer_identity_hash IS NULL OR customer_identity_hash ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE VIEW read_models.customer_operational_history AS
WITH order_rollup AS (
  SELECT o.customer_identity_hash AS customer_key,
    count(*)::integer AS orders_total,
    count(*) FILTER (WHERE o.lifecycle_status IN ('DELIVERED','FINISHED'))::integer AS delivered,
    count(*) FILTER (WHERE o.lifecycle_status IN ('CANCELLED','REJECTED'))::integer AS cancelled,
    count(*) FILTER (WHERE r.duplicate_status='DUPLICATE_ACTIVE_ORDER')::integer AS duplicate_attempts,
    max(o.created_at_utc) AS last_order_at
  FROM integration.dropea_orders o
  JOIN read_models.operations_order_records r USING(canonical_order_id)
  WHERE o.customer_identity_hash IS NOT NULL
  GROUP BY o.customer_identity_hash
), issue_rollup AS (
  SELECT o.customer_identity_hash AS customer_key,
    count(i.*)::integer AS incidents,
    count(*) FILTER (WHERE i.canonical_type='RECIPIENT_ABSENT'
      AND i.delivery_attempt_number IN ('1','FIRST','FIRST_ATTEMPT'))::integer AS first_absence,
    count(*) FILTER (WHERE i.canonical_type='RECIPIENT_ABSENT'
      AND i.delivery_attempt_number IN ('2','SECOND','SECOND_ATTEMPT'))::integer AS second_absence,
    count(*) FILTER (WHERE i.canonical_type='REFUSED_BY_RECIPIENT')::integer AS refused,
    count(*) FILTER (WHERE i.resolution_status='PICKUP_AT_AGENCY')::integer AS pickup_at_agency,
    count(DISTINCT i.canonical_order_id) FILTER (
      WHERE i.canonical_type IN ('RETURN_REQUESTED','POSSIBLE_RETURN')
         OR i.resolution_status='RETURN_REQUESTED')::integer AS return_to_origin,
    count(DISTINCT i.canonical_order_id) FILTER (
      WHERE o.lifecycle_status IN ('DELIVERED','FINISHED'))::integer AS recovery_success
  FROM integration.dropea_orders o
  JOIN integration.dropea_issues i USING(canonical_order_id)
  WHERE o.customer_identity_hash IS NOT NULL
  GROUP BY o.customer_identity_hash
)
SELECT h.customer_key,h.orders_total,h.delivered,h.cancelled,
  coalesce(i.return_to_origin,0)::integer AS return_to_origin,
  coalesce(i.incidents,0)::integer AS incidents,
  coalesce(i.first_absence,0)::integer AS first_absence,
  coalesce(i.second_absence,0)::integer AS second_absence,
  coalesce(i.refused,0)::integer AS refused,
  coalesce(i.pickup_at_agency,0)::integer AS pickup_at_agency,
  coalesce(i.recovery_success,0)::integer AS recovery_success,
  h.duplicate_attempts,h.last_order_at,
  'SHADOW_READ_ONLY'::text AS run_mode,
  0::integer AS actions_executed,0::integer AS production_writes
FROM order_rollup h LEFT JOIN issue_rollup i USING(customer_key);

GRANT SELECT ON read_models.customer_operational_history
  TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;

COMMIT;

