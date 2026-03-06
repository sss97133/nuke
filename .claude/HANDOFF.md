# Handoff — 2026-03-06 Enrichment Campaign

## What I Was Working On
Massive data enrichment and cleanup campaign across all auction sources. User asked to "clean up and enrich, keep it going" after prior session merged 46,912 duplicate stubs and fixed the `get_enrichment_candidates` RPC + Bonhams extractor.

## What's Complete
1. **Bonhams re_enrich**: 1,019 vehicles enriched (queue drained for this 24hr cycle)
2. **RM Sotheby's extractor**: Added `offset` param for batch pagination, deployed v2. 6 of 14 auctions processed (PA26, AZ26, CC26, MI26, S0226, PA25)
3. **BaT paywall discovery**: Confirmed that 21K BaT vehicles with missing prices are blocked by "View Result" paywall on ended auctions — extract-bat-core can't get prices from these pages
4. **DONE.md updated**, scripts committed

## Still Running at Session Close (background tasks)
- **Barrett-Jackson re_enrich** (task b9izse5yp): 3,626+ enriched, ~1,100 prices + ~2,000 VINs, still going
- **Mecum re_enrich** (task b0bjfckyk): 3,498+ enriched, ~1,200 VINs, still going
- **RM Sotheby's batch** (task bjcfvws6i): Processing auction AZ25 (7th of 14)

These background processes may still be running or may have completed/timed out. Check with:
```bash
ps aux | grep "backfill" | grep -v grep
```

## What's Next
1. **Re-run enrichment daily**: Scripts have 24hr cooldowns, re-run tomorrow:
   ```bash
   dotenvx run -- bash scripts/backfill-auction-prices.sh all
   dotenvx run -- bash scripts/backfill-rmsothebys.sh
   ```
2. **RM Sotheby's remaining auctions**: If batch script didn't finish, re-run — saveVehicle does upserts so idempotent
3. **BaT 21K missing prices**: Need BaT API access or logged-in session scraping
4. **Cars & Bids 11K missing prices**: Requires Firecrawl ($$$), no batch re_enrich exists
5. **CZ stubs (~70K)**: Dead ends — no discovery_url. Would need cross-referencing by year/make/model
6. **Remaining gaps by source**:
   - Mecum: 91K missing prices (re_enrich running, many daily cycles needed)
   - Barrett-Jackson: 54K missing prices (re_enrich running)
   - Bonhams: ~18K remaining after this cycle
   - RM Sotheby's: 15K missing (catalog ingest filling some)
   - silver-auctions/leake/kruse/auctions-america: 50K+ combined, no extractors

## Key Files Modified This Session
- `supabase/functions/extract-rmsothebys/index.ts` — added `offset` param
- `scripts/backfill-rmsothebys.sh` — new batch processor for RM auctions
- `scripts/backfill-bat-prices.sh` — new (not effective due to paywall)
- `DONE.md` — updated with session work

## DB State at Session Close
- 1,281,580 total vehicles (non-deleted)
- ~770,780+ with prices (climbing with running tasks)
- ~242,161+ with VINs (climbing fast from BJ/Mecum)
- 46,912 merged duplicates
