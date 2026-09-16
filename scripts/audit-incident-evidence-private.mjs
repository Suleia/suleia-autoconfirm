// Read-only, private-runtime audit. Never emits customer text or identifiers.
import { OperationsRepository } from '../packages/suleia-operations-mcp/src/operations/repository.mjs';
import { decryptOperationsPrivateJson } from '../packages/suleia-operations-mcp/src/operations/private-display.mjs';
const repo = await OperationsRepository.connect(process.env.OPERATIONS_DATABASE_URL, { privateDataKey: process.env.OPERATIONS_PRIVATE_DATA_KEY });
try {
  const row = (await repo.pool.query(`SELECT * FROM read_models.operations_incident_panel_context WHERE dropea_issue_id=$1`, [process.env.AUDIT_ISSUE_ID])).rows[0];
  if (!row) throw new Error('AUDIT_CASE_NOT_FOUND');
  const messages = await repo.pool.query(`SELECT * FROM read_models.operations_private_incident_messages WHERE canonical_issue_id=$1 ORDER BY occurred_at`, [row.canonical_issue_id]);
  console.log(JSON.stringify({ case: 'OWNER_REPORTED_CASE', type: row.interpreted_type, issue_created_at: row.created_at,
    issue_updated_at: row.updated_at, conversation_status: row.conversation_status, conversation_reason: row.conversation_reason,
    messages: messages.rows.map(m => { const text = decryptOperationsPrivateJson(m.message_text_ciphertext, process.env.OPERATIONS_PRIVATE_DATA_KEY)?.text || '';
      return { at: m.occurred_at, direction: m.direction, type: m.message_type, intent: m.intent,
        relation: m.relation_to_issue, template: m.context_template_slug || null, relevance: m.incident_relevance || null,
        original_confirmation_text: /^(confirmar mi pedido|confirmar pedido)$/i.test(text.trim()) }; }) }));
  const columns = await repo.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='read_models' AND table_name='operations_private_incident_messages' ORDER BY ordinal_position`);
  console.log(JSON.stringify({ message_view_columns: columns.rows.map(r => r.column_name) }));
} finally { await repo.pool.end(); }
