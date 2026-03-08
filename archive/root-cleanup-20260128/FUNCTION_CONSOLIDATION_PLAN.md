# Function Consolidation & Angle Taxonomy Fix

## The Problem

**292 Edge Functions** - way too many, many duplicates, none working properly.

**Angle labeling is broken:**
- 12,653 images labeled `exterior_three_quarter` (useless - which side?)
- Should be: `exterior.front_three_quarter.driver` or `exterior.front_three_quarter.passenger`
- Precise taxonomy system documented but NEVER implemented

## Current Broken State

### Angle Labels (What You Have):
- `exterior_three_quarter`: 12,653 images ❌
- `exterior`: 7,846 images ❌
- `interior_dashboard`: 22,050 images (ok but should be `interior.dash.full`)
- `detail_shot`: 19,017 images ❌
- `engine_bay`: 4,492 images (should be `engine.bay.full` or `engine.bay.driver_side`)

### What You Should Have:
- `exterior.front_three_quarter.driver`
- `exterior.front_three_quarter.passenger`
- `exterior.rear_three_quarter.driver`
- `exterior.rear_three_quarter.passenger`
- `engine.bay.driver_side`
- `engine.bay.passenger_side`
- `interior.dash.full`
- `interior.dash.driver`
- etc.

## Function Audit

### Image Analysis Functions (6 duplicates):
1. `analyze-image` - Main function (should be the ONLY one)
2. `analyze-image-contextual` - Duplicate logic
3. `analyze-image-tier1` - Duplicate logic
4. `analyze-image-tier2` - Duplicate logic
5. `backfill-image-angles` - Should use analyze-image
6. `ai-tag-image-angles` - Should use analyze-image

**Action:** Consolidate to ONE function: `analyze-image` with proper taxonomy

### Other Duplicates:
- `batch-analyze-images` vs `batch-analyze-all-images`
- `analyze-organization-images` vs `analyze-image` (just different scope)

## Solution

### Step 1: Populate Angle Taxonomy Table
Seed the `angle_taxonomy` table with all 100+ precise angles from the documented system.

### Step 2: Create Mapping Function
Map weak labels → precise taxonomy:
- `exterior_three_quarter` → `exterior.front_three_quarter.unknown` (then re-analyze to determine side)
- `engine_bay` → `engine.bay.full` (then re-analyze for side-specific)
- `interior_dashboard` → `interior.dash.full`

### Step 3: Fix analyze-image Function
Make it use the taxonomy table and return precise angles only.

### Step 4: Consolidate Functions
Delete duplicates, keep only `analyze-image`.

