# Operational Truth architecture

The layer is an isolated module of `platform-core`, preserving the modular monolith.

```text
masked fixture facts -> identity validation -> Reality Engine -> Truth Snapshot
connector samples ---------------------------> Connector Health
quality signals -----------------------------> Data Quality
current/VPS snapshots -> Reconciliation Ledger -> Functional Parity
events + historical policies + explicit time -> Operational Replay
all evidence -> Migration Readiness + local read models
```

No component imports network, database, command-execution, AI or production-action clients. C0 produces evidence only. C-CORE Business Graph, Decision Memory and Enterprise Twins remain separate and unstarted.

