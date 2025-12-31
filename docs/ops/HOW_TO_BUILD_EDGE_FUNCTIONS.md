# How to Build Edge Functions

## System Optimization: Queue-Based Processing

**The Nuke platform is optimized for queue-based processing to avoid 60-second timeout limits.**

### The Pattern

1. **Discovery Function** - Finds items and adds them to a queue (fast, <10s)
2. **Queue Table** - Stores items to be processed with status tracking
3. **Processing Function** - Processes queue items in small batches (each batch <50s)

### Why This Pattern?

- ✅ **No timeout issues** - Each batch completes well under 60s limit
- ✅ **Can process unlimited items** - Queue can grow, process incrementally
- ✅ **Automatic retry** - Failed items can be retried
- ✅ **Better error handling** - Individual items can fail without stopping everything
- ✅ **Scalable** - Multiple workers can process the queue in parallel

## Step-by-Step: Building a New Function

### Step 1: Decide If You Need a Queue

**Use a queue if:**
- Processing multiple items (10+)
- Each item takes >5 seconds
- You might hit timeout (60s total)
- Items can be processed independently

**Skip queue if:**
- Single operation (<30s)
- User-facing synchronous request
- Small batch (1-5 items, each <10s)

### Step 2: Create Queue Table (if needed)

```sql
-- Example: organization_ingestion_queue
CREATE TABLE IF NOT EXISTS public.organization_ingestion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Item identifier (unique to prevent duplicates)
  organization_url TEXT NOT NULL UNIQUE,
  
  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped')),
  
  -- Retry logic
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Result tracking
  organization_id UUID REFERENCES businesses(id),
  processed_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queue processing
CREATE INDEX idx_org_ingestion_queue_status 
  ON organization_ingestion_queue(status, created_at) 
  WHERE status = 'pending';

CREATE INDEX idx_org_ingestion_queue_url 
  ON organization_ingestion_queue(organization_url);
```

### Step 3: Create Discovery Function

**Purpose:** Find items and add them to queue (fast, <10s)

```typescript
// supabase/functions/discover-organizations/index.ts

Deno.serve(async (req) => {
  const supabase = createClient(...);
  
  // Step 1: Find organizations to process
  const { data: orgs } = await supabase
    .from('businesses')
    .select('id, website')
    .eq('needs_ingestion', true)
    .limit(100); // Reasonable limit
  
  // Step 2: Add to queue (with ON CONFLICT to prevent duplicates)
  const queueItems = orgs.map(org => ({
    organization_url: org.website,
    metadata: { organization_id: org.id }
  }));
  
  const { error } = await supabase
    .from('organization_ingestion_queue')
    .upsert(queueItems, { onConflict: 'organization_url' });
  
  return new Response(JSON.stringify({
    success: true,
    queued: queueItems.length
  }));
});
```

### Step 4: Create Processing Function

**Purpose:** Process queue items in batches (each batch <50s)

```typescript
// supabase/functions/process-organization-ingestion/index.ts

Deno.serve(async (req) => {
  const supabase = createClient(...);
  
  const batch_size = 10; // Process 10 items per run
  const max_execution_time = 50000; // 50 seconds - leave 10s buffer
  const start_time = Date.now();
  
  // Step 1: Get pending items
  const { data: queueItems } = await supabase
    .from('organization_ingestion_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(batch_size);
  
  if (!queueItems || queueItems.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      message: 'No items to process',
      processed: 0
    }));
  }
  
  // Step 2: Process each item
  const stats = { processed: 0, succeeded: 0, failed: 0 };
  
  for (const item of queueItems) {
    // Check timeout
    if (Date.now() - start_time > max_execution_time) {
      console.log('⏰ Timeout protection: stopping early');
      break;
    }
    
    try {
      // Mark as processing
      await supabase
        .from('organization_ingestion_queue')
        .update({ status: 'processing' })
        .eq('id', item.id);
      
      // Do the actual work
      const result = await processOrganization(item.organization_url);
      
      // Mark as complete
      await supabase
        .from('organization_ingestion_queue')
        .update({
          status: 'complete',
          organization_id: result.id,
          processed_at: new Date().toISOString()
        })
        .eq('id', item.id);
      
      stats.succeeded++;
    } catch (error) {
      // Mark as failed (with retry logic)
      const attempts = item.attempts + 1;
      await supabase
        .from('organization_ingestion_queue')
        .update({
          status: attempts >= item.max_attempts ? 'failed' : 'pending',
          attempts,
          next_attempt_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 min
          error_message: error.message
        })
        .eq('id', item.id);
      
      stats.failed++;
    }
    
    stats.processed++;
  }
  
  return new Response(JSON.stringify({
    success: true,
    ...stats
  }));
});
```

