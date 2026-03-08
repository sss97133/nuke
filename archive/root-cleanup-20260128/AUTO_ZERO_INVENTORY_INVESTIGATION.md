# Auto-Investigation for Zero Inventory Organizations

**Problem**: Organizations with zero inventory should automatically trigger thorough investigation to find missing vehicle information.

**Solution**: Automated system that:
1. **Detects** orgs with zero inventory
2. **Prioritizes** easy targets (dealers, classic.com, simple sites)
3. **Queues** them for thorough extraction
4. **Processes** with higher limits and better extraction (LLM, not cheap mode)

---

## What Was Created

### 1. Database Trigger (`20250130000001_auto_investigate_zero_inventory.sql`)
- **Trigger**: Automatically queues orgs when created/updated with zero inventory
- **Cron Job**: Runs every 30 minutes to find and queue zero-inventory orgs
- **Function**: `auto_queue_zero_inventory_orgs()` - Finds and queues orgs with zero vehicles

### 2. Prioritization System (`20250130000002_improve_zero_inventory_extraction.sql`)
- **Function**: `is_easy_extraction_target()` - Identifies easy-to-extract sites
- **View**: `orgs_needing_investigation` - Shows all orgs needing extraction (prioritized)
- **Function**: `get_next_investigation_batch()` - Gets next batch of orgs to investigate

### 3. Enhanced Extraction (`bulk-enqueue-inventory-extraction/index.ts`)
- **Prioritization**: Sorts candidates by "easy target" score
- **Easy targets first**: Classic.com (1), Dealers (2), DealerFire (2), Others (4)

### 4. Thorough Extraction (`process-inventory-sync-queue/index.ts`)
- **Higher limits**: Zero-inventory orgs get `max_results: 500` instead of default
- **No cheap mode**: Always uses `cheap_mode: false` for zero inventory (thorough extraction)
- **LLM extraction**: Always uses `use_llm_extraction: true` for better vehicle profiles

---

## How It Works

### Automatic Detection
1. **Trigger**: When an org is created/updated with a website and has zero vehicles
2. **Cron**: Every 30 minutes, finds all orgs with zero inventory and queues them
3. **Processing**: `process-inventory-sync-queue` processes the queue with thorough extraction

### Prioritization
```
Priority 1: Classic.com sites (easiest, well-structured)
Priority 2: Dealers, DealerFire sites (predictable structure)
Priority 4: Everything else (might need Firecrawl for JS)
```

### Thorough Extraction Settings
For zero-inventory orgs:
- `max_results: 500` (vs default 200-250)
- `use_llm_extraction: true` (better vehicle profiles)
- `cheap_mode: false` (thorough extraction, uses Firecrawl if needed)
- `extract_dealer_info: true` (complete org profiles)

---

## Manual Triggers

### Queue Zero-Inventory Orgs Manually
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/bulk-enqueue-inventory-extraction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "min_inventory_threshold": 1,
    "only_with_website": true,
    "limit": 100,
    "run_mode": "both"
  }'
```

### Check Queue Status
```sql
-- See what's queued
SELECT 
  b.business_name,
  b.website,
  q.status,
  q.attempts,
  q.created_at
FROM organization_inventory_sync_queue q
JOIN businesses b ON b.id = q.organization_id
WHERE q.run_mode = 'both'
ORDER BY q.created_at DESC
LIMIT 20;

-- See orgs needing investigation
SELECT * FROM orgs_needing_investigation 
WHERE already_queued = false
ORDER BY priority_score ASC
LIMIT 20;
```

---

## Expected Results

- **Automatic**: Zero-inventory orgs are automatically queued within 30 minutes
- **Prioritized**: Easy targets (dealers, classic.com) are processed first
- **Thorough**: Higher limits, LLM extraction, no cheap mode
- **Complete**: Full vehicle profiles with all available data

---

## Next Steps

1. **Run migrations** to set up triggers and cron jobs
2. **Monitor** the queue to see orgs being automatically queued
3. **Verify** extraction quality for zero-inventory orgs
4. **Adjust** priorities if needed based on extraction success rates

---

## Notes

- The system prioritizes "easy targets" but will still extract from harder sites (uses Firecrawl)
- Zero-inventory orgs get **more thorough** extraction (higher limits, LLM, not cheap mode)
- The trigger fires immediately when orgs are created/updated
- The cron job catches any orgs that might have been missed

