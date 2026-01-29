# Market Intelligence Initiative - Deployment Guide

## Overview
This guide covers the deployment of the Market Intelligence & Investment Analytics system for the Nuke vehicle platform.

## Components Built

### 1. Database Schema
**File:** `/Users/skylar/nuke/supabase/migrations/20260125000002_market_intelligence_schema.sql`

Creates:
- `market_indexes` - Index definitions (SQBDY-50, CLSC-100, PROJ-ACT, MKTV-USD)
- `market_index_values` - Time series data (OHLCV format)
- `market_index_components` - What makes up each index
- `investment_packages` - Investment-like product definitions
- `package_holdings` - Vehicles in each package
- `projection_outcomes` - Projection accuracy tracking (RLM feedback loop)
- `analysis_feedback` - User feedback on AI insights

### 2. Edge Function
**File:** `/Users/skylar/nuke/supabase/functions/calculate-market-indexes/index.ts`
**Status:** ✅ Deployed

Calculates daily index values:
- SQBDY-50: Top 50 squarebody trucks by recent pricing
- CLSC-100: Top 100 classic vehicles by value
- PROJ-ACT: Project activity momentum
- MKTV-USD: Overall market velocity

### 3. Frontend Service
**File:** `/Users/skylar/nuke/nuke_frontend/src/services/marketIndexService.ts`
**Status:** ✅ Built and compiled

Provides:
- `getIndexes()` - List all indexes
- `getLatestIndexValues()` - Current values for all indexes
- `getIndexHistory(indexId, days)` - Time series data
- `getIndexComponents(indexId)` - Index composition
- `getIndexPerformance(indexCode)` - Comprehensive performance data
- `recalculateIndexes()` - Trigger edge function

### 4. Dashboard Page
**File:** `/Users/skylar/nuke/nuke_frontend/src/pages/MarketIntelligence.tsx`
**Status:** ✅ Built and compiled

Features:
- Display all indexes with current values
- 7-day trend charts (expandable)
- Change indicators (1D, 7D, 30D)
- System statistics
- Manual recalculation trigger
- Coming soon roadmap

## Deployment Steps

### Step 1: Run Database Migration

**Option A: Via Supabase Dashboard SQL Editor**
1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new
2. Copy the entire contents of `supabase/migrations/20260125000002_market_intelligence_schema.sql`
3. Paste and run
4. Verify success (should see "Market Intelligence schema deployed successfully")

**Option B: Via psql (if you have direct database access)**
```bash
cd /Users/skylar/nuke
psql <your-database-url> -f supabase/migrations/20260125000002_market_intelligence_schema.sql
```

**Option C: Via Supabase CLI (if configured)**
```bash
cd /Users/skylar/nuke
supabase db push
```

### Step 2: Verify Tables Created

Run this query in SQL editor:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'market_%'
  OR table_name LIKE '%package%'
  OR table_name IN ('projection_outcomes', 'analysis_feedback')
ORDER BY table_name;
```

Should return:
- analysis_feedback
- market_index_components
- market_index_values
- market_indexes
- investment_packages
- package_holdings
- projection_outcomes

### Step 3: Verify Seed Data

Check initial indexes were created:
```sql
SELECT index_code, index_name, is_active
FROM market_indexes
ORDER BY index_code;
```

Should return:
- CLSC-100 - Classic 100 Index
- MKTV-USD - Market Velocity Index
- PROJ-ACT - Project Activity Index
- SQBDY-50 - Squarebody 50 Index

### Step 4: Calculate Initial Index Values

Run the edge function to populate initial data:
```bash
dotenvx run -- bash -c 'curl -X POST "$VITE_SUPABASE_URL/functions/v1/calculate-market-indexes" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}"'
```

Expected response:
```json
{
  "success": true,
  "date": "2026-01-25",
  "indexes_calculated": 4,
  "results": [
    {
      "index_code": "SQBDY-50",
      "index_name": "Squarebody 50 Index",
      "value": 45000,
      "count": 50,
      "metadata": {...}
    },
    ...
  ]
}
```

### Step 5: Add Route to Frontend

Add the route to your router configuration:

```typescript
import MarketIntelligence from './pages/MarketIntelligence';

