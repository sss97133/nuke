# ConceptCarz Data Investigation

**Date:** 2026-03-04
**Scope:** All `vehicles` rows where `listing_url LIKE 'conceptcarz://%'`

---

## Summary

ConceptCarz is an auction results aggregator (conceptcarz.com). A bulk scrape on 2026-02-06 imported **374,804 rows** — 28.9% of all vehicles in the database. The data is auction cross-reference material: year/make/model + sale price from events at Barrett-Jackson, Bonhams, RM Sotheby's, Mecum, Gooding, etc.

**CRITICAL FINDING: ~73% of sale_price values are NOT real hammer prices — they're site-wide model averages that ConceptCarz displays as "Estimated Sale Value."** Only ~27% of priced rows have unique prices that could be real transactions.

**Verdict:** The vehicle identity data (year/make/model + auction event) is valuable for sales history. But the pricing is mostly fake averages. The cleanup script has barely been run. The data needs price triage, not just dedup.

---

## Data Shape

| Metric | Value |
|--------|-------|
| Total rows | 374,804 |
| % of all vehicles (1.3M) | 28.9% |
| Has sale_price >= $500 | 292,910 (78%) |
| Has any price | 292,953 |
| No price at all | 81,851 (22%) |
| Has VIN | 7,588 (2%) |
| Has full 17-char VIN | 734 (0.2%) |
| Has discovery_url | 7,489 (2%) |
| Distinct makes | 4,661 (inflated by garbage) |
| Distinct models | 110,258 |
| Year range | 1900-2026 |
| Status: active | 335,434 |
| Status: duplicate | 39,370 |
| All created on | 2026-02-06 |

### listing_url format
```
conceptcarz://event/{event_id}/{year} {make} {model}[Chassis#:{vin}]
```
Examples:
- `conceptcarz://event/1503/1964 Chevrolet Impala`
- `conceptcarz://event/955/1997 Aston Martin DB7 CoupeChassis#: SCFAA11185K100273`

### notes JSON
```json
{
  "status": "sold",
  "event_id": 615,
  "event_name": "Bonhams - Les Grandes Marques a Monaco - Auction Results",
  "source_url": "https://www.conceptcarz.com/events/auctionResults/auctionResults.aspx?eventID=615",
  "extracted_at": "2026-02-06T06:47:55",
  "auction_house": "conceptcarz"
}
```

### discovery_url (when populated)
Points to the actual auction house listing, e.g.:
- `https://barrett-jackson.com/scottsdale-2020/docket/vehicle/...`
- `https://bringatrailer.com/listing/...`

Only 7,489 populated so far. 7,404 of those have `discovery_source = 'barrett-jackson'`.

---

## Year/Decade Distribution

| Decade | Count | Avg Price |
|--------|-------|-----------|
| 1900s | 1,338 | $153k |
| 1910s | 2,537 | $171k |
| 1920s | 7,475 | $135k |
| 1930s | 22,414 | $174k |
| 1940s | 14,242 | $68k |
| 1950s | 51,855 | $125k |
| **1960s** | **98,539** | $94k |
| 1970s | 63,476 | $59k |
| 1980s | 30,671 | $50k |
| 1990s | 30,610 | $64k |
| 2000s | 35,788 | $70k |
| 2010s | 13,520 | $292k |
| 2020s | 2,339 | $627k |

Peak concentration: 1960s (26%). Heavy domestic bias (Chevy 88k, Ford 54k = 38% of all rows).

---

## Top Makes

| Make | Count |
|------|-------|
| Chevrolet | 87,721 |
| Ford | 54,248 |
| Mercedes-Benz | 18,049 |
| Pontiac | 14,229 |
| Cadillac | 12,347 |
| Dodge | 10,733 |
| Porsche | 10,699 |
| Jaguar | 10,513 |
| Plymouth | 7,875 |
| Buick | 7,688 |
| Ferrari | 7,631 |

---

## Data Quality Problems

### 1. Auction houses parsed as makes (~7,300 rows)

The scraper misattributed auction house names as vehicle makes:

