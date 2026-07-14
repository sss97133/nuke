# /valuation page — first ship

Date: 2026-05-26
Agent: Claude (Opus 4.7, autonomous build session)

## What shipped

A public `/valuation` page that answers: *"what's a {year} {make} {model} worth on BaT, and show me proof."*

Input: year (optional), make (required), model (optional prefix). Output: median sale price + P10/P90 range + sold count + last sale date + avg bid/comment counts + 10 most-recent comparable sold listings with BaT URLs.

Surface area is intentionally tiny: one page, one RPC, no new tables, no edge function.

## Why this and not the other approaches

Past attempts (drill-down, treemap, classifieds, traditional listing grid) all exposed *the dataset* — they didn't *answer a question*. With 4.2M bids / 13.9M comments / 157K listings, "explore this" is a worse experience than not having anything. This page picks one question and answers it directly. Comment intelligence, market trends, seller patterns can be layered later from telemetry — not guessed-at upfront.

The valuation infrastructure that already exists (`nuke_estimates`, `compute-vehicle-valuation`, `vehicle_valuation_feed` MV) is per-vehicle, not per-YMM. No bridge existed between "what does this specific chassis sell for" and "what does a 1989 Ferrari 328 typically sell for." This adds that bridge using **real BaT sold prices**, not algorithmic estimates.

## Files added/changed

| File | Change |
|---|---|
| `supabase/migrations/20260526040000_valuation_by_ymm_rpc.sql` | NEW — RPC `valuation_by_ymm(year, make, model)` returning `{query, stats, comparables}`. Applied to prod successfully. |
| `nuke_frontend/src/pages/Valuation.tsx` | NEW — search form + result card + comparables table. Honors design system (Arial, 2px borders, no radius/shadows, all-caps labels). |
| `nuke_frontend/src/routes/DomainRoutes.tsx` | EDIT — added lazy import + public route `/valuation`. Two surgical edits, ~2 lines each. |

## Data quality flags surfaced in the build (not fixed here)

These are real and should get a separate cleanup pass before this surfaces in any nav/seo path:

