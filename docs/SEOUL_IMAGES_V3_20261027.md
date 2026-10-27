# SEOUL V3 pack photos — 27 October 2026

Owner authorizes production deployment of the newly updated draft208994337100 to existing MAIN198240600396. Fresh file reads show identical SEOUL JSON templates and exactly two changed lines in the shared quantity snippet. Only the two owner-specified pack2/3 image URLs change to `seoul-pack-2-tight-centered-v3.png?v=1793131337` and `seoul-pack-3-tight-centered-v3.png?v=1793131344`.

Candidate is constructed from the current live snippet and compared byte-for-byte with the freshly read draft. All changes are within existing `product.handle == 'crema-seoul-1988'` guards. The CollaGum branch/V7 marker and every other byte remain intact; pack1 image, CSS/object-fit containment, JavaScript, prices, discounts, text, default pack2, templates and theme role are unchanged.

Backup209070686540 still exists. A new exact current-file backup plus all379filename/checksum pairs is stored locally under `shopify-theme-work/seoul-images-v3-20261027/backup`, preserving the newer CollaGum social block and preceding SEOUL release. Original snippet MD5 `48500864fc513983c6665a2ebd21ceba`; V3 candidate MD5 `9c934494d8649150066da3834387acb5`.

Both exact supplied images were inspected: two adjacent centered full tubes, and a compact centered group of three full tubes. No images generated or altered. Official Shopify Liquid validation passes with only the existing shared-snippet complexity warning. Fresh GraphQL preflight checks MAIN and source plus protected SEOUL/CollaGum templates before one journaled file write. Readback uses GraphQL, not potentially stale REST asset reads. No mutation retries; exact-file guarded rollback is prepared for failure.

Deployed at2026-10-27T20:19:08UTC (21:19Madrid); fresh GraphQL readback verifies exact candidate. Final complete manifest: only the shared snippet changed,378otherfiles identical. SEOUL JSON remains8ef71c799976c1731e9e4626cd0bfe47; current CollaGum JSON/social remains0b0b758898104f0c54610a3630b7ce5d.

Public page checked after hard refresh; independent anonymous HTML confirms MAIN198240600396, both exact V3 URLs and no old pack2/3V2 URL. All3images loaded, object-fit contain and position50%50%, complete/centered without overflow at actualCSS375/390/430/768/1440. Badges and prices visible, pack2 default, transitions1→2→3→1 verified. Console errors0; only the existing Liquid complexity warning.

Fresh isolated native carts confirm quantities1/2/3, totals29.99/34.99/44.99, discounts0/24.99/44.98. Tests remove all their lines, never touch operator cart and create0orders. CollaGum and NIDA pack2carts29.99/34.99 pass. CollaGum V7 text/photos/prices/selection/dimensions and its new illustrative social block match fresh pre-change references at375and1440; NIDA reference likewise unchanged at1440.

Final receipt: `shopify/seoul-images-v3-20261027/final-receipt.json`; local mobile/desktop screenshots under the evidence folder. No other theme, template, pricing rule, global cart/checkout, app, campaign, automation or message changed.
