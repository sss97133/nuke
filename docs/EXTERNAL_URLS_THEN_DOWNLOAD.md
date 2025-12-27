# External URLs Then Download Strategy

**Strategy**: Create `vehicle_images` records with external URLs immediately, then gradually download and replace them.

## How It Works

### Step 1: Extract Data (Create External Image Records)

When `skip_image_upload: true` is passed to `process-import-queue`:
- ✅ Vehicle profiles created with all data
- ✅ `vehicle_images` records created with `is_external: true` and external URLs
- ✅ Frontend can display images immediately using external URLs
- ❌ No image downloads/uploads (fast extraction)

### Step 2: Trickle Download Images

The `trickle-backfill-images` function:
- Finds `vehicle_images` records with `is_external: true`
- Downloads images using `backfill-images` function
- Deletes external image records (replaced by downloaded versions)
- Gradually processes in batches

## Benefits

✅ **Immediate image display** - Frontend shows images right away using external URLs  
✅ **Fast extraction** - No image download delays during extraction  
✅ **Gradual download** - Images trickle in over time  
✅ **No image loss** - External URLs preserved until downloaded  

## Usage

### Extract with External URLs

```bash
# Extract from all organizations (creates external image records)
npm run extract-all-orgs -- --threshold 1 --limit 50
```

This creates:
- Vehicle profiles with all data
- `vehicle_images` records with `is_external: true` and external URLs

### Download Images Gradually

```bash
# Download and replace external images
npm run trickle-backfill-images -- --limit 500 --batch-size 20
```

This:
- Finds vehicles with external images
- Downloads images to storage
- Replaces external records with downloaded versions

## Monitoring

### Check External Images Count

```sql
-- Count external images that need downloading
SELECT COUNT(*) as external_images_count
FROM vehicle_images
WHERE is_external = true;
```

### Check Download Progress

```sql
-- Vehicles with external images
SELECT 
  COUNT(DISTINCT vehicle_id) as vehicles_with_external_images
FROM vehicle_images
WHERE is_external = true;

-- Vehicles with downloaded images
SELECT 
  COUNT(DISTINCT vehicle_id) as vehicles_with_downloaded_images
FROM vehicle_images
WHERE is_external = false
  AND storage_path IS NOT NULL;
```

## Flow Diagram

```
Extract Data
    ↓
Create vehicle_images (is_external: true)
    ↓
Frontend displays images (external URLs)
    ↓
Trickle backfill process
    ↓
Download images → Replace external records
    ↓
Frontend displays images (stored URLs)
```

## Notes

- External images are immediately visible in frontend
- Downloads happen gradually in background
- External records are deleted after successful download
- Process is resumable - safe to run multiple times
- Images are limited per vehicle (default: 20) to avoid overwhelming storage

