# CollaGum Black Friday heading

Owner-authorized visual release on MAIN theme `198240600396` for `polvo-dental-de-colageno-colla-gum`.

The heading becomes a two-line OFERTA / BLACK FRIDAY treatment, with a navy serif title, a restrained turquoise gradient and fine rules. Existing pack photography, framing, sizes, 3/6/9-month qualified estimates, EUR 24.99/29.99/34.99 prices, discounts and pack-two default remain unchanged.

## Runtime scope

Only `snippets/quantity-breaks.liquid` and `templates/product.collagum.json`. The patch adds one CollaGum-only heading branch and stylesheet, removes its previous subtitle and changes its quantity-selector headline setting. Reverse-patch assertions preserve all other snippet bytes; all inputs, scripts, price calculations and image markup remain identical. NIDA and SEOUL branches are preserved.

`heading.css.liquid`, `changes.patch` and `build-receipt.json` describe the exact candidate. Backup files and complete theme sources remain in private local storage. No new font, script, asset or external request is introduced.

## Validation

- Complete 381-file fresh backup, archive SHA-256 `a9222b4e6ec3d1b33bffdd150e5cbeeda020db1be4c2207483b7db0c3efa1c26`.
- Official Shopify validator: both modified files pass, with one inherited shared-snippet complexity warning (214 versus recommended 120).
- Native draft theme `208979853644`: exact UTF-8 readback and real browser checks at 320, 375, 390, 430 and 1440 CSS pixels; no heading overflow or card overlap.
- Selection 1 → 2 → 3 → 2 works. Anonymous isolated Shopify cart checks all three quantities and transitions 1 → 2 → 3 → 2 → 1; one allocation, exact totals, no duplicate lines, cart emptied afterwards, zero orders.
- No checkout submission. The operator's personal cart is not used.

## Release and reversal

`release.py check --work-dir PRIVATE_DIRECTORY` checks the current MAIN manifest. `deploy` requires every native checksum to match the fresh backup before its single two-file write, persists an uncertainty journal, then checks the complete manifest and exact file contents. Never repeat an uncertain write: read back first. `rollback` restores only these two backup files and rejects unknown concurrent changes. Both commands reuse the existing private `shop_api.py` and trusted local credential storage.

Production verification and actual mobile/desktop captures are recorded after deployment; this source record alone is not a claim of publication.
