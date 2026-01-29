# Data Extraction Fix Approach
## Comprehensive Strategy Based on 3000+ Cursor Conversations & RLM Research

**Author**: Claude (synthesizing from conversation history + RLM paper insights)
**Date**: January 19, 2026
**Status**: Strategic Planning Document

---

## Executive Summary

After analyzing the nuke repository, existing documentation from past attempts, and the RLM (Recursive Language Models) paper on extending context limits, this document outlines a comprehensive approach to fixing the data extraction pipeline. The core insight is that **the extraction problem is fundamentally a long-context information aggregation problem** - similar to what the RLM paper addresses.

### Key Findings

1. **Root Cause**: Extraction failures stem from trying to process complex, JavaScript-rendered content (long context) through a single-pass approach that suffers from "context rot"
2. **Pattern Match**: The RLM paper's insight applies directly - treat the extraction target (HTML/DOM) as an "external environment" that can be programmatically examined, decomposed, and recursively processed
3. **Quick Wins Available**: Several fixes (batch size reduction, queue cleanup, source focusing) can be applied immediately for 50-100% improvement
4. **Strategic Shift Required**: Moving from "scrape everything" to "extract quality data recursively" aligns with RLM principles

---

## Part 1: Current State Analysis

### What's Working

| Component | Status | Notes |
|-----------|--------|-------|
| Queue Infrastructure | ✅ Good | `import_queue`, `bat_extraction_queue` with locking |
| BaT Extraction | ✅ 25% complete rate | Best auction source |
| HTML Snapshot Reuse | ✅ Cost-effective | Saves Firecrawl costs |
| Fallback Pattern | ✅ Implemented | Firecrawl → Direct → DOM |
| Image Upload | ✅ Working | Supabase storage integration |

### What's Broken

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Queue Timeouts | 🔴 HIGH | Batch size (10-20) × item time (15-30s) > 150s limit |
| KSL Blocking | 🔴 74% of failures | 3,037 items keep failing, clogging queue |
| Cars & Bids Empty Data | 🔴 0% images/comments | JavaScript rendering not captured |
| Low Complete Rate | 🟡 9.7% | Only 928 of 9,589 vehicles have VIN+mileage+price+5images |
| Orphaned Locks | 🟡 Fixed but recurs | Edge functions crash without releasing locks |
| Schema Mismatch | 🟡 2% alignment | 532 tables in migrations, 10 exist remotely |

### Queue Health Snapshot

```
import_queue:
  - Pending: 748
  - Processing: 99 (many orphaned)
  - Complete: 7,849
  - Failed: 4,112 (74% are KSL!)

bat_extraction_queue:
  - Pending: 1,000
  - Processing: 0
  - Complete: 0 (never runs!)
```

---

## Part 2: RLM Paper Insights Applied to Extraction

### The Core Insight

The RLM paper demonstrates that LLMs (and by extension, extraction systems) suffer from **context rot** - performance degrades as context length increases. Their solution: **treat long prompts as external environment variables that can be programmatically examined and recursively decomposed**.

### Mapping to Our Extraction Problem

| RLM Concept | Extraction Equivalent |
|-------------|----------------------|
| Long prompt as external variable | HTML/DOM as data structure |
| Programmatic examination (regex, slicing) | Targeted selectors, __NEXT_DATA__ parsing |
| Recursive sub-calls to LLM | Recursive extraction passes |
| Context chunking | Processing images/comments/bids separately |
| REPL environment | Edge Function with DOM parser |

### Key Takeaway

**Don't try to extract everything in one pass.** Instead:

1. **First Pass**: Examine structure, identify what data types exist
2. **Targeted Extractions**: Separate passes for images, comments, bids, metadata
3. **Recursive Refinement**: If first pass fails, try different extraction method
4. **Aggregate Results**: Combine all passes into complete profile

---

## Part 3: The Fix Strategy

### Immediate Actions (This Week)

