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
      last_cycle_completed_at: lastResult?.completed_at ?? null,
      last_error: lastError || null,
      components: Object.freeze({
        legacy: Object.freeze({ enabled: true, ok: lastResult?.legacy?.ok ?? null }),
        dropea: Object.freeze({ enabled: lastResult?.dropea?.enabled ?? null, ok: lastResult?.dropea?.ok ?? null }),
        chatby: Object.freeze({
          enabled: lastResult?.chatby?.enabled ?? null,
          ok: lastResult?.chatby?.ok ?? null,
          consultable: lastResult?.chatby?.consultable ?? null,
          error: lastResult?.chatby?.error ?? null,
          freshness_persisted: lastResult?.chatby?.freshness_persisted ?? null
        }),
        incidents: Object.freeze({ enabled: true, ok: lastResult?.incidents?.ok ?? null })
      }),
      actions_executed: 0,
      production_writes: 0
    })
  });
}
