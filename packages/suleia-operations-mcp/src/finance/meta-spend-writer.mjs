export class MetaSpendWriter {
  constructor(pool) { this.pool = pool; }

  static async connect(databaseUrl) {
    const { default: pg } = await import('pg');
    return new MetaSpendWriter(new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'suleia-finance-daily-sync', statement_timeout: 10_000 }));
  }

  async close() { await this.pool.end(); }

  async persistDay({ storeId, sourceRecordKey, result, observedAt = new Date() }) {
    if (!result?.ok || result.execution_mode !== 'SIMULATION' || result.meta_budget_writes !== 0 || result.telegram_messages !== 0) {
      throw new Error('FINANCE_META_RESULT_UNSAFE');
    }
    const campaignCount = Number(result.campaign_count ?? result.active_campaign_count);
    if (!Number.isSafeInteger(campaignCount) || campaignCount < 0 || campaignCount !== result.campaigns.length) {
      throw new Error('FINANCE_META_CAMPAIGN_COUNT_INVALID');
    }
    const spend = result.campaigns.reduce((sum, row) => sum + Number(row.spend || 0), 0);
    const breakdown = result.campaigns.map((row) => ({
      campaign_id: row.campaign_id, spend: row.spend, purchases: row.purchases,
      purchase_value: row.purchase_value, purchase_roas: row.purchase_roas
    }));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO economics.finance_ad_spend_daily
        (store_id,business_date,platform,spend,currency,source,source_record_key,campaign_breakdown,sync_status,source_observed_at,ingested_at)
        VALUES ($1,$2::date,'META',$3,$4,'META_MARKETING_API',$5,$6::jsonb,'COMPLETE',$7,now())
        ON CONFLICT (store_id,business_date,platform,source_record_key) DO UPDATE SET
          spend=EXCLUDED.spend,currency=EXCLUDED.currency,campaign_breakdown=EXCLUDED.campaign_breakdown,
          sync_status='COMPLETE',source_observed_at=EXCLUDED.source_observed_at,ingested_at=now()`,
      [storeId, result.business_date, spend, result.account.currency, sourceRecordKey, JSON.stringify(breakdown), observedAt]);
      await client.query(`INSERT INTO economics.finance_sync_checkpoints
        (store_id,source,business_date,sync_status,records_read,last_success_at,last_failure_at,failure_code,updated_at)
        VALUES ($1,'META_MARKETING_API',$2::date,'COMPLETE',$3,$4,NULL,NULL,now())
        ON CONFLICT (store_id,source,business_date) DO UPDATE SET sync_status='COMPLETE',records_read=EXCLUDED.records_read,
          last_success_at=EXCLUDED.last_success_at,last_failure_at=NULL,failure_code=NULL,updated_at=now()`,
      [storeId, result.business_date, campaignCount, observedAt]);
      await client.query('COMMIT');
      return { business_date: result.business_date, campaigns: campaignCount, spend, internal_writes: 2, external_writes: 0 };
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }

  async persistFailure({ storeId, businessDate, failureCode, observedAt = new Date() }) {
    const safeCode = /^[A-Z0-9_:-]{1,80}$/.test(String(failureCode || ''))
      ? String(failureCode)
      : 'FINANCE_SYNC_FAILED';
    await this.pool.query(`INSERT INTO economics.finance_sync_checkpoints
      (store_id,source,business_date,sync_status,records_read,last_success_at,last_failure_at,failure_code,updated_at)
      VALUES ($1,'META_MARKETING_API',$2::date,'FAILED',0,NULL,$3,$4,now())
      ON CONFLICT (store_id,source,business_date) DO UPDATE SET sync_status='FAILED',records_read=0,
        last_failure_at=EXCLUDED.last_failure_at,failure_code=EXCLUDED.failure_code,updated_at=now()`,
    [storeId, businessDate, observedAt, safeCode]);
    return { business_date: businessDate, internal_writes: 1, external_writes: 0, failure_code: safeCode };
  }
}
