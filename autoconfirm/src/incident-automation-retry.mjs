export function incidentChatbyReadBlockCount(incidents = []) {
  return incidents.filter((incident) => incident.incidentType === 'rejected_goods'
    && (incident.incidentDiscountReturnStatus === 'BLOCKED_CHATBY_READ_FAILED' || ['chatby_final_read_failed', 'chatby_pre_send_read_failed'].includes(
      incident.incidentDiscountRecoveryReason
    ))).length;
}

export function discountSchedulerOwnsIncidentSync(enabled, intervalMinutes) {
  return enabled === true && Number.isFinite(Number(intervalMinutes)) && Number(intervalMinutes) > 0;
}

// Both periodic owners use the same result-driven recovery. A thrown request
// has an uncertain outcome and must never schedule another write from here.
export async function runIncidentSyncWithRecovery(sync, retry) {
  const result = await sync();
  if (result?.ok === true) retry.consider(result);
  return result;
}

// One non-blocking, coalesced retry after an explicit provider cooldown.
// All eligibility checks and persistent action claims run again on that cycle.
export function createIncidentAutomationRetry({
  getRetryAfterMs,
  scheduleRetry,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let timer = null;
  let generation = 0;
  let fallbackDelay = 60_000;
  let nextRetryAt = null;
  return {
    status() { return { retryScheduled: timer !== null, nextRetryAt }; },
    consider(result) {
      const retryAfterMs = Number(getRetryAfterMs());
      const activity = result?.customerActivitySummary;
      const providerBlockedReads = retryAfterMs > 0 && Number.isFinite(Number(activity?.checked))
        && Number.isFinite(Number(activity?.verified)) && Number(activity.checked) > Number(activity.verified);
      if (!result?.discountRecoverySummary?.blockedChatbyRead && !providerBlockedReads) {
        if (timer !== null) clearTimer(timer);
        timer = null; nextRetryAt = null; generation += 1; fallbackDelay = 60_000;
        return false;
      }
      if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) return false;
      const delay = retryAfterMs > 0 ? retryAfterMs : fallbackDelay;
      fallbackDelay = Math.min(15 * 60_000, fallbackDelay * 2);
      if (timer !== null) clearTimer(timer);
      const currentGeneration = ++generation;
      nextRetryAt = new Date(Date.now() + Math.max(1000, delay) + 1000).toISOString();
      timer = setTimer(() => {
        if (currentGeneration !== generation) return;
        timer = null;
        nextRetryAt = null;
        scheduleRetry();
      }, Math.max(1000, delay) + 1000);
      timer?.unref?.();
      return true;
    }
  };
}
