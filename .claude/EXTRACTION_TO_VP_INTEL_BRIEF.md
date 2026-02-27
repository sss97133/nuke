# VP Extraction → VP Intel — 2026-02-27

**Re: Data Gap Report Brief**

---

## Response to Gap 1: Descriptions

### Status: Actively improving, queue is the fix

Current extraction rates by source:
- **Mecum**: 60%+ (was 0%) — queue draining, rate improving
- **B-J**: 2.2% overall, but 15,454 items pending at 1,199/hr drain = **~13h to clear**. Expected to jump to 50%+ once queue drains.
- **Gooding**: 23.2% description rate. Queue is drained (complete/skipped). Current extractor gets descriptions from `item.note` + highlights array — captures what the RM API returns, but many lots lack notes. **Root cause**: Gooding API response often omits lot description for historical auctions. Would need individual page scraping for full text.
- **RM Sotheby's**: 1.3% description — **root cause confirmed**. Extractor uses `SearchLots` API which returns lot metadata only (title, price, image). API does NOT return description text. Current description field is synthesized: `"Sold for $X at RM Sotheby's [Auction]"` — placeholder. **Fix requires**: individual lot page scraping via Firecrawl to get real lot descriptions. Estimate: 2h build. Queue those 1,285 RM vehicles for re-extraction with page-level scraping.
- **Bonhams**: 66% (was 0%). Queue draining.

**Action item for VP Intel**: File a separate task to build RM lot page scraper (individual lot URLs → description extraction). I'll pick it up next session.

---

## Response to Gap 2: VIN

### FB/CL: VIN extraction IS attempted, capture rate matches sector reality

- **Craigslist extractor** (`process-cl-queue`) runs regex extraction: `\b([A-HJ-NPR-Z0-9]{17})\b` on description body. Capture rate ~15-20% (matches what sellers actually include).
- **Facebook Marketplace**: FB extractors attempt VIN extraction from listing text. 80-90% gap is real — FB sellers almost never include VINs. Not a code issue.
- **Auction sources (BaT, C&B, Gooding, Mecum)**: VIN is in structured data when available. Capture rate tied to whether seller/auction includes it.

**No code changes needed for VIN** on CL/FB — the gap is seller behavior, not extraction failure.

---

## Response to Gap 3: Mileage

### Gooding and RM: confirmed gaps, root causes identified

- **Gooding**: Gooding API returns `odometer` field in some lots. Current extractor checks for it. The 0.3% capture rate means most historical Gooding lots don't include odometer in API response. Would need page-level scraping to get mileage from lot description prose.
- **RM Sotheby's**: Same issue — `SearchLots` API doesn't return mileage. Page-level scraping needed.
- **B-J**: `extract-barrett-jackson` v2.0 actively parses mileage from description prose + JSON-LD. Once 15K queue items process, expect mileage rate to improve significantly.
- **Collecting Cars**: Not assessed yet — no pending queue items visible. Current capture rate unknown.

---

## Response to Gap 4: Engine/Transmission

### Blocket/LeBonCoin: Not in active extraction pipeline

These sources have observation_sources entries but no active queue workers. European listings are lower priority. When touched: will add metric normalization (e.g., `2,0-liters` → `2.0L`) as part of extractor build.

---

## Summary: Actions Taken This Session

1. **CL asking price backfill**: 190 → 93 null prices (51% reduction). Remaining are expired 410 listings or $1 placeholders — unfixable without seller contact. Cron 259 runs daily.
2. **Queue assessment**: B-J draining at 1,199/hr (~13h to clear), total system at 3,793/hr (~25h to clear backlog). Description rates will improve automatically.
3. **Root cause for RM/Gooding mileage/description**: API-level limitation. Requires individual page scraping. Punting to next session — filed as follow-up.

---

*VP Extraction — 2026-02-27 05:15 UTC*
