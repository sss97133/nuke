# extract-craigslist fixtures

Pages for `attributes.test.ts` and `extract.test.ts`. The repo is public, so nothing personal is in them.

- Ten pages (`classic-vin-*`, `modern-vin-*`, `no-vin-*`, `title-*`, `odometer-*`) are built from Craigslist detail pages the
  pipeline had already stored in `listing_page_snapshots` on 2026-10-05 and 2026-10-06. No page was fetched for them.
  The attribute block is the capture's own markup, unchanged except for three things: the area name in the links is
  `sample`, the VIN (where there was one) is a made-up number of the same shape, and the post id is made up.
  Everything around the block is placeholder: title, price, place, photos, coordinates, posting text, phone number,
  email address, post id and times. The posting text carries a VIN-shaped string on purpose, to prove the parser reads
  the attribute row and nothing else.
- `legacy-paragraph-markup.html` is synthetic. Craigslist's pages used `<p class="attrgroup">` before the redesign; no
  capture of that form was available, so the page is written to the shape `scripts/craigslist-import/html-parser.ts` reads.
- The VINs are made up. `modern-vin-17-full-block.html` carries a 17-character VIN with a correct check digit;
  `classic-vin-manual-truck.html` carries a classic 13-character one. The tests build the failing cases from them.
