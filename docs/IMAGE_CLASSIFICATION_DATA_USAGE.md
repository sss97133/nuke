# Image Classification Data Usage Guide

## Overview

We now have **3,042+ classified images** with rich metadata including:
- Angle families (front_corner, side, engine_bay, etc.)
- View axes (front_left, rear_right, etc.)
- Elevation (ground, low, mid, high, overhead)
- Distance (close, medium, wide, ultra_wide)
- Focal length (wide, normal, telephoto, macro)
- Role (hero, coverage, detail, labor_step, before/during/after)
- 3D spatial coordinates (spatial_x, spatial_y, spatial_z)
- Part names and system areas
- Confidence scores (average: 91.1%)

## What You Can Do With This Data

### 1. **Query Images by Angle** ✅
```typescript
import { getFrontCornerShots, getEngineBayImages, getInteriorImages } from '@/services/imageAngleService';

// Get all front corner shots
const frontCorners = await getFrontCornerShots(vehicleId);

// Get all engine bay images
const engineImages = await getEngineBayImages(vehicleId);

// Get all interior shots
const interiorImages = await getInteriorImages(vehicleId);
```

### 2. **Filter Images by Classification** ✅
```typescript
import { getImagesByAngle } from '@/services/imageAngleService';

// Get all high-angle wide shots
const highWideShots = await getImagesByAngle({
  vehicleId,
  elevation: 'high',
  distance: 'wide',
  minConfidence: 85
});

// Get all labor/repair images
const laborImages = await getImagesByAngle({
  vehicleId,
  role: ['labor_step', 'before', 'during', 'after']
});
```

### 3. **Find Images by Part** ✅
```typescript
import { getImagesByPart } from '@/services/imageAngleService';

// Get all images of brake calipers
const brakeImages = await getImagesByPart(vehicleId, 'brake_caliper');
```

### 4. **Get Coverage Summary** ✅
```typescript
import { getAngleCoverageSummary } from '@/services/imageAngleService';

// See what angles are covered
const coverage = await getAngleCoverageSummary(vehicleId);
// Returns: { front_corner: { count: 107, avgConfidence: 95, mapped: 107 }, ... }
```

### 5. **Review Low-Confidence Images** ✅
```typescript
import { getImagesNeedingReview } from '@/services/imageAngleService';

// Get images flagged for human review
const needsReview = await getImagesNeedingReview(vehicleId);
```

### 6. **Use SQL Functions Directly** ✅
```sql
-- Get all front corner shots for a vehicle
SELECT * FROM get_vehicle_images_by_angle(
  'vehicle-id-here',
  p_angle_family := 'front_corner',
  p_min_confidence := 85
);

-- Get all high-angle shots
SELECT * FROM get_vehicle_images_by_angle(
  'vehicle-id-here',
  p_elevation := 'high'
);
```

## UI Components Available

### ImageAngleFilter Component
Filter images by angle classification in the UI:

```tsx
import { ImageAngleFilter } from '@/components/image/ImageAngleFilter';

<ImageAngleFilter
  vehicleId={vehicleId}
  onFilteredImages={(images) => {
    // Display filtered images
    setDisplayedImages(images);
  }}
/>
```

### ImageCoverageChecklist Component
Shows which essential angles are documented:

```tsx
import ImageCoverageChecklist from '@/components/vehicle/ImageCoverageChecklist';

<ImageCoverageChecklist vehicleId={vehicleId} />
```

## Database Views & Tables

### `image_angle_classifications_view`
Combines `vehicle_images`, `ai_angle_classifications_audit`, and `image_coverage_angles` for easy querying.

### `ai_angle_classifications_audit`
All AI classifications (even unmapped ones) with full metadata.

### `vehicle_image_angles`
Mapped classifications linked to `image_coverage_angles` (the canonical angle system).

### `image_spatial_metadata`
3D spatial coordinates, part names, system areas for detail shots.

## Common Use Cases

### 1. **"Show me all front corner angle shots"**
```typescript
const shots = await getFrontCornerShots(vehicleId);
```

### 2. **"Show me all repair/labor images"**
```typescript
const laborImages = await getLaborImages(vehicleId);
```

### 3. **"Show me all close-up detail shots"**
```typescript
const details = await getImagesByAngle({
  vehicleId,
  distance: 'close',
  angleFamily: 'detail'
});
```

### 4. **"Show me all engine bay images"**
```typescript
const engine = await getEngineBayImages(vehicleId);
```

### 5. **"What angles are we missing?"**
```typescript
const coverage = await getAngleCoverageSummary(vehicleId);
// Compare against essential angles in image_coverage_angles
```

## Next Steps / Future Enhancements

1. **Labor Bundle Grouping** - Group images by work session/timeline event
2. **Spatial Visualization** - 3D view showing where images were taken
3. **Smart Image Selection** - AI picks best images for each angle
4. **Coverage Gaps** - Automatically suggest missing angles
5. **Parts Marketplace Integration** - Link classified parts to replacement parts
6. **Manual Annotation** - Already implemented! Click "ANNOTATION" in ImageLightbox

## Integration Points

- **ImageLightbox**: Shows classification metadata, has "ANNOTATION" button
- **ImageGallery**: Can add angle filter dropdown
- **VehicleProfile**: Shows ImageCoverageChecklist
- **Parts Marketplace**: Can use part_name from spatial metadata

## Performance Notes

- Classifications are indexed for fast queries
- Views are materialized for common queries
- Spatial data is optional (only for detail shots)
- Confidence scores help prioritize results

