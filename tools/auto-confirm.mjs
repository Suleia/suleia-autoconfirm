import { runAutoConfirm } from '../src/workflows/orders.mjs';

const result = await runAutoConfirm();
console.log(JSON.stringify(result, null, 2));