| Garbage "make" | Count |
|---------------|-------|
| Rm | 1,961 |
| Bonhams | 1,426 |
| RM | 1,370 |
| Gooding | 1,268 |
| Mecum | 972 |
| Barrett-Jackson | 522 |
| Worldwide | 359 |
| Russo | 173 |
| An | 102 |
| 's | 53 |
| Barrett-Jackson's | 51 |
| Artcurial | 51 |
| Bonhams, | 46 |

Plus additional garbage: `c.`, `**`, `**Regretfully`, `Scottsdale,`, `-1/2`, `-45`, `S.`, `J.`, `Christie's`, `Bordeaux,`, `Willy's`

**Cleanup script Step 3 covers most but not all of these.** Missing: `RM` (case variant), `An`, `'s`, `Scottsdale,`, `Christie's`, `**Regretfully`, `**`, `Barrett-Jackson's`, `Barrett-Jackson,`, `Bordeaux,`, `c.`, `C.`, `S.`, `J.`, `-1/2`, `-45`, `Willy's`

### 2. Chassis# stuck in model names (25,434 rows)

Model field still contains `Chassis#:...` suffix. Cleanup script Step 2 handles this but hasn't been run fully.

### 3. Empty/numeric models (4,484 rows)

- 1,270 rows with empty model
- 3,214 rows with numeric-only model (likely chassis numbers parsed as model)

### 4. Massive duplication (170,687 removable rows)

41,647 duplicate groups (same year + lower(make) + lower(model) + sale_price). Worst offenders:

| Year | Make | Model | Price | Dupes |
|------|------|-------|-------|-------|
| 1957 | Chevrolet | Bel Air Convertible | $62,474 | 333 |
| 1957 | Ford | Thunderbird Convertible | $50,515 | 318 |
| 1969 | Chevrolet | Camaro | $70,156 | 315 |
| 1957 | Ford | Thunderbird | $50,515 | 310 |
| 1965 | Ford | Mustang | $33,453 | 304 |
| 1957 | Chevrolet | Bel Air | $62,474 | 301 |
| 1965 | Ford | Mustang Convertible | $33,453 | 296 |
| 1966 | Ford | Mustang | $29,798 | 286 |

**NOW UNDERSTOOD: These aren't duplicates from re-scraping. They're individual auction appearances where the scraper recorded ConceptCarz's site-wide average ("Estimated Sale Value") instead of the actual hammer price.** Each row IS a real event appearance — a 1957 Bel Air really did appear at 333 different auctions — but $62,474 is the model's average, not what any individual car sold for.

### 5. CRITICAL: Prices are mostly estimated averages, not hammer prices

ConceptCarz event pages show an "Estimated Sale Value" column (marked with `*`) which is the site-wide historical average for that year/make/model. The scraper captured this average as `sale_price` for the vast majority of rows.

**Proof:**
- 1995 Ford Mustang: $22,432 appears **137 times across 93 different events** (same price at Barrett-Jackson 2016, Barrett-Jackson 2020, Mecum everywhere)
- 1956 Ford Thunderbird: $42,713 appears **211 times across 148 events**
- 1969 Chevrolet Camaro: $70,156 appears **315 times across 184 events**

**Price uniqueness breakdown (of 292,953 priced rows):**

| Category | Rows | % | Interpretation |
|----------|------|---|----------------|
| Unique price (appears once for that Y/M/M) | 80,619 | 27.5% | Possibly real hammer prices |
| 2-5 duplicates | 86,686 | 29.6% | Mixed — some real, some coincidence |
| 6-50 duplicates | 85,358 | 29.1% | Almost certainly averages |
| 50+ duplicates | 40,290 | 13.8% | Definitely averages |

**Rows with real prices tend to also have VINs.** The 1956 Thunderbird data shows: rows with VINs had unique prices ($32k, $36.6k, $57.2k, $62.7k) while the 211 rows without VINs all had the same $42,713 average.

**Status field doesn't help:** "sold" rows are 75.5% single-price (average), "unknown" rows are 69.9% single-price. Both are heavily contaminated.

### 6. discovery_url not backfilled (367,315 rows)

The notes JSON contains `source_url` pointing back to the conceptcarz event page. Cleanup Step 4 moves this to `discovery_url`, but only 7,489 of ~374,804 have been migrated. **367,315 still pending.**

