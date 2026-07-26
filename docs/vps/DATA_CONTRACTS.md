# Data contracts

## Order event

Required fields:

- `event_id`: globally unique identifier.
- `order_id`: masked staging order identifier.
- `event_type`: normalized event name.
- `occurred_at`: source business timestamp.
- `received_at`: Event Store receipt timestamp.
- `source`: system that supplied the evidence.
- `source_record_id`: hashed source idempotency identifier when available.
- `payload`: masked JSON evidence in memory; persisted as `payload_masked`.
- `deduplication_key`: stable key derived from source and hashed source record.
- `masking_version`: masking contract used before acceptance.
- `run_mode`: always `SIMULATION` in this phase.

Events are append-only. Repeated `source + source_event_id` values must be idempotent.

## Digital Twin

The Order Digital Twin exposes:

- current normalized order state;
- source freshness per connector;
- completeness and contradiction indicators;
- active timers;
- customer-signal evidence;
- incident context;
- prior proposed actions;
- risk gates.

Missing facts remain `UNKNOWN`; they are never converted to negative evidence.

## Decision record

Every result contains:

- `decision_id`;
- `order_id`;
- `policy_version`;
- `route`;
- `proposed_action`;
- `reason_codes`;
- `evidence`;
- `confidence_breakdown`;
- `alternatives`;
- `run_mode = SIMULATION`;
- `actions_executed = 0`.

## MCP response

Every MCP tool returns only masked staging fields. It must not return customer names, full telephone numbers, emails, complete addresses, credentials or raw provider payloads.

Simulation tools always include:

```json
{
  "run_mode": "SIMULATION",
  "actions_executed": 0
}
```
