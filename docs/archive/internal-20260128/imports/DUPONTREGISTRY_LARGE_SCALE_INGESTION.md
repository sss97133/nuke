# duPont Registry Large-Scale Ingestion Strategy

## Overview

**14,821 listings** need to be ingested. This document outlines a production-ready, scalable strategy using the existing `import_queue` system.

---

## Strategy: Three-Phase Approach

### Phase 1: Discovery (Extract All URLs)
**Goal**: Get all 14,821 listing URLs into a list
**Method**: Paginate through browse pages
**Output**: Array of listing URLs
**Time**: ~2-4 hours (with rate limiting)

### Phase 2: Queue Population (Fast Bulk Insert)
**Goal**: Add all URLs to `import_queue` table
**Method**: Bulk inserts in batches
**Output**: All listings in `import_queue` with `status='pending'`
**Time**: ~10-30 minutes

### Phase 3: Processing (Controlled Batch Processing)
**Goal**: Process listings through `process-import-queue`
**Method**: Continuous batch processing with rate limiting
**Output**: Vehicles created, images downloaded, organizations linked
**Time**: ~3-7 days (depending on rate limits and image counts)

---

## Phase 1: Discovery Strategy

### Option A: Paginate Browse Page (Recommended)

```typescript
async function discoverAllListings(
  browseUrl: string = 'https://www.dupontregistry.com/autos/results/all',
  supabase: any
): Promise<string[]> {
  const allUrls = new Set<string>();
  let currentPage = 1;
  let hasMorePages = true;
  const maxPages = 1000; // Safety limit (adjust based on actual page count)
  
  console.log(`🔍 Starting discovery from: ${browseUrl}`);
  
  while (hasMorePages && currentPage <= maxPages) {
    try {
      const pageUrl = currentPage === 1 
        ? browseUrl 
        : `${browseUrl}?page=${currentPage}`;
      
      console.log(`📄 Scraping page ${currentPage}: ${pageUrl}`);
      
      // Scrape page
      const html = await fetchPage(pageUrl);
      const doc = parseHTML(html);
      
      // Extract listing URLs
      const listingLinks = doc.querySelectorAll('a[href*="/autos/listing/"]');
      const pageUrls: string[] = [];
      
      listingLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          const fullUrl = href.startsWith('http') 
            ? href 
            : `https://www.dupontregistry.com${href}`;
          pageUrls.push(fullUrl);
        }
      });
      
      console.log(`   Found ${pageUrls.length} listings on page ${currentPage}`);
      
      // Add to set (deduplication)
      pageUrls.forEach(url => allUrls.add(url));
      
      // Check for next page
      const nextPageLink = doc.querySelector('[class*="next"] a, [class*="pagination"] a[aria-label*="next"]');
      hasMorePages = !!nextPageLink && pageUrls.length > 0;
      
      currentPage++;
      
      // Rate limiting (1-2 seconds between pages)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Progress logging
      if (currentPage % 10 === 0) {
        console.log(`   Progress: ${allUrls.size} unique listings discovered`);
      }
      
    } catch (error: any) {
      console.error(`❌ Error on page ${currentPage}:`, error.message);
      
      // If we get 404 or no listings, assume we're done
      if (error.status === 404 || error.message.includes('not found')) {
        hasMorePages = false;
      } else {
        // Retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 5000));
        currentPage--; // Retry same page
      }
    }
  }
  
  console.log(`✅ Discovery complete: ${allUrls.size} unique listings found`);
  return Array.from(allUrls);
}
```

### Option B: Sitemap (If Available)

```typescript
async function discoverFromSitemap(): Promise<string[]> {
  const sitemapUrl = 'https://www.dupontregistry.com/sitemap.xml';
  
  try {
    const response = await fetch(sitemapUrl);
    const xml = await response.text();
    
    // Parse sitemap XML
    const urls = xml.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g) || [];
    const listingUrls = urls
      .map(match => match.replace(/<\/?loc>/g, ''))
      .filter(url => url.includes('/autos/listing/'));
    
    console.log(`✅ Found ${listingUrls.length} listings in sitemap`);
    return listingUrls;
  } catch (error) {
    console.warn('⚠️ Sitemap not available, falling back to pagination');
    return [];
  }
}
```

### Option C: Search Engine Queries (Fallback)

```typescript
// Use Google/Bing site: queries to discover URLs
// This is slower but works if pagination is broken
```

**Recommended**: Start with Option B (sitemap), fallback to Option A (pagination)

---

## Phase 2: Queue Population (Bulk Insert)

### Strategy: Batch Inserts

```typescript
async function populateImportQueue(
  listingUrls: string[],
  sourceId: string,
  supabase: any
): Promise<{ queued: number; skipped: number; errors: number }> {
  const stats = { queued: 0, skipped: 0, errors: 0 };
  const BATCH_SIZE = 100; // Insert 100 at a time
  
  console.log(`📥 Populating import_queue with ${listingUrls.length} listings...`);
  
  // Process in batches
  for (let i = 0; i < listingUrls.length; i += BATCH_SIZE) {
    const batch = listingUrls.slice(i, i + BATCH_SIZE);
    
    try {
      // Prepare batch data
      const queueItems = batch.map(url => ({
        source_id: sourceId,
        listing_url: url,
        listing_title: null, // Will be filled during scraping
        listing_price: null,
        listing_year: null,
        listing_make: null,
        listing_model: null,
        thumbnail_url: null,
        raw_data: { source: 'dupontregistry', url },
        status: 'pending',
        priority: 5, // Standard priority
        attempts: 0
      }));
      
      // Bulk insert (PostgreSQL handles conflicts)
      const { error } = await supabase
        .from('import_queue')
        .upsert(queueItems, {
          onConflict: 'listing_url',
          ignoreDuplicates: true
        });
      
      if (error) {
        console.error(`❌ Batch ${i / BATCH_SIZE + 1} error:`, error.message);
        stats.errors += batch.length;
      } else {
        stats.queued += batch.length;
        console.log(`   ✅ Batch ${i / BATCH_SIZE + 1}: ${batch.length} queued (${stats.queued}/${listingUrls.length})`);
      }
      
      // Small delay to avoid overwhelming DB
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error: any) {
      console.error(`❌ Error processing batch:`, error.message);
      stats.errors += batch.length;
    }
  }
  
  console.log(`✅ Queue population complete: ${stats.queued} queued, ${stats.skipped} skipped, ${stats.errors} errors`);
  return stats;
}
```

**Time Estimate**: 
- 14,821 listings ÷ 100 per batch = ~148 batches
- ~100ms per batch = ~15 seconds total
- **Total: ~30 seconds to 2 minutes** (with error handling)

---

## Phase 3: Processing (Controlled Batch Processing)

### Strategy: Continuous Batch Processing

The existing `process-import-queue` function handles this. We just need to call it repeatedly.

```typescript
// This is already implemented - just call it repeatedly
// via cron job or scheduled function

