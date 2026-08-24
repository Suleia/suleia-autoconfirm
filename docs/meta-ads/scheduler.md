# Scheduler status

No Meta schedule is installed in META-0/META-1.

The VPS audit found:

- the Compose `scheduler` is a documented `NOT_IMPLEMENTED` placeholder;
- the existing systemd timer is dedicated to the historical Render order automation and must not be reused or changed;
- no persistent sleeping Node process is acceptable.

META-5 must introduce separate systemd timer/service units for hourly reads, 22:30, 23:00, 23:30, and 00:00 Europe/Madrid boundaries. Units must use persistent catch-up deliberately, locking, bounded runtime, restart-safe audit state, and a distinct service account. Until then scheduler readiness is `NO-GO`.
