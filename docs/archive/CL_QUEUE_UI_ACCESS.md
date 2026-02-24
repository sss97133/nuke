# Craigslist Queue UI - Access & Tracking

## 📍 Where to Find It

**URL:** https://nuke.ag/admin

**Tab:** Click "CL SCRAPING" tab (rightmost tab in admin dashboard)

## 🎯 What You'll See

### 1. **Queue Statistics** (Top Section)
Real-time stats showing:
- **Pending**: Listings waiting to be processed
- **Processing**: Currently being scraped
- **Complete**: Successfully created vehicles
- **Failed**: Errors occurred (can retry)
- **Skipped**: Not squarebodies (filtered out)
- **Total**: All listings discovered

### 2. **Progress Bar**
Visual progress showing:
- `Complete / Total` with percentage
- Green progress bar filling as items complete

### 3. **Recent Activity Feed**
Last 20 queue items showing:
- Listing URL
- Status (color-coded badges)
- Error messages (if failed)
- Timestamps

### 4. **Action Buttons**
- **TRIGGER DISCOVERY**: Manually run discovery (finds new listings)
- **PROCESS QUEUE**: Manually process pending items
- **RETRY FAILED**: Reset failed items to pending (if any)

## 🔄 Auto-Refresh

The dashboard automatically refreshes every **5 seconds** to show:
- Updated statistics
- New activity
- Current status

## 📊 Understanding the Data

### Queue Status Meanings:

- **pending**: Waiting in queue to be processed
- **processing**: Currently being scraped (should only last a few minutes)
- **complete**: Vehicle successfully created
- **failed**: Error occurred (check error_message)
- **skipped**: Not a squarebody (1973-1991 Chevy/GMC) - filtered out

### What Gets Created:

When a listing is processed successfully:
1. ✅ Vehicle record created (if not duplicate)
2. ✅ Images downloaded and uploaded to Supabase Storage
3. ✅ Timeline event created (discovery event)
4. ✅ Ghost user created for photographer attribution
5. ✅ Queue item marked as "complete"

### Duplicate Detection:

The system checks for duplicates by:
1. VIN match (if VIN found in listing)
2. Year/Make/Model match (if no VIN)

If duplicate found, vehicle is **updated** (not created), and queue item still marked "complete".

## 🐛 Troubleshooting

### Queue Stuck on "Processing"

If items are stuck in "processing" status for >1 hour:
1. They may have timed out
2. Check Supabase function logs
3. Manually reset: Update status to "pending" in database

### High Failure Rate

If many items are failing:
1. Check error messages in Recent Activity
2. Common issues:
   - Listing deleted/expired
   - Network timeout
   - Invalid data (missing year/make/model)
   - Not actually a squarebody

### No New Listings

If discovery isn't finding new listings:
1. Check cron job status (Supabase Dashboard → Database → Cron Jobs)
2. Manually trigger discovery via button
3. Check function logs for errors

## 📈 Expected Performance

- **Discovery**: Runs daily at 2 AM, finds 200-500 listings
- **Processing**: Runs every 30 minutes, processes 15 listings per run
- **Success Rate**: >90% (some will be skipped if not squarebodies)
- **Image Import**: >80% of listings have images

## 🔍 Database Access

You can also query the queue directly in Supabase:

```sql
-- View queue stats
SELECT status, COUNT(*) 
FROM craigslist_listing_queue 
GROUP BY status;

-- View recent activity
SELECT * FROM craigslist_listing_queue 
ORDER BY updated_at DESC 
LIMIT 20;

-- View failed items
SELECT * FROM craigslist_listing_queue 
WHERE status = 'failed' 
ORDER BY updated_at DESC;
```

## ✅ Success Indicators

You'll know it's working when:
1. ✅ "Pending" count increases after discovery runs
2. ✅ "Complete" count increases after processing runs
3. ✅ New vehicles appear with `discovery_source = 'craigslist_scrape'`
4. ✅ Progress bar fills up over time
5. ✅ Recent activity shows "complete" status items

---

**Last Updated:** January 2025  
**Location:** https://nuke.ag/admin → CL SCRAPING tab

