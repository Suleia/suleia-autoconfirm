// Allowlist only stable diagnostic codes. Provider errors may contain URLs,
// credentials or payloads and must never be returned or logged verbatim.
const known=new Set(['META_RATE_LIMITED','META_FINANCIAL_WINDOW_RESERVED','ACTOR_UNAUTHORIZED','ACCOUNT_NOT_ELIGIBLE','ACCOUNT_BUDGET_BUSY','META_REPORT_PREPARING_OR_UNAVAILABLE','ADS_REPORT_BUSY','ADS_REPORT_TIMEOUT','AUTOPILOT_HISTORY_INCOMPLETE','AUTOPILOT_DAY_CHANGED','ADS_ALGORITHM_DISABLED','QUERY_INVALID','REQUEST_INVALID','IDEMPOTENCY_PAYLOAD_CONFLICT','LIVE_NOT_AUTHORIZED','PROPOSAL_NOT_AUTHORIZED','LIVE_CANARY_GUARD_UNAVAILABLE']);
export function adsCommandErrorCode(error){const code=error?.code||error?.message;return known.has(code)||/^META_HTTP_(?:401|403|429|500|502|503|504)$/.test(code||'')?code:'ADS_COMMAND_FAILED';}
