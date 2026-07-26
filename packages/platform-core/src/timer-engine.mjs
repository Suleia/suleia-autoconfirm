const HOUR = 3_600_000;

export function deriveTimers(events, now = new Date()) {
  const active = new Map();
  for (const event of events) {
    const timerId = event.payload?.timer_id;
    if (!timerId) continue;
    if (event.event_type === 'TIMER_STARTED') {
      active.set(timerId, {
        timer_id: timerId,
        workflow: event.payload.workflow || 'UNKNOWN',
        started_at: event.occurred_at,
        deadline_at: event.payload.deadline_at || null,
        status: 'ACTIVE'
      });
    }
    if (event.event_type === 'TIMER_PAUSED' && active.has(timerId)) active.get(timerId).status = 'PAUSED';
    if (event.event_type === 'TIMER_RESUMED' && active.has(timerId)) active.get(timerId).status = 'ACTIVE';
    if (['TIMER_EXPIRED', 'TIMER_CANCELLED'].includes(event.event_type) && active.has(timerId)) {
      active.get(timerId).status = event.event_type === 'TIMER_EXPIRED' ? 'EXPIRED' : 'CANCELLED';
    }
  }
  return [...active.values()].map((timer) => ({
    ...timer,
    remaining_hours: timer.deadline_at
      ? Math.max(0, (new Date(timer.deadline_at).getTime() - now.getTime()) / HOUR)
      : null
  }));
}

export function deadlineFrom(startedAt, hours) {
  return new Date(new Date(startedAt).getTime() + Number(hours) * HOUR).toISOString();
}
