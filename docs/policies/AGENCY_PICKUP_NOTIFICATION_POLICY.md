# Agency-pickup notification policy

A customer message may be proposed only after the carrier has explicitly and
currently confirmed agency pickup.

The proposal is generic and does not include an address, phone number,
customer name, tracking identifier or unverified opening hours. It tells the
customer to consult the carrier notice before travelling.

Simulation output must always contain:

```text
customer_message_required=true
customer_message_proposed=true
customer_message_sent=false
actions_executed=0
```

If carrier evidence is missing, stale or superseded, no message is proposed or
sent.
