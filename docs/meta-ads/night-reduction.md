# Night reduction status

Night reduction is a META-2 policy and META-5 scheduling concern. It is not implemented or simulated in META-1.

The later deterministic implementation must:

- stop scale-up at 22:30 Europe/Madrid;
- capture the authoritative Meta budget at 22:30;
- interpolate monotonically through 22:30, 23:00, 23:30 and 00:00;
- end at EUR 20 only for budgets at or above EUR 20;
- never raise a budget below EUR 20;
- reconcile every real change and prevent duplicate steps.

No Meta budget mutation capability exists in the current module.
