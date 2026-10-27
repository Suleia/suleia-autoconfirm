# SEOUL V3 pack photos — 27 October 2026

Owner authorizes production deployment of the newly updated draft208994337100 to existing MAIN198240600396. Fresh file reads show identical SEOUL JSON templates and exactly two changed lines in the shared quantity snippet. Only the two owner-specified pack2/3 image URLs change to `seoul-pack-2-tight-centered-v3.png?v=1793131337` and `seoul-pack-3-tight-centered-v3.png?v=1793131344`.

Candidate is constructed from the current live snippet and compared byte-for-byte with the freshly read draft. All changes are within existing `product.handle == 'crema-seoul-1988'` guards. The CollaGum branch/V7 marker and every other byte remain intact; pack1 image, CSS/object-fit containment, JavaScript, prices, discounts, text, default pack2, templates and theme role are unchanged.

Backup209070686540 still exists. A new exact current-file backup plus all379filename/checksum pairs is stored locally under `shopify-theme-work/seoul-images-v3-20261027/backup`, preserving the newer CollaGum social block and preceding SEOUL release. Original snippet MD5 `48500864fc513983c6665a2ebd21ceba`; V3 candidate MD5 `9c934494d8649150066da3834387acb5`.

Both exact supplied images were inspected: two adjacent centered full tubes, and a compact centered group of three full tubes. No images generated or altered. Official Shopify Liquid validation passes with only the existing shared-snippet complexity warning. Fresh GraphQL preflight checks MAIN and source plus protected SEOUL/CollaGum templates before one journaled file write. Readback uses GraphQL, not potentially stale REST asset reads. No mutation retries; exact-file guarded rollback is prepared for failure.

Public responsive/cart/regression receipt follows execution; preflight is not a completion claim.
