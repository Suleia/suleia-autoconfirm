export function shadowWorkerHealth({ lastResult, lastError, running }) {
  const firstCycleComplete = Boolean(lastResult);
  const ok = firstCycleComplete && lastResult.ok === true && !lastError;
  return Object.freeze({
    statusCode: ok ? 200 : 503,
    body: Object.freeze({
      ok,
      service: 'shadow-readonly-worker',
      run_mode: 'SHADOW_READ_ONLY',
      running: Boolean(running),
      first_cycle_complete: firstCycleComplete,
      last_sync_ok: lastResult?.ok ?? null,
      last_error: lastError || null,
      actions_executed: 0,
      production_writes: 0
    })
  });
}

