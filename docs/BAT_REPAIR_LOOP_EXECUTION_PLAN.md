# BaT Repair Loop: Make Profiles Correct - Execution Plan

**Status**: 🟢 **PRODUCTION READY**  
**Last Updated**: 2025-01-XX  
**Priority**: TOP PRIORITY

## Overview

This document tracks the end-to-end automation of the BaT "make profiles correct" repair loop. The system identifies incomplete BaT vehicle profiles and automatically backfills images, extracts comprehensive vehicle data, pulls comments/bid history, and ensures the frontend displays correct bid/price information with properly ordered images.

---

## ✅ COMPLETED WORK

### 1. Core Infrastructure

#### 1.1 BaT DOM Map Extractor (Fixed & Hardened)
**File**: `supabase/functions/_shared/batDomMap.ts`

**Status**: ✅ **COMPLETE**

**Changes Made**:
- **Removed duplicated code**: Found and removed a full duplicated copy of the extractor that was causing unstable extraction and bundling issues
- **Hardened image extraction**: `data-gallery-items` attribute now supports both single and double quotes for robust parsing
- **Improved description extraction**: Prioritizes paragraph-based extraction for cleaner, more structured text
- **Enhanced comments/bids counting**: Improved robust NodeList handling with deterministic fallbacks

**Impact**: The canonical DOM map extractor is now stable and reliable for all BaT listing imports.

---

#### 1.2 Orchestrator Edge Function
**File**: `supabase/functions/bat-make-profiles-correct-runner/index.ts`

**Status**: ✅ **COMPLETE**

**Features**:
- Selects incomplete BaT vehicles based on:
  - 0 `vehicle_images`
  - Missing/short description (<80 chars)
  - Missing `listing_location`
  - 0 `auction_comments`
- Rate limiting via `origin_metadata.bat_repair.last_attempt_at` (6-hour cooldown)
- Re-invokes `import-bat-listing` which chains:
  1. Image backfill
  2. Comprehensive data extraction
  3. Comment/bid history ingestion
- Authorization: Service role OR admin user token
- Batch processing: Configurable batch size (1-50, default 10)
- Dry-run mode for testing
- Comprehensive audit trail in `origin_metadata.bat_repair.*`

**Key Logic**:
```typescript
// Candidate pool: BaT vehicles older than min_vehicle_age_hours
// Filters: incomplete based on cheap signals (image count, description length, etc.)
// For each candidate: invokes import-bat-listing → triggers backfill-images → extract-auction-comments
```

---

#### 1.3 GitHub Action Workflow
**File**: `.github/workflows/bat-make-profiles-correct.yml`

**Status**: ✅ **COMPLETE**

**Features**:
- **Scheduled runs**: Daily at 03:15 UTC
- **Manual dispatch**: Supports `batch_size` and `dry_run` parameters
- **Artifact upload**: Results saved as JSON artifact for inspection
- **Error handling**: Proper exit codes and secret validation

**Usage**:
```yaml
# Manual trigger via GitHub UI or CLI:
gh workflow run bat-make-profiles-correct.yml \
  -f batch_size=20 \
  -f dry_run=false
```

---

#### 1.4 Admin UI Integration
**File**: `nuke_frontend/src/pages/AdminMissionControl.tsx`

**Status**: ✅ **COMPLETE**

**Changes**:
- Added "BaT Repair Loop: make profiles correct" button
- UI state management for running/loading states
- Displays results: `scanned`, `candidates`, `repaired`, `failed`
- Authorization: Uses user session token (admin check on backend)

**Location**: AdminMissionControl dashboard → BaT repair section

---

### 2. Image Ordering System

#### 2.1 Backfill Images Function
**File**: `supabase/functions/backfill-images/index.ts`

**Status**: ✅ **COMPLETE**

**Changes**:
- **Writes `position` field**: Sets `vehicle_images.position` based on gallery index (0, 1, 2, ...)
- **Self-healing**: Updates `position` on existing rows during re-runs if previously NULL
- **Consistent ordering**: Ensures images maintain source gallery order

**Key Code**:
```typescript
// On image upload:
position: i, // Gallery index

// Self-heal existing rows:
if (existing?.position === null || existing?.position === undefined) {
  await admin.from("vehicle_images")
    .update({ position: i })
    .eq("id", existing.id);
}
```

---

#### 2.2 Vehicle Profile Image Sorting
**File**: `nuke_frontend/src/pages/VehicleProfile.tsx`

**Status**: ✅ **COMPLETE**

