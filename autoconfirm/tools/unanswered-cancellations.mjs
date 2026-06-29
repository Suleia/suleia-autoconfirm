import { getAppConfig } from '../src/config.mjs';
import { runUnansweredCancellationSweep } from '../src/workflows/unanswered-cancellations.mjs';

const config = getAppConfig();

const result = await runUnansweredCancellationSweep({ store: config.defaultStore });
console.log(JSON.stringify(result, null, 2));
