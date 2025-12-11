# AI Proofreader Setup & Usage

## Status
✅ Function deployed: `ai-proofread-pending` (version 4)  
✅ **Working!** `OPENAI_API_KEY` is configured and the function is successfully processing vehicles

### Current Status
- ✅ Function is returning 200 status codes
- ✅ Successfully processing batches (tested with 6 vehicles: 6 succeeded, 0 failed)
- ✅ Backfilling missing data (VIN, description, mileage, price, etc.)
- ✅ Execution time: ~20-25 seconds per batch of 3 vehicles

## Setup

### 1. Set OpenAI API Key (REQUIRED - Currently Missing)
The function requires `OPENAI_API_KEY` to be configured as a Supabase Edge Function secret.

**Option A: Supabase Dashboard (Recommended)**
1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions
2. Scroll to "Edge Function Secrets" section
3. Click "Add new secret"
4. Add secret:
   - Name: `OPENAI_API_KEY`
   - Value: `sk-proj-...` (your OpenAI API key)
5. Click "Save"
6. Wait 1-2 minutes for the secret to propagate to all Edge Function instances

**Option B: Supabase CLI**
```bash
cd /Users/skylar/nuke
supabase secrets set OPENAI_API_KEY=sk-proj-your-key-here
```

**⚠️ Important:** After setting the secret, wait 1-2 minutes before testing. The secret needs to propagate to all Edge Function instances.

### 2. Verify It's Set
```bash
# Test the function
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ai-proofread-pending \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_ids": ["test-id"]}'
```

Should return JSON (not "OPENAI_API_KEY not configured" error).

## Usage

### Script: `scripts/ai-proofread-all-pending.js`

Processes all pending vehicles through AI proofreading to:
- Backfill missing data (VIN, description, mileage, price, etc.)
- Improve data quality
- Extract additional information from discovery URLs
- Normalize make/model/series/trim

**Usage:**
```bash
# Process all pending vehicles (batch size 20)
node scripts/ai-proofread-all-pending.js

# Process specific number (batch size 20, max 100 vehicles)
node scripts/ai-proofread-all-pending.js 20 100

# Process all (batch size 50, no limit)
node scripts/ai-proofread-all-pending.js 50
```

**What It Does:**
1. Fetches pending vehicles in batches
2. For each vehicle:
   - Re-scrapes the `discovery_url` (using Firecrawl if available, else direct fetch)
   - Extracts text content from HTML
   - Sends to OpenAI GPT-4o for proofreading and backfilling
   - Updates vehicle with backfilled fields
3. Returns results: processed, succeeded, failed, backfilled count

**Output:**
```
🤖 AI Proofreader for All Pending Vehicles
   Batch size: 20
   Processing ALL pending vehicles

📊 Total pending vehicles: 1846

📋 Processing batch: 20 vehicles starting from 0...
✅ Batch complete: {
  processed: 20,
  succeeded: 18,
  failed: 2,
  backfilled: 15,
  vehicles_updated: 15
}
```

## Current Statistics

- **Total pending vehicles**: 1,846
- **Has discovery URL**: 1,816
- **Missing description**: 395
- **Missing VIN**: 1,484
- **Missing images**: 1,846

## What Gets Backfilled

The AI proofreader extracts and backfills:
- ✅ VIN (if found in listing)
- ✅ Description (improved/extended)
- ✅ Mileage
- ✅ Asking price
- ✅ Color
- ✅ Transmission
- ✅ Drivetrain
- ✅ Engine details
- ✅ Body type
- ✅ Series/Trim (for trucks)
- ✅ Normalized make/model

## Integration with Other Scripts

The AI proofreader works alongside:
- `scripts/comprehensive-backfill-pending.js` - Backfills images, data, timeline
- `scripts/backfill-bat-vehicles.js` - BaT-specific backfill
- `scripts/backfill-bat-vehicles.js` - BaT-specific backfill

**Recommended workflow:**
1. Run AI proofreader first (fills in missing data)
2. Then run comprehensive backfill (adds images, timeline events)
3. Finally validate and activate ready vehicles

## Troubleshooting

**Error: "OPENAI_API_KEY not configured"**
- Set the key in Supabase Dashboard > Edge Functions > Secrets
- Wait 1-2 minutes for secret to propagate
- Retry the script

**Error: "Edge Function returned a non-2xx status code"**
- Check Supabase Dashboard logs for detailed error
- Verify OPENAI_API_KEY is set correctly
- Check OpenAI account has credits/quota

**Function returns 500**
- Check Edge Function logs in Supabase Dashboard
- Verify OPENAI_API_KEY is valid and active
- Check OpenAI API status

