# Automated Duplicate Detection and Merge System

## Overview

This system automatically detects and merges duplicate vehicle profiles, then notifies all related users.

## How It Works

### 1. Detection Logic (`detect_vehicle_duplicates`)

The system detects duplicates using multiple match types:

- **VIN Exact Match (100% confidence)**: Same real VIN = definite duplicate
- **Year/Make/Model + Fake VIN (95% confidence)**: Same year/make/model where one has real VIN and other has placeholder (VIVA-...)
- **Year/Make/Model + Same Fake VIN (90% confidence)**: Same year/make/model with same placeholder VIN
- **Year/Make/Model Match (85% confidence)**: Same year/make/model (requires manual review)

### 2. Automatic Merging (`auto_merge_duplicates_with_notification`)

When duplicates are detected with confidence >= 95%, the system:

1. **Merges Data**: Combines data from both vehicles, preferring:
   - Real VIN over placeholder VIN
   - Non-null values
   - Higher values (for pricing)
   - Combines descriptions and notes

2. **Moves Related Data**: Transfers all related records:
   - Images
   - Timeline events
   - Organization links
   - Comments
   - Contractor work
   - Price history

3. **Sends Notifications**: Notifies all related users:
   - Vehicle owners (uploaded_by, user_id)
   - Vehicle contributors
   - Organization members with vehicle access

4. **Creates Timeline Event**: Records the merge in vehicle history

5. **Deletes Duplicate**: Removes the duplicate vehicle profile

### 3. Automated Trigger (`trigger_auto_detect_duplicates`)

A database trigger automatically checks for duplicates when:
- A new vehicle is created
- A vehicle's year, make, model, or VIN is updated

The trigger only auto-merges if confidence >= 95% to avoid false positives.

## Usage

### Manual Merge

```sql
SELECT auto_merge_duplicates_with_notification(
  'primary-vehicle-id'::UUID,    -- Vehicle to keep
  'duplicate-vehicle-id'::UUID,  -- Vehicle to merge
  'year_make_model_fake_vin'::TEXT,
  95,                             -- Confidence score
  NULL                            -- NULL for auto-merge, or user_id for manual merge
);
```

### Check for Duplicates

```sql
SELECT * FROM detect_vehicle_duplicates('vehicle-id'::UUID);
```

### Auto-Check and Merge

```sql
SELECT check_and_auto_merge_duplicates(
  'vehicle-id'::UUID,
  95  -- Auto-merge threshold
);
```

## Notification Details

When a merge occurs, notifications are sent to:
- Vehicle owners (uploaded_by, user_id)
- Vehicle contributors
- Organization members with active vehicle relationships

Notification includes:
- Title: "Vehicle Profiles Merged"
- Message: Details about the merge
- Metadata: Vehicle IDs, match type, confidence, action URL

## Example: Recent Merge

**Primary Vehicle**: `ef844607-46fc-40a5-a27b-ad245ffe5ef5` (1973 Chevrolet K20, VIN: CKY243Z178481)
**Duplicate Vehicle**: `c3ee7cc3-76ef-4a71-aad0-843d4a8c3c59` (1973 Chev Y24, VIN: VIVA-1762059705059)

**Match Type**: `year_make_model_fake_vin` (95% confidence)
**Result**: Duplicate merged into primary, notification sent to user `0b9f107a-d124-49de-9ded-94698f63c1c4`

## Files Created

1. `supabase/migrations/20251201000006_automated_duplicate_detection_and_merge.sql` - Core functions
2. `supabase/migrations/20251201000007_auto_detect_duplicates_trigger.sql` - Automated trigger

## Future Enhancements

- Scheduled job to check all vehicles periodically
- Manual review queue for lower-confidence matches
- Merge proposal system for user approval
- Batch duplicate detection for bulk imports

