# Nuke Platform System Status Report
**Generated: 2026-02-05**

## Executive Summary

The Nuke vehicle data platform is operational with strong data coverage. Key metrics:

| Metric | Value |
|--------|-------|
| Total Vehicles | 284,990 |
| Unique Makes | 3,247 |
| Unique Models | 62,474 |
| BaT Listings | 127,666 |
| Observations | 626,761 |
| External Identities | 485,764 |

## Database Health

### Core Tables
- **vehicles**: 284,990 records (235 columns)
- **bat_listings**: 127,666 records (126,776 with comments)
- **vehicle_observations**: 626,761 records
- **external_identities**: 485,764 records
- **zip_to_fips**: 41,173 ZIP to county mappings

### Import Queue Status
| Status | Count | Percentage |
|--------|-------|------------|
| Complete | 240,519 | 89% |
| Skipped | 16,323 | 6% |
| Duplicate | 7,919 | 3% |
| Pending | 6,131 | 2% |
| Failed | 2,994 | 1% |
| Processing | 87 | <1% |

**Failure Categories:**
- Uncategorized: 2,630
- Blocked: 211
- No data: 127
- Unknown: 27
- Server error: 2

## Geographic Distribution (Map Data)

The vehicle map shows **48,029 vehicles** across **1,803 counties** with a total value of **$3.56B**.

### Top States by Value
| State | Vehicles | Total Value |
|-------|----------|-------------|
| CA | 1,241 | $83.8M |
| TX | 243 | $18.6M |
| FL | 407 | $17.6M |
| NY | 288 | $16.1M |
| AZ | 193 | $11.7M |

### Data Sources for Map
| Source | Count |
|--------|-------|
| bat | 27,737 |
| bat_simple_extract | 25,825 |
| bring a trailer | 553 |
| Other | ~400 |

## Vehicle Inventory Analysis

### Top Makes by Count
| Make | Count | Total Value |
|------|-------|-------------|
| Chevrolet | 21,414 | $1.79B |
| Ford | 18,221 | $479M |
| Porsche | 17,350 | $1.18B |
| BMW | 9,245 | $202M |
| Mercedes-Benz | 9,226 | $461M |
| Toyota | 8,135 | $150M |
| Ferrari | 3,728 | $972M |

### Distribution by Decade
| Decade | Count |
|--------|-------|
| 1950s | 17,131 |
| 1960s | 43,509 |
| 1970s | 40,315 |
| 1980s | 32,221 |
| 1990s | 42,744 |
| 2000s | 45,285 |
| 2010s | 28,174 |
| 2020s | 11,205 |

## Data Quality Issues

### Identified Issues
| Issue | Count | % of Total |
|-------|-------|------------|
| Vehicles without year | 13,138 | 4.6% |
| Vehicles without make | 7,195 | 2.5% |
| Future year vehicles (>2026) | 4 | <0.01% |

### Sources of Missing Year Data
- No source: 10,905
- bat: 1,641
- gooding_extract: 216
- bat_simple_extract: 158

## Edge Function Status

### Working Functions
- **map-vehicles RPC** - Returns state/county data in <1s
- **universal-search** - Returns results in ~118ms
- **bat-simple-extract** - Successfully extracts live BaT listings

### Functions with Issues
- **ralph-wiggum-rlm-extraction-coordinator** - OpenAI quota exceeded
- **extract-vehicle-data-ai** - OpenAI quota exceeded

**Note:** AI-based functions require OpenAI API quota replenishment.

## Static Map Deployment

Successfully deployed `vehicle-map-static.html` to production:
- Embedded state data: 50 states, 5,388 vehicles, $298M value
- Embedded county data: 1,803 counties, 48,029 vehicles, $3.56B value
- Supports: State/County toggle, Value/Count/Avg metrics
- Git commit: 7cddf51c

## Recommendations

1. **Replenish OpenAI API quota** - Required for AI-based extraction and coordination functions
2. **Investigate 13k vehicles missing year** - 10,905 have no source, may need data cleanup
3. **Fix 4 future-year vehicles** - Includes 2033 Land Rover Defender (likely error)
4. **Add more location data** - Only 48k of 285k vehicles have mappable locations
5. **Consider case-normalization** - "Chevrolet" and "chevrolet" are counted separately

## System Architecture Notes

- Database: Supabase (PostgreSQL)
- Edge Functions: Deno (181 functions deployed)
- Frontend: React
- Backend: Elixir/Phoenix
- Map visualization: D3.js with TopoJSON

---
*Report generated automatically by Claude Code system health check*
