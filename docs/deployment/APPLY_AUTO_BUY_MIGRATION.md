# Apply Auto-Buy System Migration

## Quick Apply Instructions

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor**
4. Click **New Query**
5. Copy the entire contents of `supabase/migrations/20251127000003_apply_auto_buy_system.sql`
6. Paste into the SQL Editor
7. Click **Run** (or press Cmd/Ctrl + Enter)

### Option 2: Supabase CLI

```bash
# Make sure you're logged in
supabase login

# Link to your project (if not already linked)
supabase link --project-ref qkgaybvrernstplzjaam

# Apply the migration
supabase db push
```

### Option 3: Direct SQL Connection

```bash
# If you have direct database access
psql $DATABASE_URL -f supabase/migrations/20251127000003_apply_auto_buy_system.sql
```

## What This Migration Does

1. ✅ Adds auto-buy columns to `vehicle_watchlist` table (if they don't exist)
2. ✅ Creates `auto_buy_executions` table for tracking order executions
3. ✅ Creates `price_monitoring` table for price tracking
4. ✅ Creates `check_auto_buy_trigger()` function
5. ✅ Creates `execute_auto_buy()` function
6. ✅ Sets up RLS policies for security
7. ✅ Creates indexes for performance

## Verification

After applying, verify with these queries:

```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('auto_buy_executions', 'price_monitoring');

-- Check if functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('check_auto_buy_trigger', 'execute_auto_buy');

-- Check watchlist columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'vehicle_watchlist' 
AND column_name LIKE 'auto_buy%';
```

## Troubleshooting

### Error: "column already exists"
- This is safe to ignore - the migration uses `IF NOT EXISTS` checks
- The migration is idempotent and can be run multiple times

### Error: "permission denied"
- Make sure you're using the service role key or have proper permissions
- Check that RLS policies are correctly set up

### Error: "relation does not exist"
- Make sure `vehicle_watchlist` table exists first
- Run the base watchlist migration if needed: `20251127000001_vehicle_watchlist_system.sql`

## Next Steps

After migration is applied:

1. Deploy edge functions:
   ```bash
   ./scripts/deploy-auto-buy-functions.sh
   ```

2. Build and deploy frontend:
   ```bash
   cd nuke_frontend
   npm run build
   vercel --prod --force --yes
   ```

3. Set up price monitoring cron job (see `AUTO_BUY_SYSTEM_DEPLOYMENT.md`)

