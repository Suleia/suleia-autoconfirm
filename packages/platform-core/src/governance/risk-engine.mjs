import { RISK_LEVELS } from './contracts.mjs';

export const RISK_FACTOR_LEVELS = Object.freeze({
  INSUFFICIENT_EVIDENCE: 'MEDIUM',
  CONTRADICTORY_SOURCES: 'HIGH',
  STALE_SOURCE: 'HIGH',
  UNCORRELATED_IDENTITY: 'HIGH',
  INCOMPLETE_ADDRESS: 'MEDIUM',
  AMBIGUOUS_POLICY: 'HIGH',
  IRREVERSIBLE_ACTION: 'HIGH',
  DUPLICATE: 'HIGH',
  MULTIPLE_ORDER_CANDIDATES: 'HIGH',
  INVALID_SCHEMA: 'CRITICAL',
  CONNECTOR_ERROR: 'HIGH',
  PII_EXPOSED: 'CRITICAL',
  LOGISTICS_STATE_INCOMPATIBLE: 'HIGH',
  INCONSISTENT_TIMER: 'HIGH',
  MISSING_SHARED_TECHNICAL_ID: 'HIGH',
  SECRET_EXPOSED: 'CRITICAL',
  POLICY_TAMPERING: 'CRITICAL',
  PROMPT_INJECTION: 'HIGH'
});

function rank(level) {
  const value = RISK_LEVELS.indexOf(level);
  if (value < 0) throw new Error(`Unsupported risk level: ${level}`);
  return value;
}

export function evaluateRisk(factors = [], { previousLevel = 'LOW' } = {}) {
  const normalized = [...new Set(factors.map((factor) => String(factor).toUpperCase()))];
  const unknown = normalized.filter((factor) => !(factor in RISK_FACTOR_LEVELS));
  if (unknown.length) throw new Error(`Unknown risk factors: ${unknown.join(', ')}`);
  const calculated = normalized.reduce((highest, factor) => {
    const level = RISK_FACTOR_LEVELS[factor];
    return rank(level) > rank(highest) ? level : highest;
  }, 'LOW');
  const riskLevel = rank(previousLevel) > rank(calculated) ? previousLevel : calculated;
  return Object.freeze({
    risk_level: riskLevel,
    risk_factors: Object.freeze(normalized),
    previous_level: previousLevel,
    automatically_reduced: false,
    required_control: riskLevel === 'LOW'
      ? 'SIMULATION_ONLY'
      : riskLevel === 'MEDIUM'
        ? 'QA_GATE'
        : riskLevel === 'HIGH'
          ? 'HUMAN_REVIEW'
          : 'TOTAL_BLOCK'
  });
}
