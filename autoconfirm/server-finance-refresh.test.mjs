import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolveFinancePeriod} from './src/finance.mjs';

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

test('finance snapshots can refresh autonomously and remain explicitly disableable', () => {
  assert.match(source, /FINANCE_BACKGROUND_REFRESH_ENABLED !== 'false'/);
  assert.match(source, /financeSnapshotNeedsRefresh\(finance\)/);
  assert.match(source, /financeBackgroundRefreshEnabled && \(force \|\| !finance \|\| stale\)/);
  assert.match(source, /unresolved > 0/);
  assert.match(source, /buildFinanceReport\(\{ month, force: true, leanRefresh: true \}\)/);
  assert.match(source, /FINANCE_REFRESH_INTERVAL_MINUTES \|\| 60/);
  assert.match(source, /startFinanceReportRefreshScheduler\(\)/);
  assert.doesNotMatch(source, /const backgroundRefreshEnabled = false/);
});

test('the dashboard polls a background refresh while continuing to show the stored snapshot', () => {
  const dashboard = fs.readFileSync(new URL('./dashboard/main.js', import.meta.url), 'utf8');
  assert.match(dashboard, /if \(payload\.refreshing\)[^]*setTimeout\(\(\) => loadFinanceReport\(\), 5000\)/);
});

test('a tariff change during an existing refresh queues exactly one follow-up using the current rates',async()=>{
 const tasks=[];let releases=[];const context={Map,Set,Promise,process:{env:{}},resolveFinancePeriod,setTimeout:fn=>fn(),console:{log(){},error(){}},buildFinanceReport:async({month})=>{tasks.push(month);await new Promise(resolve=>releases.push(resolve));return {period:{month}};}};
 const start=source.indexOf('const financeRefreshInFlight = new Map();'),end=source.indexOf('\nconst server = http.createServer',start);
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.queue=queueFinanceReportRefresh;',context);
 context.queue('2026-10');await new Promise(setImmediate);assert.deepEqual(tasks,['2026-10']);
 context.queue('2026-10',{afterCurrent:true});context.queue('2026-10',{afterCurrent:true});releases.shift()();await new Promise(setImmediate);
 assert.deepEqual(tasks,['2026-10','2026-10']);releases.shift()();await new Promise(setImmediate);assert.equal(tasks.length,2);
});

test('the existing financial timer reconciles a stale prior cohort sequentially and never duplicates a sweep',async()=>{
 const calls=[],releases=[];const context={Date,Map,Set,Promise,Number,process:{env:{}},resolveFinancePeriod:month=>({month:month||'2026-11'}),setTimeout:fn=>fn(),console:{log(){},error(){}},
  loadFinanceSnapshot:async({month})=>month==='2026-10'?{generatedAt:'2026-10-30T10:00Z',period:{current:false},counts:{inAir:2,pending:1}}:null,
  buildFinanceReport:async({month})=>{calls.push(month);await new Promise(resolve=>releases.push(resolve));return {period:{month}};}};
 const start=source.indexOf('const financeRefreshInFlight = new Map();'),end=source.indexOf('\nconst server = http.createServer',start);
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.sweep=runFinanceReconciliationSweep;',context);
 const first=context.sweep(),second=context.sweep();assert.equal(first,second);await new Promise(setImmediate);assert.deepEqual(calls,['2026-11']);
 releases.shift()();await new Promise(setImmediate);assert.deepEqual(calls,['2026-11','2026-10']);releases.shift()();await first;
 assert.equal(calls.length,2);
});

