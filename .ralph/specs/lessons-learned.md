# Lessons Learned - DO NOT REPEAT THESE FAILURES

## Critical Failures to Avoid

### 1. KSL.com ALWAYS Blocks Scrapers (74% of all failures!)
- **Count**: 3,037 failed items
- **Error**: `"Scrape failed: 403"`
- **Lesson**: NEVER try to scrape KSL without browser automation or residential proxies
- **Action**: Skip all KSL items, don't waste resources

### 2. Batch Size Too Large = Timeouts
- **Symptom**: 504 Gateway Timeout
- **Cause**: Batch size of 10-20 items, each taking 15-30s = >150s timeout
- **Fix**: ALWAYS use batch_size = 3 max
- **Files**: `process-import-queue`, `process-bat-extraction-queue`

### 3. Old Errors Keep Retrying Forever
- **Example**: `"relation 'vehicle_images' does not exist"` - 181 items failing for 9+ days
- **Lesson**: When fixing a root cause, RESET the failed items to pending
- **SQL**: `UPDATE import_queue SET status='pending', attempts=0 WHERE error_message LIKE '%old error%'`

### 4. Items Stuck in "processing" Forever
- **Cause**: Edge function crashes without releasing lock
- **Symptom**: 751 items locked for 20+ hours
- **Fix**: Auto-unlock after 15 minutes (pipeline-orchestrator does this)

### 5. Cars & Bids __NEXT_DATA__ Not Being Parsed
- **Current State**: 0% images extracted, 0% comments
- **Root Cause**: Not parsing the `__NEXT_DATA__` JSON blob
- **Fix**: Add dedicated __NEXT_DATA__ extraction

### 6. Non-Vehicle Items Clogging Queue
- **Examples**: BaT memorabilia, parts, pedal cars, signs
- **Error**: `"Junk identity detected: year=2025 make=Bring model=a Trailer"`
- **Fix**: Skip non-vehicle listings at discovery time

### 7. Dead Links Keep Retrying
- **404/410 errors**: Links removed or expired
- **Lesson**: Skip immediately, don't retry

## What NOT to Do

1. **DON'T write new extraction functions** - Fix existing ones
2. **DON'T use deprecated BaT functions**:
   - ❌ `comprehensive-bat-extraction`
   - ❌ `import-bat-listing`
   - ❌ `bat-extract-complete-v*`
   - ❌ `extract-premium-auction`
3. **DON'T call functions with large batch sizes**
4. **DON'T try to scrape KSL**
5. **DON'T ignore error patterns** - Group and fix systematically

## What WORKS

1. **BaT extraction**: `extract-bat-core` + `extract-auction-comments` (25% complete rate)
2. **HTML Snapshot reuse**: Saves Firecrawl costs
3. **Fallback pattern**: Firecrawl → Direct → DOM
4. **Queue locking**: Prevents duplicate processing
5. **Image backfill**: Works, just slow (62K images downloaded)

## Common Error Patterns

| Error | Count | Fix |
|-------|-------|-----|
| KSL 403 | 3,037 | Skip permanently |
| Craigslist 410 (expired) | 141 | Skip |
| Dead links 404 | 133 | Skip |
| Junk identity | 60 | Skip non-vehicles |
| Non-listing URL | 71 | Skip index pages |
| Invalid make | 38 | Skip junk data |
| Missing table | 181 | Reset after migration |

## Queue Health Target

**Before cleanup:**
- Failed: 4,112
- Pending: 821

**After cleanup:**
- Skipped: ~3,500 (KSL + expired + dead + junk)
- Pending: ~1,000
- Failed (real issues): ~400
