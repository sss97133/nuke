# Discovery vs Extraction Workflow

## Why Separate Discovery from Extraction?

### Current Approach (One-Step)
```
Scrape Directory → Extract URLs → Immediately Process Each URL
```
**Problems:**
- Can't retry failed extractions without re-scraping
- No visibility into discovered vs processed URLs
- Hard to batch process efficiently
- Discovery and extraction failures are mixed

### Recommended Approach (Two-Phase)

```
PHASE 1: DISCOVERY (Fast, Lightweight)
Scrape Directory → Catalog All Profile URLs → Store in Queue

PHASE 2: EXTRACTION (Slower, Intensive)
Process Queue → Extract Profiles → Create Organizations → Extract Inventory
```

**Benefits:**
- ✅ Retry failed extractions without re-discovery
- ✅ Track discovered vs processed
- ✅ Batch processing with better rate limiting
- ✅ Progress tracking and monitoring
- ✅ Can pause/resume extraction phase
- ✅ Better error handling and retry logic

---

## Proposed Architecture

### Phase 1: Discovery Queue

**Table**: `dealer_discovery_queue` (or use existing `scrape_sources`)

```sql
CREATE TABLE IF NOT EXISTS dealer_discovery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Discovery Info
  profile_url TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'classic_com', -- 'classic_com', 'manual', etc.
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  
  -- Extraction Results
  organization_id UUID REFERENCES businesses(id),
  extraction_method TEXT, -- 'firecrawl', 'llm', 'dom'
  confidence_score DECIMAL(3,2),
  
  -- Metadata
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dealer_discovery_status ON dealer_discovery_queue(status, discovered_at);
CREATE INDEX idx_dealer_discovery_url ON dealer_discovery_queue(profile_url);
```

### Phase 2: Extraction Processing

**Function**: `process-dealer-discovery-queue`

Processes items from `dealer_discovery_queue`:
1. Marks status as 'processing'
2. Calls `index-classic-com-dealer` function
3. Updates with results
4. Marks as 'completed' or 'failed'

---

## Implementation

### Step 1: Discovery Script (Index URLs)

```javascript
// scripts/discover-classic-com-dealers.js

async function discoverDealerProfiles() {
  // Scrape directory
  const profileUrls = await scrapeDealerDirectory();
  
  // Store in discovery queue (don't extract yet)
  for (const url of profileUrls) {
    await supabase
      .from('dealer_discovery_queue')
      .upsert({
        profile_url: url,
        source: 'classic_com',
        status: 'pending'
      }, {
        onConflict: 'profile_url'
      });
  }
  
  return profileUrls.length;
}
```

### Step 2: Extraction Script (Process Queue)

```javascript
// scripts/extract-discovered-dealers.js

async function processDiscoveryQueue(batchSize = 10) {
  // Get pending items
  const { data: queueItems } = await supabase
    .from('dealer_discovery_queue')
    .select('*')
    .eq('status', 'pending')
    .order('discovered_at', { ascending: true })
    .limit(batchSize);
  
  // Process each
  for (const item of queueItems) {
    await supabase
      .from('dealer_discovery_queue')
      .update({ status: 'processing', last_attempted_at: new Date() })
      .eq('id', item.id);
    
    try {
      const result = await supabase.functions.invoke('index-classic-com-dealer', {
        body: { profile_url: item.profile_url }
      });
      
      await supabase
        .from('dealer_discovery_queue')
        .update({
          status: 'completed',
          organization_id: result.data.organization_id,
          processed_at: new Date()
        })
        .eq('id', item.id);
    } catch (error) {
      await supabase
        .from('dealer_discovery_queue')
        .update({
          status: 'failed',
          error_message: error.message,
          attempts: item.attempts + 1
        })
        .eq('id', item.id);
    }
  }
}
```

---

## Benefits of Two-Phase Approach

### 1. Retry Logic
- Failed extractions can be retried without re-discovering URLs
- Track attempt counts
- Exponential backoff for retries

### 2. Progress Tracking
```sql
-- See discovery progress
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM dealer_discovery_queue
GROUP BY status;

-- Results:
-- pending: 450 (45%)
-- completed: 400 (40%)
-- failed: 50 (5%)
-- processing: 100 (10%)
```

### 3. Batch Processing
- Process in controlled batches
- Better rate limiting
- Can pause/resume

### 4. Monitoring & Debugging
- See which URLs are stuck
- Identify patterns in failures
- Track extraction methods that work best

---

## Migration from Current Approach

### Option 1: Use Existing `scrape_sources` Table

If `scrape_sources` exists and has appropriate fields, we can use it:

```sql
-- Check if scrape_sources has what we need
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'scrape_sources';
```

### Option 2: Create New `dealer_discovery_queue` Table

More focused, purpose-built for dealer discovery.

---

## Recommended Workflow

### Initial Discovery Run
```bash
# Phase 1: Discover all Classic.com dealer profiles
node scripts/discover-classic-com-dealers.js

# Output: "Discovered 500 dealer profile URLs, queued for extraction"
```

### Extraction Runs (Can Run Multiple Times)
```bash
# Phase 2: Extract discovered profiles (processes 50 at a time)
node scripts/extract-discovered-dealers.js --batch-size 50

# Can run multiple times to process remaining items
# Automatically skips completed items
```

### Monitor Progress
```sql
SELECT 
  status,
  COUNT(*) as count
FROM dealer_discovery_queue
GROUP BY status;
```

---

## Next Steps

1. ✅ Create `dealer_discovery_queue` table (or use `scrape_sources`)
2. ✅ Update discovery script to store URLs instead of processing
3. ✅ Create extraction script to process queue
4. ✅ Add retry logic for failed extractions
5. ✅ Add progress monitoring dashboard

Want me to implement this two-phase approach?