#### 1. Queue Health - Unblock Processing

```sql
-- STEP 1: Skip KSL permanently (3,037 items)
UPDATE import_queue
SET status = 'skipped',
    error_message = 'KSL blocks scrapers - permanent skip'
WHERE listing_url LIKE '%ksl.com%'
  AND status IN ('failed', 'pending');

-- STEP 2: Skip expired/dead links (274 items)
UPDATE import_queue
SET status = 'skipped', error_message = 'Dead link or expired'
WHERE status = 'failed'
  AND (error_message LIKE '%410%' OR error_message LIKE '%404%');

-- STEP 3: Skip non-vehicles (169 items)
UPDATE import_queue
SET status = 'skipped', error_message = 'Non-vehicle content'
WHERE status = 'failed'
  AND (error_message LIKE '%Junk identity%'
    OR error_message LIKE '%Non-listing URL%'
    OR error_message LIKE '%Invalid make:%');

-- STEP 4: Retry old BaT failures (181 items - table now exists)
UPDATE import_queue
SET status = 'pending', attempts = 0, error_message = NULL
WHERE error_message LIKE '%vehicle_images% does not exist%';

-- STEP 5: Release orphaned locks (15+ minutes old)
UPDATE import_queue
SET status = 'pending', locked_at = NULL, locked_by = NULL
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '15 minutes';
```

**Expected Result**: ~3,500 items cleared, ~180 retried, queue much healthier.

#### 2. Batch Size Reduction - Fix Timeouts

**File**: `supabase/functions/process-import-queue/index.ts`

```typescript
// Change from:
const BATCH_SIZE = 10;  // Was causing 150s+ timeouts

// Change to:
const BATCH_SIZE = 3;   // 3 items × 30s = 90s (safe margin)
```

**Also in**: `supabase/functions/process-bat-extraction-queue/index.ts`

#### 3. Focus on Quality Sources Only

```sql
-- Prioritize auction sources (25-70% complete rate)
UPDATE import_queue
SET priority = 10
WHERE status = 'pending' AND (
  listing_url LIKE '%bringatrailer.com%' OR
  listing_url LIKE '%carsandbids.com%' OR
  listing_url LIKE '%classic.com%' OR
  listing_url LIKE '%mecum.com%' OR
  listing_url LIKE '%barrett-jackson.com%' OR
  listing_url LIKE '%pcarmarket.com%'
);

-- Skip low-quality sources (4-9% complete rate)
UPDATE import_queue
SET status = 'skipped', error_message = 'Low-quality source - optimizing for complete profiles'
WHERE status = 'pending'
  AND listing_url LIKE '%craigslist%';
```

---

### Phase 1: Recursive Extraction Architecture (Week 1-2)

Apply RLM principles to extraction by implementing **multi-pass extraction**:

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTRACTION ORCHESTRATOR                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌───────────┐   ┌───────────┐   ┌───────────┐
      │  Pass 1   │   │  Pass 2   │   │  Pass 3   │
      │ Structure │   │  Images   │   │ Comments  │
      └───────────┘   └───────────┘   └───────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────┐
                    │    AGGREGATE    │
                    │  Complete Profile│
                    └─────────────────┘
