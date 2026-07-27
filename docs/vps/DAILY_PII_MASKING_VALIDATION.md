# Daily PII masking validation

Date: 2026-07-27

The masking layer covers names, telephone numbers, email addresses, postal
addresses, DNI/NIE, IBAN, card-like values, private links, tokens, notes and
conversation text. Technical identifiers are pseudonymized and are excluded
from false-positive direct-PII checks.

The final write path performs a direct-PII scan before creating the report and
writes with restrictive file permissions. Raw responses remain in memory and
are not logged, cached or written to temporary files.

Validation tests passed before the preview. The live preview stopped before
reading customer data, therefore:

- direct PII read: none;
- direct PII logged: none;
- direct PII persisted: none;
- `PII_PERSISTED_COUNT=0`.
