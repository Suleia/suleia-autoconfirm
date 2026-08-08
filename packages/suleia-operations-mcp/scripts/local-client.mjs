import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(packageRoot, 'src', 'transports', 'stdio.mjs');
const client = new Client({ name: 'suleia-mcp-local-validator', version: '0.3.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: 'pipe'
});

await client.connect(transport);

const toolList = await client.listTools();
const results = {};
for (const tool of toolList.tools) {
  const args = {
    search_orders: { status: 'PENDING_CONFIRMATION' },
    get_order: { order_id: 'STG-ORDER-0001' },
    search_incidents: { status: 'PENDING' },
    get_incident: { canonical_issue_id: 'STG-ISSUE-0001' },
    get_order_timeline: { order_id: 'STG-ORDER-0001' },
    get_data_freshness: {},
    search_operational_findings: {},
    get_platform_overview: { section: 'ALL' },
    get_runtime_inventory: { platform: 'VPS' },
    get_database_catalog: { platform: 'VPS_POSTGRES' },
    get_component_details: { component_type: 'MODULE', component_id: 'incident-processor' },
    get_active_timers: { order_id: 'STG-ORDER-0001' },
    get_agent_decisions: { order_id: 'STG-ORDER-0001' },
    preview_order_decision: { order_id: 'STG-ORDER-0001' },
    compare_simulation_with_current_system: { order_id: 'STG-ORDER-0001' },
    list_orders_needing_ai_review: {}
  }[tool.name];
  results[tool.name] = await client.callTool({ name: tool.name, arguments: args });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  transport: 'stdio',
  tools: toolList.tools.map((tool) => tool.name),
  actions_executed: Object.values(results).reduce((total, result) => {
    return total + Number(result.structuredContent?.result?.meta?.actions_executed || 0);
  }, 0)
}, null, 2)}\n`);

await client.close();