### 6. No VIN cross-referencing

0 ConceptCarz VINs overlap with vehicles from other sources. The 734 full VINs extracted haven't matched anything — likely because our other sources (BaT, C&B, etc.) have different vehicle populations, or the VINs weren't extracted from those sources.

---

## Cleanup Script Status

`scripts/cleanup-conceptcarz.sql` exists with 6 steps, batched at 500 rows per pass. The shell wrapper (`run-cleanup-conceptcarz.sh`) runs up to 200 passes.

| Step | Description | Status |
|------|-------------|--------|
| 1a | Extract 17-char VINs from listing_url | Partially done (734 extracted) |
| 1b | Extract short chassis numbers (4-16 chars) | Partially done (6,854 extracted) |
| 2 | Strip `Chassis#:` from model names | **NOT DONE** — 25,434 still dirty |
| 3 | Delete rows where make = auction house | **NOT DONE** — ~7,300 still present |
| 4 | Move source_url → discovery_url | **BARELY STARTED** — 367,315 pending |
| 5 | Fix make names (Aston-Martin, Desoto, etc.) | Unknown |
| 6 | Deduplicate by year/make/model/price | **NOT DONE** — 170,687 removable |

**The cleanup script has not been meaningfully run.** Either it was started and errored out early, or only a few passes completed.

---

## Cross-Reference: Existing Auction Data

We already have direct data from several of the same auction houses that ConceptCarz aggregates:

| Source | Vehicles | Has Price | Has Full VIN |
|--------|----------|-----------|--------------|
| BaT | 600,563 | 536,938 | 45,187 |
| Mecum | 52,863 | 49,488 | 13,218 |
| Barrett-Jackson | 36,157 | 797 | 117 |
| Bonhams | 25,211 | 12,435 | 765 |
| Cars & Bids | 6,937 | 3,802 | 332 |
| RM Sotheby's | 1,286 | 1,058 | 48 |

**Year+make+model matching works** — a ConceptCarz "1970 Chevrolet Corvette Coupe" joins cleanly against BaT and Mecum rows for the same. But the join is many-to-many (one CZ "model" matches every individual listing of that model). VIN matching would be 1:1 but we only have 734 CZ full VINs.

**Barrett-Jackson gap:** We have 36k BJ vehicles but only 797 with prices. ConceptCarz has the event appearances + (fake average) prices. The real opportunity is matching CZ event rows to our BJ data to fill in which BJ vehicles appeared at which events.

---

## The Role of ConceptCarz Data (Sales History)

Each CZ row represents: **"A [year] [make] [model] appeared at [auction event]"** — with optional VIN and sold/not-sold status.

This is the backbone of sales history. When a 1967 Shelby GT500 comes in from BaT, we want to show: "This model has sold 47 times at auction since 2005" with a price trendline.

**What CZ gives us:**
- Vehicle identity (year/make/model) at specific auction events
- Event name → auction house + location + approximate date
- Sold/not-sold status for some rows
- VIN for ~2% of rows (enables exact vehicle tracking across auctions)

**What CZ does NOT reliably give us:**
- Real hammer prices (73% are averages)
- Sale dates (only event-level, not lot-level)
- Lot numbers
- Images, descriptions, condition reports

---

## Recommendations

### Phase 1: Triage & Clean (do now)

1. **Add `price_confidence` column** to flag real vs estimated prices:
   ```sql
   -- Rows where price appears 6+ times for same Y/M/M = estimated average
   -- Rows with unique price + VIN = high confidence real price
   -- Rows with unique price, no VIN = medium confidence
   ```

2. **Run the cleanup script** (model names, garbage makes, discovery_url backfill) — but increase batch size to 5,000 and passes to 800+

3. **Extract auction house from event_name** into `auction_source`:
   - "Barrett-Jackson : Scottsdale, AZ" → `barrett-jackson`
   - "Mecum : Kissimmee" → `mecum`
   - "Bonhams - Les Grandes Marques" → `bonhams`
   - "RM Sotheby's NY Auction" → `rm-sothebys`

4. **Extract event date** from event_name or conceptcarz page metadata — critical for the time axis of sales history

### Phase 2: Cross-Reference (match to real prices)