**Changes**:
- Updated image query to sort by:
  1. `is_primary DESC` (primary images first)
  2. `position ASC NULLS LAST` (positioned images by order, then unpositioned)
  3. `created_at ASC` (chronological fallback for NULL positions)

**Impact**: Images now display in consistent, predictable order matching the source BaT gallery.

---

### 3. Frontend Price/Bid Display Logic

#### 3.1 Feed Cards (VehicleCardDense)
**File**: `nuke_frontend/src/components/vehicles/VehicleCardDense.tsx`

**Status**: ✅ **COMPLETE**

**Changes**:
- Price display hierarchy (highest to lowest priority):
  1. `display_price` (precomputed, if available)
  2. `sale_price`
  3. `current_bid` (direct field)
  4. `origin_metadata.live_metrics.current_bid` (fallback for auction imports)
  5. `asking_price`
- Auction badge logic: Shows numeric bid when `display_price` is available
- Zero per-card network calls: Uses precomputed fields for synchronous rendering

**Impact**: Feed cards now show correct live bids without additional API calls.

---

#### 3.2 Homepage Batch Loading
**File**: `nuke_frontend/src/pages/CursorHomepage.tsx`

**Status**: ✅ **COMPLETE**

**Changes**:
- Batch-fetches `external_listings` for all vehicles in the feed
- Includes live auction metrics (`current_bid`, `final_price`, `listing_status`) in vehicle payload
- Enables feed cards to display live BaT bids without individual network calls

**Performance**: Reduces N network calls to 1 batch query.

---

#### 3.3 Profile Header (VehicleHeader)
**File**: `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx`

**Status**: ✅ **COMPLETE**

**Changes**:
- Price display logic updated to prioritize `auctionPulse` data:
  - **Live auctions**: Shows `current_bid` from `external_listings`
  - **Sold auctions**: Shows `final_price` from `external_listings`
  - **Reserve not met**: Shows `high_bid` when available
- Falls back to `sale_price`, `asking_price`, `current_value` only when auction data unavailable
- Hover text reveals detailed auction telemetry

**Impact**: Profile headers now reflect live auction truth, not stale estimates.

---

#### 3.4 RLS (Row Level Security) Verification
**File**: `supabase/migrations/20251103000002_notification_system.sql`

**Status**: ✅ **VERIFIED**

**Policy**:
```sql
-- Everyone can view external listings (public data)
CREATE POLICY "Anyone can view external listings" ON external_listings
  FOR SELECT USING (TRUE);
```

**Impact**: Anonymous users can see live auction bids on feed cards and profile pages.

---

## 🔄 REMAINING WORK (Optional Enhancements)

### 4. Nice-to-Have Improvements

#### 4.1 VehiclePriceSection Enhancement
**File**: `nuke_frontend/src/components/vehicle/VehiclePriceSection.tsx`

**Status**: ⚠️ **NOT STARTED** (Lower Priority)

**Current State**:
- Only reads from `vehicles` table directly
- Doesn't check `external_listings` or `auctionPulse`
- Shows: MSRP, purchase price, current value, asking price, sale price

**Proposed Enhancement**:
- Add auction data check (similar to `VehicleHeader`)
- Show live bid for active auctions
- Show final price for sold auctions
- Add badge/indicator when auction data is present

**Rationale**: `VehicleHeader` already handles auction truth prominently, so this is a polish enhancement rather than a critical fix.

**Effort Estimate**: 1-2 hours

---

#### 4.2 Additional Feed Pages (Future)
**Status**: ⚠️ **NOT STARTED**

**Target Files**:
- `nuke_frontend/src/pages/AuctionMarketplace.tsx`
- Any other feed/list views that render `VehicleCardDense`

**Enhancement**: Apply the same "batch external_listings → display_price" pattern to ensure consistency across all feed views.

**Effort Estimate**: 2-3 hours per page

---

## 📋 DETAILED EXECUTION PLAN

### Phase 1: Core Infrastructure ✅ COMPLETE

- [x] Fix BaT DOM map extractor (remove duplication, harden selectors)
- [x] Create orchestrator Edge Function (`bat-make-profiles-correct-runner`)
- [x] Add GitHub Action workflow for scheduled/manual runs
- [x] Add Admin UI button for manual triggering

### Phase 2: Image Ordering ✅ COMPLETE

- [x] Update `backfill-images` to write `position` field
- [x] Add self-healing logic to update NULL positions on re-runs
- [x] Update `VehicleProfile` image query sorting logic

### Phase 3: Frontend Price/Bid Display ✅ COMPLETE

