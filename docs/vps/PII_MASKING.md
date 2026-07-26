# PII masking

## Mask before output

- Phone: retain only the last three digits.
- Email: retain first character and domain.
- Address: replace entirely.
- Names: use masked display labels.
- External IDs: hash where business use allows.
- Tokens, secrets, cookies and authorization fields: replace entirely.

## Boundaries

Masking applies before:

- staging persistence;
- MCP responses;
- panel responses;
- logs;
- migration artifacts;
- audit payloads.

## Validation

The fixture validator scans outputs for direct phone and email patterns. Production-grade validation should add a DLP scanner and sampled human review before any real data import.
