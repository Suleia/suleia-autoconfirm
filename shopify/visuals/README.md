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

- Active live theme: `198240600396`; applied and verified on 2026-10-21.
- Dedicated unpublished draft: `208548331852`.
- Preview: <https://suleia.com/products/polvo-dental-de-colageno-colla-gum?preview_theme_id=208548331852>.
- Official Liquid validator revision 2: passed all checks.
- Saved template was read back and matched the proposed body exactly.
- All 379 theme file checksums compared: only `templates/product.collagum.json`
  differs. Within its parsed JSON, only the field named above differs.
- The original custom Liquid, including its existing script, is preserved
  byte for byte; only the product-guarded style is appended.
- Public preview HTML contains the added style and no Liquid errors.
- Owner approved the browser exception for CollaGum design and colors only.
- Desktop preview reviewed at 1536 x 639 and mobile at 390 x 844. Title palette
  and typography, selected pack, prices and stock panel were visually checked.
  No horizontal overflow in either view; screenshots remain private locally.
- The owner opened a working Chrome editor; the existing live field matched
  the fresh API snapshot exactly before editing. Save was initially disabled.
- Applied through that authorized editor and saved at `2026-10-21T18:34:34Z`.
  Live target checksum: `7fb7f3e11bbecd9138d0479cf43b51fd`.
- Fresh before/after comparison of all 379 live files: only the CollaGum
  template changed, with no files added or removed. Its only semantic change
  is the appended custom Liquid. Shopify also lowercased six existing hex
  color strings without changing their values and removed the final newline.
- Read-back confirms the complete original field is preserved byte for byte,
  followed by the exact prepared fragment apart from that final newline.
  The style marker occurs once; the editor has no pending save.
- Public live verification was performed after using Exit preview, with no
  draft preview bar. Desktop 1536 x 639 and mobile 390 x 844 both show the
  intended navy/ice palette, Georgia title and selected pack styling, retain
  the same prices and selected quantity, and have no horizontal overflow or
  Liquid errors. Header and footer remain outside the CSS scope.
- Private screenshots and machine-readable live checks are stored beside the
  backups. The temporary mobile viewport override was reset.

Full theme/template backups and HTML evidence are private local working files,
outside Git, in `shopify-theme-work/collagum-premium-20261021`.

## Rollback

Remove only this appended fragment, from its `{% doc %}` header through its
closing `{% endif %}`. Identify it by `suleia-collagum-premium-20261021` and the
CollaGum product guard. Preserve the original field and later merchant edits;
do not restore a whole historical template or theme.
