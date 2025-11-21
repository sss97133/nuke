# Image Gallery Requirements - User Specifications

## Core Principle: "Show Vehicle in Its Best Light"

The image gallery must display images in a **hierarchical structure** that showcases the vehicle professionally, prioritizing the best images first to create the best first impression.

## Image Hierarchy System

### Tier 1: Hero Shots (Highest Priority - 50+ score)
- **Exterior hero shots**: Front quarter (driver/passenger), rear quarter, profile shots
- **Interior hero shots**: Full dashboard view, driver seat, passenger seat  
- **Engine bay beauty shots**: Full engine view, clean presentation
- **Display**: Large, prominent, first in gallery - the "money shots"

### Tier 2: Supporting Angles (10-49 score)
- Supporting exterior/interior/engine angles
- **Display**: Medium size, organized by category

### Tier 3: Historical Documentation (0-9 score)
- VIN plates, door jamb tags, undercarriage shots
- **Display**: Smaller, organized by date/category

### Tier 4: Work Documentation (Negative score)
- Work in progress photos, repair documentation
- **Display**: Collapsed/hidden by default, accessible but not prominent

## Core Requirements

### 1. **Structured Metadata for Every Image**
Every image must have:
- **Angle family**: `front_corner`, `side`, `rear`, `engine_bay`, `interior`, `detail`, `document`
- **Axis**: `front`, `rear`, `left`, `right`, `front_left`, `front_right`, `rear_left`, `rear_right`, `top`, `underside`, `dash`
- **Elevation**: `low`, `mid`, `high`
- **Distance / framing**: `close`, `medium`, `wide`
- **Lens / look**: `wide`, `normal`, `telephoto`
- **Role in narrative**: `hero`, `coverage`, `detail`, `evidence`, `labor_step_n`
- **Linked work session / timeline**: which **labor bundle** this image belongs to

### 2. **Queryable Like SQL**
User wants to query like:
```sql
SELECT image_url FROM vehicle_image_angles 
WHERE vehicle_id = ? 
  AND angle_family = 'front_corner' 
  AND elevation = 'high' 
  AND distance = 'wide';
```

### 3. **Labor Bundle Grouping**
- Images should be grouped by **labor bundles** (work sessions)
- Each bundle represents a job/work done on the vehicle
- Images in a bundle help "shape and document labor of a job done on a vehicle"

### 4. **Circular Workflow**
1. User A views User B's vehicle profile
2. Views image x
3. Clicks brake caliper (part tag)
4. Orders brake caliper (through our system entirely - we track all data)
5. User A documents installation
6. Process repeats
7. We begin to calculate stats on "job"

### 5. **V2 Image Gallery Step One + Tagging System**
- Gallery should show "step one" (the organized/labeled images)
- Followed by "tagging system/ this data labeling"
- Everything should be "clickable that adds value, meaning and authentication proof"

### 6. **Better Image Gallery Top to Bottom**
- "Inside and out fully torqued out functionally"
- Should show all images organized properly
- Should be production-ready ASAP

## What's Missing in Current Implementation

1. ❌ **No labor bundle grouping** - Images shown as flat list
2. ❌ **Tags not prominently displayed** - Only shown in lightbox
3. ❌ **Parts not clickable in gallery** - Only clickable in lightbox
4. ❌ **Metadata not queryable** - Can't easily query by angle_family + elevation + distance
5. ❌ **No work session display** - Labor bundles not shown
6. ❌ **Tagging system not integrated** - Should be step one visible

## What Needs to Be Built

1. **Labor Bundle View** - Group images by timeline_event_id/work_session
2. **Prominent Tag Display** - Show tags on images in gallery
3. **Clickable Parts in Gallery** - Parts clickable directly in grid view
4. **Query Interface** - UI to query by angle_family, elevation, distance, etc.
5. **Structured Metadata Display** - Show all metadata (angle, axis, elevation, distance, lens, role, labor bundle)
6. **Tagging System Integration** - Make tagging visible and accessible

