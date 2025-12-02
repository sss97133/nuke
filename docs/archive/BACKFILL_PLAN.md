# IMAGE ANALYSIS BACKFILL PLAN

**Created:** November 23, 2025  
**Status:** READY TO EXECUTE

---

## CURRENT STATE (Database Reality)

```
Total Images:        2,934
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Never Analyzed:      1,967 (67%) ← PRIORITY
Has Some Metadata:     967 (33%)
Fully Analyzed:        200 (7%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Critical Gap:** 67% of images have never been analyzed by AI.

---

## WHAT WE BUILT TODAY

### 1. Edge Functions (Deployed ✅)
- `analyze-image` - Main analysis pipeline (Rekognition + OpenAI + SPID detection)
- `batch-analyze-vehicle` - Batch processor per vehicle
- `backfill-image-angles` - Angle classification
- `detect-sensitive-document` - Document detection
- `auto-analyze-upload` - Upload trigger

### 2. Scripts (Created 📝)
- `scan-all-vehicles.js` - Orchestrator for all vehicles
- `batch-process-images.js` - Concurrent batch processor
- **NEW:** `backfill-all-images.js` - Simple, focused backfill script

### 3. Documentation (Analysis 📊)
- `IMAGE_PROCESSING_FLOW_ANALYSIS.md` - Problem diagnosis
- `AI_IMAGE_ANALYSIS_DEPLOYED.md` - System overview
- `SCANNING_ALL_IMAGES.md` - Previous scan attempt

---

## THE PLAN: BACKFILL ALL 1,967 UNANALYZED IMAGES

### Phase 1: Test Run (5 minutes)
```bash
# Test with 10 images first
node scripts/backfill-all-images.js --dry-run

# Then process 10 for real
BATCH_SIZE=5
DELAY=2000
node scripts/backfill-all-images.js 5 2000
```

**Validates:**
- Edge function is working
- Database updates correctly
- Error handling works
- Performance is acceptable

### Phase 2: Full Backfill (2-4 hours)
```bash
# Process all 1,967 images
# Batch size: 10 images
# Delay: 1 second between batches
node scripts/backfill-all-images.js 10 1000
```

**Expected Performance:**
- Rate: ~10-15 images/minute
- Total time: 2-3 hours
- Cost: ~$40-60 (OpenAI + Rekognition)

### Phase 3: Verification (5 minutes)
```sql
-- Check completion
SELECT 
  COUNT(*) as total_images,
  COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) as analyzed,
  COUNT(CASE WHEN ai_last_scanned IS NULL THEN 1 END) as remaining,
  ROUND(100.0 * COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) / COUNT(*), 1) as percent_complete
FROM vehicle_images
WHERE vehicle_id IS NOT NULL;
```

---

## WHAT THE BACKFILL DOES

For each image, the `analyze-image` edge function:

### 1. Rekognition Label Detection
- Detects objects: "steering wheel", "tire", "engine", "dashboard"
- Confidence scores
- Bounding boxes

### 2. Contextual Analysis
- Determines if it's an engine photo, interior shot, exterior, etc.
- Runs appropriate "Appraiser Brain" analysis

### 3. OpenAI Vision "Appraiser Brain"
- Paint quality assessment
- Build quality detection (professional vs DIY)
- Component identification
- Condition assessment
- Modification detection

### 4. SPID Sheet Detection (if applicable)
- Detects Service Parts Identification sheets
- Extracts VIN, RPO codes, paint codes, build date
- Auto-populates vehicle specs

### 5. Database Updates
- `ai_scan_metadata` - Full analysis results
- `ai_last_scanned` - Timestamp
- `ai_component_count` - Number of components found
- `ai_avg_confidence` - Average confidence score
- `is_document` - Document flag
- `document_category` - Document type

### 6. Creates Records
- `image_tags` - Individual detections
- `component_conditions` - Part condition assessments
- `paint_quality_assessments` - Paint analysis
- `vehicle_spid_data` - SPID extracted data (if found)

---

## MONITORING PROGRESS

### Option 1: Admin Dashboard
Visit: `https://n-zero.dev/admin`

Shows real-time progress in the "AI Scanning Status" card.

### Option 2: Terminal
```bash
# Watch the script output
node scripts/backfill-all-images.js 10 1000
```

### Option 3: Database Query
```sql
-- Real-time progress
SELECT 
  COUNT(CASE WHEN ai_last_scanned IS NULL THEN 1 END) as remaining,
  COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) as completed
FROM vehicle_images
WHERE vehicle_id IS NOT NULL;
```

---

## ERROR HANDLING

The script includes:

1. **Automatic Retry** - Up to 3 attempts with exponential backoff
2. **Error Logging** - All failures tracked in `stats.errors`
3. **Resume Capability** - Uses `ai_last_scanned` to skip processed images
4. **Graceful Failure** - One image failure doesn't stop the batch

