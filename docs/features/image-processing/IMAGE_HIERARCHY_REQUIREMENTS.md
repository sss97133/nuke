# Image Gallery Hierarchy Requirements

## Core Principle: "Show Vehicle in Its Best Light"

The image gallery must display images in a **hierarchical structure** that showcases the vehicle professionally, like a high-end listing or auction presentation.

## Image Hierarchy Tiers

### Tier 1: Hero Shots (Highest Priority)
**Purpose**: First impression - the "money shots"
- **Exterior hero shots**: Front quarter (driver/passenger), rear quarter, profile shots
- **Interior hero shots**: Full dashboard view, driver seat, passenger seat
- **Engine bay beauty shots**: Full engine view, clean presentation
- **Display**: Large, prominent, first in gallery
- **Priority Score**: 50+ (from `imageDisplayPriority.ts`)

### Tier 2: Supporting Angles
**Purpose**: Complete the picture - show all important angles
- Supporting exterior angles (front straight, rear straight, etc.)
- Supporting interior angles (rear seats, door panels, etc.)
- Supporting engine bay angles
- **Display**: Medium size, organized by category
- **Priority Score**: 10-49

### Tier 3: Historical Documentation
**Purpose**: Show vehicle history and condition
- VIN plates, door jamb tags
- Undercarriage shots
- Historical photos
- **Display**: Smaller, organized by date/category
- **Priority Score**: 0-9

### Tier 4: Work Documentation
**Purpose**: Buried at end - internal work documentation
- Work in progress photos
- Repair documentation
- Internal shop photos
- **Display**: Collapsed/hidden by default, accessible but not prominent
- **Priority Score**: Negative (< 0)

## Visual Hierarchy Implementation

### Layout Structure
1. **Hero Section** (Top)
   - Large featured image (best hero shot)
   - Grid of top 4-8 hero shots below
   - Full width, prominent

2. **Supporting Section** (Middle)
   - Organized by category (Exterior, Interior, Engine Bay)
   - Medium-sized thumbnails
   - Collapsible sections

3. **Documentation Section** (Bottom)
   - Historical photos
   - VIN/documentation
   - Smaller thumbnails

4. **Work Documentation** (Hidden/Collapsed)
   - Only visible when expanded
   - Clearly marked as internal documentation

## Priority Calculation Factors

From `imageDisplayPriority.ts`:
1. **Essential Angle Priority** (100 = Front Quarter Driver, 10 = Rear Suspension)
2. **Confidence Bonus** (high confidence = higher priority)
3. **Perspective Bonus** (wide angle for exteriors, standard for interiors)
4. **Recency Bonus** (newer hero shots get priority)
5. **Category Bonus** (hero category = +50, exterior = +20, etc.)

## Integration Requirements

1. **Use `imageDisplayPriority.ts` service** in ImageGalleryV2
2. **Load angle data** from `vehicle_image_angles` or `ai_angle_classifications_audit`
3. **Map to `image_coverage_angles`** for essential angle flags
4. **Group by tier** using `groupImagesByTier()`
5. **Display hierarchically** with visual size/position differences
6. **Respect `is_primary` flag** but also use calculated priority scores

## Current Gap

ImageGalleryV2 currently:
- ❌ Doesn't use `imageDisplayPriority.ts`
- ❌ Only sorts by `is_primary` and date
- ❌ Doesn't group by tier
- ❌ Doesn't show visual hierarchy
- ❌ Doesn't load angle data for priority calculation

## What Needs to Be Built

1. **Load angle classifications** and map to `image_coverage_angles`
2. **Calculate priority scores** using `imageDisplayPriority.ts`
3. **Group images by tier** (hero, supporting, historical, workDocs)
4. **Display in hierarchical layout** (large hero section, medium supporting, small docs)
5. **Respect both `is_primary` and calculated priority** (primary gets bonus, but calculated priority determines final order)

