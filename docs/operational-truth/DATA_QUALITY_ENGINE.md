# Data Quality Engine

Quality issues are immutable, versioned records with order reference, dimension, type, severity, source, first/last observation, masked evidence, blocking flag, remediation and status.

Covered dimensions are completeness, freshness, validity, consistency, uniqueness through explicit issue types, identity, temporal coherence, schema conformity, source reliability, replay reproducibility and lineage. HIGH and CRITICAL issues default to blocking. A CRITICAL issue forces score zero and migration ineligibility.

