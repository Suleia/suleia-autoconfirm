export const CYCLE_INTERVAL_MS = 60 * 60 * 1000;
export const CYCLE_WATCHDOG_MS = 25 * 60 * 1000;
export const CYCLE_FRESHNESS_MS = CYCLE_INTERVAL_MS + CYCLE_WATCHDOG_MS + 5 * 60 * 1000;

// Runs on the server at startup and every hour, including nights/weekends.
// A slow callback never creates overlapping executions.
export function startSchedule(run, {now = Date.now, every = setInterval, onError = () => {}} = {}) {
 const state = {intervalMinutes: CYCLE_INTERVAL_MS / 60000, lastTriggeredAt: null, nextRunAt: null};
 let busy = false;
 async function tick() {
  const at = now();
  state.nextRunAt = new Date(at + CYCLE_INTERVAL_MS).toISOString();
  if (busy) return;
  busy = true;
  state.lastTriggeredAt = new Date(at).toISOString();
  try { await run(); } catch (error) { onError(error); } finally { busy = false; }
 }
 const timer = every(tick, CYCLE_INTERVAL_MS);
 void tick();
 return {state, timer};
}