```

#### Pass 1: Structure Examination (Metadata)

**Goal**: Identify what extraction method to use, get basic metadata.

```typescript
async function examineStructure(html: string, url: string): Promise<ExtractionPlan> {
  // 1. Check for __NEXT_DATA__ (Next.js sites like Cars & Bids)
  const nextData = extractNextData(html);
  if (nextData) {
    return { method: 'nextjs', data: nextData };
  }

  // 2. Check for embedded JSON (BaT pattern)
  const embeddedJson = extractEmbeddedJson(html);
  if (embeddedJson) {
    return { method: 'embedded_json', data: embeddedJson };
  }

  // 3. Check for structured data (JSON-LD)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    return { method: 'json_ld', data: jsonLd };
  }

  // 4. Fallback to DOM parsing
  return { method: 'dom', data: null };
}
```

#### Pass 2: Targeted Image Extraction

**Goal**: Extract all gallery images using method identified in Pass 1.

```typescript
async function extractImagesRecursive(
  html: string,
  plan: ExtractionPlan,
  depth: number = 0
): Promise<string[]> {
  const images: string[] = [];

  // Try primary method
  if (plan.method === 'nextjs' && plan.data?.auction?.images) {
    images.push(...plan.data.auction.images.map(i => i.url));
  } else if (plan.method === 'embedded_json') {
    // Parse from embedded JSON
  } else {
    // DOM parsing fallback
    images.push(...extractFromGallery(html));
    images.push(...extractFromSrcset(html));
    images.push(...extractFromBackgroundImages(html));
  }

  // RECURSIVE: If we got <5 images and haven't tried all methods, recurse
  if (images.length < 5 && depth < 2) {
    const fallbackImages = await extractImagesRecursive(
      html,
      { method: 'dom', data: null }, // Try DOM fallback
      depth + 1
    );
    images.push(...fallbackImages);
  }

  return [...new Set(images)]; // Dedupe
}
```

#### Pass 3: Comments/Bids Extraction

**Goal**: Extract community data separately (can be expensive, do only when needed).

```typescript
async function extractCommentsRecursive(
  html: string,
  plan: ExtractionPlan,
  options: { includeReplies: boolean; maxComments: number }
): Promise<Comment[]> {
  // Similar recursive pattern...
}
```

#### Aggregation Phase

```typescript
async function aggregateExtraction(
  passes: {
    structure: ExtractionPlan;
    images: string[];
    comments: Comment[];
    bids: Bid[];
    metadata: VehicleMetadata;
  }
): Promise<CompleteProfile | PartialProfile> {
  // Calculate completeness score
  const completeness = calculateCompleteness(passes);

  if (completeness >= 0.8) {
    return { type: 'complete', data: passes, score: completeness };
  } else {
    // Queue for retry with different method
    return { type: 'partial', data: passes, score: completeness, needsRetry: true };
  }
}
```

---

### Phase 2: Enhanced __NEXT_DATA__ Extraction (Week 1)

**Critical for Cars & Bids** - they embed everything in `__NEXT_DATA__`.

#### Implementation

```typescript
function extractFromNextData(html: string): {
  images: string[];
  comments: Comment[];
  bids: Bid[];
  bidders: Bidder[];
  sections: StructuredSection[];
} {
  // Find the script tag
  const scriptMatch = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!scriptMatch) {
    // Try alternative patterns
    const windowMatch = html.match(/window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (!windowMatch) return null;
  }

  const jsonStr = scriptMatch?.[1] || windowMatch?.[1];
  const data = JSON.parse(jsonStr);

  // Navigate to auction data (structure varies)
  const auction =
    data?.props?.pageProps?.auction ||
    data?.props?.pageProps?.listing ||
    data?.props?.pageProps?.vehicle ||
    data?.pageProps?.auction;

  if (!auction) return null;

  return {
    images: extractNextDataImages(auction),
    comments: extractNextDataComments(auction),
    bids: extractNextDataBids(auction),
    bidders: extractNextDataBidders(auction),
    sections: extractNextDataSections(auction),
  };
}

