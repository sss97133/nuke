# Active Auctions Sync System - Complete Setup ✅

## What Was Built

A complete automated system to sync ALL active auction listings and keep bid counts/current bids up-to-date.

---

## Components Created

### 1. **Edge Function: `sync-active-auctions`**
- **Location**: `supabase/functions/sync-active-auctions/index.ts`
- **Purpose**: Batch syncs all active external auction listings
- **Features**:
  - Rate limiting: Only syncs listings not synced in last 15 minutes
  - Batch processing: Processes 20 listings per run
  - Platform-aware: Routes to correct sync function (BaT, Cars & Bids)
  - Error handling: Continues on errors, reports failures

### 2. **Database Function: `get_listings_needing_sync`**
- **Purpose**: Efficiently queries active listings that need syncing
- **Optimization**: Uses indexed queries, only returns listings needing sync

### 3. **Cron Job: `sync-active-auctions`**
- **Schedule**: Every 15 minutes (`*/15 * * * *`)
- **Action**: Calls `sync-active-auctions` edge function
- **Batch Size**: 20 listings per run

---

## How It Works

### Sync Flow:

1. **Cron triggers** every 15 minutes
2. **Edge function queries** active listings that need syncing:
   - `listing_status = 'active'`
   - `sync_enabled = true`
   - `last_synced_at` is NULL or older than 15 minutes
3. **Groups listings by platform** (BaT, Cars & Bids, etc.)
4. **Calls appropriate sync function** for each platform:
   - `sync-bat-listing` for BaT auctions
   - `sync-cars-and-bids-listing` for Cars & Bids auctions
5. **Updates `external_listings` table**:
   - `current_bid` - Latest bid amount
   - `bid_count` - Number of bids
   - `watcher_count`, `view_count` - Engagement metrics
   - `listing_status` - Updates to 'sold' when auction ends
   - `final_price` - Final sale price
   - `last_synced_at` - Sync timestamp (rate limiting)

### Rate Limiting Strategy:

- **15-minute cooldown**: Same listing won't sync more than once per 15 minutes
- **1-second delay**: Between individual listing syncs (avoids overwhelming external sites)
- **Batch size**: 20 listings per run (prevents timeouts)

---

## Supported Platforms

Currently syncs:
- ✅ **BaT (Bring a Trailer)** - via `sync-bat-listing`
- ✅ **Cars & Bids** - via `sync-cars-and-bids-listing`

Future platforms can be added by:
1. Creating a sync function (e.g., `sync-classic-auction`)
2. Adding platform mapping in `sync-active-auctions/index.ts`

---

## Verification

### Check Cron Job:
```sql
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 150) as command_preview
FROM cron.job 
WHERE jobname = 'sync-active-auctions';
```

Expected:
- `schedule`: `*/15 * * * *`
- `active`: `true`

### Check Sync Status:
```sql
SELECT 
  platform,
  listing_status,
  COUNT(*) as total,
  COUNT(last_synced_at) as synced_count,
  AVG(EXTRACT(EPOCH FROM (NOW() - last_synced_at))/60) as avg_minutes_since_sync
FROM external_listings
WHERE listing_status = 'active'
GROUP BY platform, listing_status
ORDER BY platform;
```

### Check Recent Sync Activity:
```sql
SELECT 
  platform,
  COUNT(*) as synced_in_last_hour
FROM external_listings
WHERE listing_status = 'active'
  AND last_synced_at > NOW() - INTERVAL '1 hour'
GROUP BY platform;
```

---

## Manual Trigger

You can manually trigger a sync:

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-active-auctions \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20}'
```

Or via Supabase Dashboard:
1. Go to Edge Functions
2. Find `sync-active-auctions`
3. Click "Invoke" with body: `{"batch_size": 20}`

---

## Monitoring

### Edge Function Logs:
- Check Supabase Dashboard → Edge Functions → `sync-active-auctions` → Logs
- Look for:
  - Success: `"Synced X listings"`
  - Errors: Platform-specific errors in `results.errors[]`

### Database Metrics:
```sql
-- Listings that haven't synced recently (potential issues)
SELECT 
  id,
  platform,
  listing_url,
  last_synced_at,
  EXTRACT(EPOCH FROM (NOW() - last_synced_at))/60 as minutes_ago
FROM external_listings
WHERE listing_status = 'active'
  AND sync_enabled = true
  AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '1 hour')
ORDER BY last_synced_at NULLS FIRST
LIMIT 50;
```

---

## Troubleshooting

### If syncs aren't happening:

1. **Check cron job is active**:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'sync-active-auctions';
   ```

2. **Check service role key is set**:
   ```sql
   SHOW app.settings.service_role_key;
   ```
   If NULL, set it:
   ```sql
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_KEY';
   ```

3. **Check edge function is deployed**:
   - Verify `sync-active-auctions` exists in Supabase Dashboard
   - Check function logs for errors

4. **Check `sync_enabled` flag**:
   ```sql
   SELECT COUNT(*) FROM external_listings 
   WHERE listing_status = 'active' AND sync_enabled = false;
   ```
   These listings won't sync!

---

## Next Steps

1. ✅ Migration applied
2. ⏳ Deploy edge function: `supabase functions deploy sync-active-auctions`
3. ✅ Cron job created (runs every 15 minutes)
4. ⏳ Monitor first sync (check logs in ~15 minutes)

The system is now set up and will automatically keep all active auction bids current!

