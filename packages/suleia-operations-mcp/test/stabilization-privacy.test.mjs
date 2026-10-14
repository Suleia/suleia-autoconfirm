import test from 'node:test';
import assert from 'node:assert/strict';
import {maskPii,containsObviousPii} from '../src/security/pii.mjs';
import {SERVICE_MANIFEST} from '../src/platform/catalog.mjs';

test('typed runtime counters do not masquerade as phones; actual PII remains masked and rejected',()=>{
 const runtime={ram_usage_bytes:678123456,disk:987654321,counts:[678123456],phone:678123456,note:'call +34678123456 or person@example.com'};
 const safe=maskPii(runtime);
 assert.equal(safe.ram_usage_bytes,runtime.ram_usage_bytes);
 assert.notEqual(safe.phone,runtime.phone);
 assert.equal(containsObviousPii(safe),false);
 assert.equal(containsObviousPii({nested:['call 678123456']}),true);
 assert.equal(containsObviousPii({nested:{note:'person@example.com'}}),true);
 assert.equal(containsObviousPii('678123456'),true);
});
test('central manifest includes bounded retry adapter and analytics materializer',()=>{
 for(const name of ['incident-browser','analytics-materializer']) assert.equal(SERVICE_MANIFEST.filter(s=>s.service===name).length,1);
});
