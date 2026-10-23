import test from 'node:test';import assert from 'node:assert/strict';
import {dailySlot,nextExecution} from './schedule.mjs';
for(const [date,utc]of [['2026-07-01','20:30'],['2026-12-01','21:30'],['2026-03-29','20:30'],['2026-10-25','21:30']])test('Madrid22:30 correctly handles summer/winter and DST '+date,()=>{
 const at=Date.parse(`${date}T${utc}:00Z`);assert.equal(dailySlot(at).due,true);assert.equal(dailySlot(at-60000).due,false);assert.equal(nextExecution(at-60000),new Date(at).toISOString());assert.equal(dailySlot(at+30*60000).missed,true);
});
test('restart recovers within bounded window, never after23:00 and weekends remain due',()=>{
 assert.equal(dailySlot(Date.parse('2026-10-24T20:45:00Z')).due,true);assert.equal(dailySlot(Date.parse('2026-10-24T21:01:00Z')).due,false);
 assert.equal(nextExecution(Date.parse('2026-10-24T22:00:00Z')),'2026-10-25T21:30:00.000Z');
});
