# Extraction Tools Summary & Usage Guide

## ✅ Existing Tools (Ready to Use)

### 1. `scrape-multi-source`
**Purpose**: Extract dealer/auction inventory from websites  
**Method**: Firecrawl + Schema extraction + LLM fallback  
**Best For**: Dealer websites, inventory pages, JS-heavy sites  
**API Keys Required**: `FIRECRAWL_API_KEY`, `OPENAI_API_KEY` (in edge function secrets)

```typescript
// Usage
const response = await supabase.functions.invoke('scrape-multi-source', {
  body: {
    source_url: 'https://dealer.com/inventory',
    source_type: 'dealer_website',
    organization_id: 'org-id', // Optional: link to organization
    max_listings: 100
  }
});
```

### 2. `extract-vehicle-data-ai`
**Purpose**: Universal vehicle data extraction from any HTML  
**Method**: Pure LLM (GPT-4o) extraction  
**Best For**: Unknown sources, irregular formats  
**API Keys Required**: `OPENAI_API_KEY`

```typescript
// Usage
const response = await supabase.functions.invoke('extract-vehicle-data-ai', {
  body: {
    url: 'https://listing-url.com'
  }
});
```

### 3. `scrape-vehicle`
**Purpose**: Fast DOM parsing + regex extraction  
**Method**: DOMParser + Regex patterns  
**Best For**: Simple sites, known structures (Craigslist), fallback  
**API Keys Required**: None (optional: `FIRECRAWL_API_KEY` for bot protection)

```typescript
// Usage
const response = await supabase.functions.invoke('scrape-vehicle', {
  body: {
    url: 'https://craigslist.org/...'
  }
});
```

### 4. `ai-proofread-pending`
**Purpose**: AI proofreading and backfilling of extracted data  
**Method**: Re-scrapes + AI validation + backfills missing fields  
**Best For**: Post-extraction quality improvement  
**API Keys Required**: `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`

```typescript
// Usage
const response = await supabase.functions.invoke('ai-proofread-pending', {
  body: {
    batch_size: 50,
    vehicle_ids: ['id1', 'id2'], // Optional
    queue_ids: ['q1', 'q2']      // Optional
  }
});
```

---

## 🆕 New Unified Tool

### 5. `extract-with-proof-and-backfill` ⭐ **RECOMMENDED**
**Purpose**: Complete extraction pipeline with proofreading and re-extraction  
**Method**: Multi-strategy extraction → AI proofreading → Re-extract missing data  
**Best For**: Production extraction with quality guarantees  
**API Keys Required**: `OPENAI_API_KEY`, `FIRECRAWL_API_KEY` (in edge function secrets)

```typescript
// Usage - Full pipeline
const response = await supabase.functions.invoke('extract-with-proof-and-backfill', {
  body: {
    url: 'https://listing-url.com',
    source_type: 'dealer_website', // Optional
    organization_id: 'org-id',     // Optional
    skip_proofreading: false,      // Optional: default false
    skip_re_extraction: false      // Optional: default false
  }
});

// Response includes:
// {
//   success: true,
//   data: { ...extracted vehicle data... },
//   confidence: 0.85,
//   extraction_method: 'firecrawl_schema',
//   missing_fields: [],
//   proofreading_applied: true,
//   re_extraction_applied: false
// }
```

---

## Tool Selection Guide

| Scenario | Recommended Tool | Reason |
|----------|-----------------|--------|
| **Dealer inventory scraping** | `scrape-multi-source` | Handles multiple listings, dealer info |
| **Single listing extraction** | `extract-with-proof-and-backfill` | Best accuracy, quality guarantees |
| **Unknown source format** | `extract-with-proof-and-backfill` | Multi-strategy + AI proofreading |
| **Simple, known sources** | `scrape-vehicle` | Fast, lightweight |
| **Post-processing quality check** | `ai-proofread-pending` | Improve already-extracted data |
| **High-volume batch processing** | `scrape-multi-source` + queue `ai-proofread-pending` | Efficiency + quality |

---

## Extraction Flow Recommendation

### For Production Use:

```
1. Initial Extraction
   └─> extract-with-proof-and-backfill()
       ├─> Tries multiple strategies automatically
       ├─> AI proofreads results
       └─> Re-extracts missing data

2. Queue for Processing
   └─> process-import-queue (handles vehicle creation, images, etc.)

3. (Optional) Batch Quality Check
   └─> ai-proofread-pending() for pending vehicles
```

### For High-Volume Inventory Scraping:

```
1. Bulk Extraction
   └─> scrape-multi-source()
       └─> Queues all listings

2. Batch Processing
   └─> process-import-queue (processes queued items)

3. Quality Improvement
   └─> ai-proofread-pending (backfills missing data)
```

---

## API Keys Configuration

All API keys should be set in Supabase Edge Function Secrets:

1. Go to Supabase Dashboard → Edge Functions → Settings → Secrets
2. Add these secrets:
   - `OPENAI_API_KEY` - For LLM extraction and proofreading
   - `FIRECRAWL_API_KEY` - For robust web scraping (bypasses bot protection)
   - `SUPABASE_SERVICE_ROLE_KEY` - Auto-configured
   - `SUPABASE_URL` - Auto-configured

---

## Confidence Scores

All extraction tools return confidence scores (0-1):
- **0.9+**: High confidence - All critical fields present
- **0.7-0.9**: Medium confidence - Most fields present
- **<0.7**: Low confidence - Missing critical fields (re-extraction recommended)

Critical fields: `vin`, `year`, `make`, `model`, `price`, `mileage`

---

## Missing Components (Future Work)

1. **Source-Specific Adapters** - Custom extractors for known sources
   - Craigslist (partially exists)
   - Classic.com (partially exists)
   - DealerFire
   - DealerSocket
   - Bring a Trailer (exists but separate)

2. **Confidence Scoring Enhancement** - More sophisticated scoring
   - Cross-validation with other sources
   - Historical accuracy tracking
   - Source reliability metrics

3. **Automated Re-extraction Triggers** - Auto-re-extract low confidence data
   - Schedule periodic re-extraction
   - Monitor confidence trends