function extractNextDataImages(auction: any): string[] {
  const images: string[] = [];

  // Try common paths
  const imageSources = [
    auction.images,
    auction.gallery,
    auction.photos,
    auction.media?.images,
    auction.listing?.images,
  ].filter(Boolean).flat();

  for (const img of imageSources) {
    const url = img?.url || img?.src || img?.large || img?.original || img;
    if (typeof url === 'string' && url.startsWith('http')) {
      images.push(url);
    }
  }

  return images;
}
```

---

### Phase 3: Firecrawl Retry with Exponential Backoff (Week 1)

```typescript
async function fetchWithFirecrawlRetry(
  url: string,
  options: FirecrawlOptions,
  maxRetries: number = 3
): Promise<FirecrawlResult> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Simplify options on retry (remove actions that fail)
      const simplifiedOptions = attempt > 0
        ? simplifyFirecrawlOptions(options, attempt)
        : options;

      const result = await firecrawl.scrape(url, simplifiedOptions);

      // Validate result has content
      if (!result?.html || result.html.length < 1000) {
        throw new Error('Firecrawl returned insufficient content');
      }

      return result;
    } catch (error) {
      lastError = error;

      // Don't retry on 4xx errors (client errors)
      if (error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }

      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.log(`Firecrawl attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function simplifyFirecrawlOptions(options: FirecrawlOptions, attempt: number): FirecrawlOptions {
  const simplified = { ...options };

  if (attempt >= 1) {
    // Remove click actions (often fail)
    simplified.actions = simplified.actions?.filter(a => a.type !== 'click');
  }

  if (attempt >= 2) {
    // Remove all actions except scroll
    simplified.actions = simplified.actions?.filter(a => a.type === 'scroll');
  }

  return simplified;
}
```

---

### Phase 4: Partial Results & Retry Queue (Week 2)

Apply RLM principle: **don't fail completely, store what you have and retry for missing parts**.

#### Schema Addition

```sql
-- Add extraction completeness tracking
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS
  extraction_completeness FLOAT DEFAULT 0;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS
  extraction_missing_fields TEXT[] DEFAULT '{}';

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS
  extraction_method TEXT;

-- Create retry queue for incomplete extractions
CREATE TABLE IF NOT EXISTS extraction_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  listing_url TEXT NOT NULL,
  missing_fields TEXT[] NOT NULL,
  retry_method TEXT NOT NULL,  -- 'browser', 'firecrawl', 'direct', 'api'
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending'  -- pending, processing, complete, failed
);

CREATE INDEX idx_retry_queue_status ON extraction_retry_queue(status, next_retry_at);
```

#### Implementation

```typescript
async function processExtractionWithPartialSave(
  url: string,
  queueItem: ImportQueueItem
): Promise<ExtractionResult> {
  let vehicle: Partial<Vehicle> = {};
  let missing: string[] = [];

  try {
    // Try full extraction
    const result = await extractFull(url);
    vehicle = result.vehicle;

    // Check what's missing
    if (!vehicle.images?.length || vehicle.images.length < 5) {
      missing.push('images');
    }
    if (!vehicle.comments?.length) {
      missing.push('comments');
    }
    if (!vehicle.vin) {
      missing.push('vin');
    }
    if (!vehicle.price) {
      missing.push('price');
    }

  } catch (error) {
    // Even on error, try to save partial data
    console.error('Full extraction failed, attempting partial save:', error);
  }

  // Calculate completeness
  const completeness = calculateCompleteness(vehicle);
  vehicle.extraction_completeness = completeness;
  vehicle.extraction_missing_fields = missing;

  // Save vehicle (even if incomplete)
  const savedVehicle = await saveVehicle(vehicle);

  // Queue retry if incomplete
  if (completeness < 0.8 && missing.length > 0) {
    await queueRetry(savedVehicle.id, url, missing);
  }

  return {
    success: true,
    complete: completeness >= 0.8,
    vehicle: savedVehicle,
    missing,
    completeness,
  };
}
```

---

### Phase 5: Browser Fallback (Week 2-3)

For JavaScript-heavy sites when all else fails.

#### Option A: Sparticuz Chromium (Edge Function)

```typescript
// supabase/functions/browser-render/index.ts
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function renderWithBrowser(url: string): Promise<string> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    );

    // Navigate and wait for content
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    // Wait for dynamic content
    await page.waitForSelector('[data-testid="gallery"]', { timeout: 10000 })
      .catch(() => {}); // Don't fail if selector not found

    // Get rendered HTML
    return await page.content();

  } finally {
    await browser.close();
  }
}
```

#### Option B: Browserless.io Service

```typescript
async function renderWithBrowserless(url: string): Promise<string> {
  const response = await fetch('https://chrome.browserless.io/content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BROWSERLESS_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      waitFor: 5000,
      gotoOptions: {
        waitUntil: 'networkidle0',
      },
    }),
  });

  return await response.text();
}
```

---

## Part 4: Monitoring & Observability

### Extraction Metrics Dashboard

```sql
-- Create metrics view
CREATE OR REPLACE VIEW extraction_metrics AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as total_processed,
  COUNT(*) FILTER (WHERE extraction_completeness >= 0.8) as complete,
  COUNT(*) FILTER (WHERE extraction_completeness < 0.8) as incomplete,
  AVG(extraction_completeness) as avg_completeness,
  COUNT(*) FILTER (WHERE array_length(extraction_missing_fields, 1) > 0) as needs_retry,
  -- By source
  COUNT(*) FILTER (WHERE discovery_url LIKE '%bringatrailer%') as bat_count,
  COUNT(*) FILTER (WHERE discovery_url LIKE '%carsandbids%') as cab_count
FROM vehicles
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;
```

### Health Check Alerts

```typescript
// Run every hour via cron
async function checkExtractionHealth(): Promise<HealthReport> {
  const metrics = await getRecentMetrics();

  const alerts: Alert[] = [];

  // Alert if queue is growing
  if (metrics.queuePending > metrics.queueCompleted24h) {
    alerts.push({
      level: 'warning',
      message: `Queue growing: ${metrics.queuePending} pending vs ${metrics.queueCompleted24h} completed/24h`,
    });
  }

  // Alert if complete rate dropping
  if (metrics.completeRate24h < 0.2) {
    alerts.push({
      level: 'critical',
      message: `Low complete rate: ${metrics.completeRate24h * 100}%`,
    });
  }

  // Alert if high failure rate
  if (metrics.failureRate24h > 0.3) {
    alerts.push({
      level: 'warning',
      message: `High failure rate: ${metrics.failureRate24h * 100}%`,
    });
  }

  return { healthy: alerts.length === 0, alerts };
}
```

---

## Part 5: Implementation Timeline

### Week 1: Immediate Fixes & Foundation

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| 1 | Run queue cleanup SQL | - | Pending |
| 1 | Reduce batch sizes to 3 | - | Pending |
| 2 | Deploy auth-fixed functions | - | Done |
| 2-3 | Implement __NEXT_DATA__ extraction | - | Pending |
| 3-4 | Add Firecrawl retry logic | - | Pending |
| 5 | Test & verify queue draining | - | Pending |

### Week 2: Recursive Architecture

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| 1-2 | Implement multi-pass extraction | - | Pending |
| 2-3 | Add partial results saving | - | Pending |
| 3-4 | Create retry queue | - | Pending |
| 4-5 | Integrate monitoring | - | Pending |

### Week 3: Browser Fallback & Polish

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| 1-2 | Implement browser fallback | - | Pending |
| 3-4 | End-to-end testing | - | Pending |
| 5 | Documentation & runbook | - | Pending |

---

## Part 6: Success Criteria

### Quantitative Targets

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Queue drain rate | ~70/day | 200-500/day | Week 1 |
| Profile completeness | 9.7% | 50%+ | Week 2 |
| Cars & Bids image extraction | 0% | 80%+ | Week 2 |
| Failed queue items | 4,112 | <500 | Week 1 |
| Processing timeouts | Frequent | Rare | Week 1 |

### Qualitative Goals

1. **Reliable Pipeline**: Queue processes without manual intervention
2. **Quality Data**: Every vehicle has VIN, price, mileage, 5+ images
3. **Observable**: Can see what's working/broken at a glance
4. **Recoverable**: Partial failures don't lose data, can retry

---

## Part 7: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Browser fallback adds latency | Only use when other methods fail; async processing |
| Firecrawl costs increase with retries | Limit retries to 3; use direct fetch when possible |
| Sites change structure | __NEXT_DATA__ extraction handles this well; DOM fallback |
| Rate limiting from sites | Add delays between requests; respect robots.txt |
| Edge Function timeouts persist | Keep batch size at 3; implement chunked processing later |

---

## Appendix A: Key File Locations

```
Core Extraction:
├── supabase/functions/extract-premium-auction/index.ts (322KB main extractor)
├── supabase/functions/extract-auction-comments/index.ts (comments extractor)
├── supabase/functions/process-import-queue/index.ts (queue processor)
├── supabase/functions/scrape-vehicle-with-firecrawl/index.ts (Firecrawl wrapper)

Queue Management:
├── supabase/functions/process-bat-extraction-queue/index.ts
├── supabase/functions/pipeline-orchestrator/index.ts

Documentation:
├── PIPELINE_STATUS.md
├── ISSUES_FOUND_AND_FIXES.md
├── COMPLETE_PROFILES_ONLY_STRATEGY.md
├── docs/extraction-improvement-plan.md
├── DATA_QUALITY_IMPROVEMENT_PLAN.md
```

## Appendix B: SQL Cleanup Scripts (Ready to Run)

```sql
-- MASTER CLEANUP SCRIPT
-- Run this in order to clean up the queue

-- 1. Skip KSL (blocks scrapers)
UPDATE import_queue
SET status = 'skipped', error_message = 'KSL blocks scrapers'
WHERE listing_url LIKE '%ksl.com%' AND status IN ('failed', 'pending');

-- 2. Skip dead links
UPDATE import_queue
SET status = 'skipped', error_message = 'Dead link'
WHERE error_message LIKE '%404%' OR error_message LIKE '%410%';

-- 3. Skip non-vehicles
UPDATE import_queue
SET status = 'skipped', error_message = 'Non-vehicle content'
WHERE error_message LIKE '%Junk identity%'
   OR error_message LIKE '%Non-listing URL%'
   OR error_message LIKE '%Invalid make:%';

-- 4. Retry old BaT failures (table exists now)
UPDATE import_queue
SET status = 'pending', attempts = 0, error_message = NULL
WHERE error_message LIKE '%vehicle_images% does not exist%';

-- 5. Release orphaned locks
UPDATE import_queue
SET status = 'pending', locked_at = NULL, locked_by = NULL
WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '15 minutes';

-- 6. Prioritize auction sources
UPDATE import_queue
SET priority = 10
WHERE status = 'pending' AND (
  listing_url LIKE '%bringatrailer.com%' OR
  listing_url LIKE '%carsandbids.com%' OR
  listing_url LIKE '%classic.com%' OR
  listing_url LIKE '%mecum.com%' OR
  listing_url LIKE '%barrett-jackson.com%' OR
  listing_url LIKE '%pcarmarket.com%'
);

-- 7. Skip low-quality sources
UPDATE import_queue
SET status = 'skipped', error_message = 'Low-quality source'
WHERE status = 'pending' AND listing_url LIKE '%craigslist%';

-- Verify results
SELECT status, COUNT(*) FROM import_queue GROUP BY status;
```

---

## Appendix C: RLM Paper Reference

**Paper**: "Recursive Language Models" (arXiv:2512.24601v1)
**Authors**: Zhang, Kraska, Khattab (MIT CSAIL)
**Key Insight**: Process arbitrarily long inputs by treating them as external environment variables that can be programmatically examined, decomposed, and recursively processed.

**Applied Here**:
- HTML/DOM treated as external data structure
- Multi-pass extraction = recursive sub-calls
- Partial results + retry = handling context rot gracefully
- __NEXT_DATA__ parsing = programmatic examination of embedded data

---

*Document generated from analysis of nuke repository, 3000+ Cursor conversations, and RLM research paper.*
