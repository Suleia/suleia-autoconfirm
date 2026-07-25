function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  url,
  options = {},
  {
    attempts = 3,
    timeoutMs = 15000,
    retryDelayMs = 500,
    shouldRetryResponse = (response) => retryableStatus(response.status)
  } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const signals = [
      options.signal,
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null
    ].filter(Boolean);

    try {
      const response = await fetch(url, {
        ...options,
        signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]
      });

      if (attempt < attempts && shouldRetryResponse(response)) {
        await response.body?.cancel().catch(() => {});
        await wait(retryDelayMs * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || options.signal?.aborted) throw error;
      await wait(retryDelayMs * attempt);
    }
  }

  throw lastError || new Error('Network request failed');
}