// In your routes array:
{
  path: '/market-intelligence',
  element: <MarketIntelligence />
}
```

### Step 6: Add Navigation Link

Add link to navigation menu:
```tsx
<Link to="/market-intelligence">Market Intelligence</Link>
```

### Step 7: Set Up Daily Cron Job (Optional)

Add cron job to automatically recalculate indexes daily:

```sql
SELECT cron.schedule(
  'calculate-market-indexes-daily',
  '0 2 * * *', -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/calculate-market-indexes',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true)
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object()
  );
  $$
);
```

## Verification Checklist

- [ ] Migration ran successfully (all 7 tables created)
- [ ] 4 seed indexes exist in `market_indexes` table
- [ ] Edge function deployed (`calculate-market-indexes`)
- [ ] Edge function runs successfully (returns index values)
- [ ] Frontend builds without errors
- [ ] `MarketIntelligence.tsx` page accessible
- [ ] Dashboard displays indexes and values
- [ ] Charts render for 7-day history
- [ ] "Recalculate Indexes" button works

## Testing

### Manual Test Flow
1. Navigate to `/market-intelligence`
2. Verify 4 indexes are displayed (SQBDY-50, CLSC-100, PROJ-ACT, MKTV-USD)
3. Check current values are shown
4. Click on an index to expand 7-day chart
5. Click "Recalculate Indexes" button
6. Verify values update

### API Test
```bash
# Get all indexes
curl "$VITE_SUPABASE_URL/rest/v1/market_indexes?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"

# Get index values
curl "$VITE_SUPABASE_URL/rest/v1/market_index_values?select=*&order=value_date.desc&limit=10" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

## Monitoring

### Check Index Calculation Health
```sql
SELECT
  mi.index_code,
  mi.index_name,
  COUNT(miv.id) as data_points,
  MAX(miv.value_date) as latest_date,
  MAX(miv.close_value) as latest_value
FROM market_indexes mi
LEFT JOIN market_index_values miv ON mi.id = miv.index_id
WHERE mi.is_active = true
GROUP BY mi.id, mi.index_code, mi.index_name
ORDER BY mi.index_code;
```

### Check Edge Function Logs
```bash
supabase functions logs calculate-market-indexes
```

## Next Phase: Investment Packages & Projections

Once core indexes are running:
1. Implement projection algorithms (moving average, seasonal, momentum)
2. Build investment package builder UI
3. Add feedback loop for projection accuracy tracking
4. Create regional indexes (RGNL-XX)
5. Add ML-based projection models

## Troubleshooting

### Tables don't exist
- Verify migration ran successfully
- Check Supabase dashboard → Database → Tables
- Re-run migration if needed

### Edge function returns empty results
- Check if vehicles table has data with `sale_price` or `asking_price`
- Verify date filters in calculation logic
- Check edge function logs for errors

### Frontend can't fetch data
- Verify RLS policies are set correctly (indexes are public readable)
- Check browser console for CORS errors
- Verify Supabase client is configured properly

### Charts don't render
- Check if index has historical data (needs multiple days)
- Verify `value_date` format is correct
- Look for JavaScript errors in console

## Files Modified/Created

### Created
- `/Users/skylar/nuke/supabase/migrations/20260125000002_market_intelligence_schema.sql`
- `/Users/skylar/nuke/supabase/functions/calculate-market-indexes/index.ts`
- `/Users/skylar/nuke/nuke_frontend/src/services/marketIndexService.ts`
- `/Users/skylar/nuke/nuke_frontend/src/pages/MarketIntelligence.tsx`
- `/Users/skylar/nuke/MARKET_INTELLIGENCE_DEPLOYMENT.md` (this file)

### Not Modified (manual steps needed)
- Router configuration (add `/market-intelligence` route)
- Navigation menu (add link)
- Cron job setup (optional)

## Success Criteria

✅ Database schema deployed
✅ Edge function deployed and functional
✅ Frontend service compiled successfully
✅ Dashboard page compiled successfully
⏳ Migration needs to be run manually
⏳ Route needs to be added to router
⏳ Initial calculation needs to be triggered

## Architecture Notes

### Why These Indexes?

1. **SQBDY-50** - Squarebodies are the primary use case for this platform
2. **CLSC-100** - Broadens coverage to all classic vehicles
3. **PROJ-ACT** - Tracks market momentum for project vehicles
4. **MKTV-USD** - Overall market health indicator

### Calculation Strategy

Each index uses different methodology:
- **Price-weighted** (SQBDY-50, CLSC-100): Average of top-N vehicles by price
- **Activity score** (PROJ-ACT): Normalized listing velocity
- **Velocity composite** (MKTV-USD): Week-over-week change in activity

### Data Flow

```
Vehicles Table (source data)
    ↓
calculate-market-indexes (edge function - daily)
    ↓
market_index_values (time series storage)
    ↓
marketIndexService.ts (frontend API)
    ↓
MarketIntelligence.tsx (dashboard UI)
```

### Future: RLM Feedback Loop

The `projection_outcomes` table enables Ralph Wiggum RLM pattern:
1. System makes price projections
2. Actual outcomes are recorded
3. Accuracy is calculated
4. Model adjusts based on feedback
5. Projections improve over time

This is Phase 2 - algorithmic projections with self-improvement.
