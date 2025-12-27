# Data First, Image Trickle Workflow

**Strategy**: Extract all non-image vehicle data first, then trickle in images gradually.

## Problem

Extracting vehicles with images is slow:
- Image downloads take time
- Image uploads consume storage bandwidth
- Rate limiting from source sites
- Timeouts on large batches

## Solution

1. **Extract all data first** (skip images)
2. **Store image URLs** in `origin_metadata`
3. **Trickle in images** gradually in background

## Workflow

### Step 1: Extract All Organizations (Skip Images)

```bash
# Extract from all organizations, skipping images
npm run extract-all-orgs -- --threshold 1 --limit 50
```

This will:
- ✅ Create vehicle profiles with all data (year, make, model, price, VIN, etc.)
- ✅ Store image URLs in `vehicles.origin_metadata.image_urls`
- ❌ Skip image downloads/uploads (fast!)

### Step 2: Trickle Backfill Images

```bash
# Backfill images gradually (100 vehicles at a time)
npm run trickle-backfill-images -- --limit 100 --batch-size 10

# Continue until all images are backfilled
npm run trickle-backfill-images -- --limit 500 --batch-size 20
```

This will:
- ✅ Find vehicles with image URLs but no images
- ✅ Download/upload images in batches
- ✅ Update `origin_metadata` to track progress

## Benefits

✅ **Fast extraction** - Get all vehicle data quickly (no image delays)  
✅ **Gradual image loading** - Images trickle in without blocking  
✅ **Resumable** - Can run multiple times, skips already-backfilled vehicles  
✅ **Rate-limited** - Built-in delays prevent overwhelming the system  
✅ **Prioritized** - Can backfill for specific organizations first  

## Monitoring

### Check Extraction Progress

```sql
-- Vehicles created (with or without images)
SELECT COUNT(*) as total_vehicles
FROM vehicles
WHERE is_public = true;
```

### Check Image Backfill Status

```sql
-- Vehicles needing image backfill
SELECT COUNT(*) as vehicles_needing_backfill
FROM vehicles v
WHERE v.is_public = true
  AND v.origin_metadata->>'image_urls' IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
  ) = 0;

-- Vehicles with images backfilled
SELECT COUNT(*) as vehicles_backfilled
FROM vehicles v
WHERE v.is_public = true
  AND (v.origin_metadata->>'images_backfilled')::boolean = true;
```

## Example: Full Pipeline

```bash
# 1. Extract from all organizations (skip images)
npm run extract-all-orgs -- --threshold 1 --limit 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 50
npm run extract-all-orgs -- --threshold 1 --limit 50 --offset 100
# ... continue until all orgs processed

# 2. Trickle backfill images (run multiple times)
npm run trickle-backfill-images -- --limit 500 --batch-size 20
npm run trickle-backfill-images -- --limit 500 --batch-size 20
# ... continue until all images backfilled
```

## Notes

- Image URLs are always stored in `origin_metadata` even when skipping uploads
- Backfill process is resumable - safe to run multiple times
- Images are limited per vehicle (default: 20) to avoid overwhelming storage
- Process skips vehicles that already have images

