# Apply Dropbox Import Fix Migration

## Quick Apply

The migration file is ready: `supabase/migrations/20251126000001_fix_dropbox_import_tracking.sql`

### Option 1: Using the Script (Recommended)

```bash
export SUPABASE_DB_PASSWORD='RbzKq32A0uhqvJMQ'
./scripts/apply-dropbox-fix.sh
```

### Option 2: Using Supabase CLI

If you have Supabase CLI properly configured:

```bash
supabase db push
```

### Option 3: Using psql Directly

```bash
export SUPABASE_DB_PASSWORD='RbzKq32A0uhqvJMQ'
psql "postgresql://postgres.qkgaybvrernstplzjaam:${SUPABASE_DB_PASSWORD}@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres" \
  -f supabase/migrations/20251126000001_fix_dropbox_import_tracking.sql
```

### Option 4: Using Supabase Dashboard

1. Go to Supabase Dashboard → SQL Editor
2. Copy the contents of `supabase/migrations/20251126000001_fix_dropbox_import_tracking.sql`
3. Paste and execute

## What This Migration Does

1. **Backfills 26 orphaned vehicles:**
   - Sets `uploaded_by` to Viva user ID
   - Sets `discovery_source = 'dropbox_bulk_import'`
   - Changes `profile_origin` from 'bulk_import_legacy' to 'dropbox_import'
   - Adds correction metadata
   - Links to Viva organization

2. **Strengthens trigger:**
   - Detects Dropbox imports by `origin_metadata->>'import_method'`
   - Detects automation patterns (user_id without uploaded_by)
   - Sets 'automated_import_legacy' for suspicious cases

3. **Adds validation trigger:**
   - Warns on vehicles without proper tracking
   - Warns on Dropbox imports without discovery_source

## Verification

After applying, verify with:

```sql
SELECT 
  COUNT(*) as vehicles_fixed,
  COUNT(CASE WHEN uploaded_by IS NOT NULL THEN 1 END) as with_uploaded_by,
  COUNT(CASE WHEN discovery_source = 'dropbox_bulk_import' THEN 1 END) as with_discovery_source,
  COUNT(CASE WHEN profile_origin = 'dropbox_import' THEN 1 END) as with_correct_origin
FROM vehicles
WHERE origin_metadata->>'backfilled_uploaded_by' = 'true';
```

Should return: 26 vehicles fixed

