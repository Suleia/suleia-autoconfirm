import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDropeaV2IssueActionClient,
  readDropeaV2IssueOperation,
  getDropeaV2IssueActionReadiness,
  loadDropeaV2IssueActionStoreConfigs
} from './dropea-v2-issue-actions.mjs';

const issueActionScopes = [
  'dp:issues:read',
  'dp:orders:read',
  'dp:issues:resolve'
];

function token(scopes = issueActionScopes, exp = 1_817_398_431) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp, scope: scopes.join(' ') })}.test-signature`;
}

function envFor(actionToken = token()) {
  return {
    DROPEA_ISSUE_ACTION_JWT_ES: actionToken,
    DROPEA_ISSUE_ACTIONS_STORES_CONFIG: JSON.stringify([{
      store_id: '16088',
      market: 'ES',
      base_url: 'https://es.public-api.dropea.com',
      jwt_secret_reference: 'DROPEA_ISSUE_ACTION_JWT_ES',
      jwt_expires_at: '2027-08-04T16:53:51.000Z'
    }])
  };
}

test('issue action credential requires read and resolve scopes while tolerating owner-authorized extras', () => {
  assert.equal(loadDropeaV2IssueActionStoreConfigs(envFor()).length, 1);
  assert.throws(
    () => loadDropeaV2IssueActionStoreConfigs(envFor(token(['dp:issues:read', 'dp:orders:read']))),
    (error) => error?.code === 'DROPEA_ISSUE_ACTION_TOKEN_REQUIRED_SCOPE_MISSING'
  );
  assert.equal(
    loadDropeaV2IssueActionStoreConfigs(envFor(token([...issueActionScopes, 'dp:orders:cancel', 'dp:orders:update']))).length,
    1
  );
});

test('an ambiguous network write is classified once, never retried in the HTTP client', async () => {
  let calls = 0;
  const client = createDropeaV2IssueActionClient({ token: token(), market: 'ES',
    fetchImpl: async () => { calls += 1; throw new Error('connection lost'); }
  });
  await assert.rejects(client.returnToOrigin(1280487), error => error.code === 'DROPEA_V2_ISSUE_ACTION_NETWORK_UNKNOWN');
  assert.equal(calls, 1);
});

test('replaying one persistent attempt preserves its exact idempotency key', async () => {
  const keys = [];
  const client = createDropeaV2IssueActionClient({ token: token(), market: 'ES',
    idempotencyNonceFactory: () => '2026-09-17T17:00:00.000Z',
    fetchImpl: async (_url, options) => {
      keys.push(options.headers['Idempotency-Key']);
      return { ok: true, status: 200, json: async () => ({ success: true,
        data: { status: 'RESOLVED', resolution_status: 'RETURN_REQUESTED' } }) };
    }
  });
  await client.returnToOrigin(1280487);
  await client.returnToOrigin(1280487);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /^suleia-return-requested-1280487-/);
});

test('return uses the official V2 issue endpoint, exact body and a fresh logical-attempt key', async () => {
  const calls = [];
  const nonces = ['attempt-one', 'attempt-two'];
  const client = createDropeaV2IssueActionClient({
    token: token(),
    market: 'ES',
    idempotencyNonceFactory: () => nonces.shift(),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            message: 'issue updated',
            data: { id: 1280487, status: 'RESOLVED', resolution_status: 'RETURN_REQUESTED' }
          };
        }
      };
    }
  });

  const first = await client.returnToOrigin(1280487);
  const second = await client.returnToOrigin(1280487);
  assert.equal(first.resolution_status, 'RETURN_REQUESTED');
  assert.equal(second.resolution_status, 'RETURN_REQUESTED');
  assert.equal(calls[0].url, 'https://es.public-api.dropea.com/dropshipper/issues/1280487/resolve');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'suleia-return-requested-1280487-attempt-one');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'suleia-return-requested-1280487-attempt-two');
  assert.notEqual(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: 'RESOLVED',
    resolution_status: 'RETURN_REQUESTED'
  });
});

test('missing issue action configuration is explicit and fail closed', () => {
  assert.deepEqual(getDropeaV2IssueActionReadiness({}), {
    configured: false,
    ready: false,
    stores: 0,
    error: 'DROPEA_ISSUE_ACTIONS_STORES_CONFIG_EMPTY'
  });
});
test('failed original operation is diagnosed by GET without exposing provider payload or re-POSTing',async()=>{
 const calls=[];const r=await readDropeaV2IssueOperation('11','original-attempt',{env:envFor(),fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method});return {ok:true,json:async()=>({data:{status:'failed',error:{code:'GLS_INCIDENCE_ALREADY_SOLVED',message:'Private provider detail'}}})};
 }});
 assert.deepEqual(r,{status:'failed',errorCode:'GLS_INCIDENCE_ALREADY_SOLVED'});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.match(calls[0].url,/operations\/suleia-return-requested-11-original-attempt$/);
});