### If Script Crashes:
Just run it again! It will automatically skip images that have `ai_last_scanned` timestamp.

---

## COST ESTIMATE

### Per Image:
- Rekognition: $0.001/image
- OpenAI Vision (GPT-4o): ~$0.02/image
- **Total: ~$0.021/image**

### Full Backfill (1,967 images):
- **Estimated Cost: $40-45**

### API Rate Limits:
- OpenAI: 10,000 requests/day (we'll use ~1,967)
- Rekognition: 5 TPS (our batching keeps us well under)

---

## NEXT STEPS AFTER BACKFILL

Once all images are analyzed:

### 1. Enhanced Vehicle Profiles
All vehicles will have:
- AI-detected components catalog
- Condition assessments
- Paint quality scores
- Modification registry
- Document classification

### 2. Improved Valuations
`vehicleValuationService.ts` will use:
- Professional build multipliers (+15%)
- Custom feature detection (+10%)
- Condition adjustments (+/-5-20%)
- Documented parts catalog

### 3. Better User Experience
- Images organized by angle/category
- "Analyzed by AI" badges
- Searchable components
- Automatic tagging
- Smart grouping

---

## IMPLEMENTATION NOTES

### Why This Script vs scan-all-vehicles.js?

**backfill-all-images.js:**
- Simple: One query, one loop, done
- Reliable: Uses `ai_last_scanned` as single source of truth
- Resumable: Automatically skips processed images
- Fast: Processes images directly, not grouped by vehicle

**scan-all-vehicles.js:**
- Complex: Orchestrates multiple vehicles
- Slower: Groups by vehicle first
- More overhead: Multiple queries per vehicle

### Database Column Usage

**`ai_scan_metadata`** (JSONB):
- Stores full analysis results
- Structure: `{ rekognition: {...}, appraiser: {...}, spid: {...}, scanned_at: "..." }`

**`ai_last_scanned`** (TIMESTAMPTZ):
- Simple flag: has this been analyzed?
- Used for: Skip logic, progress tracking
- **This is what we're using to track backfill progress**

---

## READY TO RUN

```bash
cd /Users/skylar/nuke

# 1. Test with dry run
node scripts/backfill-all-images.js --dry-run

# 2. Test with 10 images
node scripts/backfill-all-images.js 5 2000

# 3. Full backfill
node scripts/backfill-all-images.js 10 1000
```

**Estimated completion: 2-3 hours**

Once complete, all 2,934 images will have AI analysis results.

---

## VERIFICATION QUERIES

### Check Progress
```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) as analyzed,
  ROUND(100.0 * COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) / COUNT(*), 1) as percent
FROM vehicle_images
WHERE vehicle_id IS NOT NULL;
```

### Top Vehicles by Image Count
```sql
SELECT 
  v.year, v.make, v.model,
  COUNT(*) as image_count,
  COUNT(CASE WHEN vi.ai_last_scanned IS NOT NULL THEN 1 END) as analyzed,
  COUNT(CASE WHEN vi.ai_last_scanned IS NULL THEN 1 END) as remaining
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
GROUP BY v.id, v.year, v.make, v.model
ORDER BY remaining DESC
LIMIT 10;
```

### Sample Analysis Results
```sql
SELECT 
  vi.id,
  vi.file_name,
  vi.ai_last_scanned,
  vi.ai_component_count,
  vi.ai_avg_confidence,
  vi.is_document,
  vi.document_category,
  jsonb_pretty(vi.ai_scan_metadata) as metadata
FROM vehicle_images vi
WHERE vi.ai_last_scanned IS NOT NULL
ORDER BY vi.ai_last_scanned DESC
LIMIT 3;
```

---

## TROUBLESHOOTING

### If images aren't being analyzed:
1. Check edge function logs in Supabase dashboard
2. Verify `OPENAI_API_KEY` is set in edge function secrets
3. Check for rate limiting errors
4. Run with smaller batch size

### If script crashes:
1. Just run it again - it will resume from where it left off
2. Check the error log in terminal output
3. Reduce batch size or increase delay

### If analysis quality is poor:
1. Check `ai_avg_confidence` scores in database
2. Review sample `ai_scan_metadata` JSONB
3. May need to adjust prompts in `analyze-image` function

---

## EXPECTED OUTCOME

After backfill completes:

```
✅ All 2,934 images analyzed
✅ Every image has ai_scan_metadata
✅ Every image has ai_last_scanned timestamp
✅ Components detected and cataloged
✅ Documents classified
✅ Paint quality assessed
✅ Build quality scored
✅ Modifications identified
✅ SPID data extracted (where applicable)
```

**Ready for:**
- Enhanced valuations
- Smart image organization
- Component search
- Automated tagging
- Quality scoring
- Market comparables

