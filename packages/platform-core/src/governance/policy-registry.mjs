import { compareVersions, deepFreeze, validatePolicy } from './contracts.mjs';

function isActiveAt(policy, now) {
  const timestamp = new Date(now).getTime();
  return policy.enabled !== false
    && !['DRAFT', 'DEPRECATED', 'ROLLED_BACK'].includes(policy.status)
    && Date.parse(policy.effective_from) <= timestamp
    && (!policy.effective_until || Date.parse(policy.effective_until) > timestamp);
}

export class PolicyRegistry {
  #versions = new Map();
  #active = new Map();
  #events = [];

  register(input, { now = new Date(), source = 'phase-b-local' } = {}) {
    let policy;
    try {
      policy = deepFreeze(validatePolicy(input));
    } catch (error) {
      this.#events.push(deepFreeze({
        event_type: 'PolicyRejected',
        policy_id: typeof input?.policy_id === 'string' ? input.policy_id : 'UNKNOWN',
        version: typeof input?.version === 'string' ? input.version : 'UNKNOWN',
        reason_code: 'SCHEMA_INVALID',
        error: error instanceof Error ? error.message : String(error),
        source,
        occurred_at: new Date(now).toISOString()
      }));
      return { loaded: false, error, retained_version: this.#active.get(input?.policy_id)?.version ?? null };
    }

    const versions = this.#versions.get(policy.policy_id) ?? new Map();
    const current = this.#active.get(policy.policy_id);
    if (current && compareVersions(policy.version, current.version) <= 0) {
      const error = new Error('Policy version must be newer than the active version');
      this.#events.push(deepFreeze({
        event_type: 'PolicyRejected',
        policy_id: policy.policy_id,
        version: policy.version,
        reason_code: 'VERSION_NOT_NEWER',
        source,
        occurred_at: new Date(now).toISOString()
      }));
      return { loaded: false, error, retained_version: current.version };
    }

    versions.set(policy.version, policy);
    this.#versions.set(policy.policy_id, versions);
    this.#active.set(policy.policy_id, policy);
    this.#events.push(deepFreeze({
      event_type: 'PolicyLoaded',
      policy_id: policy.policy_id,
      version: policy.version,
      status: policy.status,
      source,
      occurred_at: new Date(now).toISOString()
    }));
    return { loaded: true, policy };
  }

  loadAll(policies, options) {
    return policies.map((policy) => this.register(policy, options));
  }

  get(policyId, version = null) {
    const policy = version ? this.#versions.get(policyId)?.get(version) : this.#active.get(policyId);
    return policy ? structuredClone(policy) : null;
  }

  list({ now = new Date(), activeOnly = false } = {}) {
    const policies = [...this.#active.values()]
      .filter((policy) => !activeOnly || isActiveAt(policy, now))
      .map((policy) => structuredClone(policy));
    return policies.toSorted((left, right) => left.policy_id.localeCompare(right.policy_id));
  }

  rollback(policyId, { now = new Date(), reason = 'explicit rollback' } = {}) {
    const current = this.#active.get(policyId);
    if (!current) throw new Error(`Unknown policy: ${policyId}`);
    if (!current.rollback_version) throw new Error('Policy has no rollback target');
    if (current.rollback_version === 'DISABLE_POLICY') {
      this.#active.delete(policyId);
      this.#events.push(deepFreeze({
        event_type: 'PolicyLoaded',
        policy_id: policyId,
        version: current.version,
        status: 'ROLLED_BACK',
        reason,
        occurred_at: new Date(now).toISOString()
      }));
      return { rolled_back: true, active_policy: null };
    }
    const target = this.#versions.get(policyId)?.get(current.rollback_version);
    if (!target) throw new Error('Rollback target is not present in the registry');
    this.#active.set(policyId, target);
    this.#events.push(deepFreeze({
      event_type: 'PolicyLoaded',
      policy_id: policyId,
      version: target.version,
      status: 'ROLLED_BACK',
      reason,
      occurred_at: new Date(now).toISOString()
    }));
    return { rolled_back: true, active_policy: structuredClone(target) };
  }

  events() {
    return this.#events.map((event) => structuredClone(event));
  }
}

export { isActiveAt };