- [x] Update `VehicleCardDense` price hierarchy
- [x] Update `CursorHomepage` to batch-load `external_listings`
- [x] Update `VehicleHeader` to prioritize auction data
- [x] Verify RLS policies allow public read of `external_listings`

### Phase 4: Optional Enhancements ⏳ PENDING

- [ ] Enhance `VehiclePriceSection` to show auction data (optional polish)
- [ ] Apply batch loading pattern to other feed pages (optional scalability)

---

## 🚀 HOW TO USE

### Manual Trigger (Admin UI)

1. Navigate to `/admin/mission-control`
2. Find "BaT Repair Loop: make profiles correct" section
3. Click button to run batch
4. View results: `scanned`, `candidates`, `repaired`, `failed`

### Manual Trigger (GitHub Actions)

```bash
# Via GitHub CLI:
gh workflow run bat-make-profiles-correct.yml \
  -f batch_size=20 \
  -f dry_run=false

# Or via GitHub UI:
# Actions → BaT Make Profiles Correct → Run workflow
```

### Manual Trigger (Direct API Call)

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/bat-make-profiles-correct-runner" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  --data '{
    "batch_size": 10,
    "dry_run": false,
    "min_vehicle_age_hours": 6
  }'
```

### Scheduled Runs

- **Frequency**: Daily at 03:15 UTC
- **Default batch size**: 10 vehicles
- **Rate limiting**: 6-hour cooldown per vehicle (prevents churn)

---

## 📊 MONITORING & VERIFICATION

### Monitoring Tools

#### 1. SQL Queries File
**Location**: `database/queries/MONITOR_BAT_REPAIR_LOOP.sql`

Contains 7 comprehensive monitoring queries:
- Recent repair attempts with status
- Repair success rate summary
- Currently incomplete vehicles (repair candidates)
- Repair failures with error messages
- Image ordering status
- Repair activity timeline (last 7 days)
- Quick health check

**Usage**:
```bash
# Using psql directly:
psql "$SUPABASE_DB_URL" -f database/queries/MONITOR_BAT_REPAIR_LOOP.sql

# Or run individual queries from the file
```

#### 2. Monitoring Script
**Location**: `scripts/monitor-bat-repair.sh`

Quick command-line monitoring script that runs 5 key queries:
- Quick health check (success/failed counts)
- Recent repair attempts (last 10)
- Incomplete vehicles count (repair candidates)
- Image ordering status
- Last 24 hours activity

**Usage**:
```bash
# Make executable (if not already):
chmod +x scripts/monitor-bat-repair.sh

# Run (requires SUPABASE_DB_URL env var or supabase CLI):
./scripts/monitor-bat-repair.sh

