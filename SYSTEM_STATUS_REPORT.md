# Nuke Platform System Status Report
**Generated: 2026-02-05** (Updated continuously)

## Executive Summary

The Nuke vehicle data platform is operational with strong data coverage. Key metrics:

| Metric | Value |
|--------|-------|
| Total Vehicles | 285,103 |
| Vehicle Images | 25,094,730 |
| Total Value | $11.36B |
| BaT Listings | 128,001 |
| Observations | 626,761 |
| External Identities | 486,368 |

## Import Queue Status (Live)

| Status | Count | Percentage |
|--------|-------|------------|
| Complete | 117,733 | 52.9% |
| Pending | 88,604 | 39.8% |
| Skipped | 16,870 | 7.6% |
| Duplicate | 6,989 | 3.1% |
| Failed | ~1,000 | 0.4% |

**Major discovery: Found 91,336 BaT URLs marked complete but never extracted. Reset to pending for re-extraction.**

**BaT Extraction Progress:**
- 128,383 bat_listings (target: ~230,000)
- 83,335 new URLs discovered via year crawling
- 12+ parallel extraction agents running

## Today's Data Cleanup

### Completed Actions
1. **Fixed future year vehicles** - Corrected 2033 Land Rover to 2003 (typo), soft-deleted 3 invalid entries
2. **Skipped 476 number plates** - collectingcars.com license plates marked as non-vehicles
3. **Marked 2,493 empty raw_data** - collectingcars items with no data marked as failed
4. **Refreshed map data** - Updated materialized views with latest vehicle locations

### Data Quality Improvements
- Future year vehicles: 4 → 0 (fixed)
- Pending queue items: 6,131 → 1,272 (cleaned up invalid entries)

## Geographic Distribution (Map Data)

**48,498 vehicles** across **1,806 counties** with total value of **$3.59B**

### Top States by Value
| State | Vehicles | Total Value | Avg Price |
|-------|----------|-------------|-----------|
| CA | 1,241 | $83.8M | $67,542 |
| TX | 243 | $18.6M | $76,464 |
| FL | 407 | $17.6M | $43,324 |
| NY | 288 | $16.1M | $55,798 |
| AZ | 193 | $11.7M | $60,447 |
| PA | 205 | $11.4M | $55,786 |
| MA | 96 | $10.6M | $110,585 |
| NV | 109 | $9.6M | $87,682 |

### Data Coverage
- 10,972 unique ZIP codes in listings
- 60,014 vehicles matched to FIPS county codes
- 3,229 US counties in mapping database

## Remaining Pending Items by Source

| Source | Pending | Notes |
|--------|---------|-------|
| Cars & Bids | 44 | React SPA - needs Firecrawl |
| Collecting Cars | 20 | Empty raw_data - needs re-fetch |
| PCarMarket | 19 | React SPA - needs Firecrawl |
| BaT | 0 | All processed or marked |

**All remaining items require Firecrawl (blocked - see Known Issues)**

## Edge Function Status

### Working Functions
- **map-vehicles RPC** - Returns state/county data in <1s
- **universal-search** - Returns results in ~118ms
- **bat-simple-extract** - Successfully extracts live BaT listings
- **extract-collecting-cars-simple** - Works when raw_data is populated

### Functions with Issues
- **ralph-wiggum-rlm-extraction-coordinator** - OpenAI quota exceeded (429)
- **extract-vehicle-data-ai** - OpenAI quota exceeded (429)
- **import-pcarmarket-listing** - Site is React SPA, needs JS rendering

## Vehicle Inventory Analysis

### Top Makes by Count
| Make | Count | Total Value |
|------|-------|-------------|
| Chevrolet | 35,480* | $1.83B |
| Ford | 26,827* | $536M |
| Porsche | 22,510* | $1.32B |
| BMW | 15,119* | $262M |
| Mercedes-Benz | 13,948* | $512M |
| Toyota | 8,135 | $150M |
| Ferrari | 3,728 | $972M |

*Combined case variants (Chevrolet + chevrolet, etc.)

### Distribution by Decade
| Decade | Count |
|--------|-------|
| Pre-1950 | 11,133 |
| 1950s | 17,131 |
| 1960s | 43,509 |
| 1970s | 40,315 |
| 1980s | 32,221 |
| 1990s | 42,744 |
| 2000s | 45,285 |
| 2010s | 28,174 |
| 2020s | 11,205 |

## Known Issues

### Blocking Issues
1. **OpenAI quota exhausted** - All AI-powered functions return 429 errors
2. **Firecrawl API credits exhausted** - Current API key has -140 credits (overdrawn). User has second plan with credits but needs to find/configure alternate API key. Blocks extraction for Cars & Bids, PCarMarket, and Collecting Cars.

### Data Quality Issues
| Issue | Count | Status |
|-------|-------|--------|
| Vehicles without year | 12,269 | 95.7% have year |
| Vehicles without make | 6,296 | 97.8% have make |
| Case-inconsistent makes | ~95k | Migration ready, run via Supabase dashboard |

### Technical Debt
- PCarMarket extractor needs Playwright for JS rendering
- collectingcars discovery not populating raw_data
- Large UPDATE queries timeout on Supabase connection pooler

## Recommendations

### High Priority
1. **Configure Firecrawl API key for second plan** - User has two Firecrawl plans. Current key `fc-12e25...` is overdrawn (-140 credits). Need to get API key from second plan ($99 paid Feb 5) and update:
   - `/Users/skylar/.claude.json` → `projects./Users/skylar/nuke.mcpServers.firecrawl.env.FIRECRAWL_API_KEY`
   - `/Users/skylar/nuke/.env` → `FIRECRAWL_API_KEY`
2. **Replenish OpenAI API quota** - Required for AI-based extraction
3. **Run make case normalization** - Function `normalize_all_makes_batch()` is ready, run via Supabase SQL Editor

### Medium Priority
3. **Add Playwright to PCarMarket extractor** - 91 pending items need JS rendering
4. **Fix collectingcars discovery** - Populate raw_data properly during discovery
5. **Improve location extraction** - Only 17% of vehicles have mappable locations

### Low Priority
6. **Clean up non-vehicle entries** - Signs, wheels, memorabilia in vehicles table
7. **Add GitHub Dependabot fixes** - 16 vulnerabilities (5 high)

## Commits Today

1. `7cddf51c` - Add static vehicle map with embedded data
2. `597f0080` - Add comprehensive system status report
3. `778c782b` - Update static vehicle map with refreshed data
4. `571fb61d` - Update vehicle map: 48,498 vehicles ($3.59B)
5. `332aaeb4` - Update system status report with cleanup progress
6. `0bc96a2c` - Add migration for make case normalization
7. `5b266f4a` - Update vehicle map: 48,532 vehicles

## System Architecture

- **Database**: Supabase (PostgreSQL) with 235-column vehicles table
- **Edge Functions**: 181 Deno functions deployed
- **Frontend**: React with Vite
- **Backend**: Elixir/Phoenix (nuke_api)
- **Map Visualization**: D3.js + TopoJSON
- **Data Sources**: BaT, Cars & Bids, Mecum, Collecting Cars, PCarMarket

---
*Report updated automatically by autonomous Claude Code session*
