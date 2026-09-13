const LIVE_WRITER_COMPILED = false;

export class MetaBudgetWriteBlockedError extends Error {
  constructor(message = 'BLOCKED_BY_SIMULATION_MODE') {
    super(message); this.name = 'MetaBudgetWriteBlockedError'; this.code = 'BLOCKED_BY_SIMULATION_MODE';
    this.actions_executed = 0; this.production_writes = 0; this.meta_budget_writes = 0; this.external_actions = 0;
  }
}

export function assertMetaWriteAllowed(context = {}) {
  const conditions = [
    LIVE_WRITER_COMPILED,
    context.mode === 'LIVE',
    context.writesEnabled === true,
    context.liveExecutionEnabled === true,
    context.externalActionsEnabled === true,
    context.validAuthorization === true,
    context.validPolicyDecision === true,
    context.metricsStatus === 'FRESH',
    context.validBudget === true,
    context.validCampaign === true,
    context.validApproval === true
  ];
  if (!conditions.every(Boolean)) throw new MetaBudgetWriteBlockedError();
  throw new MetaBudgetWriteBlockedError();
}

export const META_LIVE_WRITER_COMPILED = LIVE_WRITER_COMPILED;

