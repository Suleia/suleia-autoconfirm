import { readFileSync } from 'node:fs';

const POLICY_URL = new URL('../../../../autoconfirm/data/incident-policy.json', import.meta.url);

export const INCIDENT_AUTOPILOT_POLICY = Object.freeze(JSON.parse(readFileSync(POLICY_URL, 'utf8')));
export const INCIDENT_AUTOPILOT_POLICY_NAME = INCIDENT_AUTOPILOT_POLICY.policy_name;
export const INCIDENT_AUTOPILOT_POLICY_VERSION = INCIDENT_AUTOPILOT_POLICY.policy_version;

export function incidentActionMode(actionType) {
  return INCIDENT_AUTOPILOT_POLICY.action_modes?.[actionType] || 'PAUSED';
}

export function incidentPolicyHours(name) {
  const value = Number(INCIDENT_AUTOPILOT_POLICY[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Unknown incident policy duration: ${name}`);
  return value;
}
