# LLM Continuation Guide

> **For AI assistants picking up this project**

## Context

This project is building a vehicle data extraction system. The user successfully extracted ONE complete BaT (Bring a Trailer) vehicle profile with all data:
- VIN, mileage, color, transmission, engine
- High-resolution images (filtered, no contamination)
- Comments and bids
- Auction metadata

**Date of success**: 2026-01-07  
**Vehicle**: 1969 Chevrolet C10 Pickup (BaT Lot #225,895)

## What You Need to Know

### 1. Read These Files FIRST (In Order)

1. **`docs/architecture/BAT_EXTRACTION_SYSTEM_LOCKED.md`**
   - This is the SINGLE SOURCE OF TRUTH
   - Describes exactly what works
   - Lists exact commands to run
   - Shows which functions to use/retire

2. **`docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md`**
   - Overall system architecture
   - First principles (Fix the Scraper, Not the Data)
   - Evidence-based extraction philosophy

3. **`docs/architecture/AGENT_QUICK_REFERENCE.md`**
   - Quick reference for extraction workflow
   - The Three Laws (Fix Scraper, Evidence First, No Placeholders)

### 2. The Proven Workflow

```
User provides BaT URL
  ↓
Call extract-premium-auction (gets VIN, specs, images)
  ↓
Get vehicle_id from response
  ↓
Call extract-auction-comments (gets comments, bids)
  ↓
Done - all data extracted and stored
```

**Functions that WORK**:
- ✅ `extract-premium-auction` (core data)
- ✅ `extract-auction-comments` (comments/bids)

**Functions to RETIRE**:
- ❌ `bat-extract-complete-v2`
- ❌ `bat-extract-complete-v3`
- ❌ `comprehensive-bat-extraction`
- ❌ `bat-simple-extract`

### 3. Critical Principles

**DO**:
- Fix the scraper, not the data (manual patches don't generalize)
- Store evidence (snapshots) before writing data
- Version extractors clearly (v1, v2, v3)
- Test on known-good listings before deploying

**DON'T**:
- Manually patch vehicle data in database
- Guess or infer data the source doesn't provide
- Use placeholder/default values
- Mix extraction logic across multiple functions

### 4. Common Tasks

#### Task: Extract a BaT Vehicle

```bash
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/..."
```

Or manually:
```bash
# Step 1
curl -X POST "SUPABASE_URL/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer KEY" \
  -d '{"url": "BAT_URL", "max_vehicles": 1}'

# Step 2 (use vehicle_id from Step 1)
curl -X POST "SUPABASE_URL/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer KEY" \
  -d '{"auction_url": "BAT_URL", "vehicle_id": "VEHICLE_ID"}'
```

#### Task: Verify Extraction

```sql
SELECT v.vin, v.mileage, v.color, v.transmission,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as images,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comments,
  (SELECT COUNT(*) FROM bat_bids WHERE vehicle_id = v.id) as bids
FROM vehicles v
WHERE v.discovery_url = 'BAT_URL';
```

Expected: VIN, mileage, color, transmission all present; images > 0; comments > 0; bids > 0

#### Task: Update an Extractor

1. Create new version (e.g., `v4` not `v3-update`)
2. Test on known-good listings
3. Compare results with previous version
4. Document changes
5. Update `BAT_EXTRACTION_SYSTEM_LOCKED.md`

### 5. Data Flow

```
extract-premium-auction
  ↓
  writes to:
    - vehicles (vin, mileage, color, transmission, etc.)
    - vehicle_images (all gallery images)
    - bat_listings (auction metadata)

extract-auction-comments
  ↓
  writes to:
    - auction_comments (all comments)
    - bat_bids (all bids)
    - bat_listings (updates comment_count, bid_count)
```

### 6. Known Issues

**Issue**: Primary image shows receipt instead of car photo  
**Cause**: `extract-premium-auction` uses first image without filtering  
**Workaround**: See `BAT_EXTRACTION_SYSTEM_LOCKED.md` for SQL fix

**Issue**: Orchestrator (`bat-extract-complete-v1`) not tested  
**Status**: Updated to call both functions, but needs testing before production use

### 7. What's Next (Likely Tasks)

1. **Test the orchestrator** (`bat-extract-complete-v1`)
   - Extract a known-good listing
   - Verify same data as manual two-step process
   - Update documentation if it works

2. **Batch extraction**
   - Extract multiple BaT vehicles
   - Monitor for failures
   - Identify patterns in failures

3. **Frontend fixes**
   - Ensure comments/bids display correctly
   - Fix primary image selection
   - Add BaT-specific metadata display

4. **Retire old functions**
   - Delete or disable deprecated extractors
   - Update queue processors to use new functions
   - Document retirement in changelog

### 8. User's Concerns

The user is concerned about:
- **Losing track of work**: This guide + `BAT_EXTRACTION_SYSTEM_LOCKED.md` prevent that
- **Not being able to repeat**: Exact commands documented
- **Cost**: Sonnet 4.5 is expensive, needs to be efficient
- **Drift**: Last few prompts were drifting, needs to stay focused

**How to help**:
- Stay focused on BaT extraction system
- Don't build new things without testing current system first
- Reference documentation instead of rebuilding from scratch
- Test thoroughly before proposing changes

### 9. Quick Checklist for New LLM

Before making changes, ask yourself:

- [ ] Have I read `BAT_EXTRACTION_SYSTEM_LOCKED.md`?
- [ ] Am I using the proven functions (`extract-premium-auction` + `extract-auction-comments`)?
- [ ] Am I following the "Fix the Scraper, Not the Data" principle?
- [ ] Will this change be testable on a known-good listing?
- [ ] Am I documenting what I'm doing?

### 10. Emergency Recovery

If something breaks:

1. **Check the proven vehicle** (C10, Lot #225,895):
   ```sql
   SELECT * FROM vehicles WHERE id = '99feba5d-cea6-4076-8bfd-6f0877750ab4';
   ```
   
2. **Re-extract using proven method**:
   ```bash
   ./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
   ```

3. **Compare results** - they should match the original extraction

4. **Revert changes** if results don't match

---

## File Locations

**Documentation**:
- `docs/architecture/BAT_EXTRACTION_SYSTEM_LOCKED.md` - Main reference
- `docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md` - System architecture
- `docs/architecture/AGENT_QUICK_REFERENCE.md` - Quick reference
- `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md` - Workflow guide

**Functions (Supabase Edge Functions)**:
- `supabase/functions/extract-premium-auction/` - Core data extractor (✅ USE)
- `supabase/functions/extract-auction-comments/` - Comments/bids extractor (✅ USE)
- `supabase/functions/bat-extract-complete-v1/` - Orchestrator (⚠️ NEEDS TESTING)

**Scripts**:
- `scripts/extract-bat-vehicle.sh` - One-command extraction script

**Database**:
- Tables: `vehicles`, `vehicle_images`, `bat_listings`, `auction_comments`, `bat_bids`
- Functions: `record_extraction_attempt`

---

**REMEMBER**: The user successfully extracted ONE complete profile. Your job is to help them repeat that success reliably and systematically. Don't rebuild, refine what works.

