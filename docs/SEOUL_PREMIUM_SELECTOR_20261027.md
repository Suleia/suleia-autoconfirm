# SEOUL premium selector — 27 October 2026

Owner authorizes deployment to existing MAIN theme 198240600396 from corrected draft 208994337100. Browser exception explicitly confirmed in chat for Shopify Admin and suleia.com; no real orders or checkout.

Backup: `BACKUP PROD antes selector SEOUL 1988 · 27 Oct`, theme 209070686540. All 379 filename/checksum pairs match MAIN before writing. Existing MAIN remains published; no theme role changes.

Only two target files: `snippets/quantity-breaks.liquid` and `templates/product.seoul_1988.json`. The attached patch is based on fresh production reads, not older repository/theme copies.

The shared snippet adds exactly nine SEOUL handle-guarded lines: three exact hosted pack images, three detail lists and three amount-derived savings. Removing these lines reproduces the production snippet byte for byte, including CollaGum V7 and every other product branch. Existing JavaScript and all discount configuration remain unchanged.

The JSON changes only the existing quantity-selector settings and its existing custom-Liquid block. It transfers the approved ivory/burgundy/champagne selector; exposes the required per-unit prices; removes the contradictory SEOUL-only 3X1 notice; and makes only the SEOUL main product columns stack at 750–989px after a real tablet overflow was found. No other section is replaced.

Preflight: official Shopify Theme Check passes both changed files, with a non-failing complexity warning in the shared snippet. JSON, arithmetic and unchanged JavaScript assertions pass. Real preview checks at 375,390,430,768,1440 CSS pixels pass without page/card overflow, with loaded exact images. Pack2 is selected by default; 1→2→3→1 changes update the radio correctly. Preview console contains no errors.

An isolated storefront cart independently verifies quantity1/2999 cents, quantity2/3499 cents with2499 discount, quantity3/4499 cents with4498 discount. Each test line is removed afterwards; the operator's existing cart is not touched. No order or checkout is submitted.

Production gate re-reads MAIN role, full backup/MAIN manifests and both files; compares source with the validated candidate hashes; then writes only these two files through the existing approved Shopify application. Each write is journaled before the request and immediately read back. Any failure triggers guarded rollback only when the current file still equals the original or this candidate. A separate per-file rollback is prepared for failed public validation and never overwrites concurrent edits.

Deployed at 2026-10-27T19:45:12Z (20:45 Madrid). Fresh GraphQL file readback verifies both files and MAIN role. Full final manifest shows exactly these two changed files and 377 untouched files. The final patch and receipt use the authoritative GraphQL representations.

The first REST file read returned stale pre-write content. An independent GraphQL read proved the snippet write succeeded; it was never repeated. Only the missing template was subsequently written once and verified through GraphQL. No rollback mutation was issued and no theme was published/switched. The guarded rollback now uses GraphQL reads and recognizes both exact deployed hashes in dry-run.

Public verification passes on the real product URL after exiting preview, with no preview bar; an independent anonymous HTML fetch identifies theme198240600396/MAIN and all3SEOUL pack images. All five responsive widths pass in production and console errors=0. CollaGum and NIDA card text/images/default selection/dimensions match the captured pre-deployment references exactly. Independent isolated-cart postchecks again verify all3SEOUL totals, CollaGum pack2=29.99 and NIDA pack2=34.99, then remove all test lines. No orders created and the operator's cart preserved.

Final receipt: `shopify/seoul-premium-20261027/final-receipt.json`. Shared snippet MD5 `48500864fc513983c6665a2ebd21ceba`; SEOUL JSON MD5 `8ef71c799976c1731e9e4626cd0bfe47`. Local backup/rollback/evidence folder: `shopify-theme-work/seoul-premium-deploy-20261027`, outside tracked repository files; it contains no newly created credentials.
