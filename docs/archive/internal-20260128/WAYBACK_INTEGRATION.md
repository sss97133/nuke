# Wayback Machine Integration for Vehicle Profiles

## Architecture Overview

```
[Wayback CDX API] → [extract-wayback-listing] → [ingest-wayback-vehicle] → [Vehicle Profile]
                                                          ↓
                                                  [Timeline Event]
                                                          ↓
                                               [vehicle_observations]
```

## Components

### 1. extract-wayback-listing
Searches and extracts listing data from Wayback Machine snapshots.

**Modes:**
- `gold_rush` - Search for specific vehicles in old archives (2003-2012)
- `search_url` - Find snapshots of a URL pattern
- `extract_snapshot` - Extract data from a specific snapshot
- `find_vehicle_history` - Find all mentions of a vehicle

**Priority Domains (old content that's GONE from live web):**
| Domain | Priority | Gold Rush Years |
|--------|----------|-----------------|
| craigslist.org | 1 | 2005-2012 |
| cgi.ebay.com | 1 | 2003-2008 |
| ebay.com | 1 | 2003-2012 |
| autotraderclassics.com | 1 | 2006-2015 |
| oldcarsonline.com | 1 | 2003-2010 |

### 2. ingest-wayback-vehicle
Validates extracted data and creates vehicle profiles with blind validation.

**Confidence Scoring:**
- Base trust: 0.85 (Wayback is reliable)
- VIN present: +0.15 bonus
- VIN missing: -0.30 penalty
- Year/Make/Model: +0.05 each
- Price realistic: +0.05
- Description clean: +0.05
- Images present: +0.02-0.10

**Validation Statuses:**
- `extracted` - Field found and validated
- `not_found` - Field not present in source
- `parse_error` - Couldn't parse the field
- `validation_fail` - Failed validation (e.g., bad VIN format)
- `low_confidence` - Extracted but suspicious

### 3. Timeline Events
Each listing becomes a timeline event tracking when the vehicle was for sale.

```typescript
{
  event_type: 'listing',
  event_category: 'sale',
  event_date: '2006-12-13',      // When we saw the listing
  event_end_date: '2006-12-23',  // Estimated end (10 days for eBay)
  metadata: {
    platform: 'cgi.ebay.com',
    asking_price: 74900,
    listing_duration_days: 10,
    archived_images: ['https://web.archive.org/...']
  }
}
```

**Duration Estimates by Platform:**
- Craigslist: 45 days
- eBay: 10 days
- AutoTrader: 60 days
- Hemmings: 90 days

## Usage Examples

### Find Old Listings for a Specific Vehicle
```bash
curl -X POST /functions/v1/extract-wayback-listing \
  -d '{
    "mode": "gold_rush",
    "search_query": "1967 Camaro SS",
    "from_year": 2005,
    "to_year": 2010,
    "priority_domains_only": true
  }'
```

### Extract a Specific Wayback Snapshot
```bash
curl -X POST /functions/v1/extract-wayback-listing \
  -d '{
    "mode": "extract_snapshot",
    "snapshot_url": "https://web.archive.org/web/20061213124648/http://cgi.ebay.com/ebaymotors/..."
  }'
```

### Ingest as Vehicle Profile (with validation)
```bash
curl -X POST /functions/v1/ingest-wayback-vehicle \
  -d '{
    "listing": {
      "snapshot_url": "https://web.archive.org/web/...",
      "snapshot_date": "2006-12-13",
      "domain": "cgi.ebay.com",
      "year": 2006,
      "make": "Jeep",
      "model": "Grand Cherokee SRT8",
      "price": 74900,
      "mileage": 8500
    }
  }'
```

### Dry Run (validate without persisting)
```bash
curl -X POST /functions/v1/ingest-wayback-vehicle \
  -d '{
    "dry_run": true,
    "listing": { ... }
  }'
```

Returns:
```json
{
  "success": true,
  "overall_confidence": 0.75,
  "confidence_factors": {
    "base": 0.85,
    "vin": -0.3,
    "ymm": 0.15,
    "price": 0.05
  },
  "would_create": {
    "vehicle": { "year": 2006, "make": "Jeep", ... },
    "timeline_event": { "start": "2006-12-13", "end": "2006-12-23" }
  }
}
```

## eBay Motors Archive

The Wayback Machine has eBay Motors listings going back to 2003:

- `cgi.ebay.com/ebaymotors/` - Individual listing pages (2003-2008)
- `motors.ebay.com/` - Category pages (2005+)

**URL Format (2003-2008):**
```
cgi.ebay.com/ebaymotors/[TITLE]_W0QQitemZ[ITEM_ID]QQcategoryZ[CAT_ID]QQcmdZViewItem
```

**Categories:**
- 6947: Passenger vehicles
- 33674: Parts (fuel systems)
- 33710: Parts (lighting)
- 6755: Car covers/tops

## Finding Old eBay Listings

eBay famously deletes old listings, but Wayback has them. Search strategies:

1. **By Category Number** - Vehicle categories start with 6xxx
2. **By Title Keywords** - Search URL patterns like `*camaro*` or `*porsche*`
3. **By Date Range** - 2003-2008 has the best coverage of cheap classics

## Pollution Handling

Old eBay pages have significant pollution (ads, navigation, JS). The extractor:
- Uses domain-specific patterns to find the real data
- Scores descriptions for pollution keywords
- Filters images (excludes 1x1, pixels, logos, icons)
- Falls back gracefully when primary patterns fail

## Integration with Existing Systems

The wayback data flows through:
1. `observation_sources` - "wayback-machine" registered as a registry source
2. `vehicle_observations` - Each listing becomes an observation
3. `timeline_events` - Listing period tracked as timeline event
4. `field_extraction_log` - Each field validated with confidence

This integrates with the existing extraction health system for monitoring and self-healing.
