import { ingestPendingOrders } from '../src/workflows/orders.mjs';

const result = await ingestPendingOrders();
console.log(JSON.stringify(result, null, 2));
