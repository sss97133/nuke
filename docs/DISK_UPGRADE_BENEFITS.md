# Disk Size Upgrade - Benefits & Optimizations

## Upgrade Summary

You've increased your disk size, which provides several benefits beyond just storage capacity.

## Disk Performance (Large Compute)

With Large compute, your disk has:
- **Throughput**: 630 Mbps (vs 87 Mbps on Micro)
- **IOPS**: 3,600 IOPS (vs 500 IOPS on Micro)
- **Size**: Increased (more storage capacity)

## Benefits

### 1. More Storage Capacity

✅ **Store more images** - Can keep more vehicle images without cleanup  
✅ **Larger datasets** - Can handle bigger databases  
✅ **More logs** - Can retain more historical data  
✅ **Room to grow** - Won't hit storage limits as quickly  

### 2. Better Performance

✅ **Faster reads** - Higher IOPS = quicker database queries  
✅ **Faster writes** - Better throughput = faster inserts/updates  
✅ **Concurrent operations** - Can handle more simultaneous disk operations  
✅ **Bulk operations** - Faster bulk imports/exports  

### 3. Image Storage Optimizations

With more disk space, you can:

**Current Image Storage:**
- Vehicle images stored in Supabase Storage
- Multiple variants per image (thumbnail, medium, large)
- ~308,265 total images in system

**Optimizations Enabled:**
- ✅ Store more images per vehicle
- ✅ Keep higher resolution originals
- ✅ Less aggressive cleanup needed
- ✅ Can backfill more images without storage concerns

### 4. Database Operations

**Faster Operations:**
- ✅ Bulk inserts (vehicle creation)
- ✅ Image metadata updates
- ✅ Timeline event writes
- ✅ Queue processing

**Better Concurrency:**
- ✅ Multiple scrapers can write simultaneously
- ✅ Image backfills won't compete for disk I/O
- ✅ Database operations won't throttle each other

## Recommended Optimizations

### 1. Increase Image Batch Sizes

With better disk performance, you can process more images per batch:

**Current:**
- `backfill-images`: Processes images in batches
- `backfill-origin-vehicle-images`: Limited batch sizes

**Can Increase:**
- Larger image upload batches
- More concurrent image processing
- Faster image backfill operations

### 2. More Aggressive Caching

With more disk space:
- ✅ Cache more vehicle data
- ✅ Store more temporary processing data
- ✅ Keep more historical logs
- ✅ Less need for cleanup operations

### 3. Bulk Operations

**Faster Bulk Imports:**
- ✅ Import more vehicles per batch
- ✅ Process larger CSV imports
- ✅ Faster data migrations
- ✅ Quicker bulk updates

### 4. Monitoring

**Watch These Metrics:**
1. **Disk usage** - Ensure you're using the additional space
2. **IOPS utilization** - Should stay well under 3,600
3. **Throughput** - Monitor for bottlenecks
4. **Storage growth** - Track how quickly you're using space

## Cost Considerations

**Disk Storage:**
- First 8 GB: Included
- Additional: ~$0.125/GB/month

**Example:**
- 50 GB disk: ~$5.25/month (42 GB × $0.125)
- 100 GB disk: ~$11.50/month (92 GB × $0.125)
- 200 GB disk: ~$24/month (192 GB × $0.125)

**Worth It If:**
- You're storing lots of images
- You need faster database operations
- You want room to grow
- You're doing bulk operations frequently

## Next Steps

1. ✅ Documented disk upgrade benefits
2. ⏳ Monitor disk usage over next week
3. ⏳ Consider increasing image batch sizes
4. ⏳ Optimize bulk operations to take advantage of higher throughput
5. ⏳ Review storage cleanup policies (may not need as aggressive cleanup)

## Performance Monitoring

Check these in Supabase Dashboard:
- **Database Reports** → Disk IO % consumed
- **Database Reports** → Disk Throughput
- **Storage** → Total storage used
- **Database Settings** → Disk size and IOPS

If `Disk IO % consumed` is consistently low (< 10%), you have headroom to:
- Increase batch sizes further
- Run more concurrent operations
- Process larger datasets

