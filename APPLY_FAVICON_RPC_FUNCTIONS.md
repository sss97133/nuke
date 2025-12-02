# Apply Favicon RPC Functions

The favicon RPC functions (`get_source_favicon` and `upsert_source_favicon`) are missing from the database, causing 404 errors in the frontend.

## Apply Migration

Run this SQL in the Supabase Dashboard SQL Editor:

```sql
-- Apply favicon RPC functions
-- File: supabase/migrations/20250201_apply_favicon_rpc_functions.sql
```

Or apply the migration file directly:

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/20250201_apply_favicon_rpc_functions.sql`
3. Run the SQL

## Verify

After applying, verify the functions exist:

```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('get_source_favicon', 'upsert_source_favicon');
```

Both functions should appear in the results.

