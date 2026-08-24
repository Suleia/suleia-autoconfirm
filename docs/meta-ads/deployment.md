# Deployment status and future plan

META-0/META-1 are not deployed. This is deliberate: the live credential is broader than read-only, the scheduler is not implemented, and later safety phases are incomplete.

The future deployment must add an independent Compose service and systemd units without editing existing order services. Required secret names are documented in `services/meta-ads/.env.example`; values must be provisioned through the VPS secret mechanism and never committed.

Required rollout order:

1. provision a dedicated `ads_read` token and Meta account ID;
2. deploy the read-only image with no public port and read-only filesystem;
3. run one manual authenticated read cycle;
4. verify audit DB role/table permissions in META-3;
5. install separate META-5 timers only after their tests pass;
6. keep `META_ADS_EXECUTION_MODE=SIMULATION`;
7. rollback by disabling only Meta timers and removing only the Meta service.

No existing container, timer, Caddy route, database schema, or Render service changes in META-0/META-1.
