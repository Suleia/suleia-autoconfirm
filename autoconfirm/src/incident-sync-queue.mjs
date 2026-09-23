// The scheduler and authenticated recovery endpoint share one execution.
// Different scopes are serialized, so their provider reads cannot overlap.
export function createIncidentSyncQueue(run) {
  const pending = new Map();
  let tail = Promise.resolve();
  return (options = {}) => {
    const key = JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
    if (pending.has(key)) return pending.get(key);
    const result = tail.then(() => run(options));
    pending.set(key, result);
    tail = result.catch(() => {});
    const release = () => pending.delete(key);
    result.then(release, release);
    return result;
  };
}
