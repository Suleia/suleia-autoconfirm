# Action Executor

The Action Executor is the only component that may eventually write to Shopify, Dropea, Chatby or GLS.

It is deliberately not connected and not implemented for production in this phase.

Current invariants:

- `ACTION_EXECUTOR_ENABLED=false`
- every proposal returns `run_mode=SIMULATION`;
- every proposal returns `actions_executed=0`;
- an execution attempt throws before any network call;
- no other new staging service imports production write clients.

Future flow:

Decision Engine -> Risk Gate -> QA Gate -> Authorization Gateway -> Action Executor -> Verification -> Reconciliation.

Enabling it requires a separate design review, connector-specific idempotency tests and explicit production authorization.
