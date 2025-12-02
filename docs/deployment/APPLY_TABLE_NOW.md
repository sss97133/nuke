# Apply user_vehicle_preferences Table - URGENT

## The Problem

The code is trying to use `user_vehicle_preferences` table but it doesn't exist in your database yet.

## Quick Fix (Choose One)

### Option 1: Supabase SQL Editor (EASIEST - 30 seconds)

1. Go to: https://supabase.com/dashboard → Your Project → **SQL Editor**
2. Click **New Query**
3. Copy the ENTIRE contents of: `supabase/sql/apply_user_vehicle_preferences.sql`
4. Paste and click **Run**
5. Done! ✅

### Option 2: Use the Migration File

1. Go to: https://supabase.com/dashboard → Your Project → **SQL Editor**
2. Copy the ENTIRE contents of: `supabase/migrations/20250127_user_vehicle_preferences.sql`
3. Paste and click **Run**

## What This Creates

- `user_vehicle_preferences` table with:
  - `is_favorite` - Mark vehicles as favorites
  - `is_hidden` - Hide from personal view
  - `collection_name` - Custom collections
  - `notes` - Personal notes
  - Proper indexes and RLS policies

## After Applying

- ✅ All errors will stop
- ✅ Favorites will work
- ✅ Collections will work
- ✅ Hide feature will work
- ✅ Bulk organization assignment will work

## Verification

After running, you should see:
```
✅ user_vehicle_preferences table created successfully!
```

If you see "already exists", the table is there and something else is wrong.

