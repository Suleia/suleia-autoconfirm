# CollaGum social block — 27 October 2026

Owner authorizes production update of only `social_proof_widget_p4q4TN` in `templates/product.collagum.json`, MAIN theme198240600396. Keep the published theme, all prices, pack selector, cart, checkout, Dropea, NIDA and SEOUL unchanged.

Fresh Shopify files identify three already-hosted decorative assets: `collagum-social-avatar-1.png`, `collagum-social-avatar-2.png`, `collagum-social-avatar-3.png`, uploaded27October18:42UTC. Visual inspection confirms two distinct women and one man. No images generated, altered or newly uploaded by this task.

The existing shared snippet unconditionally calls portrait images verified customers and prints a count even when its random animation is disabled. To satisfy the owner's honesty requirement without editing that global snippet, the existing block id/order is preserved and only its value becomes a custom-Liquid block. All markup/styles stay guarded by the CollaGum handle and unique `cg-social-proof-p4q4TN` id.

Compact light-blue background, overlapping circular portraits and neutral brand message: `Sonríe cada día con CollaGum`, with `Retratos ilustrativos`. Decorative images have empty alt text and are hidden from the accessibility tree; the visible illustrative label prevents a customer/testimonial implication. No customer names, verified badges, purchase counts, invented numbers or JavaScript in this block. No live purchase-count source is connected to this theme block, so the neutral message is used.

Exact current-template backup is saved outside Git under `shopify-theme-work/collagum-social-live-20261027/backup/product.collagum.json`; MD5 `2e5b03fb5492eb6a73cf1be3c08248ec`. All379theme filename/checksum pairs are also captured. This is a targeted file backup, not a replacement/published theme. Shared snippet baseline MD5 `6adfcec9d7e6e5404ba7e9527e52e156`.

Preflight: official Shopify Theme Check passes the generated Liquid and complete candidate JSON against fresh section/locale context. JSON parsing and exact object/byte checks prove only this block changes. An isolated local preview verifies loaded portraits, overlap and no overflow at375/390/430/768/1440CSSpixels; block height56px mobile,62px desktop. No other Shopify theme was edited for preview.

Production writer freshly compares the full target template and shared snippet, journals before a single request, writes only the target file, and verifies via fresh GraphQL reads. No write retries. Concurrent edits abort; failed verification restores only the unchanged original/candidate file under exact guards. Final public checks/receipt follow execution.
