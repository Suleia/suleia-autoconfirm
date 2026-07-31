# Operational Replay Engine

Replay accepts events, historical policies, timers and a mandatory reference timestamp. It filters events at or before that timestamp, orders them by occurrence time and event ID, selects the policy valid then and invokes a deterministic reducer.

The result hash covers the ordered evidence, historical policy, reconstructed state and reference time. Repeating the call over a clone must produce the same hash. No current clock, external source, network call or database read is available inside replay.

