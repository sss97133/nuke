# Agent Quick Reference

> **For AI agents implementing extraction/repair logic**

## The Three Laws

### 1. Fix the Scraper, Not the Data
When bad data appears:
- ✅ **DO**: Fix the extractor, re-run it, verify the fix
- ❌ **DON'T**: Manually patch the database

### 2. Evidence First, Write Second
Every data change must be traceable to:
- Source URL (where it came from)
- Extractor version (what code produced it)
- Snapshot reference (proof of source at extraction time)

### 3. Null is Valid, Placeholders are Forbidden
- ✅ `null` = "source didn't provide it" (valid)
- ❌ Placeholder/default = "we made it up" (forbidden)

## BaT Extraction Workflow

**For Bring a Trailer listings, ALWAYS use this two-step process:**

### Step 1: Core Data
```bash
# Call extract-premium-auction
POST /functions/v1/extract-premium-auction
{
  "url": "https://bringatrailer.com/listing/...",
  "max_vehicles": 1
}
```

**What it extracts:**
- ✅ VIN, Mileage, Color, Transmission, Engine (from BaT Essentials)
- ✅ All high-resolution images (filtered, no contamination)
- ✅ Auction metadata (prices, dates, seller, buyer)

### Step 2: Comments & Bids
```bash
# Call extract-auction-comments (after Step 1 completes)
POST /functions/v1/extract-auction-comments
{
  "auction_url": "https://bringatrailer.com/listing/...",
  "vehicle_id": "<from Step 1>"
}
```

**What it extracts:**
- ✅ All comments (stored in `auction_comments`)
- ✅ All bids (stored in `bat_bids`)
- ✅ Updates `bat_listings` with counts

## Extraction Checklist

Before marking extraction as complete, verify:

- [ ] VIN extracted (17 characters) OR confirmed null (source doesn't have it)
- [ ] Mileage extracted OR confirmed null
- [ ] Color extracted OR confirmed null
- [ ] Transmission extracted OR confirmed null
- [ ] Images extracted (20-100+ typically) AND filtered (no contamination)
- [ ] Comments extracted (if listing has comments)
- [ ] Bids extracted (if listing has bids)
- [ ] Primary image is NOT a receipt/documentation image

## What NOT to Use

❌ **Don't use these extractors** (they're incomplete/broken):
- `bat-extract-complete-v1` (missing VIN/specs)
- `bat-extract-complete-v2` (missing VIN/specs)
- `bat-extract-complete-v3` (untested)
- `comprehensive-bat-extraction` (doesn't use proven workflow)
- `bat-simple-extract` (incomplete)

✅ **DO use**:
- `extract-premium-auction` (v128, battle-tested)
- `extract-auction-comments` (proven, works)

## Quick Script

For manual extraction, use:
```bash
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/..."
```

## See Also

- Full workflow: `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`
- Architecture: `docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md`

