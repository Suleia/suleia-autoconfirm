export function loadStartupAppState(selectRows) {
 // app_state also contains growing capability, claim and feedback records.
 // A limit without a key filter can silently omit every dashboard cache.
 return selectRows('app_state', {
  query: {key:'in.(runtime_state,operational_orders_cache,incidents_cache)'},
  limit:3
 });
}
