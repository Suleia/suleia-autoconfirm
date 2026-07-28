import crypto from 'node:crypto';
import fs from 'node:fs';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, 16);
}

function countRecords(result) {
  if (Array.isArray(result?.data)) return result.data.length;
  return result?.data ? 1 : 0;
}

export function createAuditLogger(config, sink = null) {
  const write = sink || ((line) => {
    if (config.auditMode === 'file' && config.auditLogPath) {
      fs.appendFileSync(config.auditLogPath, `${line}\n`, 'utf8');
      return;
    }
    process.stderr.write(`${line}\n`);
  });

  return {
    record({
      requestId,
      principal,
      scopes,
      tool,
      outcome,
      durationMs,
      errorCode = null,
      args = {},
      result = null
    }) {
      const entry = {
        event: 'mcp_tool_call',
        at: new Date().toISOString(),
        request_id: String(requestId || crypto.randomUUID()),
        principal_hash: hash(principal),
        scopes: [...new Set(scopes || [])].sort(),
        tool: String(tool || 'unknown'),
        parameter_hash: hash(JSON.stringify(args || {})),
        order_ref_hash: args?.order_id ? hash(args.order_id) : null,
        outcome: String(outcome || 'unknown'),
        duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
        error_code: errorCode,
        records_returned: outcome === 'success' ? countRecords(result) : 0,
        run_mode: 'SIMULATION',
        read_only: true,
        audit_policy_version: config.auditPolicyVersion,
        masking_policy_version: config.maskingPolicyVersion,
        pii_logged: false,
        actions_executed: 0
      };
      write(JSON.stringify(entry));
      return entry;
    },
    security({ event, requestId, principal = 'anonymous', outcome, errorCode }) {
      const entry = {
        event: String(event),
        at: new Date().toISOString(),
        request_id: String(requestId || crypto.randomUUID()),
        principal_hash: hash(principal),
        outcome: String(outcome),
        error_code: errorCode || null,
        run_mode: 'SIMULATION',
        read_only: true,
        pii_logged: false,
        actions_executed: 0
      };
      write(JSON.stringify(entry));
      return entry;
    }
  };
}
