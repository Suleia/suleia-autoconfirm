import crypto from 'node:crypto';
import { containsDirectPii, maskRecord } from './masking.mjs';

const SOURCES = new Set(['SHOPIFY', 'DROPEA', 'CHATBY', 'GLS', 'FIXTURE']);

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function required(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${field}`);
  }
  return value;
}

export class LocalIngestionPipeline {
  constructor(eventStore) {
    this.eventStore = eventStore;
  }

  ingest(record) {
    const source = String(required(record.source, 'source')).toUpperCase();
    if (!SOURCES.has(source)) throw new Error(`Unsupported ingestion source: ${source}`);

    const sourceRecordId = required(record.source_record_id, 'source_record_id');
    const orderId = required(record.order_id, 'order_id');
    const eventType = required(record.event_type, 'event_type');
    const maskedPayload = maskRecord(record.payload || {});
    if (containsDirectPii(maskedPayload)) {
      throw new Error('PII masking gate rejected the ingestion record');
    }

    const sourceRecordHash = hash(sourceRecordId);
    const result = this.eventStore.append({
      order_id: orderId,
      event_type: eventType,
      occurred_at: record.occurred_at,
      source,
      source_record_id: sourceRecordHash,
      deduplication_key: `${source}:${sourceRecordHash}`,
      payload: maskedPayload,
      masking_version: 'v1',
      freshness_status: record.freshness_status || 'FRESH',
      trust_level: record.trust_level || 'MEDIUM'
    });

    return {
      accepted: true,
      inserted: result.inserted,
      source,
      source_record_id_hash: sourceRecordHash,
      event: result.event,
      actions_executed: 0,
      run_mode: 'SIMULATION'
    };
  }
}
