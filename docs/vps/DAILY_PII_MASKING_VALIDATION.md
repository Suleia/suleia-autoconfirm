# Daily PII masking validation

Date: 2026-07-28

The masking layer covers names, telephone numbers, email addresses, postal
addresses, DNI/NIE, IBAN, card-like values, private links, tokens, notes and
conversation text. Raw source responses existed only in memory.

The final report passed the direct-PII gate before persistence:

- source orders processed: 12;
- PII elements detected and redacted: 39;
- masked order entries persisted: 12;
- direct PII logged: 0;
- `PII_PERSISTED_COUNT=0`;
- report file mode on the VPS: `0600`.

An intermediate execution was rejected before persistence when a free-form
current-system logistics value matched the direct-PII detector. The connector
now maps that field to a closed logistics-state vocabulary; the repeated final
execution passed the gate.

No raw payload, temporary plaintext export or identifier mapping was written.
