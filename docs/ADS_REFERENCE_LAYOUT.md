# Ads overview reference composition

Presentation-only follow-up to the owner's second visual reference, 2026-10-25.
Uses the existing report reader, evidence contracts and supervised executor.

- Twelve compact overview slots in four columns, with actual daily sparklines.
- Weighted spend/value/conversion ratios, attributed AOV, explicit missing reach;
  no example values, fabricated audience sums, zero-filled gaps or profit claims.
- Three independently labelled plot scales for EUR, purchases and ROAS; legend
  toggles and single-metric/comparable-period inspection remain available.
- Funnel, four evidence-backed decision cards and a persistent nonmodal desktop
  analysis pane. Mobile opens the analysis explicitly as a modal.
- Existing additional metrics, denominators, measurement caveats, goals,
  children, history and guarded decision/proposal controls remain accessible.
- Compact filters retain custom dates, explicit comparison dates, product and
  campaign scopes. Replacing a pane must not let its queued close event remove
  the replacement pane's reserved space. Other tabs/views close that analysis.

Synthetic real-Chrome QA covers desktop/mobile layout, real filter interaction,
custom comparison, campaign scope, close/reopen, budget-tab transition, all six
shared navigation views, and historical-action blocking. No external requests,
messages, budget actions or internal decision writes are made by that QA.

Deployment uses `infrastructure/vps/deploy-ads-reference-static.py` with an
explicit hash manifest and the shared deployment lock. It copies the actual
previous static directory and overlays five reviewed assets. Only the static
panel container is recreated. API image/container/environment, Telegram process
and configuration, other containers, import/address observers and preceding
compose files are verified unchanged. Rollback restores the previous static
mount only; it never restores database/ledger/configuration state.
