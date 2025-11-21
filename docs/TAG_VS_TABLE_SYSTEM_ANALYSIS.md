# Tag System vs Table System - Architecture Analysis

## The Problem You Identified

You're right - there's overlap and confusion between:
1. **Tags System** (`image_tags` table) - Originally for manual user tagging
2. **Tables System** - AI-driven structured data storage

## Current Architecture

### 1. **`image_tags` Table** (The "Everything" Table)
**Original Purpose**: Manual user tagging - click on image, label a part
**Current Reality**: Trying to do EVERYTHING
- Manual tags (user clicks and labels)
- AI-extracted tags (from backfill-image-angles)
- Parts marketplace data (prices, suppliers, OEM numbers)
- Verification/validation data
- Spatial coordinates (x, y, width, height)

**Problem**: This table has 50+ columns and is trying to be:
- A tagging system
- A parts database
- A marketplace integration
- A verification system
- A spatial mapping system

### 2. **`ai_angle_classifications_audit` Table** (AI Audit Trail)
**Purpose**: Store EVERYTHING the AI saw/classified
- `angle_family`: "front_corner", "engine_bay", etc.
- `primary_label`: Human-readable label
- `raw_classification`: Full JSONB with ALL extracted data:
  - `extracted_tags`: ["brake caliper", "rotor", "wheel"]
  - `colors`: ["red", "black", "chrome"]
  - `materials`: ["metal", "rubber"]
  - `conditions`: ["rust", "wear"]
  - `brands`: ["Ford", "Holley"]
  - `features`: ["power steering", "air conditioning"]
  - `text_labels`: ["part numbers", "stickers"]

**How It Works**: 
- AI analyzes image → Returns comprehensive JSON
- We store the FULL response in `raw_classification` (JSONB)
- We also extract key fields into columns for easy querying
- This is the "source of truth" for what AI detected

### 3. **`image_spatial_metadata` Table** (3D Spatial Mapping)
**Purpose**: Store 3D coordinates and part locations
- `spatial_x`, `spatial_y`, `spatial_z`: 3D coordinates (0.0-1.0)
- `part_name`: "brake caliper"
- `part_category`: "braking"
- `system_area`: "front_left"
- `repair_stage`: "before", "during", "after"

**How It Works**:
- AI identifies a part AND its 3D location
- Stores normalized coordinates for spatial queries
- Links to repair stages and labor steps

### 4. **`vehicle_image_angles` Table** (Normalized Angle Links)
**Purpose**: Link images to predefined angle definitions
- Links `image_id` → `angle_id` (from `image_coverage_angles` table)
- Stores confidence, perspective, focal length
- This is the "normalized" version for queries

## The Overlap Problem

**Current Flow** (What We Just Implemented):
```
AI Classifies Image
  ↓
1. Store in `ai_angle_classifications_audit` (full audit trail)
  ↓
2. Extract tags → Store in `image_tags` (for searchability)
  ↓
3. Extract spatial data → Store in `image_spatial_metadata` (for 3D mapping)
  ↓
4. Map to angle → Store in `vehicle_image_angles` (for queries)
```

**The Issue**: We're storing the same data in multiple places:
- `extracted_tags` in `ai_angle_classifications_audit.raw_classification`
- Same tags in `image_tags` table
- Part names in both `image_spatial_metadata` AND `image_tags`

## Why This Happened

1. **Tags were first** - Designed for manual user interaction
2. **AI came later** - Needed structured storage
3. **We tried to reuse tags** - But tags aren't designed for AI bulk data
4. **Now we have both** - Competing systems

## The Better Approach: Table System

### Why Tables Are Better for AI:

1. **Structured Data**: Tables have defined schemas
   - `ai_angle_classifications_audit.angle_family` = "front_corner"
   - `image_spatial_metadata.part_name` = "brake caliper"
   - Easy to query: `WHERE angle_family = 'engine_bay'`

2. **No New Table Per Tag**: 
   - One row per image in `ai_angle_classifications_audit`
   - All tags stored in JSONB `raw_classification.extracted_tags`
   - Query with: `WHERE raw_classification->>'extracted_tags' @> '["brake"]'`

3. **True/False Statements**:
   - `image_spatial_metadata.is_repair_image` = true/false
   - `ai_angle_classifications_audit.needs_review` = true/false
   - `vehicle_image_angles.confidence_score` = 0-100

4. **Relationships**:
   - `image_spatial_metadata.part_name` → Can link to parts catalog
   - `vehicle_image_angles.angle_id` → Links to predefined angles
   - `ai_angle_classifications_audit.vehicle_id` → Links to vehicle

### Why Tags Are Better for Manual User Input:

1. **Spatial Coordinates**: User clicks at (x, y) position
2. **User Verification**: User can verify/reject AI tags
3. **Custom Labels**: User can add labels AI didn't detect
4. **Visual Overlay**: Tags show as dots/boxes on images

## Recommended Architecture

### **Use Tables for AI Data**:
```
ai_angle_classifications_audit (source of truth)
  ↓
Extract structured data into:
  - image_spatial_metadata (3D coordinates, parts)
  - vehicle_image_angles (angle links)
  - DON'T duplicate into image_tags
```

### **Use Tags for User Interaction**:
```
image_tags (manual user tags only)
  - User clicks on image → Creates tag
  - User verifies AI detection → Creates tag
  - User adds custom label → Creates tag
```

### **Search Strategy**:
```sql
-- Search AI classifications (comprehensive)
SELECT * FROM ai_angle_classifications_audit
WHERE raw_classification->>'extracted_tags' @> '["brake"]'
  OR raw_classification->>'colors' @> '["red"]'

-- Search user tags (manual verification)
SELECT * FROM image_tags
WHERE tag_name ILIKE '%brake%'
  AND source_type = 'manual'
```

## What We Should Do

1. **Stop storing AI tags in `image_tags`**
   - Keep `image_tags` for manual user tags only
   - Search AI data from `ai_angle_classifications_audit.raw_classification`

2. **Use `image_spatial_metadata` for part locations**
   - This is the proper table for AI-identified parts
   - Has 3D coordinates, part names, categories

3. **Keep `ai_angle_classifications_audit` as source of truth**
   - Store everything AI detected
   - Query from here for comprehensive search

4. **Simplify `image_tags`**
   - Remove AI-extracted tags
   - Keep only manual user tags
   - Keep spatial coordinates for visual overlay

## Benefits of Table System

1. **No table creation per tag** - One row per image
2. **Structured queries** - SQL WHERE clauses
3. **Relationships** - Foreign keys, joins
4. **True/false statements** - Boolean columns
5. **Better performance** - Indexed columns vs JSONB searches
6. **Type safety** - Defined schemas vs free-form tags

## Next Steps

1. Remove AI tag insertion into `image_tags` from backfill function
2. Update search to query `ai_angle_classifications_audit` instead
3. Keep `image_tags` for manual user interaction only
4. Use `image_spatial_metadata` for AI-identified parts with locations

