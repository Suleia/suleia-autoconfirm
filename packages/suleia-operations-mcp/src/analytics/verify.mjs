// Runs on the VPS with the existing MCP read role. Prints only aggregates.
import assert from 'node:assert/strict';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../config.mjs';
import { createPostgresReadRepository } from '../data/postgres-read-repository.mjs';
import { createOperationsService } from '../domain/service.mjs';
import { createMcpServer } from '../mcp/server.mjs';
import { ANALYTICS_TOOLS, localParts, shiftDay } from '../../../platform-core/src/analytics/order-intelligence.mjs';
const config=loadConfig(),pool=new pg.Pool({connectionString:process.env.MCP_DATABASE_URL,max:2,statement_timeout:10000});
const repository=createPostgresReadRepository(config,{pool}),service=createOperationsService(repository,config),server=createMcpServer({service,config,audit:{record(){}},authContext:{principal:'analytics-deploy-verification',scopes:['orders:read']}});
const [ct,st]=InMemoryTransport.createLinkedPair(),client=new Client({name:'analytics-deploy-verification',version:'1'});await server.connect(st);await client.connect(ct);
try{
 const tools=await client.listTools();assert.equal(tools.tools.length,28);const today=localParts(new Date()).day,filters={date_from:shiftDay(today,-89),date_to:today};const results=[];
 for(const name of ANALYTICS_TOOLS){const start=performance.now();const r=await client.callTool({name,arguments:filters});assert.equal(r.isError,undefined,name+': '+r.content?.[0]?.text);const v=r.structuredContent.result.data;assert.equal(v.meta.actions_executed,0);assert.ok(v.meta.sample_size>0);assert.ok(Buffer.byteLength(r.content[0].text)<=config.maxResponseBytes);results.push({tool:name,sample_size:v.meta.sample_size,confidence:v.meta.confidence,freshness:v.meta.freshness.freshness_status,bytes:Buffer.byteLength(r.content[0].text),duration_ms:Math.round(performance.now()-start),...(v.data.overview?{overview:v.data.overview}:{}),...(v.data.rows?{segments:v.data.rows.length}:{}),...(v.data.total!==undefined?{patterns:v.data.total}:{})});}
 const latency={};for(const name of ['get_order_intelligence_overview','get_geographic_performance','get_detected_patterns']){const times=[];for(let i=0;i<20;i++){const start=performance.now();const r=await client.callTool({name,arguments:filters});assert.equal(r.isError,undefined);times.push(performance.now()-start);}times.sort((a,b)=>a-b);latency[name]={p50_ms:Math.round(times[9]),p95_ms:Math.round(times[18])};assert.ok(times[18]<(name==='get_order_intelligence_overview'?1000:name==='get_geographic_performance'?1500:2000),JSON.stringify({name,p95_ms:times[18]}));}
 const permissions=(await pool.query("SELECT has_table_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='integration' AND c.relname='dropea_orders'),'INSERT,UPDATE,DELETE') AS operational_write,has_table_privilege(current_user,'analytics.order_facts','SELECT') AS private_fact_read,has_table_privilege(current_user,'analytics.order_cells','INSERT,UPDATE,DELETE') AS analytics_write")).rows[0];assert.deepEqual(permissions,{operational_write:false,private_fact_read:false,analytics_write:false});
 const reconciliation=(await pool.query("SELECT m.month,(m.body->'counts'->>'created')::int AS finance_orders,(m.body->'totals'->>'realRevenue')::numeric AS finance_revenue,(m.body->'totals'->>'exactNetProfit')::numeric AS finance_profit,sum((d.body->>'created')::int)::int AS daily_orders,round(sum((d.body->>'realRevenue')::numeric),2) AS daily_revenue,round(sum((d.body->>'netProfit')::numeric),2) AS daily_profit FROM analytics.finance_months m JOIN analytics.finance_days d ON to_char(d.business_date,'YYYY-MM')=m.month GROUP BY m.month,m.body ORDER BY m.month")).rows;
 for(const r of reconciliation){assert.equal(r.finance_orders,r.daily_orders);assert.equal(Number(r.finance_revenue),Number(r.daily_revenue));assert.equal(Number(r.finance_profit),Number(r.daily_profit));}
 const runtime=(await pool.query("SELECT body FROM analytics.runtime_state WHERE state_key='materializer'")).rows[0]?.body;
 console.log(JSON.stringify({verified_at:new Date().toISOString(),transport:'MCP_SDK_IN_MEMORY_WITH_PRODUCTION_READ_ROLE',tools:results,latency,permissions,reconciliation,runtime,business_actions:0}));
}finally{await client.close();await server.close();await pool.end();}
