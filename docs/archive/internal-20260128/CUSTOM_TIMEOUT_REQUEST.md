# Requesting Custom Edge Function Timeout Limits

## Current Situation

You're on a plan **without a spend cap**, which means you can request custom timeout limits beyond the standard 400s for paid plans.

## Standard Limits

- **Free Plan**: 150 seconds
- **Pro/Team Plan**: 400 seconds  
- **Enterprise/No Spend Cap**: **Custom** (can be increased via support)

## How to Request Custom Limits

### Step 1: Contact Supabase Support

1. Go to: https://supabase.com/dashboard/support/new
2. Select your project
3. Request: **"Increase Edge Function timeout limit for project [project-ref]"**

### Step 2: Provide Context

Include this information in your support request:

```
Subject: Request to Increase Edge Function Timeout Limit

Hi Supabase Team,

I'm working on a large-scale web scraping project that processes vehicle listings 
from multiple sources. My current Edge Functions are hitting the 400s timeout 
limit when processing large batches.

Project: [your-project-ref]
Current Plan: [Pro/Team/Enterprise - no spend cap]
Requested Timeout: 600-900 seconds (10-15 minutes)

Use Case:
- Scraping vehicle listings from Craigslist across 30+ regions
- Processing 50-100 listings per run
- Each listing requires multiple API calls (Firecrawl, image downloads, etc.)
- Total processing time per batch: ~8-12 minutes

I understand this is a custom request and I'm willing to pay for additional 
resources if needed. My monthly budget is up to $300/month.

Thank you!
```

### Step 3: Alternative - Function Chaining

While waiting for support, we've implemented **function chaining** (self-invocation) 
which allows functions to continue processing beyond the timeout limit by calling 
themselves recursively.

**Benefits:**
- ✅ Works immediately (no support ticket needed)
- ✅ Can process unlimited items
- ✅ Each invocation stays under timeout
- ✅ Automatic continuation

**How it works:**
1. Function processes a batch (stays under 400s)
2. If more work remains, function calls itself
3. New invocation continues where previous left off
4. Repeats until all work is complete

## Recommended Approach

**Use both strategies:**

1. **Short-term**: Implement function chaining (already done)
2. **Long-term**: Request custom timeout limit from support

This gives you:
- Immediate solution (function chaining)
- Better performance (longer timeouts = fewer invocations)
- Lower costs (fewer function calls)

## What We've Implemented

✅ **Function chaining** in:
- `scrape-all-craigslist-squarebodies` (with `chain_depth` parameter)
- `discover-cl-squarebodies` (with `chain_depth` parameter)

✅ **Queue-based processing** (already existed):
- `discover-cl-squarebodies` → adds to queue
- `process-cl-queue` → processes in batches

## Next Steps

1. **Test function chaining** with existing scrapers
2. **Submit support ticket** for custom timeout limits
3. **Monitor performance** and adjust batch sizes accordingly

