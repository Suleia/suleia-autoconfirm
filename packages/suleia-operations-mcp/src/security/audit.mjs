import crypto from 'node:crypto';
import fs from 'node:fs';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, 16);
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
    record({ requestId, principal, scopes, tool, outcome, durationMs, errorCode = null }) {
      const entry = {
        event: 'mcp_tool_call',
        at: new Date().toISOString(),
        request_id: String(requestId || crypto.randomUUID()),
        principal_hash: hash(principal),
        scopes: [...new Set(scopes || [])].sort(),
        tool: String(tool || 'unknown'),
        outcome: String(outcome || 'unknown'),
        duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
        error_code: errorCode,
        pii_logged: false,
        actions_executed: 0
      };
      write(JSON.stringify(entry));
      return entry;
    }
  };
}
