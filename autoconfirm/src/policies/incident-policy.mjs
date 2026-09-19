import { readFileSync } from 'node:fs';

const POLICY_URL = new URL('../../data/incident-policy.json', import.meta.url);

function positiveNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid incident policy field: ${field}`);
  return parsed;
}

function loadPolicy() {
  const policy = JSON.parse(readFileSync(POLICY_URL, 'utf8'));
  if (policy.policy_name !== 'INCIDENT_AUTOPILOT_POLICY') throw new Error('Invalid incident policy name');
  if (!policy.policy_version) throw new Error('Incident policy version is required');
  if (policy.carrier !== 'GLS') throw new Error('Only the governed GLS incident policy is supported');
  positiveNumber(policy.discount_offer_delay_hours, 'discount_offer_delay_hours');
  positiveNumber(policy.discount_response_timeout_hours, 'discount_response_timeout_hours');
  positiveNumber(policy.initial_incident_response_timeout_hours, 'initial_incident_response_timeout_hours');
  return Object.freeze(policy);
}

export const INCIDENT_POLICY = loadPolicy();
export const INCIDENT_POLICY_NAME = INCIDENT_POLICY.policy_name;
export const INCIDENT_POLICY_VERSION = INCIDENT_POLICY.policy_version;
export const INCIDENT_DISCOUNT_DELAY_HOURS = INCIDENT_POLICY.discount_offer_delay_hours;
export const INCIDENT_DISCOUNT_RESPONSE_HOURS = INCIDENT_POLICY.discount_response_timeout_hours;
export const INCIDENT_INITIAL_RESPONSE_HOURS = INCIDENT_POLICY.initial_incident_response_timeout_hours;
export const INCIDENT_ABSENT_RESPONSE_HOURS = INCIDENT_POLICY.absent_response_timeout_hours;
export const INCIDENT_DISCOUNT_MAX_EUR = INCIDENT_POLICY.discount_amount_eur;
