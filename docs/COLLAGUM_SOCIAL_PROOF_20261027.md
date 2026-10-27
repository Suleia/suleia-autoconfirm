# CollaGum social block — 27 October 2026

Owner authorizes production update of only `social_proof_widget_p4q4TN` in `templates/product.collagum.json`, MAIN theme198240600396. Keep the published theme, all prices, pack selector, cart, checkout, Dropea, NIDA and SEOUL unchanged.

Fresh Shopify files identify three already-hosted decorative assets: `collagum-social-avatar-1.png`, `collagum-social-avatar-2.png`, `collagum-social-avatar-3.png`, uploaded27October18:42UTC. Visual inspection confirms two distinct women and one man. No images generated, altered or newly uploaded by this task.

The existing shared snippet unconditionally calls portrait images verified customers and prints a count even when its random animation is disabled. To satisfy the owner's honesty requirement without editing that global snippet, the existing block id/order is preserved and only its value becomes a custom-Liquid block. All markup/styles stay guarded by the CollaGum handle and unique `cg-social-proof-p4q4TN` id.

Compact light-blue background, overlapping circular portraits and neutral brand message: `Sonríe cada día con CollaGum`, with `Retratos ilustrativos`. Decorative images have empty alt text and are hidden from the accessibility tree; the visible illustrative label prevents a customer/testimonial implication. No customer names, verified badges, purchase counts, invented numbers or JavaScript in this block. No live purchase-count source is connected to this theme block, so the neutral message is used.

Exact current-template backup is saved outside Git under `shopify-theme-work/collagum-social-live-20261027/backup/product.collagum.json`; MD5 `2e5b03fb5492eb6a73cf1be3c08248ec`. All379theme filename/checksum pairs are also captured. This is a targeted file backup, not a replacement/published theme. Shared snippet baseline MD5 `6adfcec9d7e6e5404ba7e9527e52e156`.

Preflight: official Shopify Theme Check passes the generated Liquid and complete candidate JSON against fresh section/locale context. JSON parsing and exact object/byte checks prove only this block changes. An isolated local preview verifies loaded portraits, overlap and no overflow at375/390/430/768/1440CSSpixels; block height56px mobile,62px desktop. No other Shopify theme was edited for preview.

Production writer freshly compares the full target template and shared snippet, journals before a single request, writes only the target file, and verifies via fresh GraphQL reads. No write retries. Concurrent edits abort; failed verification restores only the unchanged original/candidate file under exact guards.

Deployed and GraphQL-verified at2026-10-27T20:06:48UTC (21:06Madrid). Final template MD5 `0b0b758898104f0c54610a3630b7ce5d`. A complete post-deployment manifest proves exactly1file changed and378files remain byte-identical, including the global social snippet, pack selector, SEOUL and NIDA templates, cart/checkout files and global configuration. JSON semantic and prefix/suffix checks prove all other CollaGum blocks/order/settings remain identical.

Anonymous public HTML identifies MAIN198240600396 and all3exact portrait URLs with the illustrative label and no counter/verification claims. Real browser checks pass for loaded images, overlap and block fit at375/390/430/768/1440CSSpx; console errors0. Pack text/photo/amount/default selection/width/height match the pre-change reference exactly at375and1440px. An initial JSON-string comparison differed only because object keys were ordered differently; explicit card-field comparisons pass.

At768px, the unchanged pack selector extends to846px while this new social block fits within425–700px. This is outside the social block and the owner explicitly forbids pack-selector changes, so it was not altered. No page-overflow claim is made for that tablet width. Mobile375/390/430and desktop1440have no page overflow.

Final evidence: `shopify/collagum-social-20261027/final-receipt.json`; local mobile/desktop screenshots under the backup/evidence folder. The temporary loopback preview server was stopped. No whole theme published, no other theme edited, no images generated, no orders/cart operations/messages/campaign actions.
