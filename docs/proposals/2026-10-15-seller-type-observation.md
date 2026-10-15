# Recording seller type as a lot-level observation

Status: implemented 2026-10-15 (supabase/functions/_shared/sellerType.ts; eBay's 1,121 lots written). Owner rule behind it: non-dealer sellers first (1964-1973 and 1974-1991 vehicles from private
sellers rank above dealer stock). The Firecrawl targeting score (`best_v1_1`, docs/ledger/theory/extraction.md) cannot apply that
rule today: `vehicles` and `vehicle_events` carry no seller-type field, `vehicle_events.seller_identifier` is filled only for
BaT (about half of events) and a few Cars & Bids rows, and Craigslist, KSL, eBay and Facebook state the class on the page but
the extractors keep it only in their own working data.

## What to record
One row per lot and per method in `lot_quality_signal` (shipped with best_v1_1), signal `seller_type`:

| value | meaning |
|---|---|
| `private` | the source declares or the page shows a private party (owner) |
| `dealer` | the source declares or the page shows a dealer or business |
| `unknown` | the page does not say |

`evidence` carries the basis, so a declared class is not mistaken for an inferred one:
`{"basis": "declared"|"inferred", "field": "<the source's own label>", "text": "<short quote>"}`. The lane writes it with
`record_lot_quality_signals(rows, written_by)` (service role, at most 500 rows a call, method = the lane or extractor name, never
`lexicon_v1`). A declared value from the source outranks an inference; the dealer-wording signal (`dealer_wording`) is recorded
beside it, because eBay's own "For Sale By" label is a claim: 29% of the listings marked private use dealer wording
(lane-ebay's audit, 2026-10-15). Where the two disagree, `firecrawl_quality_score` counts both checks.

## Where each source states it, and who writes it
| Source | Where it is stated | Writing lane (reads the retained page or feed, 0 credits) |
|---|---|---|
| eBay Motors | "For Sale By" item specific (Private Seller / Dealer); seller name when shown | lane-ebay |
| Craigslist | the owner and dealer feeds (cto vs ctd), the post's own category | the classifieds-capture lane |
| KSL | FSBO vs dealer listing flag in the listing JSON | daily-capture-master |
| Facebook Marketplace | "Seller type" shown on a detail page (`seller_type` / `seller_type_basis` already in the capture runner) | the fb-browser-capture lane |
| Cars & Bids | `sellerType` in the page data (extract-cab-vehicles-playwright already reads it) | lane-online-auctions |
| BaT | the seller's handle against known dealer handles; no declared class | the BaT lane, inferred only |
| Auction houses (Mecum, Bonhams, Gooding, RM, Barrett-Jackson) | consignor is the house or a named consignor; not a seller class | not recorded (unknown) |

## How the score uses it
`quality` in best_v1_1 is the share of known checks a lot passes: no dealer wording, no parts/project wording, VIN not noisy,
not a relist, and (when recorded) `seller_type = private`. A `dealer` seller fails that check; a `private` one passes it. A
source whose lanes record the class therefore gains or loses on it automatically; a source with no record keeps it unknown and
unknown counts 0 in the score, so recording it can only change a source's rank on evidence.

## Not proposed
No column on `vehicles` or `vehicle_events` (the signal belongs to a lot-reading and has a method and a date). No inference
from seller listing counts alone (eBay's audit found 27% of listings carry no seller name).

## Implementation (2026-10-15)
- Storage and writer are the ones this proposal names: `lot_quality_signal` and `record_lot_quality_signals(p_rows, p_written_by)`.
  Nothing new in the schema.
- `supabase/functions/_shared/sellerType.ts` is the lane-facing helper so every lane writes the same shape: `sellerTypeRow(...)` builds one
  row and `recordSellerTypes(supabase, rows, writtenBy)` sends them in chunks of 500 (a failed chunk throws).
- The evidence carries a `confidence` (0 to 1): declared by the source's own field 0.9; inferred from handles, feeds or wording 0.5;
  unknown 0. A `private` class whose own text still uses dealer wording loses 0.4 (floor 0.2) and lists the terms in `wording_terms`;
  a `dealer` class is not lowered. The score counts a lot's class as known at any confidence above 0.
- A lane re-running its read overwrites its own row (key: lot, signal, method), so a changed rule or page re-scores cleanly.
