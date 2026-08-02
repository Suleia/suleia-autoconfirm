export function normalizeSpanishOperationalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^[6789]\d{8}$/.test(digits)) return `+34${digits}`;
  if (/^34[6789]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0034[6789]\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  return null;
}

export function evaluateOperationalTestPhone(value, { enabled, testPhoneNormalized }) {
  if (!enabled) return { matched: false };
  const phone = normalizeSpanishOperationalPhone(value);
  const protectedPhone = normalizeSpanishOperationalPhone(testPhoneNormalized);
  if (!phone || !protectedPhone || phone !== protectedPhone) return { matched: false };
  return {
    matched: true,
    classification: 'TEST_ORDER',
    route: 'HUMAN_REVIEW_TEST',
    automaticConfirmationAllowed: false,
    executionAllowed: false,
    releasitBlockAllowed: false
  };
}
