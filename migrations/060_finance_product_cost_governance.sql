BEGIN;

CREATE TABLE IF NOT EXISTS economics.finance_product_cost_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigserial UNIQUE NOT NULL,
  rate_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('CREATE','UPDATE')),
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  principal_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON economics.finance_product_cost_audit FROM PUBLIC;
GRANT SELECT ON economics.finance_product_cost_audit TO suleia_operations_readonly,suleia_backup;

-- A narrowly scoped internal writer. The Operations connection receives no
-- INSERT/UPDATE permission on the general financial-rate table.
CREATE OR REPLACE FUNCTION economics.save_product_cogs_rate(
  p_id uuid,p_store text,p_product text,p_variant text,p_amount numeric,
  p_from date,p_to date,p_principal text,p_expected timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,economics,pg_temp AS $$
DECLARE
 old_row economics.finance_cost_rates%ROWTYPE;
 new_row economics.finance_cost_rates%ROWTYPE;
BEGIN
  IF p_store IS NULL OR p_product IS NULL OR p_variant IS NULL OR p_store<>'16088' OR p_product!~'^[0-9]{1,18}$' OR p_variant!~'^[0-9]{1,18}$'
    OR p_amount IS NULL OR p_amount<0 OR p_amount>100000 OR p_amount<>round(p_amount,2)
    OR p_from IS NULL OR p_from<DATE '2026-05-01' OR (p_to IS NOT NULL AND p_to<p_from)
    OR p_principal IS NULL OR length(p_principal)<8 OR length(p_principal)>256
    OR NOT EXISTS(SELECT 1 FROM integration.dropea_store_config WHERE store_id=p_store AND enabled)
  THEN RAISE EXCEPTION 'INVALID_PRODUCT_COST_RATE' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('product-cogs:'||p_store||':'||p_product||':'||p_variant,0));
  IF p_id IS NOT NULL THEN
    SELECT * INTO old_row FROM economics.finance_cost_rates WHERE rate_id=p_id AND cost_type='PRODUCT_COGS' AND store_id=p_store FOR UPDATE;
    IF NOT FOUND OR old_row.product_id<>p_product OR old_row.variant_id<>p_variant THEN RAISE EXCEPTION 'PRODUCT_COST_RATE_NOT_FOUND'; END IF;
    IF p_expected IS NULL OR old_row.updated_at<>p_expected THEN RAISE EXCEPTION 'PRODUCT_COST_RATE_CHANGED'; END IF;
  ELSE
    SELECT * INTO old_row FROM economics.finance_cost_rates WHERE cost_type='PRODUCT_COGS' AND store_id=p_store
      AND product_id=p_product AND variant_id=p_variant AND effective_from=p_from FOR UPDATE;
    IF FOUND THEN
      IF old_row.amount=p_amount AND old_row.effective_to IS NOT DISTINCT FROM p_to AND old_row.source='OWNER_VERIFIED_PRODUCT_COST' THEN RETURN to_jsonb(old_row)||jsonb_build_object('version',old_row.updated_at::text); END IF;
      RAISE EXCEPTION 'PRODUCT_COST_RATE_EXISTS_USE_UPDATE';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM economics.finance_cost_rates WHERE cost_type='PRODUCT_COGS' AND store_id=p_store
    AND product_id=p_product AND variant_id=p_variant AND (p_id IS NULL OR rate_id<>p_id)
    AND effective_from<=coalesce(p_to,DATE '9999-12-31') AND coalesce(effective_to,DATE '9999-12-31')>=p_from)
  THEN RAISE EXCEPTION 'PRODUCT_COST_RATE_OVERLAP'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO economics.finance_cost_rates(store_id,cost_type,product_id,variant_id,amount,currency,effective_from,effective_to,source)
    VALUES(p_store,'PRODUCT_COGS',p_product,p_variant,p_amount,'EUR',p_from,p_to,'OWNER_VERIFIED_PRODUCT_COST') RETURNING * INTO new_row;
  ELSE
    UPDATE economics.finance_cost_rates SET amount=p_amount,currency='EUR',effective_from=p_from,effective_to=p_to,
      source='OWNER_VERIFIED_PRODUCT_COST',updated_at=clock_timestamp() WHERE rate_id=p_id RETURNING * INTO new_row;
  END IF;
  INSERT INTO economics.finance_product_cost_audit(rate_id,operation,before_snapshot,after_snapshot,principal_hash)
  VALUES(new_row.rate_id,CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(old_row) END,to_jsonb(new_row),p_principal);
  RETURN to_jsonb(new_row)||jsonb_build_object('version',new_row.updated_at::text);
