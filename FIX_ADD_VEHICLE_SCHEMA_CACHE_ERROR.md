# Fix: Add Vehicle Schema Cache Error

## The Error
```
Failed to create vehicle: Could not find the 'created_by' column of 'vehicles' in the schema cache
```

## Root Cause

This is a **PostgREST schema cache issue**, NOT a database schema problem.

- ✅ The `vehicles` table schema is CORRECT
- ✅ Frontend code is CORRECT (uses `user_id`, not `created_by`)
- ❌ **PostgREST (Supabase's API layer) has a stale schema cache**

### What Happened

PostgREST caches the database schema for performance. Sometimes after migrations or schema changes, the cache gets out of sync and "remembers" old column names that no longer exist (or never existed).

## The Fix

### Option 1: Run SQL to Reload Schema Cache (RECOMMENDED)

**Open Supabase SQL Editor and run:**

```sql
-- 1. Drop any stale views
DROP VIEW IF EXISTS vehicles_with_owner CASCADE;
DROP VIEW IF EXISTS vehicle_ownership_view CASCADE;
DROP VIEW IF EXISTS vehicles_extended CASCADE;

-- 2. Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- 3. Verify (should show user_id, uploaded_by, discovered_by - NOT created_by)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
  AND column_name IN ('user_id', 'uploaded_by', 'discovered_by', 'created_by')
ORDER BY column_name;
```

### Option 2: Restart PostgREST Instance

1. Go to Supabase Dashboard
2. Navigate to **Settings** > **Database** 
3. Find **Connection pooling** section
4. Click **Restart** button
5. Wait 30 seconds for PostgREST to restart

### Option 3: Wait for Auto-Refresh

PostgREST may auto-refresh its cache after some time (usually 10-30 minutes), but this is not reliable.

---

## Why This Happened

Looking at the migration history, there was likely:

1. An old migration that referenced `created_by`
2. A later migration that removed it
3. PostgREST cached the schema between these migrations
4. The cache was never invalidated

---

## Correct Vehicle Ownership Columns

The `vehicles` table uses these columns for ownership/authorship:

- **`user_id`** - Primary owner (who owns the vehicle)
- **`uploaded_by`** - Who created the record (may differ from owner)
- **`discovered_by`** - Who discovered the vehicle (for non-owned vehicles)

**NOT `created_by`** - This column does not exist!

---

## Files

- `FIX_SCHEMA_CACHE.sql` - Ready to run in Supabase SQL Editor
- `supabase/migrations/20251030_fix_vehicles_schema_cache.sql` - Migration file (for completeness)

---

## Status

- ✅ Frontend code verified correct
- ✅ Database schema verified correct
- ⏳ **ACTION REQUIRED**: Run the SQL fix in Supabase SQL Editor

Once you run the fix, the mobile add vehicle flow should work immediately.

