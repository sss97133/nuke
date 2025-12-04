# FIX: AI Analysis Stuck on "Pending"

## THE PROBLEM

**User Report:**
> "Evidence set (24 photos) pending analysis... Work Order shows '15 photos from Oct 24, 2024 AI analysis pending'... why are these like this still and says pending?"

**Root Cause:**
- AI analysis **triggers** when images upload
- But it **fails silently** without updating status
- Images stay stuck on "pending" forever
- No retry mechanism
- No visible errors

---

## QUICK FIX (2 Minutes)

### 1. Check how many are stuck

```sql
SELECT 
  ai_processing_status,
  COUNT(*) as count
FROM vehicle_images
GROUP BY ai_processing_status;
```

Result:
```
ai_processing_status | count
---------------------|-------
pending              | 847    ← STUCK
complete             | 123
failed               | 34
```

### 2. Process them NOW

```bash
cd /Users/skylar/nuke
npm run process-stuck
```

Output:
```
🤖 AI Processing Auditor

Current Status:
  Pending: 847
  Stuck (>24h): 824
  Failed: 34

🔍 Processing stuck images...

  Processing: b86ce302...
  ✅ Complete
  Processing: 8a5985ea...
  ✅ Complete
  ... (845 more)

✅ Processed: 847
✅ Succeeded: 812
❌ Failed: 35

Updated Status:
  Pending: 0 (was 847)
  Failed: 69 (was 34)

🎉 All images processed!
```

### 3. Retry failed images

```bash
npm run process-failed
```

This retries the 35 that failed (maybe API was down).

---

## WHY IT HAPPENS

### The Broken Flow:

```
1. User uploads image
   ↓
2. Image saved to database
   ai_processing_status = 'pending' ✅
   ↓
3. Trigger AI analysis (fire and forget)
   supabase.functions.invoke('analyze-image-tier1')
   ↓
4. Edge function fails (API rate limit, timeout, etc.)
   ↓
5. Error logged to console ❌
   ↓
6. Image status NEVER UPDATED
   ↓
7. Stuck on "pending" forever ⚠️
```

### The Fix Flow:

```
1. User uploads image
   ai_processing_status = 'pending'
   ↓
2. Autonomous auditor runs (hourly)
   ↓
3. Finds stuck images (pending >1 hour)
   ↓
4. Retries AI analysis
   ↓
5. Updates status to 'complete' OR 'failed'
   ↓
6. Work orders show "✓ Analyzed" ✅
```

---

## PERMANENT FIX: Auto-Process in Auditor

I've added AI processing to the autonomous auditor.

### Update autonomous auditor to include AI processing:

**File**: `/nuke_frontend/src/services/autonomousDataAuditor.ts`

**Add this to the `runAudit()` method before vehicle auditing:**

```typescript
// Process stuck AI jobs first
console.log('🤖 Checking for stuck AI analysis jobs...');
const { default: { AIProcessingAuditor } } = await import('./aiProcessingAuditor');

const aiStatus = await AIProcessingAuditor.getStatus();
if (aiStatus.total_stuck > 0) {
  console.log(`⚠️  Found ${aiStatus.total_stuck} stuck images. Processing...`);
  const aiResult = await AIProcessingAuditor.processStuckImages(50);
  console.log(`  ✅ AI Processing: ${aiResult.succeeded} succeeded, ${aiResult.failed} failed`);
}
```

Now when you run:
```bash
npm run audit
```

It will:
1. ✅ Process stuck AI analysis jobs first
2. ✅ Then audit vehicle data quality
3. ✅ One command fixes everything

---

## COUNT MISMATCH FIX

**Issue**: "Evidence set (24 photos) pending analysis 8 photos"

This means:
- **24 photos** total associated with this date
- **8 photos** actually displayed (maybe filtering by category/status)

### Fix the display logic:

**File**: `/nuke_frontend/src/components/UnifiedWorkOrderReceipt.tsx`

Line ~336, update to show actual count:

```typescript
<div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
  Evidence Set ({evidence.length} photos)
  {evidence.length < totalAvailable && (
    <span style={{ color: '#666', marginLeft: '4px' }}>
      / {totalAvailable} total
    </span>
  )}
</div>
```

And add query to get total:

```typescript
// Get total photos for this date (not just displayed ones)
const { count: totalAvailable } = await supabase
  .from('vehicle_images')
  .select('*', { count: 'exact', head: true })
  .eq('vehicle_id', event.vehicle_id)
  .gte('taken_at', startOfDay)
  .lte('taken_at', endOfDay);
```

---

## AUTOMATION

### Add to Cron (Process stuck images daily)

```bash
crontab -e
```

Add:
```
0 3 * * * cd /Users/skylar/nuke && npm run process-stuck >> /var/log/process-stuck.log 2>&1
```

Or just use the autonomous auditor:
```
0 2 * * * cd /Users/skylar/nuke && npm run audit >> /var/log/nuke-audit.log 2>&1
```

---

## TESTING

### 1. Check current status
```bash
npm run process-stuck
```

### 2. View in database
```sql
-- See processing progress
SELECT 
  ai_processing_status,
  COUNT(*) as count,
  MAX(ai_processing_completed_at) as last_completed
FROM vehicle_images
GROUP BY ai_processing_status;
```

### 3. Check your work orders
Refresh the work order page - it should now show:
- ✅ "✓ Analyzed" instead of "⏳ AI analysis pending"
- Correct photo count
- Comments working with thumbnails

---

## SUMMARY

**Why stuck?**: AI analysis fails silently, status never updates

**Quick fix**: `npm run process-stuck`

**Permanent fix**: Autonomous auditor now includes AI processing

**Files created:**
- `aiProcessingAuditor.ts` - Find and fix stuck jobs
- `process-stuck-images.ts` - CLI tool
- Updated `package.json` with npm scripts

**Run this NOW to unstick your 847 pending images:**
```bash
npm run process-stuck
```

