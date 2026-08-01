# Webhook security boundary

Status: implemented as an unmounted shadow ingress. It is not registered with
Dropea or Chatby and cannot trigger production actions.

Both ingress adapters validate the original raw bytes before parsing JSON.
They require HMAC-SHA-256, constant-time signature comparison, matching topic
and event-ID headers, JSON content type, bounded body size, timestamp window,
schema essentials and technical identity correlation.

Dropea additionally enforces the six documented topics and the ES/IT/PT market
allowlist. Chatby supports only the five required event classes and refuses
`PARTIAL`, `UNKNOWN` or `CONFLICTING` identity.

Validated events are masked, deduplicated and appended to the Event Store
before acknowledgement. Processing is queued after persistence; it never runs
inside the request path. Duplicate deliveries return the existing safe event
and are not queued again.

Customer message text is not persisted in the ingress event. The durable event
contains only presence and HMAC evidence; the verified raw payload is handed to
the asynchronous processor as ephemeral memory and must not be logged.

The Chatby signature/header configuration remains deployment-configurable
because it must be matched against the exact credentials and webhook contract
of the active account before the route can be mounted. Until that verification,
the runtime route remains disabled.
