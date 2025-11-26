# Apply Database Migration - URGENT

## Error

The `user_vehicle_preferences` table doesn't exist, causing errors. You need to apply the migration.

## Quick Fix

Run this command in your terminal:

```bash
cd /Users/skylar/nuke
supabase migration up
```

Or apply the migration manually via Supabase Dashboard:

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Database** → **Migrations**
4. Click **New Migration**
5. Copy the contents of `supabase/migrations/20250127_user_vehicle_preferences.sql`
6. Paste and apply

## What This Migration Creates

- `user_vehicle_preferences` table for:
  - Favorites
  - Collections
  - Hidden vehicles
  - Personal notes

## After Applying

The errors will stop and all organization tools will work properly.

