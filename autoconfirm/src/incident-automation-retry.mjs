export function incidentChatbyReadBlockCount(incidents = []) {
  return incidents.filter((incident) => incident.incidentType === 'rejected_goods'
    && ['chatby_final_read_failed', 'chatby_pre_send_read_failed'].includes(
      incident.incidentDiscountRecoveryReason
    )).length;
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
  return {
    consider(result) {
      if (!result?.discountRecoverySummary?.blockedChatbyRead) return false;
      const retryAfterMs = Number(getRetryAfterMs());
      if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return false;
      if (timer !== null) clearTimer(timer);
      const currentGeneration = ++generation;
      timer = setTimer(() => {
        if (currentGeneration !== generation) return;
        timer = null;
        scheduleRetry();
      }, Math.max(1000, retryAfterMs) + 1000);
      timer?.unref?.();
      return true;
    }
  };
}
