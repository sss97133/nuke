# Apply Analysis Queue Migration - Instructions

## ✅ Ready to Apply

The migration is ready. You have **two options**:

## Option 1: Supabase Dashboard (Recommended)

1. **Go to Supabase Dashboard:**
   - https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new

2. **Open the migration file:**
   - File: `scripts/apply-migration-direct.sql`
   - This is a **consolidated, ready-to-run** SQL file

3. **Copy and paste** the entire contents

4. **Click "Run"**

5. **Verify success:**
   ```sql
   SELECT COUNT(*) FROM analysis_queue;
   SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%analysis%';
   ```

## Option 2: Supabase CLI (If configured)

```bash
cd /Users/skylar/nuke
export PGPASSWORD='RbzKq32A0uhqvJMQ'
supabase db push
```

## What Gets Applied

### ✅ Table
- `analysis_queue` - Complete with all columns and indexes

### ✅ Functions (7 total)
- `queue_analysis()` - Queue new analysis
- `get_analysis_batch()` - Get next batch
- `mark_analysis_processing()` - Mark processing
- `mark_analysis_completed()` - Mark completed  
- `mark_analysis_failed()` - Mark failed with retry
- `get_analysis_status()` - Get status
- `auto_queue_expert_valuation()` - Auto-queue trigger

### ✅ Triggers (2 total)
- Auto-queue on vehicle creation
- Auto-queue on image addition

### ✅ RLS Policies
- Users can view their vehicle analyses
- System can manage queue

## After Applying

Run the assessment again to verify:
```bash
node scripts/run-db-assessment.js
```

You should see:
```
✅ analysis_queue table exists!
```

## Files Created

- `scripts/apply-migration-direct.sql` - **Use this file** (consolidated, ready to run)
- `scripts/apply-analysis-queue-migration.js` - Alternative script (may need manual steps)
- `APPLY_ANALYSIS_QUEUE_MIGRATION.md` - Quick reference

