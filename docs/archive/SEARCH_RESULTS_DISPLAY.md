# Search Results Display - Current State

## Current Implementation

### Where Search Results Are Shown

**Location**: `/vehicles` page (Vehicles.tsx)

**Display Format**:
- **Grid Layout**: `GarageVehicleCard` components in a responsive grid
- **Grid Columns**: `repeat(auto-fill, minmax(280px, 1fr))` - minimum 280px per card
- **Gap**: 12px between cards
- **Container**: Section with padding: 8px

### Current Search Functionality

**What Gets Searched** (lines 998-1010 in Vehicles.tsx):
```typescript
// Only searches vehicle metadata:
- vehicle.year (as string)
- vehicle.make
- vehicle.model  
- vehicle.vin
- vehicle.color
- relationship.role
```

**What's Missing**:
- ❌ **Image search** - No search by image angle/part name
- ❌ **Image angle classifications** - Doesn't query `image_angle_classifications_view`
- ❌ **Part name search** - Doesn't search `image_spatial_metadata` for part names
- ❌ **Angle family search** - Doesn't search for "fender", "door", "hood", etc.

### Example: "show me pictures of front fenders"

**Current Behavior**:
1. Navigates to `/vehicles?search=show me pictures of front fenders`
2. Tries to match vehicles where:
   - year contains "show" or "me" or "pictures" or "of" or "front" or "fenders"
   - make contains those words
   - model contains those words
   - etc.
3. **Result**: Likely finds NO vehicles (because no vehicle has "fenders" in make/model)

**What Should Happen**:
1. Parse query: "front fenders" → search for images
2. Query `image_angle_classifications_view`:
   - `angle_family` LIKE '%fender%' OR
   - `part_name` LIKE '%fender%' OR  
   - `extracted_tags` contains 'fender'
3. Query `image_spatial_metadata`:
   - `part_name` LIKE '%fender%'
4. Display matching images grouped by vehicle
5. Show image thumbnails with vehicle context

## How to Fix

### Option 1: Add Image Search to Vehicles Page

When search query contains image-related terms (pictures, images, photos, fender, door, hood, etc.):
1. Detect image search intent
2. Query `image_angle_classifications_view` and `image_spatial_metadata`
3. Display images in a gallery view instead of/in addition to vehicle cards

### Option 2: Create Dedicated Image Search Page

Create `/images?search=...` route that:
1. Shows image search results
2. Groups by vehicle
3. Shows image thumbnails with angle/part labels
4. Links to vehicle profiles

### Option 3: Enhance Vehicles Page with Image Results Section

Add a new section below vehicle cards:
- "Matching Images" section
- Shows images that match the search query
- Clicking image navigates to vehicle profile

## Current Display Components

**GarageVehicleCard** (`components/vehicles/GarageVehicleCard.tsx`):
- Shows vehicle thumbnail
- Vehicle year, make, model
- Relationship type (owned, contributing, etc.)
- Organization relationships
- Metrics (timeline events, images, etc.)

**No Image-Specific Display Component**:
- No component for showing search results of images
- No gallery view for image search results
- No way to display images grouped by angle/part

## Recommendation

**Implement Option 3** (enhance Vehicles page):
1. Detect if search query is image-related
2. If yes, query image classifications
3. Display matching images in a new section
4. Keep vehicle search results above
5. Show both vehicle matches AND image matches

