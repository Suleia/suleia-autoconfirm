import { runStoreAutomationCycle } from '../src/workflows/orders.mjs';

const result = await runStoreAutomationCycle();
console.log(JSON.stringify(result, null, 2));
