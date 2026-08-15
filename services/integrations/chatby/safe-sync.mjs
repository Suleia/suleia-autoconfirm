const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_:-]{0,95}$/;

export function chatbyErrorCode(error, fallback = 'CHATBY_READ_FAILED') {
  const candidate = String(error?.code || error?.error || fallback).trim().toUpperCase();
  return SAFE_ERROR_CODE.test(candidate) ? candidate : fallback;
}

export async function syncChatbyWithRecovery({ projector, sync }) {
  let result;
  try {
    result = await sync();
  } catch (error) {
    result = Object.freeze({
      ok: false,
      enabled: true,
      consultable: false,
      error: chatbyErrorCode(error),
      actions_executed: 0,
      production_writes: 0,
      messages_sent: 0
    });
  }

  if (result?.ok === true) return result;

  const errorCode = chatbyErrorCode(result, 'CHATBY_READ_INCOMPLETE');
  const sourceStatus = result?.consultable === true ? 'DEGRADED' : 'UNAVAILABLE';
  try {
    await projector.recordSourceFailure?.({ source: 'chatby', status: sourceStatus });
  } catch {
    return Object.freeze({
      ...result,
      error: errorCode,
      freshness_persisted: false,
      actions_executed: 0,
      production_writes: 0,
      messages_sent: 0
    });
  }
  return Object.freeze({
    ...result,
    error: errorCode,
    freshness_persisted: true,
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0
  });
}