# Or with explicit DB URL:
SUPABASE_DB_URL="postgresql://..." ./scripts/monitor-bat-repair.sh
```

#### 3. Admin UI
**Location**: `/admin/mission-control`

The AdminMissionControl dashboard shows BaT repair results when you manually trigger a run. Results include:
- `scanned`: Total vehicles scanned
- `candidates`: Vehicles that need repair
- `repaired`: Successfully repaired vehicles
- `failed`: Failed repair attempts

### Success Metrics

1. **Image Count**: Incomplete vehicles should have >0 images after repair
2. **Description Length**: Descriptions should be ≥80 characters
3. **Location**: All repaired vehicles should have `listing_location` populated
4. **Comments**: All repaired vehicles should have >0 `auction_comments`
5. **Frontend Display**: Feed cards and profile headers show correct live bids

### Verification Queries (Quick Reference)

```sql
-- Check repair status:
SELECT 
  id,
  (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_attempt,
  (origin_metadata->'bat_repair'->>'attempts')::int as attempts,
  (origin_metadata->'bat_repair'->>'last_ok')::boolean as last_ok,
  (origin_metadata->'bat_repair'->>'last_error')::text as last_error
FROM vehicles
WHERE profile_origin = 'bat_import'
  AND origin_metadata->'bat_repair' IS NOT NULL
ORDER BY (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 50;

-- Check image ordering:
SELECT 
  vehicle_id,
  COUNT(*) as image_count,
  COUNT(position) as positioned_count,
  MIN(position) as min_position,
  MAX(position) as max_position
FROM vehicle_images
WHERE vehicle_id IN (
  SELECT id FROM vehicles WHERE profile_origin = 'bat_import' LIMIT 10
)
GROUP BY vehicle_id
ORDER BY vehicle_id;

-- Check incomplete vehicles (candidates for repair):
SELECT 
  v.id,
  v.profile_origin,
  COUNT(DISTINCT vi.id) as image_count,
  LENGTH(COALESCE(v.description, '')) as desc_len,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN false ELSE true END as has_location,
  COUNT(DISTINCT ac.id) as comment_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
LEFT JOIN auction_comments ac ON ac.vehicle_id = v.id
WHERE v.profile_origin = 'bat_import'
  OR v.discovery_source = 'bat_import'
  OR v.listing_url ILIKE '%bringatrailer.com/listing/%'
  OR v.discovery_url ILIKE '%bringatrailer.com/listing/%'
GROUP BY v.id, v.profile_origin, v.description, v.listing_location
HAVING 
  COUNT(DISTINCT vi.id) = 0
  OR LENGTH(COALESCE(v.description, '')) < 80
  OR v.listing_location IS NULL
  OR v.listing_location = ''
  OR COUNT(DISTINCT ac.id) = 0
ORDER BY v.updated_at ASC
LIMIT 50;
```

---

## 🔍 FILES MODIFIED

### Backend (Supabase Edge Functions)

1. `supabase/functions/_shared/batDomMap.ts` - Fixed duplication, hardened extractors
2. `supabase/functions/bat-make-profiles-correct-runner/index.ts` - **NEW** orchestrator
3. `supabase/functions/backfill-images/index.ts` - Added position tracking

### Frontend (React/TypeScript)

4. `nuke_frontend/src/pages/AdminMissionControl.tsx` - Added repair button
5. `nuke_frontend/src/components/vehicles/VehicleCardDense.tsx` - Updated price hierarchy
6. `nuke_frontend/src/pages/CursorHomepage.tsx` - Added batch external_listings loading
7. `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx` - Prioritized auction data
8. `nuke_frontend/src/pages/VehicleProfile.tsx` - Updated image sorting

### Infrastructure

9. `.github/workflows/bat-make-profiles-correct.yml` - **NEW** GitHub Action
10. `supabase/migrations/20251103000002_notification_system.sql` - RLS verified (no changes needed)

---

## 📝 NOTES

### Design Decisions

1. **Rate Limiting**: 6-hour cooldown per vehicle prevents repair churn on problematic listings
2. **Batch Size**: Default 10, max 50. Small batches reduce risk of rate limits/timeouts
3. **Dry Run Mode**: Allows testing without side effects
4. **Audit Trail**: All repair attempts stored in `origin_metadata.bat_repair.*` for debugging

### Dependencies

- `import-bat-listing` Edge Function (must exist and work correctly)
- `backfill-images` Edge Function (must write `position` field)
- `extract-auction-comments` Edge Function (triggered by `import-bat-listing`)
- `external_listings` table with RLS policy allowing public read
- `vehicle_images` table with `position` column
- `auction_comments` table for comment tracking

### Known Limitations

1. **Single Platform Focus**: Currently only handles BaT (`bringatrailer.com/listing/`)
2. **No Retry Logic**: Failed repairs are logged but not automatically retried (manual re-run required)
3. **No Progress Tracking**: Large batches show only final results, no incremental progress
4. **Vehicle Selection**: Only processes vehicles older than `min_vehicle_age_hours` (default 6 hours)

---

## ✅ CONCLUSION

**The BaT repair loop is production-ready and fully functional.** All critical components are implemented, tested, and verified:

- ✅ Orchestrator function selects and repairs incomplete BaT vehicles
- ✅ Image ordering is consistent and self-healing
- ✅ Frontend displays correct live bids/prices
- ✅ Scheduled automation via GitHub Actions
- ✅ Manual triggers via Admin UI
- ✅ Comprehensive audit trail

**Optional enhancements** (VehiclePriceSection, additional feed pages) can be tackled as polish work when time permits, but they are not blocking production use.

---

**Next Steps** (if continuing):

1. ✅ **Monitor first production run**: Use `./scripts/monitor-bat-repair.sh` or SQL queries in `database/queries/MONITOR_BAT_REPAIR_LOOP.sql`
2. **Tune batch size**: Adjust default batch size based on performance
3. **Add retry logic**: Implement exponential backoff for failed repairs
4. **Enhance monitoring**: Add dashboard/metrics for repair success rates (see `docs/BAT_REPAIR_MONITORING.md`)
5. **Polish enhancements**: Implement VehiclePriceSection auction display

---

## 📚 RELATED DOCUMENTATION

- **Monitoring Guide**: `docs/BAT_REPAIR_MONITORING.md` - Comprehensive monitoring queries and troubleshooting
- **SQL Queries**: `database/queries/MONITOR_BAT_REPAIR_LOOP.sql` - 7 detailed monitoring queries
- **Monitoring Script**: `scripts/monitor-bat-repair.sh` - Quick command-line monitoring

