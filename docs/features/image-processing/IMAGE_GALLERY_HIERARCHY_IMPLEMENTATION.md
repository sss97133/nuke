# Image Gallery Hierarchy Implementation Plan

## Goal
Rebuild ImageGalleryV2 to show vehicle in its best light using the existing `imageDisplayPriority.ts` service to create a visual hierarchy.

## Current State
- ❌ ImageGalleryV2 doesn't use `imageDisplayPriority.ts`
- ❌ Doesn't load `vehicle_image_angles` data
- ❌ Doesn't map to `image_coverage_angles` for angle_name/is_essential/category
- ❌ Doesn't group by tier (hero, supporting, historical, workDocs)
- ❌ Doesn't display hierarchically (all images same size)

## Required Changes

### 1. Load Angle Data
```typescript
// Load vehicle_image_angles (links images to image_coverage_angles)
const { data: angleLinks } = await supabase
  .from('vehicle_image_angles')
  .select(`
    image_id,
    angle_id,
    confidence_score,
    image_coverage_angles (
      angle_name,
      is_essential,
      category,
      display_name
    )
  `)
  .in('image_id', imageIds);
```

### 2. Map to imageDisplayPriority Format
```typescript
// Convert to format expected by imageDisplayPriority.ts
const imagesWithAngles = baseImages.map(img => ({
  ...img,
  angles: angleLinks
    .filter(link => link.image_id === img.id)
    .map(link => ({
      angle_name: link.image_coverage_angles?.angle_name,
      is_essential: link.image_coverage_angles?.is_essential,
      category: link.image_coverage_angles?.category,
      confidence_score: link.confidence_score,
      perspective: classification?.focal_length // from ai_angle_classifications_audit
    }))
}));
```

### 3. Use Priority Service
```typescript
import { groupImagesByTier, sortImagesByPriority } from '../../services/imageDisplayPriority';

const { heroShots, supporting, historical, workDocs } = groupImagesByTier(imagesWithAngles);
```

### 4. Display Hierarchically
```typescript
// Hero Section - Large, prominent
<div className="hero-section">
  {heroShots.slice(0, 1).map(img => <LargeHeroImage />)}
  <div className="hero-grid">
    {heroShots.slice(1, 9).map(img => <HeroThumbnail />)}
  </div>
</div>

// Supporting Section - Medium, organized
<div className="supporting-section">
  <h3>Supporting Angles</h3>
  <div className="supporting-grid">
    {supporting.map(img => <MediumThumbnail />)}
  </div>
</div>

// Historical Section - Small, organized
<div className="historical-section">
  <h3>Documentation</h3>
  <div className="historical-grid">
    {historical.map(img => <SmallThumbnail />)}
  </div>
</div>

// Work Docs - Collapsed by default
<CollapsibleSection title="Work Documentation">
  {workDocs.map(img => <SmallThumbnail />)}
</CollapsibleSection>
```

## Visual Hierarchy Specs

### Hero Section
- **Lead Image**: Full width, 600px height, prominent
- **Hero Grid**: 4-8 images, 200px each, 2-4 columns
- **Total**: ~8-9 hero shots visible

### Supporting Section
- **Thumbnails**: 150px each, 4-6 columns
- **Grouped by**: Category (Exterior, Interior, Engine Bay)

### Historical Section
- **Thumbnails**: 100px each, 6-8 columns
- **Grouped by**: Date or category

### Work Docs Section
- **Collapsed by default**
- **Thumbnails**: 100px each
- **Clear label**: "Internal Work Documentation"

## Implementation Steps

1. ✅ Update `loadImages()` to load `vehicle_image_angles`
2. ✅ Map angle data to `imageDisplayPriority.ts` format
3. ✅ Use `groupImagesByTier()` to organize images
4. ✅ Create hierarchical layout components
5. ✅ Update sorting to use priority scores
6. ✅ Add tier labels and visual separators

