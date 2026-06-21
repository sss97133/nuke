The ProWire index exists and is real. It lives in two DB tables plus the scrapers/docs in the repo.

## Where the data lives

**1. `catalog_parts` (Nuke DB) — the primary ProWire index**
- `catalog_sources` row: `ProWire USA`, id `913c5ab2-57b6-41df-87cf-a29416f21e85`, base_url `https://www.prowireusa.com`
- **1,248 ProWire rows** (of 10,853 total catalog_parts across 7 sources; docs cite "9,649 parts" as a stale total)
- 1,235 priced, 1,112 in stock. First scraped 2025-12-06, last updated 2026-05-11
- Schema highlights: `part_number`, `name`, `price_current` (price/ft for wire), `in_stock`, `supplier_url` (deep link to product page), `application_data` jsonb with `stock_qty` (feet in stock) and `source_category_url`
- Breakdown: M22759/32 = 101 SKUs, M22759/16 = 98 SKUs, TXL = 92, M27500 shielded = 37, ~103 Deutsch (DT/HD10/MS3470/positioners), rest = boots, Weather-Pack, fuse boxes (Eaton-Bussmann), ASL/AS connectors, heat shrink

**2. `wire_catalog` (Nuke DB) — curated wire-only table, 107 rows (101 ProWire)**
- Richer wire schema (`mil_spec`, `gauge_awg`, `base_color/stripe_color/color_hex`, `price_per_ft`, `tier`, `supplier_sku`) but thinner coverage: M22759/32 = 89 rows (12–28 AWG, solid colors only, no stripes populated), TXL = 8, M22759/16 = only 4 rows (8/10 AWG, no SKUs). Last updated 2026-04-05. `min_order_ft`, `od_inches`, `strand_count` are mostly NULL.

**3. Repo artifacts**
- Scrapers: `/Users/skylar/nuke/scripts/scrape-prowire-v2.mjs` (current — Firecrawl → catalog_parts), plus older `scrape-prowire-catalog.js`, `-comprehensive.js`, `-full.js`, `-full-catalog.js`, `test-prowire-scraper.js`
- Docs: `/Users/skylar/nuke/docs/wiring/chapters/04-supply-chain.md`, `14-catalog-browser.md`, `WIRING_SYSTEM_KNOWLEDGE.md`; cut lists in `/Users/skylar/nuke/output/wiring/K5-order-list.{md,csv}` and `/Users/skylar/nuke/docs/wiring/output/`
- Edge functions consuming it: `generate-wiring-bom`, `generate-wiring-quote`, `query-wiring-needs`
- No ProWire HTML in `listing_page_snapshots` (0 rows) and no ProWire row in `suppliers`/`supplier_capabilities`.

## Coverage by gauge (catalog_parts, M22759 only — colors per gauge / stock-feet on hand)

| AWG | /16 colors | /16 stock ft | /16 avg $/ft | /32 colors | /32 stock ft | /32 avg $/ft |
|---|---|---|---|---|---|---|
| 2–8 | 14 SKUs | ~1,700 | $5.55–15.80 | — | — | — |
| 10 | 10 | 15,305 | 2.01 | — | — | — |
| 12 | 10 | 20,268 | 1.00 | 10 | 27,908 | 1.52 |
| 14 | 10 | 33,681 | 0.68 | 10 | 71,490 | 0.84 |
| 16 | 10 | 24,986 | 0.47 | 10 | 119,542 | 0.49 |
| 18 | 14 | 52,116 | 0.87 | 12 | 157,006 | 0.48 |
| 20 | 10 | 59,214 | 0.30 | 10 | 242,770 | 0.27 |
| 22 | 10 | 46,232 | 0.23 | 16 | 547,004 | 0.41 |
| 24 | 10 | 26,606 | 0.18 | 13 | 109,427 | 0.29 |
| 26–28 | — | — | — | 20 | 144,755 | 0.18–0.32 |

(>10 colors per gauge = striped variants present in catalog_parts even though wire_catalog has no stripes.)

## Sample actual rows — 16 AWG (harness workhorse)

M22759/32 (thin-wall Tefzel): `/32-16-0` Black $0.480/ft 4,830 ft · `/32-16-2` Red $0.471 **OUT of stock** · `/32-16-3` Orange $0.509 14,806 ft · `/32-16-5` Green $0.509 16,645 ft · `/32-16-7` Violet $0.509 17,720 ft · `/32-16-9` White $0.444 7,283 ft

M22759/16 (medium-wall Tefzel): `/16-16-0` Black $0.380/ft 575 ft · `/16-16-2` Red $0.502 3,035 ft · `/16-16-5` Green $0.495 4,819 ft · `/16-16-9` White $0.543 6,465 ft

Each row carries the live product URL (e.g. `https://www.prowireusa.com/p-422-m22759-16-10-2-red-wire-tefzel-10-awg.html`).

## Honest gaps

- **No spool sizes** — ProWire sells cut-to-length per foot; `min_order_ft` is NULL everywhere and there's no spool-size field anywhere. The only quantity data is feet-in-stock per SKU.
- **wire_catalog is the thin one** — if Skylar remembers a rich normalized wire table, it covers /32 well but has only 4 /16 rows and zero striped colors. The full scrape is in `catalog_parts`.
- **Stock/prices are a snapshot** from Dec 2025–May 2026 scrapes (last touch 2026-05-11), not live. Re-run `scrape-prowire-v2.mjs` to refresh.
- M22759/32 heavy gauges (≤10 AWG) are absent — only /16 covers 2–10 AWG, which matches what ProWire actually stocks.