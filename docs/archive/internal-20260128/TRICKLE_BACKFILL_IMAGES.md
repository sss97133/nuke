# Trickle Backfill Images

System for backfilling images for vehicles that have image URLs stored in `origin_metadata` but no actual images in the `vehicle_images` table.

## Strategy

1. **Extract all non-image data first** - Vehicle profiles created with all data
2. **Store image URLs in origin_metadata** - URLs preserved for later backfill
3. **Trickle in images** - Background process downloads/uploads images gradually

## How It Works

### During Extraction

When `skip_image_upload: true` is passed to `process-import-queue`:
- Vehicle profiles are created with all non-image data
- Image URLs are stored in `vehicles.origin_metadata.image_urls`
- No images are downloaded/uploaded (fast extraction)

### During Backfill

The `trickle-backfill-images` function:
- Finds vehicles with `image_urls` in `origin_metadata` but no images
- Processes them in batches
- Downloads/uploads images using `backfill-images` function
- Updates `origin_metadata` to mark as backfilled

## Usage

### Using the Script

```bash
# Backfill images for vehicles needing them (default: 100 vehicles, 10 per batch)
npm run trickle-backfill-images

# Process more vehicles
npm run trickle-backfill-images -- --limit 500

# Larger batches
npm run trickle-backfill-images -- --batch-size 20

# Limit images per vehicle (default: 20)
npm run trickle-backfill-images -- --max-images 10

# Backfill for specific organization
npm run trickle-backfill-images -- --organization-id <org-id>

# Preview what would be backfilled (dry run)
npm run trickle-backfill-images -- --dry-run
```

### Direct API Call

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/trickle-backfill-images" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 10,
    "limit": 100,
    "max_images_per_vehicle": 20
  }'
```

## Workflow

### Step 1: Extract All Data (Skip Images)

```bash
# Extract from all organizations (images skipped)
npm run extract-all-orgs -- --threshold 1 --limit 50
```

This creates vehicle profiles with all data, stores image URLs in `origin_metadata`, but doesn't download images.

### Step 2: Trickle Backfill Images

```bash
# Backfill images gradually
npm run trickle-backfill-images -- --limit 500 --batch-size 20

# Continue until all images are backfilled
npm run trickle-backfill-images -- --limit 500 --batch-size 20
```

This processes vehicles in batches, downloading/uploading images gradually.

## Monitoring

### Check Vehicles Needing Backfill

```sql
-- Count vehicles with image URLs but no images
SELECT COUNT(*) as vehicles_needing_backfill
FROM vehicles v
WHERE v.is_public = true
  AND v.origin_metadata->>'image_urls' IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
  ) = 0;
```

### Check Backfill Progress

```sql
-- Vehicles with images backfilled
SELECT COUNT(*) as vehicles_backfilled
FROM vehicles v
WHERE v.is_public = true
  AND (v.origin_metadata->>'images_backfilled')::boolean = true;
```

## Benefits

✅ **Fast extraction** - Get all vehicle data quickly  
✅ **Gradual image loading** - Images trickle in without blocking  
✅ **Resumable** - Can run multiple times, skips already-backfilled vehicles  
✅ **Rate-limited** - Built-in delays prevent overwhelming the system  
✅ **Organization-specific** - Can backfill for specific orgs  

## Notes

- Images are limited per vehicle (default: 20) to avoid overwhelming storage
- Process is resumable - can run multiple times safely
- Skips vehicles that already have images
- Updates `origin_metadata` to track backfill status

