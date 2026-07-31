import crypto from 'node:crypto';
import { GOVERNANCE_SCHEMA_VERSION, deepFreeze, validatePolicy } from './contracts.mjs';

const BASE = Object.freeze({
  version: '1.0.0',
  status: 'SIMULATION',
  priority: 500,
  required_evidence: ['current_order_correlation', 'source_freshness'],
  forbidden_conditions: ['explicit_current_cancellation', 'unmasked_pii', 'production_write_requested'],
  fallback: 'HUMAN_REVIEW',
  human_review_conditions: ['ambiguous_policy', 'contradictory_sources', 'insufficient_evidence'],
  owner: 'policy-engine-department',
  effective_from: '2026-07-31T00:00:00.000Z',
  effective_until: null,
  rollback_version: 'DISABLE_POLICY',
  change_reason: 'Centralized without changing current behavior in Phase B',
  schema_version: GOVERNANCE_SCHEMA_VERSION,
  enabled: true,
  specificity: 100
});

function policy(overrides) {
  return deepFreeze(validatePolicy({ ...BASE, ...overrides }));
}

export const TEMPORAL_POLICIES = deepFreeze([
  policy({
    policy_id: 'confirmation.current-order.wait',
    name: 'Current-order confirmation wait',
    scope: ['ORDER_CONFIRMATION'],
    trigger: { fact_code: 'CURRENT_ORDER_CONFIRMED' },
    timer_definition: { workflow: 'CONFIRMATION_WAIT_1H', duration_hours: 1 },
    proposed_action: 'PROPOSE_CONFIRM'
  }),
  policy({
    policy_id: 'commercial.recovery.candidate',
    name: 'Commercial recovery candidate timer',
    status: 'DRAFT',
    scope: ['COMMERCIAL_RECOVERY'],
    trigger: { fact_code: 'COMMERCIAL_RECOVERY_CANDIDATE' },
    timer_definition: { workflow: 'COMMERCIAL_RECOVERY_24H', duration_hours: 24 },
    proposed_action: 'PROPOSE_COMMERCIAL_RECOVERY',
    enabled: false,
    priority: 100,
    change_reason: 'Recorded as a disabled candidate; no commercial automation is authorized'
  }),
  ...['AUSENTE', 'FALTAN_DATOS', 'NO_RESPUESTA'].map((incident) => policy({
    policy_id: `incident.${incident.toLowerCase()}.response`,
    name: `${incident} incident response window`,
    scope: [`INCIDENT_${incident}`],
    trigger: { fact_code: 'CURRENT_INCIDENT_OPEN', incident_type: incident },
    timer_definition: { workflow: `INCIDENT_${incident}_48H`, duration_hours: 48 },
    proposed_action: 'PROPOSE_INCIDENT_POLICY_REVIEW'
  })),
  policy({
    policy_id: 'unknown.human-review',
    name: 'UNKNOWN human review deadline',
    scope: ['UNKNOWN'],
    trigger: { fact_code: 'UNKNOWN_CASE' },
    timer_definition: { workflow: 'UNKNOWN_72H', duration_hours: 72 },
    proposed_action: 'REQUEST_HUMAN_REVIEW',
    priority: 900
  }),
  policy({
    policy_id: 'legacy.unanswered.36h',
    name: 'Legacy unanswered cancellation reference',
    status: 'DEPRECATED',
    scope: ['LEGACY_COMPARISON'],
    trigger: { fact_code: 'LEGACY_UNANSWERED_THRESHOLD' },
    timer_definition: { workflow: 'LEGACY_UNANSWERED_36H', duration_hours: 36 },
    proposed_action: 'COMPARE_LEGACY_36H_ONLY',
    enabled: false,
    priority: 0,
    forbidden_conditions: [...BASE.forbidden_conditions, 'real_cancellation_or_rejection'],
    human_review_conditions: [...BASE.human_review_conditions, 'conflicts_with_current_timer_policy'],
    change_reason: 'Inventory of active historic references; comparison-only in the VPS core and never executable'
  })
]);

