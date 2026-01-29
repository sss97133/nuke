# Missing Database Infrastructure - Fixed

## Overview

This document describes the missing database infrastructure that was identified and fixed to support the platform-native tier system.

## Issues Found

### 1. `vehicle_receipts` Table Missing

**Problem:** The tier system references `vehicle_receipts` but only `receipts` table exists.

**Solution:** Created `vehicle_receipts` as a VIEW that filters `receipts` to only vehicle-related receipts. This allows the tier system to query `vehicle_receipts` directly without schema changes.

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 2. Missing Columns on `receipts` Table

**Problem:** The tier system needs:
- `timeline_event_id` - Link receipts to timeline events
- `part_number` - Part numbers extracted from receipts
- `receipt_date` - DATE type (may be `purchase_date` as TIMESTAMPTZ)

**Solution:**
- Added `timeline_event_id` column with FK to `vehicle_timeline_events`
- Added `part_number` column (extracted from metadata if available)
- Added `receipt_date` DATE column with sync trigger to `purchase_date`

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 3. Missing Columns on `image_tags` Table

**Problem:** The tier system needs:
- `vehicle_id` - Direct reference to vehicle (currently only via `image_id` -> `vehicle_images` -> `vehicle_id`)
- `tag_name` - Normalized tag name
- `oem_part_number` - OEM part number
- `part_type` - Part type classification

**Solution:**
- Added all missing columns
- Backfilled `tag_name` from `tag_text`
- Backfilled `vehicle_id` from `image_id` -> `vehicle_images`
- Added indexes for performance

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 4. `vehicle_timeline_events.event_date` Type Mismatch

**Problem:** The tier system expects `event_date` as DATE, but it may be TIMESTAMPTZ.

**Solution:**
- Tier system queries use `DATE(event_date)` casting, so no schema change needed
- Added comment documenting the expected usage
- Tier calculations handle both types correctly

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql` (documentation only)
- `supabase/migrations/20251229000000_platform_native_tier_system.sql` (uses DATE() casting)

### 5. Missing `taken_at` Column on `vehicle_images`

**Problem:** The tier system needs EXIF date/time for temporal value calculations.

**Solution:**
- Added `taken_at` TIMESTAMPTZ column
- Extract from metadata if available (`taken_at`, `exif_date`, `date_taken`, `original_date`)
- Added index for performance

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 6. Missing `timeline_event_id` on `vehicle_images`

**Problem:** The tier system links images to timeline events for verification.

**Solution:**
- Added `timeline_event_id` column with FK to `vehicle_timeline_events`
- Added index

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 7. `organizations.is_verified` Column Missing

**Problem:** The tier system checks if organizations are verified for builder verification scoring.

**Solution:**
- Added `is_verified` BOOLEAN column to `organizations`
- If `organizations` doesn't exist but `businesses` does, added `is_verified` to `businesses` and created `organizations` as a view
- Added index

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 8. `external_identities.user_id` Column Missing

**Problem:** The tier system checks `external_identities.user_id` but the table has `claimed_by_user_id`.

**Solution:**
- Added `user_id` column
- Created sync trigger with `claimed_by_user_id`
- Backfilled existing data
- Added index

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 9. `business_ownership` References

**Problem:** The tier system checks `business_ownership.organization_id` but it may reference `businesses.id`.

**Solution:**
- Added `organization_id` column if `organizations` table exists
- The tier system handles both cases (checks both `business_ownership` and `organization_contributors`)

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

### 10. Missing Performance Indexes

**Problem:** Tier calculation queries need indexes for performance.

**Solution:**
- Added indexes on:
  - `vehicle_images(user_id, created_at)`
  - `vehicle_images(vehicle_id, created_at)`
  - `vehicle_timeline_events(user_id, created_at)`
  - `vehicle_timeline_events(vehicle_id, event_date)`
  - `receipts(user_id, created_at)`
  - `receipts(vehicle_id, receipt_date)`
  - `receipts(timeline_event_id)`
  - `receipts(part_number)`
  - `image_tags(vehicle_id)`
  - `image_tags(tag_name)`
  - `image_tags(oem_part_number)`
  - `vehicle_images(taken_at)`
  - `vehicle_images(timeline_event_id)`

**Files Changed:**
- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql`

## Migration Order

1. **First:** Apply `20251229000001_tier_system_missing_infrastructure.sql`
   - Creates missing tables/views
   - Adds missing columns
   - Creates indexes
   - Backfills data

2. **Second:** Apply `20251229000000_platform_native_tier_system.sql`
   - Creates tier calculation functions
   - Creates triggers
   - Depends on infrastructure from step 1

## Verification

After applying both migrations, verify:

```sql
-- Check vehicle_receipts view exists
SELECT * FROM vehicle_receipts LIMIT 1;

-- Check receipts has new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'receipts' 
  AND column_name IN ('timeline_event_id', 'part_number', 'receipt_date');

-- Check image_tags has new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'image_tags' 
  AND column_name IN ('vehicle_id', 'tag_name', 'oem_part_number', 'part_type');

-- Check vehicle_images has new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicle_images' 
  AND column_name IN ('taken_at', 'timeline_event_id');

-- Check organizations has is_verified
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('organizations', 'businesses') 
  AND column_name = 'is_verified';

-- Check external_identities has user_id
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'external_identities' 
  AND column_name = 'user_id';

-- Test tier calculation (should not error)
SELECT calculate_platform_tier_score('00000000-0000-0000-0000-000000000000'::UUID);
```

## Notes

- All changes are **idempotent** (use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`)
- Data is **backfilled** where possible
- **Triggers** maintain data consistency
- **Views** are used to avoid breaking existing code
- **Indexes** are added for performance

## Files Created

- `supabase/migrations/20251229000001_tier_system_missing_infrastructure.sql` (~400 lines)

## Related Documentation

- `docs/systems/TIER_SYSTEM_ARCHITECTURE.md` - Tier system architecture
- `docs/systems/PLATFORM_TIER_IMPLEMENTATION.md` - Implementation guide
- `PLATFORM_TIER_IMPLEMENTATION_STATUS.md` - Implementation status

