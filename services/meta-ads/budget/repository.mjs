export class MetaBudgetDecisionRepository {
  constructor(pool, { internalDatabaseWritesEnabled = false } = {}) {
    if (!pool) throw new Error('A database pool is required');
    this.pool = pool; this.internalDatabaseWritesEnabled = internalDatabaseWritesEnabled;
  }

  static async connect(databaseUrl, options = {}) {
    if (!databaseUrl) throw new Error('META_BUDGET_DATABASE_URL is required');
    const { default: pg } = await import('pg');
    return new MetaBudgetDecisionRepository(new pg.Pool({
      connectionString: databaseUrl, max: 2, application_name: 'suleia-meta-budget-shadow',
      statement_timeout: 10_000, query_timeout: 12_000
    }), options);
  }

  async close() { if (this.pool.end) await this.pool.end(); }

  async getSimulationState(campaignId, policyVersion) {
    const result = await this.pool.query(`SELECT campaign_id,policy_version,actual_meta_budget_cents,
      simulated_budget_cents,last_evaluation_hour,updated_at
      FROM economics.meta_budget_simulated_state WHERE campaign_id=$1 AND policy_version=$2`,
    [campaignId, policyVersion]);
    const row = result.rows[0];
    return row ? {
      campaignId: row.campaign_id, policyVersion: row.policy_version,
      actualMetaBudgetCents: row.actual_meta_budget_cents === null ? null : Number(row.actual_meta_budget_cents),
      simulatedBudgetCents: Number(row.simulated_budget_cents),
      lastEvaluationHour: row.last_evaluation_hour, updatedAt: row.updated_at
    } : null;
  }

  async getHourlyDecision(campaignId, evaluationHour, policyVersion) {
    const result = await this.pool.query(`SELECT * FROM read_models.meta_budget_decision_history
      WHERE campaign_id=$1 AND evaluation_hour=$2 AND policy_version=$3 LIMIT 1`,
    [campaignId, evaluationHour, policyVersion]);
    const row = result.rows[0];
    return row ? Object.freeze({
      decisionId: row.decision_id, evaluationHour: row.evaluation_hour,
      campaignId: row.campaign_id, campaignName: row.campaign_name,
      campaignStatus: row.campaign_status, budgetModel: row.budget_model,
      budgetPeriod: row.budget_period,
      actualMetaBudgetCents: row.actual_meta_budget_cents === null ? null : Number(row.actual_meta_budget_cents),
      budgetBeforeCents: row.simulated_budget_before_cents === null ? null : Number(row.simulated_budget_before_cents),
      budgetProposedCents: row.budget_proposed_cents === null ? null : Number(row.budget_proposed_cents),
      budgetDeltaCents: row.budget_delta_cents === null ? null : Number(row.budget_delta_cents),
      purchaseRoas: row.purchase_roas, metricsWindow: row.metrics_window,
      metricsStatus: row.metrics_status, localTime: row.local_time, timezone: row.timezone,
      policyVersion: row.policy_version, decisionType: row.decision_type,
      reasonCode: row.reason_code, reasonText: row.reason_text, mode: row.mode,
      wouldExecute: row.would_execute, executed: false, metaWriteAttempted: false,
      telegramPreviewPayload: row.telegram_preview_payload, actionsExecuted: 0,
      productionWrites: 0, metaBudgetWrites: 0, externalActions: 0
    }) : null;
  }

  async persistDecision(decision) {
    if (!this.internalDatabaseWritesEnabled) throw new Error('META_BUDGET_INTERNAL_DB_WRITES_DISABLED');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ WRITE');
      const inserted = await client.query(`INSERT INTO economics.meta_budget_decisions
        (decision_id,evaluation_hour,campaign_id,campaign_name,campaign_status,timezone,local_time,
         budget_model,budget_period,actual_meta_budget_cents,simulated_budget_before_cents,
         budget_proposed_cents,budget_delta_cents,purchase_roas,metrics_window,metrics_status,
         policy_version,decision_type,reason_code,reason_text,mode,would_execute,executed,
         meta_write_attempted,telegram_preview_payload,external_actions,production_writes,meta_budget_writes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,
         false,false,$23::jsonb,0,0,0)
       ON CONFLICT (campaign_id,evaluation_hour,policy_version) DO NOTHING
       RETURNING decision_id`, [
        decision.decisionId, decision.evaluationHour, decision.campaignId, decision.campaignName,
        decision.campaignStatus, decision.timezone, decision.localTime, decision.budgetModel,
        decision.budgetPeriod, decision.actualMetaBudgetCents, decision.budgetBeforeCents,
        decision.budgetProposedCents, decision.budgetDeltaCents, decision.purchaseRoas,
        JSON.stringify(decision.metricsWindow), decision.metricsStatus, decision.policyVersion,
        decision.decisionType, decision.reasonCode, decision.reasonText, decision.mode,
        decision.wouldExecute, JSON.stringify(decision.telegramPreviewPayload)
      ]);
      const wasInserted = inserted.rows.length === 1;
      if (wasInserted && decision.budgetModel === 'CBO'
        && Number.isSafeInteger(decision.actualMetaBudgetCents)
        && Number.isSafeInteger(decision.budgetProposedCents)) {
        await client.query(`INSERT INTO economics.meta_budget_simulated_state
          (campaign_id,policy_version,actual_meta_budget_cents,simulated_budget_cents,last_evaluation_hour)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (campaign_id,policy_version) DO UPDATE SET
           actual_meta_budget_cents=EXCLUDED.actual_meta_budget_cents,
           simulated_budget_cents=EXCLUDED.simulated_budget_cents,
           last_evaluation_hour=EXCLUDED.last_evaluation_hour,updated_at=now()
         WHERE economics.meta_budget_simulated_state.last_evaluation_hour < EXCLUDED.last_evaluation_hour`,
        [decision.campaignId, decision.policyVersion, decision.actualMetaBudgetCents,
          decision.budgetProposedCents, decision.evaluationHour]);
      }
      const current = wasInserted ? inserted.rows[0] : (await client.query(`SELECT decision_id
        FROM economics.meta_budget_decisions WHERE campaign_id=$1 AND evaluation_hour=$2 AND policy_version=$3`,
      [decision.campaignId, decision.evaluationHour, decision.policyVersion])).rows[0];
      await client.query('COMMIT');
      return Object.freeze({ decisionId: current?.decision_id || decision.decisionId, inserted: wasInserted,
        idempotentReplay: !wasInserted, internalDatabaseWrites: wasInserted ? 1 : 0,
        actionsExecuted: 0, productionWrites: 0, metaBudgetWrites: 0, externalActions: 0 });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }

  async resetSimulationToMetaBudget({ campaignId, policyVersion, actualMetaBudgetCents, reason = 'MANUAL_INTERNAL_RESET' }) {
    if (!this.internalDatabaseWritesEnabled) throw new Error('META_BUDGET_INTERNAL_DB_WRITES_DISABLED');
    if (!Number.isSafeInteger(actualMetaBudgetCents) || actualMetaBudgetCents < 0) throw new Error('INVALID_META_BUDGET_RESET');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ WRITE');
      const state = await client.query(`INSERT INTO economics.meta_budget_simulated_state
        (campaign_id,policy_version,actual_meta_budget_cents,simulated_budget_cents,last_evaluation_hour)
       VALUES ($1,$2,$3,$3,date_trunc('hour',now()))
       ON CONFLICT (campaign_id,policy_version) DO UPDATE SET actual_meta_budget_cents=EXCLUDED.actual_meta_budget_cents,
         simulated_budget_cents=EXCLUDED.simulated_budget_cents,last_evaluation_hour=EXCLUDED.last_evaluation_hour,updated_at=now()
       RETURNING campaign_id,actual_meta_budget_cents,simulated_budget_cents,last_evaluation_hour`,
      [campaignId, policyVersion, actualMetaBudgetCents]);
      await client.query(`INSERT INTO economics.meta_budget_simulation_resets
        (campaign_id,policy_version,actual_meta_budget_cents,reason,external_actions,production_writes,meta_budget_writes)
       VALUES ($1,$2,$3,$4,0,0,0)`, [campaignId, policyVersion, actualMetaBudgetCents, reason]);
      await client.query('COMMIT');
      return { ...state.rows[0], actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }

  async listLatest(limit = 100) {
    const bounded = Number.isInteger(limit) ? Math.min(250, Math.max(1, limit)) : 100;
    const result = await this.pool.query(`SELECT * FROM read_models.meta_budget_simulation_latest
      ORDER BY last_evaluation DESC,campaign_id LIMIT $1`, [bounded]);
    return result.rows;
  }

  async history({ campaignId = null, limit = 250 } = {}) {
    const bounded = Number.isInteger(limit) ? Math.min(1000, Math.max(1, limit)) : 250;
    const result = await this.pool.query(`SELECT * FROM read_models.meta_budget_decision_history
      WHERE ($1::text IS NULL OR campaign_id=$1) ORDER BY evaluation_hour DESC,campaign_id LIMIT $2`,
    [campaignId, bounded]);
    return result.rows;
  }
}