// Example: Process in batches of 40 (default)
// Each batch takes ~2-5 minutes (depending on images)
// 14,821 ÷ 40 = ~371 batches
// At 3 minutes per batch = ~18.5 hours of processing time
// But with rate limiting and image downloads, expect 3-7 days
```

### Rate Limiting Strategy

**Per Listing:**
- **Scraping**: 1-2 second delay between listings
- **Image Downloads**: 0.5-1 second between images
- **Database Operations**: Batched (fast)

**Total Time Per Listing:**
- Scraping: ~2 seconds
- Image processing (avg 20 images): ~20 seconds
- Database operations: ~1 second
- **Total: ~23 seconds per listing**

**For 14,821 listings:**
- 14,821 × 23 seconds = 340,883 seconds
- = ~94.7 hours = **~4 days** of continuous processing

**With batching (40 at a time):**
- Parallel processing within batch
- **Estimated: 3-7 days** depending on:
  - Image counts per listing
  - Network conditions
  - Firecrawl rate limits
  - Supabase compute capacity

### Monitoring & Resumability

**The queue system is already resumable:**
- ✅ Failed items stay in queue with `status='failed'`
- ✅ Can retry failed items
- ✅ Locking prevents double-processing
- ✅ `attempts` counter prevents infinite retries

**Monitoring Script:**

```typescript
async function monitorIngestionProgress(sourceId: string, supabase: any) {
  const { data: stats } = await supabase
    .from('import_queue')
    .select('status')
    .eq('source_id', sourceId);
  
  const counts = {
    pending: 0,
    processing: 0,
    complete: 0,
    failed: 0,
    skipped: 0
  };
  
  stats?.forEach(item => {
    counts[item.status as keyof typeof counts]++;
  });
  
  const total = stats?.length || 0;
  const completed = counts.complete;
  const progress = total > 0 ? (completed / total * 100).toFixed(1) : '0';
  
  console.log(`
📊 Ingestion Progress:
   Total: ${total}
   Pending: ${counts.pending}
   Processing: ${counts.processing}
   Complete: ${counts.complete} (${progress}%)
   Failed: ${counts.failed}
   Skipped: ${counts.skipped}
  `);
  
  return counts;
}
```

---

## Dealer Integration

### Additional Discovery: Dealer Profiles

Many dealers have their own websites AND listings on duPont Registry. We need to:

1. **Discover all dealer profiles** (`/autos/{dealer-slug}/{id}`)
2. **Extract dealer websites** from profiles
3. **Extract inventory from duPont Registry** (`/autos/results/filter:dealers={dealer-slug}`)
4. **Extract inventory from dealer websites** (using existing infrastructure)
5. **Deduplicate** (same vehicle might be on both sources)

See `DUPONTREGISTRY_DEALER_INGESTION.md` for complete dealer strategy.

---

## Implementation Plan

### Step 1: Discovery Edge Function

Create `scrape-dupontregistry-discover`:

```typescript
// supabase/functions/scrape-dupontregistry-discover/index.ts
serve(async (req) => {
  const { use_sitemap = true, max_pages = 1000 } = await req.json();
  
  // Try sitemap first
  let urls: string[] = [];
  if (use_sitemap) {
    urls = await discoverFromSitemap();
  }
  
  // Fallback to pagination
  if (urls.length === 0) {
    urls = await discoverAllListings(max_pages);
  }
  
  return new Response(JSON.stringify({
    success: true,
    total_listings: urls.length,
    urls: urls.slice(0, 1000) // Return first 1000 for verification
  }));
});
```

### Step 2: Queue Population Edge Function

Create `populate-dupontregistry-queue`:

```typescript
// supabase/functions/populate-dupontregistry-queue/index.ts
serve(async (req) => {
  const { listing_urls, source_id } = await req.json();
  
  if (!listing_urls || !Array.isArray(listing_urls)) {
    return new Response(JSON.stringify({ error: 'listing_urls array required' }), { status: 400 });
  }
  
  const stats = await populateImportQueue(listing_urls, source_id, supabase);
  
  return new Response(JSON.stringify({
    success: true,
    stats
  }));
});
```

### Step 3: Processing (Use Existing)

Use existing `process-import-queue` function:

```bash
# Call repeatedly via cron or scheduled function
# Default batch size: 40
# Can run multiple instances in parallel (locking prevents conflicts)
```

### Step 4: Orchestration Script

Create a script to coordinate all phases:

```typescript
// scripts/ingest-dupontregistry-complete.js

