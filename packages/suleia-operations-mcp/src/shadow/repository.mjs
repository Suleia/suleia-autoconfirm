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
  }
}
