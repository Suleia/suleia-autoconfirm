# V3 validation continuation — 31 October 2026

PR181/182/183 remain staged candidates. This updates the initial report's release
limitations; exact final test/runtime receipts belong in the Agent Hub. No
conditional deployment or real canary is implied by a source/test commit.

The immutable canonical corpus hash is
`b2a56686413d99dd74aef8c90daa5f084ba59aa5ce58a610b67674ab5e2228c2`.
All 380 real cases remain: 345 scored historical cases, 32 historically active
cases requiring independent current validation and three insufficient-context
cases. Synthetic grammar regressions never count toward this real-case cohort.

Exactly thirteen discrepancies were privately audited: seven code corrections,
one code-and-expectation correction, one expectation correction, and four
explicitly unresolved ambiguities requiring human review. Five expectation
records change in a separately encrypted annotation version. The private audit
retains expected/actual facts, supersession, missing information, root causes,
individual rationale and old/new expectations. No private conversation is in Git.

Against unchanged frozen expectations, parser corrections reach 340/345 cases and
131/132 temporal projections (99.24%). Reviewed annotations yield 341 closed and
four explicitly unresolved cases, and 131/131 temporal projections. The denominator
loses one current-clock assertion because that clock had already expired; an
expiry assertion replaces it. These are different annotation versions, not an
unqualified claim of 100%. Explicit order/return recall stays 271/271 and 25/25.
The complete replay must be repeated on final source revisions.

Corrections preserve qualified tomorrow versus morning, negation token
boundaries, positive availability beside a denied attempt, recurring afternoons
versus morning work, bounded literal recurring availability/expiry, reported
receipt supersession, existing retry facts and contextual pickup consent.
No new intent, framework, model, owner, scheduler, gateway or writer is introduced.

A native pending-issue scan on 31 October 08:07–08:09 UTC found 33 cases with fresh
exact order/issue/Chatby association/conversation reads. GET/HEAD-only enforcement
recorded zero customer messages, provider writes or claims. The historical local
list of 32 is not used as current authorization. Current comparison additionally
found a product question retaining an old refusal and a waiting clarification
exposing actionable intent. Both now block operational projection conservatively;
old facts remain auditable. Re-run the comparison before the release decision.

`evaluatePreCanaryGate` requires real/reviewed provenance, zero safety violations,
full explicit-intent/owner scores, temporal accuracy strictly above 98%, current
replay, executor reconciliation contract and unknown-execution no-retry tests.
It does not require an observed canary or invent an observed blind-retry zero.
`evaluatePromotionGate` separately requires a real exact canary, exactly one send,
provider receipt, readback, fresh evidence and zero wrong-recipient/duplicate/
blind-retry/uncertain-replay counters, for that capability alone. Global LIVE
cannot bypass the explicit single-case canary path.

VPS integration tests exercise the existing sender's journal before POST, waiting
through later cycles, durable-store failure, WAMID/readback and natural inbound
consumption. Tests are not production canaries. PR182 uses the existing care
policy when runtime input omits a policy, preserving its date/window requirements.
Its reconciliation is an ordinary merge with the deployed accepted-discount
baseline; all five hotfix runtime modules remain identical to that baseline.

Only evidence-complete pre-canary PASS admits the authorized SHADOW stage: legacy
plans remain authoritative, V3 only compiles/persists/compares, and clarification,
status and semantic flags stay false. Several natural 30-minute cycles must show
stable reads, latency, owners, claims and memory before PR183 read-only projection.
Only a naturally eligible exact single-missing-fact case may receive the first
clarification. No eligible case means no canary. Unknown delivery cannot replay.
External model consumption remains 0 USD.

Retain exact prior images and control hashes for rollback. Disable V3/restore the
prior image without deleting persistent memory, claims or uncertain journals.
Final SHA tests and conditional runtime evidence must be reported separately.
