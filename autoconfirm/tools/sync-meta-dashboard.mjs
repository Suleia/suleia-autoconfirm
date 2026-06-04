import { getAppConfig } from '../src/config.mjs';
import { syncMetaDashboard } from '../src/workflows/analytics.mjs';

const config = getAppConfig();

try {
  const result = await syncMetaDashboard({ store: config.defaultStore });
  console.log(JSON.stringify(result, null, 2));
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
