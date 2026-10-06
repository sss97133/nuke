# ✅ Auto-Buy System Migration - Ready to Apply!

## Migration File
**Location:** `supabase/migrations/20251127000003_apply_auto_buy_system.sql`

## Quick Apply (3 Steps)

### Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project: `qkgaybvrernstplzjaam`
3. Click **SQL Editor** in the left sidebar

### Step 2: Copy Migration
```bash
# View the file
cat supabase/migrations/20251127000003_apply_auto_buy_system.sql

# Or open it in your editor
```

### Step 3: Run Migration
1. Click **New Query** in SQL Editor
2. Paste the entire migration file contents
3. Click **Run** (or press Cmd/Ctrl + Enter)
4. Wait for "Success" message

## What Gets Created

✅ **Tables:**
- `auto_buy_executions` - Tracks all auto-buy order executions
- `price_monitoring` - Monitors price changes for triggers

✅ **Columns Added to `vehicle_watchlist`:**
- `auto_buy_enabled`
- `auto_buy_max_price`
- `auto_buy_type`
- `auto_buy_bid_increment`
- `auto_buy_max_bid`
- `auto_buy_requires_confirmation`
- `auto_buy_payment_method_id`
- `price_drop_target`
- `price_drop_monitoring`
- `auto_buy_executions` (counter)

✅ **Functions:**
- `check_auto_buy_trigger()` - Checks if price triggers auto-buy
- `execute_auto_buy()` - Executes auto-buy orders

✅ **Security:**
- RLS policies for all tables
- User isolation (users only see their own data)

✅ **Performance:**
- Indexes on all key columns
- Optimized queries

## Verification

After applying, run this in SQL Editor:

```sql
-- Check tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('auto_buy_executions', 'price_monitoring');

-- Check functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('check_auto_buy_trigger', 'execute_auto_buy');

-- Check watchlist columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'vehicle_watchlist' 
AND column_name LIKE 'auto_buy%'
ORDER BY column_name;
```

Expected results:
- **Tables:** 2 rows (auto_buy_executions, price_monitoring)
- **Functions:** 2 rows (check_auto_buy_trigger, execute_auto_buy)
- **Columns:** 10 rows (all auto_buy columns)

## Next Steps After Migration

1. **Deploy Edge Functions:**
   ```bash
   ./scripts/deploy-auto-buy-functions.sh
   ```

2. **Build Frontend:**
   ```bash
   cd nuke_frontend
   npm run build
   ```

3. **Deploy to Production:**
   ```bash
   vercel --prod --force --yes
   ```

4. **Set Up Price Monitoring Cron:**
   See `AUTO_BUY_SYSTEM_DEPLOYMENT.md` for cron job setup

## Troubleshooting

### "column already exists"
✅ **Safe to ignore** - Migration uses `IF NOT EXISTS` checks

### "relation does not exist"
❌ **Need to run base watchlist migration first:**
   - Run `supabase/migrations/20251127000001_vehicle_watchlist_system.sql` first

### "permission denied"
❌ **Check authentication:**
   - Make sure you're logged into Supabase Dashboard
   - Verify you have admin access to the project

## Migration is Idempotent

✅ **Safe to run multiple times** - The migration checks for existing objects before creating them

---

**Ready to go!** Just copy/paste the migration file into Supabase SQL Editor and run it! 🚀

