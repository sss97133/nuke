# Apply BaT Comment Tracking Migration

## Step 1: Apply Migration

The migration needs to be applied to your Supabase database. You can do this via:

### Option A: Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `supabase/migrations/20250205_bat_comment_tracking_system.sql`
4. Paste and run the SQL

### Option B: Supabase CLI
```bash
supabase db push
```

Or manually:
```bash
psql $DATABASE_URL -f supabase/migrations/20250205_bat_comment_tracking_system.sql
```

## Step 2: Import Data

Once the migration is applied, run:

```bash
node scripts/import-bat-comments-to-db.js
```

This will:
- Create BaT user records for all commenters
- Create bat_listings records for each listing
- Create bat_comments records for each comment
- Link comments to vehicles when matched
- Update vehicles with BaT listing URLs and sale data

## Step 3: Verify

Check that data was imported:

```sql
-- Count imported data
SELECT 
  (SELECT COUNT(*) FROM bat_users) as users,
  (SELECT COUNT(*) FROM bat_listings) as listings,
  (SELECT COUNT(*) FROM bat_comments) as comments,
  (SELECT COUNT(*) FROM bat_listings WHERE vehicle_id IS NOT NULL) as linked_listings,
  (SELECT COUNT(*) FROM bat_comments WHERE vehicle_id IS NOT NULL) as linked_comments;

-- View comments for a specific vehicle
SELECT * FROM vehicle_bat_comment_timeline 
WHERE vehicle_id = 'YOUR_VEHICLE_ID'
ORDER BY event_date DESC;
```

