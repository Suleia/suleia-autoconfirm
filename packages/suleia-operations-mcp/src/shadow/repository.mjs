import pg from 'pg';
import { containsDirectPii } from './masking.mjs';

const { Pool } = pg;

export class ShadowRepository {
  constructor(databaseUrl, { pool = null } = {}) {
    this.pool = pool || new Pool({ connectionString: databaseUrl, max: 3, application_name: 'suleia-shadow-readonly' });
  }

  async close() { await this.pool.end(); }

  async checkpoint(sourceObject) {
    const result = await this.pool.query("SELECT last_seen_at FROM migration.checkpoints WHERE source=$1 AND source_object=$2 AND status='COMPLETED'", ['supabase', sourceObject]);
    const value = result.rows[0]?.last_seen_at;
    return value ? new Date(new Date(value).getTime() - 1000).toISOString() : null;
  }

  async inventory(sourceObject, classification, recordCount) {
    await this.pool.query(`INSERT INTO migration.source_inventory(source,source_object,classification,record_count,inventoried_at)
      VALUES('supabase',$1,$2,$3,now()) ON CONFLICT(source,source_object) DO UPDATE SET classification=EXCLUDED.classification,record_count=EXCLUDED.record_count,inventoried_at=now()`, [sourceObject, classification, recordCount]);
  }

  async startBatch(sourceObject, rangeStart) {
    const result = await this.pool.query(`INSERT INTO migration.batches(source,source_object,range_start,status,masking_status,reconciliation_status)
      VALUES('supabase',$1,$2,'RUNNING','ENFORCED','PENDING') RETURNING batch_id`, [sourceObject, rangeStart]);
    return result.rows[0].batch_id;
  }

