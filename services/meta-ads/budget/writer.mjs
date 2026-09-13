import { assertMetaWriteAllowed } from './write-gate.mjs';

function featureNotEnabled(feature) {
  return Object.freeze({ ok: false, feature, code: 'FEATURE_NOT_ENABLED', actions_executed: 0,
    production_writes: 0, meta_budget_writes: 0, external_actions: 0 });
}

export class MetaBudgetWriter {
  constructor({ audit = () => {} } = {}) { this.audit = audit; }

  previewChange(decision) {
    return Object.freeze({ ok: true, execution: 'WOULD_CHANGE', decision_id: decision?.decisionId || null,
      budget_before_cents: decision?.budgetBeforeCents ?? null,
      proposed_budget_cents: decision?.budgetProposedCents ?? null,
      reason: decision?.reasonCode || null, executed: false, actions_executed: 0,
      production_writes: 0, meta_budget_writes: 0, external_actions: 0 });
  }

  executeChange(_decision, context = {}) {
    try { assertMetaWriteAllowed(context); }
    catch (error) {
      this.audit({ event: 'META_WRITE_BLOCKED', code: 'BLOCKED_BY_SIMULATION_MODE',
        mode: context.mode || 'SIMULATION', actions_executed: 0, production_writes: 0,
        meta_budget_writes: 0, external_actions: 0 });
      throw error;
    }
  }

  createApproval() { return featureNotEnabled('create_approval'); }
  executeApprovedChange() { return featureNotEnabled('execute_approved_change'); }
}

export function createMetaBudgetFutureInterfaces() {
  return Object.freeze({
    preview_budget_change: (decision) => new MetaBudgetWriter().previewChange(decision),
    create_approval: () => featureNotEnabled('create_approval'),
    execute_approved_change: () => featureNotEnabled('execute_approved_change')
  });
}
