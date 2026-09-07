import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDropeaV2IssueActionClient,
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

test('issue action credential requires the exact read and resolve scopes', () => {
  assert.equal(loadDropeaV2IssueActionStoreConfigs(envFor()).length, 1);
  assert.throws(
    () => loadDropeaV2IssueActionStoreConfigs(envFor(token(['dp:issues:read', 'dp:orders:read']))),
    (error) => error?.code === 'DROPEA_ISSUE_ACTION_TOKEN_REQUIRED_SCOPE_MISSING'
  );
  assert.throws(
    () => loadDropeaV2IssueActionStoreConfigs(envFor(token([...issueActionScopes, 'dp:orders:cancel']))),
    (error) => error?.code === 'DROPEA_ISSUE_ACTION_TOKEN_UNAPPROVED_SCOPE'
  );
});

test('return uses the official V2 issue endpoint, exact body and stable idempotency key', async () => {
  const calls = [];
  const client = createDropeaV2IssueActionClient({
    token: token(),
    market: 'ES',
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

  const result = await client.returnToOrigin(1280487);
  assert.equal(result.resolution_status, 'RETURN_REQUESTED');
  assert.equal(calls[0].url, 'https://es.public-api.dropea.com/dropshipper/issues/1280487/resolve');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'suleia-return-requested-1280487');
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