1. **$100M EBR motorcycle typo** — listing `bringatrailer.com/listing/2012-ebr-erik-buell-racing-1190rs-carbon-edition` has `sale_price = 100000000`. Skews any aggregate. RPC marks results as `possible_outlier=true` when max > 5× median, but the underlying row is bad. One-line fix: `UPDATE bat_listings SET sale_price = NULL WHERE sale_price >= 99000000;` (with batching per Hard Rule #8).
2. **listing_status field is broken** — 66,746 rows tagged `ended` are actually no-sales (sale_price=0). Should be `no_sale`. RPC ignores rows where `sale_price <= 0` so this doesn't affect the page, but it's misleading anywhere else that uses `listing_status`.
3. **Top sales have NULL `bat_listing_title`** — the join to `vehicles.year/make/model` recovers the make/model. The title scraper has gaps on high-value listings specifically.
4. **`vehicles.model` parser anomaly** — at least one row has `model = "a Trailer"` (URL fragment). Spot-check via `SELECT make, model FROM vehicles WHERE model LIKE '%Trailer%' LIMIT 10;`

## Scraper freshness

`bat_listings` newest row: 2026-03-13. `bat_bids` / `auction_comments` newest: 2026-04-13. Scrapers have been silent for 6-10 weeks. The valuation page is **historical**, not live. That's fine for "what does it sell for" — sale prices from 2014-2026 are still the market. Not fine for "what's hot right now."

## What I did NOT do (deliberate)

- **Did not** create a materialized view for YMM aggregates. A function works fine for single-YMM lookups (the index `idx_vehicles_ymm` covers it). MVs would help if we add a "browse common valuations" surface, but YAGNI.
- **Did not** touch `nuke_estimates`, `vehicle_valuation_feed`, the treemap MVs, or `compute-vehicle-valuation`. They're per-vehicle, this is per-YMM. Different products.
- **Did not** clean up the data quality issues. Separate receipt-worthy work; flagged above.
- **Did not** wire `/valuation` into navigation. Up to Skylar whether to surface it in the header, nav drawer, or just leave it as a direct-URL surface for now.
- **Did not** add SSR / prefetch / sitemap entry. McMaster targets in `.claude/rules/frontend.md` say it should be SSR-fast eventually, but this page doesn't have to ship that for a first cut.
- **Did not** instrument telemetry. Should add events for search queries + result clicks when telemetry table is sorted out (see Section: Next steps).

## Verification done

| Check | Result |
|---|---|
| RPC applied to prod | ✓ `CREATE FUNCTION` succeeded |
| RPC works via psql (service role) | ✓ 1989 Ferrari 328: 27 sold, median $121K |
| RPC works via PostgREST (anon key — what frontend uses) | ✓ Same data, same shape |
| `tsc --noEmit` on Valuation.tsx | ✓ No errors |
| Vite serves `/valuation` | ✓ HTTP 200 |
| Browser screenshot | ✗ Permission denied (user away) — Skylar should verify visually |

## Test cases for visual verification

When you (Skylar) sit back down, hit these URLs on localhost:5174 to confirm:

```
http://localhost:5174/valuation                                  → empty state with example links
http://localhost:5174/valuation?year=1989&make=Ferrari&model=328 → 27 sold, $121K median, outlier warning
http://localhost:5174/valuation?year=2015&make=Porsche&model=918 → high-end sports car
http://localhost:5174/valuation?year=1995&make=Toyota&model=Land+Cruiser → volume play
http://localhost:5174/valuation?year=2020&make=Ford&model=Bronco → 0 sold (gen6 didn't ship til 2021)
http://localhost:5174/valuation?make=Lamborghini&year=2010      → 1 sold (works with year-only + make)
```

## Deploy to production

The RPC is **already on prod** (applied via direct psql connection during the build). Frontend deploy is normal Vercel:

```bash
# From /Users/skylar/nuke
git add nuke_frontend/src/pages/Valuation.tsx \
        nuke_frontend/src/routes/DomainRoutes.tsx \
        supabase/migrations/20260526040000_valuation_by_ymm_rpc.sql \
        docs/library/working/2026-05-26_valuation-page-ship.md
git status   # review
git commit -m "feat(valuation): /valuation YMM lookup page + RPC"
git push     # triggers Vercel build
```

The migration file is committed for source-of-truth even though the function is already live — so a fresh DB rebuild includes it.

## Next steps (in priority order, ALL optional)

1. **Visual QA** — load each test URL, make sure layout reads well on mobile (we built for desktop layout; the grid will reflow but check).
2. **Data quality cleanup** — see flags above. The $100M typo is the highest-impact single fix (one-row update).
3. **Telemetry** — once the events table is settled, log `valuation.search` (year/make/model entered) and `valuation.comparable_click` (which BaT listing they opened). After ~2 weeks of self-use, the search log answers "what should we build next."
4. **Make/model autocomplete** — the free-text fields are friction. A simple datalist sourced from `mv_treemap_models_by_brand` would speed up usage. Maybe 30 lines.
5. **Add SEO** — once the page reads well, give it a `<title>{year} {make} {model} BaT valuation – Nuke</title>` and a meta description. People Google "1969 Camaro worth" — this could rank.
6. **Hook into vehicle profile** — vehicle pages could show "this 1989 Ferrari 328 sold for $X — median is $Y" as context, by calling the same RPC. Reuses the work.
7. **Surface in nav** — if it's useful in solo testing, add `/valuation` to whatever the public nav is.

## What I'd push back on if asked to keep building

Don't expand the page until there's evidence (telemetry or feedback from a real user) that the current surface is too thin. Resist the urge to add charts, sliders, "trending YMMs", related-vehicles widgets. Each one is a separate bet. Ship one, measure, then bet on the next.

## Sources / context

- Past attempts pattern: PROJECT_STATE.md (sprint history), DONE.md
- Existing valuation system: `supabase/functions/compute-vehicle-valuation/`, `nuke_frontend/src/hooks/useNukeEstimate.ts`, `nuke_frontend/src/services/vehicleValuationService.ts`
- Existing MVs: `supabase/migrations/20260215300000_treemap_materialized_views.sql`, `20260208_d_vehicle_valuation_feed.sql`
- Data quality findings: BaT analysis during 2026-05-26 session against local restored DB (SSD: `/Volumes/NukePortable/pgdata`, currently ejected — should remount before next analytical pass)
