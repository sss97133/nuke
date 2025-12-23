# Supabase Plan Upgrade Guide

## Current Situation

**Free Plan Limits:**
- Wall clock time: 150 seconds
- Request timeout: 150 seconds
- Functions per project: 100

**Paid Plan Benefits (Pro/Team):**
- Wall clock time: **400 seconds** (2.67x longer!)
- Request timeout: 150 seconds (same)
- Functions per project: 500-1000
- Better support and monitoring

## Cost

- **Pro Plan**: $25/month
- **Team Plan**: $599/month (likely overkill)
- **Enterprise**: Custom pricing

**Recommendation: Pro Plan ($25/month)**
- Gets you 400s timeout (vs 150s free)
- 5x more functions allowed
- Better for production workloads
- Well within your $300/month budget

## What We've Optimized

With the paid plan's 400s timeout, we've increased:

1. **Scraper batch sizes:**
   - `max_regions`: 10 → 30
   - `max_listings_per_search`: 30 → 50
   - `maxProcessPerRun`: 5 → 20 listings
   - Search terms: 10 → 20 per region

2. **Queue processor:**
   - `batch_size`: 15 → 30 listings per run

3. **Execution time budget:**
   - `maxExecutionTime`: 50s → 380s (leaves 20s buffer)

4. **Discovery scraper:**
   - `max_searches_per_region`: 5 → 10

## Performance Improvement

**Before (Free Plan - 150s limit):**
- Process ~5 listings per run
- ~10 regions max
- Frequent timeouts on large batches

**After (Paid Plan - 400s limit):**
- Process ~20 listings per run (4x more)
- ~30 regions max (3x more)
- Can handle much larger batches
- Fewer function invocations needed

## How to Upgrade

1. Go to Supabase Dashboard → Settings → Billing
2. Select "Pro Plan" ($25/month)
3. Confirm upgrade
4. Wait ~5 minutes for limits to update
5. Test with larger batch sizes

## Monitoring

After upgrade, monitor:
- Function execution times (should stay under 380s)
- Success rates (should improve with larger batches)
- Cost (should stay well under $300/month)

## Next Steps

1. ✅ Code optimized for 400s timeout
2. ⏳ Upgrade Supabase plan to Pro
3. ⏳ Test with larger batches
4. ⏳ Monitor performance improvements

