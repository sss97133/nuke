# Apply Analysis Queue Migration

## Quick Apply

**Run this SQL in Supabase Dashboard → SQL Editor:**

1. Open: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new
2. Copy and paste the contents of: `scripts/apply-migration-direct.sql`
3. Click "Run"
4. Verify success by checking for `analysis_queue` table

## What Gets Created

### Table
- `analysis_queue` - Tracks all analysis requests with retry logic

### Functions
- `queue_analysis()` - Queue a new analysis
- `get_analysis_batch()` - Get next batch to process
- `mark_analysis_processing()` - Mark as processing
- `mark_analysis_completed()` - Mark as completed
- `mark_analysis_failed()` - Mark as failed (with retry)
- `get_analysis_status()` - Get status for a vehicle
- `auto_queue_expert_valuation()` - Auto-queue trigger function

### Triggers
- `auto_queue_valuation_on_vehicle_create` - Auto-queue on vehicle creation
- `auto_queue_valuation_on_image_add` - Auto-queue on image addition

### Indexes
- Status/priority/retry index
- Vehicle ID index
- Retry timestamp index
- Created timestamp index

## Verification

After applying, run:
```sql
-- Check table exists
SELECT COUNT(*) FROM analysis_queue;

-- Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE '%analysis%';

-- Check triggers exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE '%queue%';
```

## Alternative: Use Supabase CLI

```bash
cd /Users/skylar/nuke
supabase db push
```

This will apply all pending migrations.