async function main() {
  console.log('🚀 Starting duPont Registry Complete Ingestion\n');
  
  // Step 1: Discovery
  console.log('Phase 1: Discovery...');
  const discoverResult = await callFunction('scrape-dupontregistry-discover', {
    use_sitemap: true,
    max_pages: 1000
  });
  
  if (!discoverResult.success) {
    console.error('❌ Discovery failed');
    process.exit(1);
  }
  
  const allUrls = discoverResult.data.urls; // Need to handle pagination if > 1000
  console.log(`✅ Discovered ${allUrls.length} listings\n`);
  
  // Step 2: Get source ID
  const sourceId = await getOrCreateSource('dupontregistry.com', supabase);
  
  // Step 3: Populate queue (in chunks if > 1000)
  console.log('Phase 2: Populating queue...');
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < allUrls.length; i += CHUNK_SIZE) {
    const chunk = allUrls.slice(i, i + CHUNK_SIZE);
    await callFunction('populate-dupontregistry-queue', {
      listing_urls: chunk,
      source_id: sourceId
    });
    console.log(`   ✅ Chunk ${i / CHUNK_SIZE + 1}: ${chunk.length} queued`);
  }
  
  console.log('✅ Queue population complete\n');
  
  // Step 3: Start processing
  console.log('Phase 3: Processing (this will take 3-7 days)...');
  console.log('   Run: process-import-queue repeatedly or via cron');
  console.log('   Monitor: Check import_queue status');
}
```

---

## Optimization Strategies

### 1. Prioritization

**High Priority** (process first):
- Recent listings (2024-2025)
- High-value vehicles (price > $100k)
- Live auctions (if applicable)

**Standard Priority**:
- Everything else

```typescript
// Set priority when populating queue
priority: listingYear >= 2024 ? 10 : 5
```

### 2. Parallel Processing

**Multiple Workers:**
- Run multiple `process-import-queue` instances
- Locking prevents conflicts
- Each worker processes different batches

```bash
# Run 3 workers in parallel
curl -X POST .../process-import-queue -d '{"batch_size": 40, "source_id": "..."}' &
curl -X POST .../process-import-queue -d '{"batch_size": 40, "source_id": "..."}' &
curl -X POST .../process-import-queue -d '{"batch_size": 40, "source_id": "..."}' &
```

### 3. Image Optimization

**Skip Image Upload Initially:**
- Process listings first
- Backfill images later

```typescript
// Process without images
await callFunction('process-import-queue', {
  batch_size: 40,
  skip_image_upload: true // Faster processing
});

