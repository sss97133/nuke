# Extraction Gaps Analysis

**Generated**: 2026-01-24 by Ralph Wiggum autonomous agent
**Data analyzed**: 14,602 vehicles across all sources

## Executive Summary

| Source | Vehicles | Critical Gaps |
|--------|----------|---------------|
| Craigslist | 6,124 | Make parsing 64% broken, Location 94% missing |
| Bring a Trailer | 6,000 | VIN 23% missing, Interior color 35% missing |
| Cars & Bids | 1,339 | Description 40% missing, Price 20% missing |
| Other sources | 1,139 | Various gaps |

## Source-by-Source Analysis

### Craigslist (6,124 vehicles) - CRITICAL

| Field | Coverage | Issue |
|-------|----------|-------|
| Year | 100% | Working |
| Make | 35.7% | **BROKEN** - parsing fails on messy titles |
| Model | 56.9% | Contains raw title text, not parsed |
| VIN | 21.3% | Low (may be legitimately missing) |
| Mileage | 10.6% | **Very low** - needs regex improvement |
| Price | 64.0% | Gap - 2,205 missing |
| Location | 6.3% | **Almost none** - despite being in URL |
| Color | 0.2% | Not extracted |
| Transmission | 0.7% | Not extracted |

**Root Cause**: `process-import-queue/index.ts` lines 1440-1486
- `invalidPrefixes` list incomplete for CL's descriptive titles
- Titles like "miss this 2013 Bentley..." fail `isValidMake()` check

**Fix Priority**: HIGH - 6,124 vehicles affected

---

### Bring a Trailer (6,000 vehicles)

| Field | Coverage | Issue |
|-------|----------|-------|
| Year | 100% | Perfect |
| Make | 100% | Perfect |
| Model | 100% | Perfect |
| VIN | 76.6% | 1,404 missing |
| Mileage | 93.7% | Good |
| Price | 99.3% | Excellent |
| Description | 99.6% | Excellent |
| Color | 94.3% | Good |
| Interior Color | 64.8% | 2,112 missing |
| Transmission | 92.2% | Good |
| Title | 0% | Not stored (intentional?) |

**Root Cause**: VIN may be legitimately missing from some listings. Interior color extraction could be improved.

**Fix Priority**: MEDIUM - Overall quality good

---

### Cars & Bids (1,339 vehicles)

| Field | Coverage | Issue |
|-------|----------|-------|
| Year | 99.9% | Excellent |
| Make | 100% | Perfect |
| Model | 100% | Perfect |
| VIN | 74.8% | 337 missing |
| Mileage | 85.4% | Minor gap |
| Price | 79.9% | **269 missing** |
| Description | 59.7% | **540 missing** |
| Color | 73.3% | Gap |
| Interior Color | 69.0% | Gap |
| Transmission | 73.3% | Gap |
| Images | 91.9 avg | Excellent |

**Root Cause**: Lazy-loading issues causing incomplete page renders

**Fix Priority**: MEDIUM - 540 vehicles missing description

---

### Image Coverage Issues

| Source | Vehicles | Avg Images | Status |
|--------|----------|------------|--------|
| PCarMarket | 1,092 | 0.4 | **CRITICAL** |
| Collecting Cars | 72 | 0.0 | **ZERO** |
| Barrett-Jackson | 51 | 0.3 | **CRITICAL** |
| Motorious | 45 | 0.0 | **ZERO** |
| Sweet Cars | 32 | 0.0 | **ZERO** |

---

## Extractors Reference

| Source | Extractor Location |
|--------|-------------------|
| BaT | `extract-bat-core/index.ts` |
| Cars & Bids | `extract-cars-and-bids-core/index.ts` + `extract-premium-auction/index.ts` |
| Craigslist | `process-import-queue/index.ts` lines 1331-1496 |
| Mecum | `extract-premium-auction/index.ts` |
| SBX Cars | `scrape-sbxcars/index.ts` |

---

## Priority Fixes

1. **Craigslist make/model parsing** - 6,124 vehicles, HIGH impact
2. **Craigslist location extraction** - 5,738 vehicles missing
3. **C&B description extraction** - 540 vehicles missing
4. **PCarMarket images** - 1,092 vehicles with <1 image
5. **BaT VIN backfill** - 1,404 vehicles missing

---

## Validation Queries

```sql
-- Check extraction accuracy by source
SELECT auction_source, COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE make IS NOT NULL AND LENGTH(make) < 20) / COUNT(*), 1) as pct_valid_make
FROM vehicles WHERE listing_kind = 'vehicle'
GROUP BY auction_source ORDER BY total DESC;
```
