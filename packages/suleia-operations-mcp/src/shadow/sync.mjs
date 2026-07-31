import { createHash } from 'node:crypto';
import { canonicalOrderHash, maskRecord, payloadChecksum, sourceRecordHash } from './masking.mjs';
import { SHADOW_TABLES } from './source.mjs';

export async function syncShadow({ source, repository, hashKey, pageSize = 250, tables = SHADOW_TABLES, audit = () => {} }) {
  const reports = [];
  for (const [sourceObject, timestampField, classification] of tables) {
    const after = await repository.checkpoint(sourceObject);
    const first = await source.page(sourceObject, timestampField, { after, offset: 0, limit: pageSize });
    await repository.inventory(sourceObject, classification, first.total);
    if (classification === 'MANUAL_REVIEW' || first.missing) {
      reports.push({ sourceObject, status: classification === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'MISSING', seen: 0, imported: 0, actions_executed: 0, production_writes: 0 });
      continue;
    }
    const batchId = await repository.startBatch(sourceObject, after);
    let offset = 0, page = first, seen = 0, imported = 0, duplicates = 0, rejected = 0, errors = 0, rangeEnd = after;
    const digest = createHash('sha256');
    try {
      while (page.rows.length) {
        for (const row of page.rows) {
          seen += 1;
          try {
            const payloadMasked = maskRecord(row, hashKey);
            const item = { sourceObject, payloadMasked, sourceRecordHash: sourceRecordHash(row, hashKey),
              canonicalOrderHash: canonicalOrderHash(row, hashKey), payloadChecksum: payloadChecksum(payloadMasked),
              sourceUpdatedAt: row[timestampField] || null };
            digest.update(item.payloadChecksum);
            if (await repository.store(batchId, item)) imported += 1; else duplicates += 1;
            if (item.sourceUpdatedAt && (!rangeEnd || item.sourceUpdatedAt > rangeEnd)) rangeEnd = item.sourceUpdatedAt;
          } catch (error) {
            rejected += 1; errors += 1;
            audit({ event: 'record_rejected', source_object: sourceObject, reason: error.message });
            throw error;
          }
        }
        offset += page.rows.length;
        if (page.rows.length < pageSize) break;
        page = await source.page(sourceObject, timestampField, { after, offset, limit: pageSize });
      }
      const status = 'COMPLETED';
      const report = { sourceObject, rangeEnd, seen, imported, duplicates, rejected, errors, checksum: digest.digest('hex'), status,
        actions_executed: 0, production_writes: 0 };
      await repository.finishBatch(batchId, report); reports.push(report); audit({ event: 'batch_completed', ...report });
    } catch (error) {
      const report = { sourceObject, rangeEnd, seen, imported, duplicates, rejected, errors: errors + 1, checksum: digest.digest('hex'), status: 'FAILED', actions_executed: 0, production_writes: 0 };
      await repository.finishBatch(batchId, report); audit({ event: 'batch_failed', source_object: sourceObject, reason: error.message }); throw error;
    }
  }
  return { ok: reports.every((item) => !['FAILED'].includes(item.status)), reports, actions_executed: 0, production_writes: 0 };
}