END $$;
REVOKE ALL ON FUNCTION economics.save_product_cogs_rate(uuid,text,text,text,numeric,date,date,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION economics.save_product_cogs_rate(uuid,text,text,text,numeric,date,date,text,timestamptz) TO suleia_operations_readonly;

-- Live read-model findings appear on the next canonical order ingestion; no
-- separate scheduler or external action is introduced. Unconfirmed/cancelled
-- orders have no recognized product-cost impact.
CREATE OR REPLACE VIEW read_models.finance_product_cogs_missing AS
WITH items AS (
 SELECT o.store_id,o.dropea_order_id,o.created_at_utc,o.updated_at,o.delivered_at_utc,
   p->>'product_id' AS product_id,p->>'variant_id' AS variant_id,p->>'name' AS product_name,
   coalesce(nullif(p->>'quantity','')::numeric,0) AS units,
   (o.created_at_utc AT TIME ZONE 'Europe/Madrid')::date AS business_day
 FROM read_models.operations_finance_order_inputs o
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.product_summary->'products','[]'::jsonb)) p
 WHERE o.returned_at_utc IS NULL AND coalesce(o.lifecycle_status,o.status) NOT IN ('CANCELLED','REJECTED')
   AND (o.confirmed_at_utc IS NOT NULL OR o.delivered_at_utc IS NOT NULL)
   AND coalesce(nullif(p->>'wholesale_price','')::numeric,0)<=0
   AND coalesce((o.order_costs->>'product_price')::numeric,(o.order_costs->'expenses_breakdown'->>'product_price')::numeric,0)<=0
)
SELECT 'PRODUCT_COGS_MISSING'::text AS code,'PRODUCT_COST_MISSING'::text AS category,
 i.store_id,i.product_id,i.variant_id,max(i.product_name) AS product_name,
 sum(i.units) AS units,sum(i.units) FILTER(WHERE i.delivered_at_utc IS NOT NULL) AS delivered_units,
 count(DISTINCT i.dropea_order_id)::integer AS orders,array_agg(DISTINCT i.dropea_order_id) AS order_ids,
 array_agg(DISTINCT i.business_day ORDER BY i.business_day) AS affected_days,
 min(i.created_at_utc) AS first_seen,max(i.created_at_utc) AS last_seen,NULL::numeric AS pending_cost
FROM items i WHERE NOT EXISTS(SELECT 1 FROM economics.finance_cost_rates r
 WHERE r.store_id=i.store_id AND r.cost_type='PRODUCT_COGS' AND r.product_id=i.product_id AND r.variant_id=i.variant_id
 AND r.effective_from<=i.business_day AND (r.effective_to IS NULL OR r.effective_to>=i.business_day))
GROUP BY i.store_id,i.product_id,i.variant_id;
REVOKE ALL ON read_models.finance_product_cogs_missing FROM PUBLIC,suleia_mcp_readonly;
GRANT SELECT ON read_models.finance_product_cogs_missing TO suleia_operations_readonly,suleia_backup;

DO $$
DECLARE first_day date; existing economics.finance_cost_rates%ROWTYPE; rate_count integer;
BEGIN
 SELECT min((o.created_at_utc AT TIME ZONE 'Europe/Madrid')::date) INTO first_day
 FROM read_models.operations_finance_order_inputs o CROSS JOIN LATERAL jsonb_array_elements(o.product_summary->'products') p
 WHERE o.store_id='16088' AND p->>'product_id'='33560' AND p->>'variant_id'='33788';
 IF first_day IS NULL THEN RAISE EXCEPTION 'OWNER_PRODUCT_FIRST_APPEARANCE_NOT_FOUND'; END IF;
 SELECT count(*) INTO rate_count FROM economics.finance_cost_rates WHERE store_id='16088' AND cost_type='PRODUCT_COGS'
   AND product_id='33560' AND variant_id='33788';
 IF rate_count>1 THEN RAISE EXCEPTION 'OWNER_PRODUCT_RATE_AMBIGUOUS'; END IF;
 SELECT * INTO existing FROM economics.finance_cost_rates WHERE store_id='16088' AND cost_type='PRODUCT_COGS' AND product_id='33560' AND variant_id='33788';
 IF existing.rate_id IS NULL OR existing.amount<>0.87 OR existing.effective_from<>first_day OR existing.effective_to IS NOT NULL OR existing.source<>'OWNER_VERIFIED_PRODUCT_COST' THEN
  PERFORM economics.save_product_cogs_rate(existing.rate_id,'16088','33560','33788',0.87,first_day,NULL,'owner-verified-20261024-product-33560',existing.updated_at);
 END IF;
END $$;
COMMIT;
