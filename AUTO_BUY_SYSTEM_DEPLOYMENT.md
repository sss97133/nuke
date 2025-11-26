# Auto-Buy System Deployment Guide

## Overview

The Auto-Buy System allows users to set up automatic buy orders (like limit orders in stock market) that execute when vehicle prices hit target levels or when matching vehicles become available.

## System Components

### 1. Database Schema
- **`vehicle_watchlist`** - Extended with auto-buy columns
- **`auto_buy_executions`** - Tracks all auto-buy executions
- **`price_monitoring`** - Monitors price changes for triggers
- **Functions**: `check_auto_buy_trigger()`, `execute_auto_buy()`

### 2. Edge Functions
- **`execute-auto-buy`** - Executes auto-buy orders
- **`monitor-price-drops`** - Monitors prices and triggers auto-buys

### 3. Frontend Components
- **`/watchlists`** - Watchlist management page
- **`CreateWatchlistModal`** - Create/edit watchlists with auto-buy settings
- **`AutoBuyExecutionList`** - View auto-buy execution history

## Deployment Steps

### Step 1: Apply Database Migration

**Option A: Via Supabase Dashboard (Recommended)**
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/20251127000002_auto_buy_execution_system.sql`
3. Paste and run

**Option B: Via CLI**
```bash
./scripts/apply-auto-buy-system.sh
```

**Option C: Manual SQL**
```bash
# First, ensure watchlist table has auto-buy columns
# Then apply the auto-buy execution system migration
psql $DATABASE_URL -f supabase/migrations/20251127000002_auto_buy_execution_system.sql
```

### Step 2: Deploy Edge Functions

```bash
./scripts/deploy-auto-buy-functions.sh
```

Or manually:
```bash
supabase functions deploy execute-auto-buy --project-ref qkgaybvrernstplzjaam --no-verify-jwt
supabase functions deploy monitor-price-drops --project-ref qkgaybvrernstplzjaam --no-verify-jwt
```

### Step 3: Build and Deploy Frontend

```bash
cd nuke_frontend
npm run build
vercel --prod --force --yes
```

### Step 4: Set Up Price Monitoring (Cron Job)

The `monitor-price-drops` function should be called periodically (every 5-10 minutes) to check for price changes.

**Option A: Supabase Cron Jobs (Recommended)**
```sql
-- Create a cron job to run every 5 minutes
SELECT cron.schedule(
  'monitor-price-drops',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-price-drops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

**Option B: External Cron Service**
```bash
# Add to crontab (runs every 5 minutes)
*/5 * * * * curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-price-drops" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**Option C: GitHub Actions**
Create `.github/workflows/monitor-prices.yml`:
```yaml
name: Monitor Price Drops
on:
  schedule:
    - cron: '*/5 * * * *' # Every 5 minutes
  workflow_dispatch:

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - name: Monitor Prices
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/monitor-price-drops" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"
```

## Testing

### 1. Create a Test Watchlist
1. Navigate to `/watchlists`
2. Click "Create Watchlist"
3. Set criteria (e.g., "1958-1965 Citroen 2CV")
4. Enable auto-buy with max price $30,000
5. Enable price drop monitoring with target $25,000

### 2. Test Price Monitoring
```bash
# Manually trigger price monitoring
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-price-drops" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

### 3. Test Auto-Buy Execution
```bash
# Create a test execution (via SQL or API)
# Then confirm it via the UI at /watchlists (Executions tab)
```

## Features

### Auto-Buy Types
1. **Price Drop Buy** - Executes when price drops to target (like limit buy orders)
2. **Auto-Bid** - Automatically places bids on auctions
3. **Buy Now** - Executes buy-now purchases immediately
4. **Reserve Met Bid** - Places bid when reserve is met

### Safety Features
- **Confirmation Required** - Default requires user confirmation before executing
- **Maximum Price Limits** - Can't exceed set maximum
- **Execution Tracking** - All executions logged and tracked
- **Error Handling** - Failed executions logged with error messages

## Usage Examples

### Example 1: Price Drop Sniping
```
User sets: "Auto-buy if 1967 Porsche 911 drops to $45,000"
System: Monitors all 1967 Porsche 911 listings
When price hits $45,000 → Auto-buy executes
```

### Example 2: New Listing Auto-Buy
```
User sets: "Auto-buy any 1958 Citroen 2CV from Viva under $30,000"
Viva lists new 2CV at $28,000
System: Matches criteria → Executes auto-buy immediately
```

### Example 3: Auction Auto-Bidding
```
User sets: "Auto-bid on any 1965 Mustang up to $50,000"
Auction starts, reserve met
System: Automatically bids up to $50,000
```

## Monitoring

### Check Active Watchlists
```sql
SELECT COUNT(*) FROM vehicle_watchlist 
WHERE is_active = true AND auto_buy_enabled = true;
```

### Check Pending Executions
```sql
SELECT COUNT(*) FROM auto_buy_executions 
WHERE status IN ('pending', 'executing');
```

### Check Price Monitoring
```sql
SELECT COUNT(*) FROM price_monitoring 
WHERE is_active = true;
```

## Troubleshooting

### Executions Not Triggering
1. Check if watchlist is active: `is_active = true`
2. Check if auto-buy is enabled: `auto_buy_enabled = true`
3. Verify price monitoring is running (check cron job)
4. Check function logs in Supabase Dashboard

### Executions Failing
1. Check `auto_buy_executions.error_message` for details
2. Verify payment method is set (if required)
3. Check vehicle listing status
4. Review edge function logs

## Next Steps

1. ✅ Database schema created
2. ✅ Edge functions created
3. ✅ Frontend UI created
4. ⏳ Apply migration to database
5. ⏳ Deploy edge functions
6. ⏳ Set up price monitoring cron job
7. ⏳ Test end-to-end
8. ⏳ Add payment integration (Stripe)
9. ⏳ Add email notifications for executions

## Files Created

- `supabase/migrations/20251127000002_auto_buy_execution_system.sql`
- `supabase/functions/execute-auto-buy/index.ts`
- `supabase/functions/monitor-price-drops/index.ts`
- `nuke_frontend/src/pages/Watchlists.tsx`
- `nuke_frontend/src/components/watchlist/CreateWatchlistModal.tsx`
- `nuke_frontend/src/components/watchlist/AutoBuyExecutionList.tsx`
- `scripts/apply-auto-buy-system.sh`
- `scripts/deploy-auto-buy-functions.sh`

