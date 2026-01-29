# Large Compute + Disk Upgrade - Optimizations

## Upgrade Details

**From:** Micro Compute + Default Disk  
**To:** Large Compute + Increased Disk

### Connection Limits

| Metric | Micro | Large | Improvement |
|--------|-------|-------|-------------|
| Direct Connections | 60 | 160 | **2.67x** |
| Pooler Connections | 200 | 800 | **4x** |
| CPU/RAM | Lower | Higher | **Significantly faster queries** |

### Disk Performance (Large Compute)

| Metric | Value | Benefit |
|--------|-------|---------|
| **Disk Throughput** | 630 Mbps | Fast read/write operations |
| **IOPS** | 3,600 IOPS | High concurrent operations |
| **Disk Size** | Increased | More storage capacity |
| **Disk Type** | gp3 (default) | Good balance of performance/cost |

**Disk Benefits:**
- ✅ **More storage** - Can store more images, data, logs
- ✅ **Better IOPS** - Faster database operations (reads/writes)
- ✅ **Higher throughput** - Faster bulk operations
- ✅ **Room to grow** - Can handle larger datasets without throttling

## Optimizations Applied

### 1. Increased Batch Sizes

With faster database operations, we can process larger batches:

**`process-cl-queue`:**
- Before: 30 listings per batch
- After: **50 listings per batch** (67% increase)

**`process-import-queue`:**
- Before: 20 items per batch
- After: **40 items per batch** (2x increase)

**`scrape-all-craigslist-squarebodies`:**
- `maxProcessPerRun`: 20 → **40 listings** (2x increase)
- `max_regions`: 30 → **50 regions** (67% increase)
- `max_listings_per_search`: 50 → **75 listings** (50% increase)

### 2. Performance Benefits

✅ **Faster database queries** - More CPU/RAM = quicker operations  
✅ **More concurrent operations** - 2.67x more direct connections  
✅ **Better connection pooling** - 4x more pooler connections  
✅ **Larger batch processing** - Process more items per function invocation  
✅ **Reduced function invocations** - Fewer calls needed to process same amount of data  

## Expected Performance Improvements

### Before (Micro)
- Process ~20 listings per function call
- Process ~20 import queue items per call
- ~30 regions per discovery run
- Database queries: slower (less CPU/RAM)
- Connection limits: 60 direct, 200 pooler

### After (Large)
- Process **~40 listings** per function call (2x)
- Process **~40 import queue items** per call (2x)
- **~50 regions** per discovery run (67% more)
- Database queries: **faster** (more CPU/RAM)
- Connection limits: **160 direct, 800 pooler** (2.67x-4x more)

## Cost Impact

**Compute Cost:**
- Micro: ~$10/month
- Large: ~$110/month
- **Additional cost: ~$100/month**

**Disk Cost:**
- Default: 8 GB included
- Additional: ~$0.125/GB/month (depends on size increase)

**But you get:**
- 2x-4x more processing capacity
- Faster operations (less time = lower Edge Function costs)
- Better reliability (more connection headroom)
- More storage for images/data
- Better disk performance (IOPS/throughput)
- Ability to handle higher traffic

## Monitoring

Watch for:
1. **Connection usage** - Should stay well under 160 direct connections
2. **Query performance** - Should see faster query times
3. **Batch processing** - Larger batches should complete successfully
4. **Function execution times** - Should be faster due to quicker DB operations

## Next Steps

1. ✅ Batch sizes increased
2. ✅ Disk upgrade documented
3. ⏳ Monitor performance for 24-48 hours
4. ⏳ Adjust batch sizes if needed (can go higher if performance is good)
5. ⏳ Consider parallel processing for independent operations
6. ⏳ Monitor disk usage - ensure you're using the additional space effectively
7. ⏳ Consider increasing image batch sizes for backfill operations

## Recommendations

With Large compute + increased disk, you can now:

1. **Process larger batches** - Already optimized
2. **Run more concurrent scrapers** - Can run multiple scrapers simultaneously
3. **Increase queue processor frequency** - Can process queues more aggressively
4. **Consider parallel processing** - Process multiple listings in parallel within functions
5. **Store more images** - Larger disk = more vehicle images without cleanup
6. **Faster image operations** - Better IOPS = quicker image uploads/downloads
7. **Aggressive caching** - Can cache more data on disk without worrying about space
8. **Bulk operations** - Higher throughput = faster bulk imports/exports

## Connection Pooling

With 800 pooler connections, you can:
- Run many Edge Functions concurrently
- Process multiple queues simultaneously
- Handle spikes in traffic without connection issues

**Recommendation:** Use connection pooler (port 6543) for all Edge Functions to maximize available connections.