5. **Match CZ rows to existing Mecum/BJ/Bonhams data** by year+make+model+auction_source+approximate_date to pull in real hammer prices from our direct-scraped data

6. **For remaining rows without real prices:** null out the fake averages rather than leaving misleading data. Mark as `price_source = 'estimated_average'` so downstream consumers know.

7. **VIN-based matching:** The 734 full VINs and 6,854 chassis numbers could enable 1:1 matching against Mecum (13k VINs) and BaT (45k VINs)

### Phase 3: Re-scrape for Real Prices

8. **Scrape ConceptCarz vehicle detail pages** (not event pages) — these may have per-lot hammer prices
9. **Or bypass CZ entirely** and scrape Barrett-Jackson/Mecum/Bonhams results pages directly for the events we know about from CZ event_name data
10. **Priority targets:** Events with 1000+ lots (the big Mecum Kissimmee, Barrett-Jackson Scottsdale events) — these represent the highest ROI for price recovery

### Phase 4: Data Model

11. **These should become `auction_events` or `vehicle_observations`**, not standalone vehicles. Each row represents "model X appeared at event Y" — it's an observation about a vehicle class, not a unique vehicle entity (except the ~7k with VINs).

12. **Schema target:**
    ```
    auction_event_results:
      id, year, make, model, vin (nullable),
      auction_house, event_name, event_date, event_location,
      sale_price (nullable), price_confidence (real|estimated|unknown),
      sold_status (sold|not_sold|unknown),
      source_url (conceptcarz event page)
    ```

---

## Fraud Analysis: Identifying Fake Prices

### The Classifier

Real US auction hammer prices are **always divisible by $100** (bid increments go $100, $250, $500, $1000, $2500, $5000, $10000). A price like $70,156 or $42,713 is **mathematically impossible** as a real auction result — it's a calculated average.

**`sale_price % 100 != 0` is the primary fraud signal.**

### Classification Results (292,910 priced rows)

| Classification | Rows | % | Has VIN | Avg Price |
|---------------|------|---|---------|-----------|
| **FAKE:** arbitrary price (not ÷ 100) | 265,551 | 90.7% | 1,586 (0.6%) | $85k |
| **LIKELY REAL:** round + unique per Y/M/M | 14,796 | 5.1% | 4,951 (33.5%) | $241k |
| **PLAUSIBLE:** round + 2-5 appearances | 10,382 | 3.5% | 959 (9.2%) | $313k |
| **SUSPECT:** round but 6+ appearances | 2,181 | 0.7% | 10 (0.5%) | $111k |

**Corroborating evidence:**
- VIN presence rate is **36x higher** in round-priced rows (21.6%) vs arbitrary-priced rows (0.6%)
- Average price for "likely real" rows ($241k) is **3x higher** than fake rows ($85k) — consistent with high-value lots getting individual hammer prices recorded while generic lots get the model average
- 2 VIN rows for the 1957 Bel Air had $62,474 (mod100=74, FAKE), while 12 VIN rows had unique round prices ($31,900–$71,500, all mod100=0, REAL)

### Round Averages (the 0.7% edge case)

Some CZ averages are coincidentally round:

| Year | Make | Model | Price | Appearances |
|------|------|-------|-------|-------------|
| 1966 | Chevrolet | Corvette Convertible | $80,300 | 217 |
| 1966 | Chevrolet | Corvette Coupe | $80,300 | 158 |
| 1981 | Pontiac | Trans Am | $18,000 | 76 |
| 1970 | Volkswagen | Beetle | $9,100 | 56 |
| 1968 | Plymouth | Road Runner | $53,100 | 56 |

These pass the mod-100 test but fail the frequency test. **Any price appearing 6+ times for the same Y/M/M is treated as suspect.**

### By Auction House

CZ event pages from some houses had actual lot data; most had only the model average:

