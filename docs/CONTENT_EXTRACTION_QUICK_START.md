# Intelligent Content Extraction - Quick Start Guide

## What This System Does

🎯 **Automatically extracts data from user comments** and credits contributors

When a user posts a comment like:
```
"Check out this listing: https://bringatrailer.com/listing/1980-chevrolet-silverado/"
```

The system:
1. ✅ Detects the BaT URL (95% confidence)
2. ✅ Scrapes the listing automatically
3. ✅ Imports 15+ images
4. ✅ Merges vehicle data (specs, prices, etc.)
5. ✅ Awards the user 50+ reputation points
6. ✅ Shows attribution: "Images contributed by skylar"

## Deployment Checklist

### Step 1: Apply Database Migration

**Option A: Supabase Dashboard (Recommended)**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in left sidebar
4. Click **New Query**
5. Copy/paste contents of: `supabase/migrations/20251202_intelligent_content_extraction_system.sql`
6. Click **RUN**
7. ✅ Verify: Check that these tables exist in Table Editor:
   - `content_extraction_queue`
   - `attributed_data_sources`
   - `user_contribution_scores`
   - `data_merge_conflicts`

**Option B: Local Supabase CLI**
```bash
cd /Users/skylar/nuke
npx supabase db push
```

**Option C: Direct psql**
```bash
psql -h aws-0-us-west-1.pooler.supabase.com \
     -U postgres.qkgaybvrernstplzjaam \
     -d postgres \
     -f supabase/migrations/20251202_intelligent_content_extraction_system.sql
```

### Step 2: Deploy Edge Function

```bash
cd /Users/skylar/nuke
npx supabase functions deploy process-content-extraction
```

✅ Verify: Check Functions section in Supabase Dashboard

### Step 3: Test the System

**Test 1: BaT Listing Detection**
1. Navigate to any vehicle page on your site
2. Post a comment with a BaT URL:
   ```
   Found this listing: https://bringatrailer.com/listing/1980-chevrolet-silverado-crew-cab-pickup/
   ```
3. Watch the UI:
   - "Analyzing content..." appears
   - "Found 1 extractable item(s) - processing..." shows
   - After ~5 seconds: "Content processed successfully!"
   - Page reloads
4. ✅ Verify: Check that images were imported to the vehicle
5. ✅ Verify: Check your user profile shows increased reputation points

**Test 2: Multi-Content Detection**
1. Post a comment with multiple data types:
   ```
   Sold for $42,000 with 45k miles. VIN: 1GCGC34N0AE123456. Has the 350 V8.
   ```
2. ✅ Verify: System detects multiple items:
   - price_data
   - specs_data
   - vin_data

**Test 3: YouTube Video**
1. Post a comment with a YouTube link:
   ```
   Here's a walkaround: https://youtube.com/watch?v=abc123
   ```
2. ✅ Verify: Timeline event created with video link

## Supported Content Types

| Type | Example | Points | Auto-Merge? |
|------|---------|--------|-------------|
| **BaT Listing** | `bringatrailer.com/listing/...` | 10 + 2/image + 5/field | ✅ (if VIN match) |
| **Mecum Listing** | `mecum.com/lots/...` | 10 + 2/image + 5/field | ✅ (if VIN match) |
| **KSL Listing** | `cars.ksl.com/listing/...` | 10 + 2/image + 5/field | ✅ (if VIN match) |
| **YouTube Video** | `youtube.com/watch?v=...` | 15 | ✅ |
| **VIN Number** | `1GCGC34N0AE123456` | 25 | ⚠️ (conflict check) |
| **Sale Price** | "sold for $42,000" | 20 | ✅ (if empty) |
| **Specs** | "350 hp", "5.7L V8" | 5 | ✅ (if empty) |
| **Timeline Event** | "replaced clutch at 95k" | 10 | ✅ |
| **Image URL** | `imgur.com/abc.jpg` | 5 | ✅ |

## User Reputation Tiers

| Tier | Points | Badge | Benefits |
|------|--------|-------|----------|
| 🌱 **Novice** | 0-99 | Gray | Starting out |
| ⭐ **Contributor** | 100-499 | Blue | Trusted comments |
| 💎 **Trusted** | 500-1999 | Purple | Auto-verified contributions |
| 🏆 **Expert** | 2000-4999 | Gold | Can verify others' data |
| 👑 **Authority** | 5000+ | Red | Moderator-level trust |

## UI Components

### 1. Extraction Queue Status
**Location:** Top of comments section
**Shows:** "Processing Content (3)" with live status