export const REQUIRED_TIMER_HOURS = deepFreeze({
  CONFIRMATION_WAIT_1H: 1,
  COMMERCIAL_RECOVERY_24H: 24,
  INCIDENT_AUSENTE_48H: 48,
  INCIDENT_FALTAN_DATOS_48H: 48,
  INCIDENT_NO_RESPUESTA_48H: 48,
  UNKNOWN_72H: 72,
  LEGACY_UNANSWERED_36H: 36
});

const LEGACY_NUMBER = /(?<![\d.])36(?![\d.])/;
const EXPLICIT_UNIT = /(?<![\d.])36\s*(?:h\b|hours?\b|horas?\b)/i;
const ASSIGNMENT = /(?:=|:)\s*["']?36["']?(?:\s|$|[,;}])/i;
const CONTEXT_KEYWORD = /\b(?:timeout|hours?|horas?|duration|delay|window|threshold|timer|legacy|unanswered|cancel|cancellation|reject|response)\b/i;

function classifyReference(path, line) {
  const normalized = String(path).replace(/\\/g, '/').toLowerCase();
  if (/^\s*(?:\/\/|#|\/\*|\*)/.test(line)) return 'COMMENT_REFERENCE';
  if (/(?:^|[/.])(?:test|tests|fixtures?)(?:[/.]|$)/.test(normalized)) return 'TEST_REFERENCE';
  if (/\.md$|docs?\//.test(normalized)) return 'DOCUMENTATION_REFERENCE';
  if (/policy|policies/.test(normalized)) return 'POLICY_REFERENCE';
  if (/\.(?:ya?ml|json|env|toml|ini|config)$|render\.yaml|docker-compose|compose\.yaml/.test(normalized)) return 'CONFIG_REFERENCE';
  if (/\.(?:mjs|cjs|js|ts|sh|ps1|sql|py)$/.test(normalized)) return 'ACTIVE_RUNTIME_REFERENCE';
  return 'UNKNOWN_REFERENCE';
}

function matchedFormat(line) {
  if (EXPLICIT_UNIT.test(line)) return 'EXPLICIT_HOUR_UNIT';
  if (ASSIGNMENT.test(line)) return 'ASSIGNED_HOUR_VALUE';
  if (/^\s*["']36["']\s*[,;]?\s*$/.test(line)) return 'QUOTED_HOUR_VALUE';
  return 'CONTEXTUAL_HOUR_VALUE';
}

export function findLegacy36HourReferences(textBySource) {
  const findings = [];
  for (const [source, text] of Object.entries(textBySource)) {
    String(text).split(/\r?\n/).forEach((line, index) => {
      if (!LEGACY_NUMBER.test(line)) return;
      const exact = /^\s*["']?36["']?\s*[,;]?\s*$/.test(line);
      if (!exact && !EXPLICIT_UNIT.test(line) && !ASSIGNMENT.test(line) && !CONTEXT_KEYWORD.test(line)) return;
      const classification = classifyReference(source, line);
      findings.push({
        source,
        path: source,
        line: index + 1,
        classification,
        matched_format: matchedFormat(line),
        sanitized_context: `LEGACY_TEMPORAL_REFERENCE:${classification}:${matchedFormat(line)}`,
        context_hash: crypto.createHash('sha256').update(line).digest('hex'),
        conflict_code: 'LEGACY_TEMPORAL_REFERENCE',
        severity: ['ACTIVE_RUNTIME_REFERENCE', 'UNKNOWN_REFERENCE'].includes(classification) ? 'HIGH' : 'MEDIUM',
        matched_value_retained: false,
        original_context_retained: false,
        disposition: ['ACTIVE_RUNTIME_REFERENCE', 'UNKNOWN_REFERENCE'].includes(classification)
          ? 'BLOCK_AND_HUMAN_REVIEW'
          : 'INVENTORY_AND_HUMAN_REVIEW',
        executable_in_phase_b: false
      });
    });
  }
  return findings;
}