// Backfill images later
await callFunction('backfill-origin-vehicle-images', {
  batch_size: 50
});
```

### 4. Rate Limit Management

**Respect Firecrawl Limits:**
- Monitor for 429 errors
- Implement exponential backoff
- Use multiple Firecrawl accounts if needed

---

## Timeline Estimate

### Phase 1: Discovery
- **Time**: 2-4 hours
- **Method**: Paginate browse pages or sitemap

### Phase 2: Queue Population
- **Time**: 10-30 minutes
- **Method**: Bulk inserts

### Phase 3: Processing
- **Time**: 3-7 days
- **Method**: Continuous batch processing
- **Rate**: ~40 listings per batch, ~3 minutes per batch
- **Total batches**: ~371 batches

**Total Timeline**: **3-7 days** (mostly Phase 3)

---

## Monitoring & Recovery

### Daily Progress Check

```sql
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM import_queue
WHERE source_id = '<dupont-registry-source-id>'
GROUP BY status
ORDER BY count DESC;
```

### Retry Failed Items

```typescript
// Reset failed items for retry
await supabase
  .from('import_queue')
  .update({ 
    status: 'pending',
    attempts: 0,
    next_attempt_at: null
  })
  .eq('status', 'failed')
  .eq('source_id', sourceId)
  .lt('attempts', 3); // Only retry items with < 3 attempts
```

### Resume from Checkpoint

The queue system is inherently resumable - just keep calling `process-import-queue` until all items are processed.

---

## Summary

**For 14,821 listings:**

1. ✅ **Discovery**: 2-4 hours (paginate or sitemap)
2. ✅ **Queue Population**: 10-30 minutes (bulk inserts)
3. ✅ **Processing**: 3-7 days (continuous batches)
4. ✅ **Monitoring**: Daily progress checks
5. ✅ **Recovery**: Automatic retry for failed items

**Key Features:**
- ✅ Resumable (can stop/start anytime)
- ✅ Scalable (multiple workers)
- ✅ Monitored (progress tracking)
- ✅ Robust (error handling, retries)
- ✅ Optimized (prioritization, batching)

**The existing `import_queue` system handles all of this - we just need to:**
1. Discover all URLs
2. Populate the queue
3. Let `process-import-queue` do its job

