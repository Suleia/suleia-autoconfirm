export function createScheduledJobQueue({ onEvent = () => {} } = {}) {
  let tail = Promise.resolve();
  const pending = new Set();

  function schedule(name, work) {
    if (pending.has(name)) {
      onEvent({ type: 'skipped', name });
      return Promise.resolve({ skipped: true, name });
    }

    pending.add(name);
    const queued = tail
      .catch(() => {})
      .then(async () => {
        onEvent({ type: 'started', name });
        try {
          const result = await work();
          onEvent({ type: 'completed', name });
          return { skipped: false, name, result };
        } catch (error) {
          onEvent({ type: 'failed', name, error });
          throw error;
        } finally {
          pending.delete(name);
        }
      });

    tail = queued.catch(() => {});
    return queued;
  }

  return {
    schedule,
    isPending: (name) => pending.has(name),
    pendingCount: () => pending.size
  };
}
