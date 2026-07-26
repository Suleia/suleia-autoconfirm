import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SCOPES, requireScopes } from '../security/scopes.mjs';

const orderId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const limit = z.number().int().min(1).max(500).default(100);
const asOf = z.string().datetime({ offset: true }).optional();
const resultShape = {
  result: z.record(z.string(), z.unknown())
};

function response(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: { result }
  };
}

function errorResponse(error) {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: false,
        error: error?.code || 'TOOL_ERROR',
        message: error instanceof Error ? error.message : 'Tool failed',
        actions_executed: 0
      })
    }]
  };
}

function registerReadTool({
  server,
  name,
  title,
  description,
  inputSchema,
  scopes,
  handler,
  context,
  audit
}) {
  server.registerTool(name, {
    title,
    description,
    inputSchema,
    outputSchema: resultShape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (args) => {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    try {
      requireScopes(context, scopes);
      const result = await handler(args);
      audit.record({
        requestId,
        principal: context.principal,
        scopes: context.scopes,
        tool: name,
        outcome: 'success',
        durationMs: performance.now() - started
      });
      return response(result);
    } catch (error) {
      audit.record({
        requestId,
        principal: context.principal,
        scopes: context.scopes,
        tool: name,
        outcome: 'error',
        durationMs: performance.now() - started,
        errorCode: error?.code || 'TOOL_ERROR'
      });
      return errorResponse(error);
    }
  });
}

export function createMcpServer({ service, audit, authContext }) {
  const server = new McpServer({
    name: 'suleia-operations-mcp',
    version: '0.1.0'
  });

  const common = { server, context: authContext, audit };

  registerReadTool({
    ...common,
    name: 'get_order',
    title: 'Get masked staging order',
    description: 'Returns one masked order from staging. No production access and no write capability.',
    inputSchema: { order_id: orderId },
    scopes: [SCOPES.READ],
    handler: ({ order_id }) => service.getOrder(order_id)
  });

  registerReadTool({
    ...common,
    name: 'get_order_timeline',
    title: 'Get masked order timeline',
    description: 'Returns the chronological masked timeline for one staging order.',
    inputSchema: { order_id: orderId, limit: limit.optional() },
    scopes: [SCOPES.READ],
    handler: ({ order_id, limit: requestedLimit = 100 }) => service.getOrderTimeline(order_id, requestedLimit)
  });

  registerReadTool({
    ...common,
    name: 'get_data_freshness',
    title: 'Get staging data freshness',
    description: 'Returns freshness metadata for the one-way staging mirror.',
    inputSchema: {},
    scopes: [SCOPES.READ],
    handler: () => service.getDataFreshness()
  });

  registerReadTool({
    ...common,
    name: 'get_active_timers',
    title: 'Get active simulation timers',
    description: 'Returns active timers from staging without executing any action.',
    inputSchema: {
      order_id: orderId.optional(),
      timer_type: z.enum(['confirmation_wait', 'incident_wait', 'review_wait']).optional()
    },
    scopes: [SCOPES.READ],
    handler: ({ order_id = null, timer_type = null }) => service.getActiveTimers({
      orderId: order_id,
      timerType: timer_type
    })
  });

  registerReadTool({
    ...common,
    name: 'get_agent_decisions',
    title: 'Get recorded agent decisions',
    description: 'Returns masked historical decisions for one staging order.',
    inputSchema: { order_id: orderId, limit: limit.optional() },
    scopes: [SCOPES.READ],
    handler: ({ order_id, limit: requestedLimit = 100 }) => service.getAgentDecisions(order_id, requestedLimit)
  });

  registerReadTool({
    ...common,
    name: 'preview_order_decision',
    title: 'Preview order decision',
    description: 'Runs a side-effect-free decision simulation. actions_executed is always zero.',
    inputSchema: { order_id: orderId, as_of: asOf },
    scopes: [SCOPES.READ, SCOPES.SIMULATE],
    handler: ({ order_id, as_of }) => service.simulateOrderDecision(order_id, as_of)
  });

  registerReadTool({
    ...common,
    name: 'compare_simulation_with_current_system',
    title: 'Compare simulation with current system',
    description: 'Compares a simulation with the stored current-system decision without executing actions.',
    inputSchema: { order_id: orderId, as_of: asOf },
    scopes: [SCOPES.READ, SCOPES.SIMULATE],
    handler: ({ order_id, as_of }) => service.compareSimulationWithCurrentSystem(order_id, as_of)
  });

  registerReadTool({
    ...common,
    name: 'list_orders_needing_ai_review',
    title: 'List staging orders requiring review',
    description: 'Lists masked staging orders that require human review.',
    inputSchema: {
      limit: limit.optional(),
      reason: z.string().min(1).max(100).optional()
    },
    scopes: [SCOPES.READ],
    handler: ({ limit: requestedLimit = 100, reason = null }) => service.listOrdersRequiringReview({
      limit: requestedLimit,
      reason
    })
  });

  return server;
}

export const MCP_TOOL_NAMES = Object.freeze([
  'get_order',
  'get_order_timeline',
  'get_data_freshness',
  'get_active_timers',
  'get_agent_decisions',
  'preview_order_decision',
  'compare_simulation_with_current_system',
  'list_orders_needing_ai_review'
]);