  async store(batchId, item) {
    if (containsDirectPii(item.payloadMasked)) throw new Error('Direct PII or credentials remained after masking');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO raw_private.source_records
        (batch_id,source,source_object,source_record_hash,canonical_order_hash,payload_masked,payload_checksum,source_updated_at)
        VALUES($1,'supabase',$2,$3,$4,$5,$6,$7)
        ON CONFLICT(source,source_object,source_record_hash,payload_checksum) DO NOTHING RETURNING id`,
      [batchId, item.sourceObject, item.sourceRecordHash, item.canonicalOrderHash, item.payloadMasked, item.payloadChecksum, item.sourceUpdatedAt]);
      if (!inserted.rowCount) { await client.query('COMMIT'); return false; }
      const now = item.sourceUpdatedAt || new Date().toISOString();
      const truthId = `truth:${item.sourceObject}:${item.sourceRecordHash}:${item.payloadChecksum}`;
      const entityId = `entity:${item.sourceObject}:${item.sourceRecordHash}`;
      await client.query(`INSERT INTO truth.snapshots(truth_snapshot_id,canonical_order_hash,snapshot,quality_score,identity_status,shadow_eligible,blocking_reasons,generated_at,schema_version)
        VALUES($1,COALESCE($2,$3),$4,$5,$6,$7,$8,$9,'shadow-v1') ON CONFLICT(truth_snapshot_id) DO NOTHING`,
      [truthId, item.canonicalOrderHash, item.sourceRecordHash, item.payloadMasked, item.canonicalOrderHash ? 90 : 60,
        item.canonicalOrderHash ? 'EXACT_TECHNICAL_ID' : 'UNLINKED', Boolean(item.canonicalOrderHash), item.canonicalOrderHash ? [] : ['NO_EXACT_ORDER_ID'], now]);
      await client.query(`INSERT INTO enterprise_graph.entities(entity_id,entity_type,source,attributes_masked,confidence,valid_from,evidence_hashes)
        VALUES($1,$2,'supabase',$3,$4,$5,$6) ON CONFLICT(entity_id) DO UPDATE SET attributes_masked=EXCLUDED.attributes_masked,valid_from=EXCLUDED.valid_from,evidence_hashes=EXCLUDED.evidence_hashes`,
      [entityId, item.sourceObject.toUpperCase(), item.payloadMasked, item.canonicalOrderHash ? 0.95 : 0.60, now, [item.payloadChecksum]]);
      await client.query(`INSERT INTO enterprise_twins.snapshots(twin_id,twin_type,entity_hash,snapshot_masked,completeness,freshness_status,generated_at)
        VALUES($1,$2,$3,$4,$5,'CURRENT',$6) ON CONFLICT(twin_id) DO UPDATE SET snapshot_masked=EXCLUDED.snapshot_masked,generated_at=EXCLUDED.generated_at`,
      [`twin:${item.sourceObject}:${item.sourceRecordHash}`, item.sourceObject.toUpperCase(), item.sourceRecordHash, item.payloadMasked, item.canonicalOrderHash ? 0.90 : 0.60, now]);
      await client.query(`INSERT INTO knowledge.facts(fact_id,fact_type,entity_hash,value_masked,verification_status,source,confidence,observed_at)
        VALUES($1,$2,$3,$4,'SOURCE_OBSERVED','supabase',$5,$6) ON CONFLICT(fact_id) DO UPDATE SET value_masked=EXCLUDED.value_masked,observed_at=EXCLUDED.observed_at`,
      [`fact:${item.sourceObject}:${item.sourceRecordHash}`, `${item.sourceObject.toUpperCase()}_OBSERVED`, item.canonicalOrderHash || item.sourceRecordHash, item.payloadMasked, item.canonicalOrderHash ? 0.95 : 0.60, now]);
      const state = item.payloadMasked.status || item.payloadMasked.state || item.payloadMasked.canonical_status;
      if (state) await client.query(`INSERT INTO process_intelligence.observations(observation_id,process_type,entity_hash,state,source,observed_at)
        VALUES($1,$2,$3,$4,'supabase',$5) ON CONFLICT(observation_id) DO UPDATE SET state=EXCLUDED.state,observed_at=EXCLUDED.observed_at`,
      [`process:${item.sourceObject}:${item.sourceRecordHash}`, item.sourceObject.toUpperCase(), item.canonicalOrderHash || item.sourceRecordHash, String(state), now]);
      const amountEntry = Object.entries(item.payloadMasked).find(([field, value]) => /(?:total|amount|price)/i.test(field) && typeof value === 'number');
      if (amountEntry) await client.query(`INSERT INTO economics.observations(observation_id,canonical_order_hash,metric,value,currency,value_status,source,observed_at)
        VALUES($1,$2,$3,$4,$5,'OBSERVED','supabase',$6) ON CONFLICT(observation_id) DO UPDATE SET value=EXCLUDED.value,observed_at=EXCLUDED.observed_at`,
      [`economic:${item.sourceObject}:${item.sourceRecordHash}:${amountEntry[0]}`, item.canonicalOrderHash, amountEntry[0], amountEntry[1], item.payloadMasked.currency || null, now]);
      if (/agent_(?:feedback|memory_events)/.test(item.sourceObject)) await client.query(`INSERT INTO decision_memory.records
        (memory_id,canonical_order_hash,facts_masked,proposed_decision,final_outcome,evidence_hashes,recorded_at)
        VALUES($1,$2,$3,'UNKNOWN','UNKNOWN',$4,$5) ON CONFLICT(memory_id) DO UPDATE SET facts_masked=EXCLUDED.facts_masked,recorded_at=EXCLUDED.recorded_at`,
      [`memory:${item.sourceObject}:${item.sourceRecordHash}`, item.canonicalOrderHash, item.payloadMasked, [item.payloadChecksum], now]);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async finishBatch(batchId, report) {
    await this.pool.query(`UPDATE migration.batches SET range_end=$2,source_records=$3,imported_records=$4,transformed_records=$4,
      rejected_records=$5,duplicate_records=$6,errors=$7,checksum=$8,masking_status='VERIFIED',reconciliation_status='RECORDED',status=$9,completed_at=now()
      WHERE batch_id=$1`, [batchId, report.rangeEnd, report.seen, report.imported, report.rejected, report.duplicates, report.errors, report.checksum, report.status]);
    await this.pool.query(`INSERT INTO migration.checkpoints(source,source_object,last_seen_at,last_success_at,last_failure_at,lag_seconds,status,updated_at)
      VALUES('supabase',$1,$2,CASE WHEN $3='COMPLETED' THEN now() END,CASE WHEN $3='COMPLETED' THEN NULL ELSE now() END,
      CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM now()-$2::timestamptz)::bigint END,$3,now())
      ON CONFLICT(source,source_object) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,last_success_at=COALESCE(EXCLUDED.last_success_at,migration.checkpoints.last_success_at),
      last_failure_at=COALESCE(EXCLUDED.last_failure_at,migration.checkpoints.last_failure_at),lag_seconds=EXCLUDED.lag_seconds,status=EXCLUDED.status,updated_at=now()`,
    [report.sourceObject, report.rangeEnd, report.status]);
    if (report.sourceObject === 'meta_campaign_insights' && report.status === 'COMPLETED') {
      await this.projectMetaFinance();
    }
  }

  async projectMetaFinance() {
    await this.pool.query(`WITH enabled_store AS (
        SELECT min(store_id) AS store_id FROM integration.dropea_store_config
        WHERE enabled=true HAVING count(*)=1
      ), current_meta AS (
        SELECT e.entity_id,e.attributes_masked,
          (e.attributes_masked->>'date_start')::date AS business_date,
          (e.attributes_masked->>'spend')::numeric(14,2) AS spend,
          e.valid_from AS source_observed_at
        FROM enterprise_graph.entities e
        WHERE e.entity_type='META_CAMPAIGN_INSIGHTS'
          AND e.attributes_masked->>'date_start'=e.attributes_masked->>'date_stop'
          AND e.attributes_masked->>'date_start' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND e.attributes_masked->>'spend' ~ '^\\d+(?:\\.\\d+)?$'
      )
      INSERT INTO economics.finance_ad_spend_daily
        (store_id,business_date,platform,spend,currency,source,source_record_key,
         campaign_breakdown,sync_status,source_observed_at,ingested_at)
      SELECT s.store_id,m.business_date,'META',m.spend,'EUR','SUPABASE_META_CAMPAIGN_INSIGHTS',
        m.entity_id,'[]'::jsonb,'COMPLETE',m.source_observed_at,now()
      FROM current_meta m CROSS JOIN enabled_store s
      ON CONFLICT(store_id,business_date,platform,source_record_key) DO UPDATE SET
        spend=EXCLUDED.spend,currency=EXCLUDED.currency,sync_status='COMPLETE',
        source_observed_at=EXCLUDED.source_observed_at,ingested_at=now()`);
    await this.pool.query(`WITH enabled_store AS (
        SELECT min(store_id) AS store_id FROM integration.dropea_store_config
        WHERE enabled=true HAVING count(*)=1
      ), coverage AS (
        SELECT business_date,count(*)::integer AS records_read,max(source_observed_at) AS observed_at
        FROM economics.finance_ad_spend_daily
        WHERE source='SUPABASE_META_CAMPAIGN_INSIGHTS'
        GROUP BY business_date
      )
      INSERT INTO economics.finance_sync_checkpoints
        (store_id,source,business_date,sync_status,records_read,last_success_at,failure_code,updated_at)
      SELECT s.store_id,'SUPABASE_META_CAMPAIGN_INSIGHTS',c.business_date,'COMPLETE',
        c.records_read,coalesce(c.observed_at,now()),NULL,now()
      FROM coverage c CROSS JOIN enabled_store s
      ON CONFLICT(store_id,source,business_date) DO UPDATE SET
        sync_status='COMPLETE',records_read=EXCLUDED.records_read,
        last_success_at=EXCLUDED.last_success_at,last_failure_at=NULL,failure_code=NULL,updated_at=now()`);
  }
}
