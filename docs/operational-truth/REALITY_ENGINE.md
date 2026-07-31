# Reality Engine

`RealityEngine.buildTruthSnapshot` groups facts by type, checks declared timestamps and validity, compares masked values across sources and keeps observation distinct from verification.

- One source remains `OBSERVED`.
- Concordant active facts from at least two sources with event evidence become `VERIFIED`.
- Different values become `CONFLICTING`.
- Expired facts become `STALE`.
- Missing sources and non-exact identities create explicit blockers.

It never modifies a source. Confidence is the explainable arithmetic mean of declared fact confidence; it cannot override a blocking condition.