## Timeout Protection

**Always include timeout protection in processing functions:**

```typescript
const startTime = Date.now();
const maxExecutionTime = 50000; // 50 seconds - leave 10s buffer

for (const item of items) {
  // Check timeout before processing
  if (Date.now() - startTime > maxExecutionTime) {
    console.log('⏰ Timeout protection: stopping early');
    break; // Stop processing, return what we've done so far
  }
  
  // Process item...
}
```

## Best Practices

### 1. Naming Conventions
- Discovery: `discover-*` (e.g., `discover-organizations`)
- Processing: `process-*-queue` (e.g., `process-organization-ingestion`)
- Single operations: descriptive verb (e.g., `analyze-image`, `scrape-vehicle`)

### 2. Batch Sizes
- **Small batches** (5-10 items) for heavy processing (scraping, AI)
- **Medium batches** (20-40 items) for lightweight processing (DB updates)
- **Self-limit** based on execution time, not just count

### 3. Error Handling
- Individual item failures shouldn't stop the batch
- Track attempts and retry with exponential backoff
- Store error messages for debugging

### 4. Status Tracking
- `pending` - Ready to process
- `processing` - Currently being processed (prevents double-processing)
- `complete` - Successfully processed
- `failed` - Failed after max attempts
- `skipped` - Intentionally skipped

### 5. Idempotency
- Use `ON CONFLICT` when inserting to queue (prevent duplicates)
- Processing should be safe to retry
- Use `locked_at` / `locked_by` for concurrent processing

## Real-World Examples

### Example 1: Craigslist Scraping
- **Discovery:** `discover-cl-squarebodies` → adds to `craigslist_listing_queue`
- **Processing:** `process-cl-queue` → processes 5 listings per run

### Example 2: Import Queue
- **Discovery:** Various scrapers → add to `import_queue`
- **Processing:** `process-import-queue` → processes 40 items per run

### Example 3: Organization Ingestion (Current Issue)
- **Problem:** `ingest-org-complete` tries to do everything in one function
- **Solution:** Split into:
  - `discover-organization-vehicles` → finds vehicle URLs, adds to queue
  - `process-organization-ingestion-queue` → processes vehicles in batches

## Migration Checklist

When creating a new queue-based system:

- [ ] Create queue table migration
- [ ] Add indexes for efficient querying
- [ ] Create discovery function
- [ ] Create processing function
- [ ] Add timeout protection
- [ ] Add retry logic
- [ ] Test with small batch
- [ ] Document in `EDGE_FUNCTION_CONTRACTS.md`
- [ ] Add to function health check script

## Anti-Patterns to Avoid

❌ **Don't:** Process 100+ items in a single function call
❌ **Don't:** Scrape many pages sequentially in one function
❌ **Don't:** Wait for all operations to complete before returning
❌ **Don't:** Ignore timeout limits (60s hard limit)
❌ **Don't:** Process items without timeout checks

✅ **Do:** Use queues for large-scale operations
✅ **Do:** Process items in small batches
✅ **Do:** Check timeout before each item
✅ **Do:** Return partial results if timeout approaches
✅ **Do:** Use concurrent processing when safe

