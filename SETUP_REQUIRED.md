# ✅ OPENAI_API_KEY Setup Complete

## Current Status
The `ai-proofread-pending` Edge Function is **working correctly**! The `OPENAI_API_KEY` is configured and the function is successfully processing vehicles.

## Quick Fix

### Step 1: Get Your OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Create a new API key or copy an existing one
3. It should look like: `sk-proj-...` or `sk-...`

### Step 2: Set It in Supabase
**Option A: Dashboard (Easiest)**
1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions
2. Scroll to "Edge Function Secrets"
3. Click "Add new secret"
4. Name: `OPENAI_API_KEY`
5. Value: Your OpenAI API key (e.g., `sk-proj-...`)
6. Click "Save"
7. **Wait 1-2 minutes** for it to propagate

**Option B: CLI**
```bash
cd /Users/skylar/nuke
supabase secrets set OPENAI_API_KEY=sk-proj-your-key-here
```

### Step 3: Verify It Works
```bash
cd /Users/skylar/nuke
node scripts/ai-proofread-all-pending.js 3 6
```

Should see:
```
✅ Batch complete: {
  processed: 3,
  succeeded: 2,
  failed: 1,
  backfilled: 2,
  vehicles_updated: 2
}
```

Instead of:
```
❌ AI proofreader error: Edge Function returned a non-2xx status code
```

## What This Enables

Once `OPENAI_API_KEY` is set, the AI proofreader will:
- ✅ Backfill missing VIN, description, mileage, price, color, transmission, etc.
- ✅ Improve data quality for all 1,855 pending vehicles
- ✅ Extract additional information from discovery URLs
- ✅ Normalize make/model/series/trim

## Related Functions That Also Need This Key

- `extract-vehicle-data-ai` - Also failing with 500 errors (likely same issue)

## Cost Estimate

OpenAI GPT-4o pricing (as of 2025):
- Input: ~$2.50 per 1M tokens
- Output: ~$10 per 1M tokens

For 1,855 vehicles:
- Average ~5,000 tokens per vehicle (input + output)
- Total: ~9.3M tokens
- Estimated cost: **~$50-100** for all pending vehicles

You can process in smaller batches to control costs:
```bash
# Process 50 vehicles at a time
node scripts/ai-proofread-all-pending.js 50 50
```