| Auction House | Total Rows | Round Prices | % Round |
|---------------|-----------|--------------|---------|
| **Gooding** | 5,766 | 1,975 | **34.3%** |
| **RM Sotheby's** | 19,922 | 5,026 | **25.2%** |
| **Bonhams** | 13,751 | 2,355 | **17.1%** |
| Mecum | 84,786 | 6,069 | 7.2% |
| Russo & Steele | 8,500 | 585 | 6.9% |
| Barrett-Jackson | 37,902 | 2,247 | 5.9% |
| Silver Auctions | 16,788 | 743 | 4.4% |
| Leake | 14,032 | 592 | 4.2% |
| Carlisle | 5,953 | 202 | 3.4% |

**Gooding, RM, and Bonhams** have the highest % of real prices — these are prestige houses where CZ likely had better data access (or where individual lot results were published on the event pages).

**Barrett-Jackson and Mecum** — despite being the largest sources — are ~94% estimated averages. Their volume results are treated as "model appeared at event" data, not real transaction prices.

### The 1,586 VIN Rows with Fake Prices

These are real vehicles (with VINs scraped from event pages) but CZ displayed its estimated average instead of the actual hammer price. They're confirmed as fake because:
- 88.6% end in X0 but not X00 (e.g., $26,460, $49,680) — still not valid US auction increments
- They come predominantly from US houses (Mecum 460, Barrett-Jackson 240) where bid increments are $100+
- The remaining 11.4% (181 rows) have truly arbitrary last digits

### Implementation: Price Confidence Column

```sql
-- Step 1: Compute the "dominant price" for each Y/M/M
CREATE TEMP TABLE ymm_price_freq AS
SELECT year, lower(make) as make, lower(model) as model, sale_price,
  count(*) as freq
FROM vehicles
WHERE listing_url LIKE 'conceptcarz://%' AND sale_price IS NOT NULL
GROUP BY year, lower(make), lower(model), sale_price;

-- Step 2: Classify every priced CZ row
-- Could be an UPDATE adding a price_confidence column
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_confidence text;

UPDATE vehicles v
SET price_confidence = CASE
  WHEN v.sale_price % 100 != 0 THEN 'fabricated'
  WHEN pf.freq >= 6 THEN 'suspected_average'
  WHEN pf.freq BETWEEN 2 AND 5 THEN 'plausible'
  WHEN pf.freq = 1 THEN 'likely_real'
  ELSE 'unknown'
END
FROM ymm_price_freq pf
WHERE v.listing_url LIKE 'conceptcarz://%'
  AND v.sale_price IS NOT NULL
  AND v.year = pf.year
  AND lower(v.make) = pf.make
  AND lower(v.model) = pf.model
  AND v.sale_price = pf.sale_price;
```

### What to Do with Fabricated Prices

**Option A: Null them out.** Set `sale_price = NULL, price_confidence = 'fabricated'`. Keeps the auction appearance data but removes misleading numbers. Most conservative.

**Option B: Move to `estimated_value`.** Add a separate column so the CZ estimate is preserved but clearly separated from real prices. Useful if we want "what CZ thinks this model is worth" as a reference.

**Option C: Keep and flag.** Leave `sale_price` as-is but let downstream consumers filter on `price_confidence`. Least disruptive but risks someone charting fake prices.

**Recommended: Option B** — the estimates aren't worthless (they represent CZ's aggregated view of model value), they're just not transaction data.

---

## Key Queries

```sql
-- Total conceptcarz stats
SELECT count(*), count(*) FILTER (WHERE sale_price >= 500) as priced
FROM vehicles WHERE listing_url LIKE 'conceptcarz://%';

-- Remaining garbage makes
SELECT make, count(*) FROM vehicles
WHERE listing_url LIKE 'conceptcarz://%'
  AND make NOT IN (SELECT DISTINCT make FROM vehicles WHERE listing_url NOT LIKE 'conceptcarz://%')
GROUP BY make HAVING count(*) < 50
ORDER BY count(*) DESC;

-- Cleanup progress check
SELECT
  count(*) FILTER (WHERE model ILIKE '%chassis#%') as dirty_models,
  count(*) FILTER (WHERE discovery_url IS NULL AND notes::jsonb->>'source_url' IS NOT NULL) as pending_discovery_url,
  count(*) FILTER (WHERE make IN ('Rm','Bonhams','RM','Gooding','Mecum','Barrett-Jackson')) as garbage_makes
FROM vehicles WHERE listing_url LIKE 'conceptcarz://%';
```
