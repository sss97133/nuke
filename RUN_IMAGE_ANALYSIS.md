# Run Image Analysis - Final Steps

## Current Status

✅ **All Edge Function secrets configured**
✅ **Tools created and ready**
✅ **Database has 2,741 images to process**

## Last Step: OpenAI Key for Local Scripts

The batch processing scripts run **locally** and need the OpenAI API key in your `.env.local` file.

### Option 1: Add Manually (Fastest)

Edit: `nuke_frontend/.env.local`

Add these two lines:
```bash
VITE_OPENAI_API_KEY=sk-proj-your-actual-key-here
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

**Get your key:** https://platform.openai.com/api-keys

### Option 2: Use the Helper Script

```bash
/tmp/add_openai_key.sh
```

This will prompt you to paste your key.

## Then Run the System

### Terminal 1: Diagnostic (verify everything)
```bash
cd /Users/skylar/nuke
node scripts/image-analysis-diagnostic.js
```

**Expected output:**
```
✓ Supabase URL: https://...
✓ Supabase Service Key: eyJhbG...
✓ OpenAI API Key: sk-proj-...
✓ Edge function working
✓ End-to-end test passed

Database Stats:
• Total images: 2,742
• Processed: 1 (0.0%)
• Remaining: 2,741

Next Steps:
➜ Run batch processing: node scripts/batch-process-images.js
➜ Monitor progress: node scripts/image-analysis-monitor.js
```

### Terminal 2: Monitor (real-time progress)
```bash
cd /Users/skylar/nuke
node scripts/image-analysis-monitor.js
```

**Shows:**
```
╔════════════════════════════════════════════════════════════════════════════╗
║              IMAGE ANALYSIS PROGRESS MONITOR                               ║
╚════════════════════════════════════════════════════════════════════════════╝

OVERALL PROGRESS
────────────────────────────────────────────────────────────────────────────
[███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 25.3%

Processed: 694 / 2,742
Remaining: 2,048

Processing Rate: 12.3 images/minute
Estimated Time Remaining: 2h 47m
```

### Terminal 3: Batch Processor (does the work)
```bash
cd /Users/skylar/nuke
node scripts/batch-process-images.js
```

**Output:**
```
╔════════════════════════════════════════════════════════════════════════════╗
║                     BATCH IMAGE PROCESSOR                                  ║
╚════════════════════════════════════════════════════════════════════════════╝

Configuration:
   Batch size: 5 concurrent requests
   Delay between batches: 2000ms
   Max retries: 3

📊 Fetching unprocessed images...
   Found 2,741 unprocessed out of 2,742 total

📸 Processing 2,741 images...

📦 Batch 1/549 (5 images)
────────────────────────────────────────────────────────────────────────────
   ✓ 3f8a2b1c... (12 tags)
   ✓ 7d9e4f2a... (8 tags)
   ✓ 1a5c8d3b... (15 tags)
   ✓ 9b2f6e4c... (10 tags)
   ✓ 5e8a1d7f... (11 tags)
────────────────────────────────────────────────────────────────────────────
   ✓ Success: 5 | ✗ Failed: 0 | ⏱ 8234ms
   Overall: 5/5 | Rate: 0.61 img/s | ETA: 1h 14m
```

## Processing Details

**For each of 2,741 images:**
- AWS Rekognition detects parts, tools, damage
- OpenAI analyzes condition (Appraiser Brain)
- OpenAI extracts SPID sheets (GM vehicles)
- Automated tags created
- Data saved to database

**Time:** ~90 minutes (at 5 concurrent)
**Cost:** ~$30 (AWS $2.74 + OpenAI $27.41)

## What You Get

After processing completes:

### 1. Database Populated
```sql
-- Check results
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 1 END) as has_rekognition,
  COUNT(CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 1 END) as has_appraiser,
  COUNT(CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 1 END) as has_spid
FROM vehicle_images
WHERE ai_scan_metadata->>'scanned_at' IS NOT NULL;
```

### 2. UI Enhanced
- Open any vehicle profile
- Click on images
- See AI analysis data:
  - Detected parts and tools
  - Professional appraisal notes
  - SPID data (if GM vehicle)
  - Automated tags for search

### 3. Search Enabled
- ~30,000 automated tags created
- Search by: part, tool, brand, process, issue
- Filter images by detected content

## Adjusting Performance

### Faster (Higher Risk of Rate Limits)
```bash
node scripts/batch-process-images.js 10 1000  # 10 concurrent, 1s delay
```

### Slower (More Conservative)
```bash
node scripts/batch-process-images.js 3 5000   # 3 concurrent, 5s delay
```

### Process One Vehicle (Testing)
```bash
node scripts/batch-process-images.js 5 2000 <vehicle-id>
```

## Troubleshooting

### Diagnostic fails
```bash
# Check secrets
supabase secrets list

# View Edge Function logs
supabase functions logs analyze-image --follow
```

### Rate limits hit
Increase delay between batches (see "Slower" config above)

### Processing stuck
Check monitor - it shows recent activity. If frozen for >5 minutes, restart batch processor.

## After Completion

### Verify Results
```bash
node scripts/image-analysis-diagnostic.js
```

Should show:
```
Processed: 2,742 (100%)
```

### Check in UI
1. Go to any vehicle profile
2. Open an image
3. Look for "AI Analysis" or "Details" tab
4. Should see tags, appraisal notes, etc.

### Query Database
```sql
-- Extraction breakdown
SELECT 
  COUNT(*) FILTER (WHERE ai_scan_metadata->'rekognition' IS NOT NULL) as rekognition,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'appraiser' IS NOT NULL) as appraiser,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'spid' IS NOT NULL) as spid_sheets
FROM vehicle_images;

-- Tag counts
SELECT COUNT(*) as automated_tags FROM image_tags WHERE verified = false;
```

---

**Ready to start!** Just add the OpenAI key and run the three commands above. 🚀

