# Address import recovery — phase1 receipt

25 October 2026, PR150 stacked on BI V2 PR149. Deployed runtime
`2868d39f66c6c56a7a0fbb3450994899c311845a` at **13:24:27 UTC**;
independent post-verification **13:26:22 UTC**. Only SHADOW observation and its
read-only card/view are active. **No live address correction, Chatby send or
reimport has been connected/enabled.**

## What is actually active

- `suleia-address-import-recovery-shadow.path`, triggered only when the existing
  **provider-rejections.jsonl** changes. Successful imports/reports do not trigger
  the observer. No additional importer, hourly polling or normal-flow preflight.
- A dedicated unprivileged oneshot, private network namespace, restricted to
  Unix sockets, CPU10%, memory128MiB, low scheduling priority. All three write
  flags false; SHADOW entrypoint rejects any write flags and has no provider
  credentials or live adapters.
- Dedicated encrypted recovery SQLite, exact case/generation uniqueness and
  contact-free projection. Healthy/no-failure input creates no state directory,
  DB, case, projection or claim. Initial observation uses already persisted errors.
- Existing OAuth API with a read-only projection mount; no private DB/key mounted
  into the API. `Errores de importación` opens
  [Import Recovery](https://mcp.suleia.com/operations/#import-recovery).

## Verified evidence

Final isolated Node22/PostgreSQL17 regression: **1,381 passed, zero failed/skipped,
147 files**, archive
`e758338ed5eed38c47f0513443b79f5c777b9146db2b85d834f1958611e53a2e`.
Includes46new recovery/panel tests and all28unchanged PR117 importer tests.
No network or production credentials were supplied to tests. Shopify2026-04
shipping-only mutation validates against the official schema. Default image UID100
imports API code; real UID100 can read the sanitized projection without private
fields. Fixture write-engine tests are not a real address/import canary.

The first deployment attempt (630794a) exited without a report because the CLI's
entrypoint compared a real module path to the `current` symlink path. Automatic
rollback restored the captured BI V2 API/static. Fixed with realpath comparison
and an actual child-process/symlink regression. The final path trigger was also
restricted to the persisted rejection stream; it does not wait for the later
result append. Final code, including both regressions, passes the complete suite.
No uncertain provider effect, key or database was discarded to retry deployment.

At the verified cut there are3ADDRESScases (2coverage reviews,1potential address
recovery) and1NON_ADDRESScase. Auto-corrected0, customer-required0, recovered0,
duplicates-prevented0. These are **observed failure cases**, not freshly verified
absence from Dropea or successful recoveries. Phase1 intentionally makes no
provider requests. A second local observation creates0cases and leaves all
metrics stable; zero effect claims and zero leases. Legacy action/rejection logs
are byte-for-byte unchanged by these observations.

Original importer/recovery release remains `3bd8626e028a3f353b39a25cd6e9920b5a47716d`.
Its two source hashes, live environment, service and hourly timer are unchanged.
Natural13:05UTC run completed with244scanned/224already present/19blocked/1provider
rejection; no second import cycle was run. Previous12:05run completed242/222/19/1.
These are different live populations, not a controlled latency/import-rate test.
Source/module isolation plus zero new provider requests establishes no added
normal import code path or quota use; no production latency SLA is claimed.

Seven API/static overlays and all seven worker/unit source files verify against
the manifest. Nineteen protected budget files, operational environment except
the build metadata/read-only projection path, botPID/config, financial tariffs,
MCP/materializer and all unrelated compose IDs are preserved. Render was not
deployed. No Meta policy, customer action, normal template/flow or paid OpenAI
usage was added. These checks do not certify existing budget/incident autonomy.

HTTPS health/page/config/new3assets:200/no-store; unauthenticated recovery API:401.
Config enables the new card. Existing authenticated GET/POST denial contracts and
actual DOM rendering are tested; this release did **not** open a browser or claim
a new production visual screenshot. Existing six-section sidebar is unchanged.

## Release and rollback

API image: `suleia-address-import-recovery:2868d39`,
`sha256:ac40cc50b6e4e23db381b16b4badc9b0988e396bf58b68085bacaaf4e6a9202e`.
Panel: `/opt/suleia-panel-releases/address-import-recovery-2868d39`.
New additive API/panel overlay:
`/etc/suleia/address-import-recovery-panel-runtime.json`.
Worker: `/opt/suleia-address-import-recovery/releases/2868d39f66c6c56a7a0fbb3450994899c311845a`.
Private backups/intention/apply/post receipts and standalone guarded rollback:
`/root/suleia-address-import-recovery-deploy/2868d39/`.

Rollback uses that directory's `deploy.py rollback <directory>/manifest.json` as
root. It checks this exact release is still current, preserves the private DB,
key/claims, disables/stops only the new observer and restores captured BI V2 API
and static. Do not use a historical V11/SHADOW budget rollback or alter the
existing Shopify importer timer. Normal importing is independent of the observer.

## Remaining phases

Connect/prove an authoritative full-address resolver; current-order Chatby
evidence, existing template ledger and reply parsing; and the existing import
builder/same-order reservation plus native-retry quiescence. Preserve source
contacts with a real Shopify-address canary before enabling phase2. The current
engine tests these contracts with fixtures; they are not configured live ports.
Only after the corresponding phase's acceptance can its independent write flag
and production worker be enabled. Coverage rejection never authorizes replacing
a valid CP, and a guessed confidence never authorizes an address change.
