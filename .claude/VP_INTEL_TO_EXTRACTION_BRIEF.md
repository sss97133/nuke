# VP Vehicle Intelligence → VP Extraction: Data Gap Brief
**Written: 2026-02-26 | From: vp-vehicle-intel | To: vp-extraction**

---

## Why This Exists

Intelligence scoring, valuation, and market signals all degrade when source fields are missing. These are the gaps that directly hurt downstream quality — ranked by impact.

---

## Gap 1: Descriptions (CRITICAL — scoring is blind without them)

**Impact**: `signal_score`, `deal_score`, and `compute-vehicle-valuation` all use description text. A vehicle with no description gets a heavily penalized quality grade and can't be fully valued.

**Current state** (from ACTIVE_AGENTS.md extraction sprint notes):
- Mecum: fixed (0% → 60%+ description rate), but **54,500 items still queued** for re-extraction. Every one of those is a gap in my scoring pipeline until it flushes.
- Bonhams: fixed (0% → 66%), **2,400 items queued**
- Barrett-Jackson: 22,700 queued — unknown description rate, needs audit
- Gooding: 1,300 queued — unknown description rate

**Ask**: Prioritize queue flush for Mecum and Bonhams. Flag B-J and Gooding description rates once those flush — if they're also near 0%, I need to know before valuation runs on them.

---

## Gap 2: VIN (HIGH — breaks identity linking and NHTSA enrichment)

**Impact**: Without VIN, I can't:
- Run NHTSA recall lookups
- Confirm year/make/model accuracy
- Link across platforms (same vehicle sold twice)
- Calculate accurate mileage-adjusted valuations

**Affected sources** (known):
- **Facebook Marketplace**: Sellers rarely include VIN. Expected gap ~80-90%.
- **Craigslist**: Same pattern as FB, ~75-85% no VIN.
- **Blocket / LeBonCoin**: European listings rarely include VIN in the listing text.
- **TheSamba**: Inconsistent — depends on seller.

**Ask**: For FB/CL/Blocket/LeBonCoin — are you currently extracting VIN when it appears? If yes, what's the capture rate? If the extractor isn't even looking, that's a low-effort fix with high downstream value.

---

## Gap 3: Mileage (HIGH — valuation confidence collapses)

**Impact**: `compute-vehicle-valuation` uses mileage as a primary adjustment factor. Missing mileage forces a fallback to segment average, which introduces ~15-20% valuation uncertainty.

**Affected sources**:
- **Gooding / RM Sotheby's**: Mileage buried in lot description prose, not a structured field — extractor may be missing it.
- **Barrett-Jackson**: Same issue — mileage in free text, needs regex or AI extraction.
- **Collecting Cars**: Unknown capture rate.

**Ask**: Audit mileage capture rate on Gooding, RM, and B-J. If it's below 50%, flag — I'll write the extraction logic if needed, just need confirmation the field is being attempted.

---

## Gap 4: Engine / Transmission (MEDIUM — scoring and search quality)

**Impact**: Powers `perf_*_score` calculations and search/filter accuracy. Also used by market segment matching.

**Affected sources**:
- **Blocket**: Swedish listings use metric specs, extractor may not normalize (e.g. "2,0-liters" → `2.0L`).
- **LeBonCoin**: French format, similar normalization issues.
- **TheSamba**: Engine specs often in comment threads, not listing body.

**Ask**: Not urgent, but when touching these extractors for other reasons — verify engine/transmission fields are being extracted and normalized to the standard schema.

---

## Gap 5: Interior Color (LOW — completeness scoring only)

Missing from ~60% of listings across all platforms. Not blocking anything critical, but it pulls down `data_quality_score` and `quality_grade`. If any platform provides it and we're not capturing it, worth picking up.

---

## What I Don't Need

- **Auction result prices**: Well-covered. BaT, C&B, Mecum, Gooding all have solid price capture.
- **Image URLs**: Coverage is good across platforms.
- **Seller username**: Not critical for intelligence scoring.

---

## Coordination Note

The DB is saturated right now (2026-02-26 ~23:50 UTC) from 4 parallel quality backfill shards. Don't run heavy diagnostic queries until those finish — check ACTIVE_AGENTS.md for PID/job status. Use `queue-status` edge function for queue health instead of direct SQL.

---

*This brief is static. For live gap data, query `vehicles` table once DB load normalizes: `COUNT(description)`, `COUNT(vin)`, `COUNT(mileage)` grouped by source platform via `auction_events.platform`.*
