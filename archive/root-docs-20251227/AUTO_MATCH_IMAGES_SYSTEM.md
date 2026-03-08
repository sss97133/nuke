# Auto-Match Images to Vehicles System

## Overview

This system automatically matches unorganized images (uploaded without a `vehicle_id`) to vehicles based on:
- **GPS coordinate proximity** (images taken at same/similar locations)
- **Date proximity** (images taken around the same time)
- **Filename patterns** (filenames containing vehicle year/make/model)
- **EXIF metadata** (camera info, location data)

## How It Works

### Automatic Matching on Upload

When you upload images **without** specifying a vehicle, the system automatically:

1. Extracts EXIF metadata (GPS, date, camera info)
2. Stores image as `organization_status = 'unorganized'`
3. Triggers auto-matching in the background
4. Matches to your vehicles based on:
   - GPS: Images taken within 50m of other images from that vehicle (40% weight)
   - Date: Images taken within 30 days of other images from that vehicle (30% weight)
   - Filename: Filenames containing vehicle year/make/model (20% weight)
   - EXIF: Additional metadata clues (10% weight)
5. If confidence ≥ 50%, automatically links image to vehicle
6. Updates `organization_status` to `'organized'`

### Matching Algorithm

**Confidence Score Calculation:**
- GPS Match (40%): Based on distance and number of nearby images
- Date Match (30%): Based on time difference from other vehicle images
- Filename Match (20%): Based on year/make/model in filename
- EXIF Match (10%): Based on location/camera metadata

**Minimum Confidence:** 50% (configurable)

**Example Match:**
```
Image: IMG_4608.jpeg
GPS: 35.9727° N, -114.8554° W (Boulder City, NV)
Date: 2025-02-17

Matches to: 1970 Plymouth Roadrunner
Confidence: 85%
Reasons:
  - GPS match: 95% (within 50m, 3 nearby images)
  - Date match: 70% (within 30 days)
  - Filename match: 0% (no vehicle identifiers)
```

## Usage

### Automatic (Default Behavior)

Just upload images without selecting a vehicle - matching happens automatically!

```typescript
// In ImageUploadService - automatically triggered
await ImageUploadService.uploadImage(
  undefined, // No vehicleId
  file,
  'general'
);
// → Auto-matching runs in background
```

### Manual Matching

Use the `useAutoMatchImages` hook to manually trigger matching:

```typescript
import { useAutoMatchImages } from '../hooks/useAutoMatchImages';

function MyComponent() {
  const { matching, matches, matchUserImages, applyMatches } = useAutoMatchImages();

  const handleMatchAll = async () => {
    // Match all unorganized images for current user
    await matchUserImages(userId);
    
    // Review matches
    console.log('Found matches:', matches);
    
    // Apply matches to database
    const result = await applyMatches();
    console.log(`Matched ${result.success} images`);
  };

  return (
    <button onClick={handleMatchAll} disabled={matching}>
      {matching ? 'Matching...' : 'Match All Images'}
    </button>
  );
}
```

### Programmatic Matching

Use `ImageVehicleMatcher` service directly:

```typescript
import { ImageVehicleMatcher } from '../services/imageVehicleMatcher';

// Match a single image
const match = await ImageVehicleMatcher.matchImage(imageId, {
  maxGpsDistanceMeters: 50,
  maxDateDifferenceDays: 30,
  minConfidence: 0.5,
  userId: currentUserId
});

if (match && match.vehicleId) {
  // Apply the match
  await ImageVehicleMatcher.applyMatches([match]);
}

// Match all user's unorganized images
const matches = await ImageVehicleMatcher.matchUserUnorganizedImages(userId);
await ImageVehicleMatcher.applyMatches(matches);
```

## Database Functions

### `auto_match_image_to_vehicles()`

RPC function that matches an image to vehicles:

```sql
SELECT * FROM auto_match_image_to_vehicles(
  p_image_id := 'uuid-here',
  p_max_gps_distance_meters := 50,
  p_max_date_difference_days := 30,
  p_min_confidence := 0.5
);
```

Returns:
- `vehicle_id`: Best matching vehicle
- `confidence`: Match confidence (0-1)
- `match_reasons`: Array of reasons (GPS, date, filename)

### `find_images_near_location()`

Helper function for GPS-based matching:

```sql
SELECT * FROM find_images_near_location(
  p_latitude := 35.9727,
  p_longitude := -114.8554,
  p_vehicle_id := 'uuid-here',
  p_max_distance_meters := 50
);
```

## Configuration

Default settings (can be customized):

- **Max GPS Distance:** 50 meters
- **Max Date Difference:** 30 days
- **Min Confidence:** 50% (0.5)
- **GPS Weight:** 40%
- **Date Weight:** 30%
- **Filename Weight:** 20%
- **EXIF Weight:** 10%

## Events

The system emits events you can listen to:

```typescript
// Listen for auto-matched images
window.addEventListener('image_auto_matched', (event) => {
  const { imageId, vehicleId, confidence, reasons } = event.detail;
  console.log(`Image ${imageId} matched to vehicle ${vehicleId}`);
  console.log(`Confidence: ${(confidence * 100).toFixed(0)}%`);
  console.log('Reasons:', reasons);
});
```

## Benefits

1. **No Manual Association Needed:** Upload images directly, system matches automatically
2. **GPS-Based Matching:** Images taken at same location automatically grouped
3. **Prevents Duplicates:** Uses filename + GPS + date to avoid duplicate uploads
4. **Smart Matching:** Multiple signals (GPS, date, filename) increase confidence
5. **User-Friendly:** Works in background, no user intervention required

## Example Workflow

1. **Upload Images:**
   ```
   User uploads 50 images from phone
   → Images stored as "unorganized"
   → EXIF extracted (GPS: Boulder City, NV; Date: Feb 17, 2025)
   ```

2. **Auto-Matching:**
   ```
   System finds: 1970 Plymouth Roadrunner
   - Has 3 images at same GPS location (35.9727, -114.8554)
   - Images taken Feb 13-17, 2025 (within 30 days)
   - Confidence: 85%
   → Auto-linked to vehicle
   ```

3. **Result:**
   ```
   Images now appear in vehicle gallery
   Organization status: "organized"
   Timeline shows images with correct dates
   ```

## Troubleshooting

**Images not matching?**
- Check GPS coordinates are present in EXIF
- Verify date taken is accurate
- Ensure vehicle has other images for comparison
- Lower `minConfidence` threshold if needed

**Too many false matches?**
- Increase `minConfidence` threshold
- Reduce `maxGpsDistanceMeters` (tighter location matching)
- Reduce `maxDateDifferenceDays` (tighter date matching)

**Want to review before applying?**
- Use `matchUserImages()` to find matches
- Review `matches` array
- Manually call `applyMatches()` when ready

