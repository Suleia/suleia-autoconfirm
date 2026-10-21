# CollaGum visual finish

Owner-requested cosmetic changes for `polvo-dental-de-colageno-colla-gum`.
Palette: deep navy `#142d47`, ice blue `#edf5f8`, restrained blue `#286582`,
silver borders `#d7e3e9` and muted text `#526774`. Serif headings, softened
pack cards, stock panel, thumbnails, benefit cards and review cards.

## Application

Append `collagum-premium-style.liquid` to the existing value at
`sections.main.blocks.custom_liquid_xMa63b.settings.custom_liquid` in
`templates/product.collagum.json`. Preserve the complete original value.
The Liquid product-handle condition prevents output on other products.
The existing template, content, prices, offers, images, scripts, app settings,
form structure, pack quantities and purchase behavior are unchanged.
No global theme configuration, header, footer or checkout changes.

Do not run template regeneration scripts or replace a live template with an
older draft. Re-read the current live field before applying this append-only
change so later merchant edits are preserved. Do not publish an entire older
theme copy over a changed live theme.

## Current delivery and evidence

- Source/live theme: `198240600396`.
- Dedicated unpublished draft: `208548331852`.
- Preview: <https://suleia.com/products/polvo-dental-de-colageno-colla-gum?preview_theme_id=208548331852>.
- Official Liquid validator revision 1: passed all checks.
- Saved template was read back and matched the proposed body exactly.
- All 379 theme file checksums compared: only `templates/product.collagum.json`
  differs. Within its parsed JSON, only the field named above differs.
- The original custom Liquid, including its existing script, is preserved
  byte for byte; only the product-guarded style is appended.
- Public preview HTML contains the added style and no Liquid errors.
- Live theme files and `updatedAt` (`2026-10-19T11:00:09Z`) remain unchanged.
- Desktop/mobile visual QA and live application are pending owner approval
  for the narrow browser exception required by `AGENTS.md`. The connector
  permits unpublished writes only. No live-write restriction was bypassed.

Full theme/template backups and HTML evidence are private local working files,
outside Git, in `shopify-theme-work/collagum-premium-20261021`.

## Rollback

Remove only this appended fragment, from its `{% doc %}` header through its
closing `{% endif %}`. Identify it by `suleia-collagum-premium-20261021` and the
CollaGum product guard. Preserve the original field and later merchant edits;
do not restore a whole historical template or theme.
