import { getAppConfig } from '../src/config.mjs';
import { runUnansweredCancellationSweep } from '../src/workflows/unanswered-cancellations.mjs';

const config = getAppConfig();
const orderIds = process.argv.slice(2).filter(Boolean);

const result = await runUnansweredCancellationSweep({ store: config.defaultStore, orderIds });
console.log(JSON.stringify(result, null, 2));
