import { readFile } from 'node:fs/promises';
import { createClient, TrendtrackError } from './client.mjs';

try {
  const file = process.argv[2];
  let key = process.env.TRENDTRACK_API_KEY;
  if (file) {
    const text = await readFile(file, 'utf8');
    key = text.replace(/^\uFEFF/, '').match(/^TRENDTRACK_API_KEY=([^\r\n]*)$/m)?.[1]?.trim();
    if (key && /^(['"]).*\1$/.test(key)) key = key.slice(1, -1);
  }
  const client = createClient({ key });
  for (const endpoint of ['/v1/me', '/v1/usage']) {
    const r = await client.get(endpoint);
    const result = { endpoint, status: r.status };
    if (endpoint === '/v1/usage') {
      const headerBalance = r.headers.get('x-credits-remaining');
      const balance = headerBalance !== null && headerBalance.trim() !== ''
        ? Number(headerBalance) : r.body.data?.total?.remaining;
      if (!Number.isFinite(balance) || balance < 0)
        throw new TrendtrackError('INVALID_BALANCE');
      result.creditsRemaining = balance;
      result.usageCost = r.headers.get('x-usage-cost');
      result.creditsUsed = r.headers.get('x-credits-used');
    }
    // Deliberately omit identity, workspace and raw provider response.
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof TrendtrackError ? error.code : 'LOCAL_CONFIGURATION_ERROR',
    status: error instanceof TrendtrackError ? error.status : null,
  }));
  process.exitCode = 1;
}
