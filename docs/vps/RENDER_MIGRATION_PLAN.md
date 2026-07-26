# Render migration plan

Render remains the production runtime during the entire staging build.

## Preparation

- Inventory environment variables without copying values into Git.
- Map scheduled jobs, webhooks and health checks.
- Reproduce runtime behavior in simulation with fixtures.
- Keep Render auto-confirmation unchanged.

## Future controlled cutover

1. Freeze code changes for a short window.
2. Verify current Render health.
3. Enable shadow reads to the VPS only after authorization.
4. Compare decisions without writes.
5. Move one non-critical read endpoint.
6. Observe and reconcile.
7. Move production traffic only after a separate approval.

Render must not be suspended or deleted until the rollback window has expired and production acceptance is signed off.