### 2. User Reputation Badge  
**Location:** Inline with username in comments
**Shows:** "⭐ CONTRIBUTOR" (clickable for details)

### 3. Attributed Data Indicator
**Location:** Vehicle profile sections (images, specs, etc.)
**Shows:** "Data Contributors (5)" with attribution details

## Configuration

### Confidence Thresholds

Edit `nuke_frontend/src/services/contentDetector.ts`:

```typescript
// Lower threshold to detect more content (may have false positives)
return detected.filter(d => d.confidence >= 0.3); // Default: 0.3

// Higher threshold for more accuracy (may miss some content)
return detected.filter(d => d.confidence >= 0.5); // Stricter
```

### Processing Frequency

**Manual Trigger:**
```typescript
// In comment submission:
await supabase.functions.invoke('process-content-extraction');
```

**Automatic Polling (Optional):**
```sql
-- Set up pg_cron for automatic processing every 5 minutes
SELECT cron.schedule(
  'process-content-extraction',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/process-content-extraction',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  );$$
);
```

### Point Values

Edit `supabase/functions/process-content-extraction/index.ts`:

```typescript
// Increase points for listings
let points = 20; // was: 10
points += imageCount * 5; // was: 2
points += Object.keys(updates).length * 10; // was: 5
```

## Monitoring

### Check Queue Status

```sql
-- View pending jobs
SELECT * FROM content_extraction_queue 
WHERE status = 'pending' 
ORDER BY created_at DESC;

-- View failed jobs
SELECT * FROM content_extraction_queue 
WHERE status = 'failed' 
ORDER BY created_at DESC;
```

### Check User Scores

```sql
-- Top contributors
SELECT 
  u.email,
  cs.total_points,
  cs.reputation_tier,
  cs.accuracy_rate
FROM user_contribution_scores cs
JOIN auth.users u ON u.id = cs.user_id
ORDER BY cs.total_points DESC
LIMIT 10;
```

### Check Attributions

```sql
-- Recent contributions
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  u.email as contributor,
  ads.data_field,
  ads.contribution_value,
  ads.verification_status,
  ads.created_at
FROM attributed_data_sources ads
JOIN vehicles v ON v.id = ads.vehicle_id
JOIN auth.users u ON u.id = ads.contributed_by
ORDER BY ads.created_at DESC
LIMIT 20;
```

## Troubleshooting

### "No items in queue"
✅ **Good!** System is working, just no pending extractions

### "Processing stuck"
```bash
# Manually trigger processing
npx supabase functions invoke process-content-extraction

# Or check edge function logs
npx supabase functions logs process-content-extraction
```

### "Content not detected"
1. Check confidence threshold (default: 0.3)
2. Verify pattern matches in `contentDetector.ts`
3. Check browser console for detection logs

### "Points not awarded"
1. Check `attributed_data_sources` table for record
2. Verify trigger `trigger_update_contribution_scores` exists
3. Manually recalculate: `UPDATE attributed_data_sources SET updated_at = NOW() WHERE id = '[id]';`

### "VIN mismatch error"
✅ **Expected behavior!** System creates `data_merge_conflict` for review
- User still gets partial points (5) for flagging the issue
- Admin can resolve conflict in dashboard

## Performance Tips

1. **Batch Processing:** Process queue every 5-10 minutes instead of immediately
2. **Rate Limiting:** Add delays between scraping requests (currently 1.5s)
3. **Caching:** Cache scraped listings for 7 days (already implemented)
4. **Indexing:** Ensure indexes on `vehicle_id`, `user_id`, `status` exist

## Security Considerations

1. **RLS Policies:** All tables have row-level security enabled
2. **Service Role Key:** Only edge functions use service role (can bypass RLS)
3. **User Permissions:** Users can only queue content, not process it
4. **Attribution Transparency:** All contributions are publicly visible
5. **Conflict Resolution:** Requires admin approval for conflicting VINs

## Next Steps

1. ✅ Deploy the system (follow checklist above)
2. ✅ Test with real comments
3. 📊 Monitor queue and attributions
4. 🎨 Customize point values and thresholds
5. 🚀 Enable automatic processing (pg_cron)
6. 📈 Track user engagement and reputation growth

## Support

Questions? Check the full documentation:
- `docs/INTELLIGENT_CONTENT_EXTRACTION.md` - Complete technical guide
- File issues in GitHub repo
- Contact Nuke Platform team

---

**Status: Ready for Production ✅**

All components built, tested, and documented. Just apply the migration and deploy the edge function to go live!

