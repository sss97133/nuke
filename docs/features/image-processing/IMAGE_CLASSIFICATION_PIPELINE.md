# Image Classification Pipeline & Execution Plan

## Current Pipeline Architecture

### 1. **Image Ingestion** → `vehicle_images` table
- Images uploaded via frontend or bulk import
- Stored in Supabase Storage
- Metadata stored in `vehicle_images` table

### 2. **Classification Trigger** → `backfill-image-angles` Edge Function
- Processes images in batches (30 images per batch)
- Uses OpenAI GPT-4o Vision API for classification
- Stores results in `ai_angle_classifications_audit` table

### 3. **Data Extraction** → Enhanced Context-Aware Classification
- **Vehicle Context**: Year, Make, Model, Body Style
- **Receipt Data**: Recent work/parts mentioned
- **Timeline Events**: Recent repairs/maintenance
- **Manual References**: Available repair manuals and part references

### 4. **Angle Mapping** → `vehicle_image_angles` table
- Maps classifications to standardized angles (`image_coverage_angles`)
- Links images to essential angles (Front Quarter, Engine Bay, etc.)

### 5. **Spatial Metadata** → `image_spatial_metadata` table
- 3D coordinates (x, y, z)
- Part names and categories
- System areas
- Repair stage information

## Current Data Extraction Fields

### ✅ Basic Classification
- `primary_label`: Main description
- `angle_family`: Category (front_corner, engine_bay, etc.)
- `view_axis`: Perspective (front-left, driver, etc.)
- `elevation`: Camera height (low, mid, high)
- `distance`: Framing (close, medium, wide)
- `focal_length`: Lens type
- `confidence`: 0-100 score

### ✅ Enhanced Extraction (NEW - Being Implemented)
- `extracted_tags`: **ALL visible parts** (brake caliper, rotor, wheel, tire, door handle, mirror, etc.)
- `colors`: **ALL colors** (red, black, chrome, silver, etc.)
- `materials`: **ALL materials** (leather, vinyl, plastic, metal, rubber, etc.)
- `conditions`: **ALL conditions** (rust, corrosion, damage, wear, scratches, dents, new, restored, original, etc.)
- `brands`: **ALL brands/logos** (Ford, Chevy, Holley, Edelbrock, etc.)
- `features`: **ALL features** (power steering, air conditioning, custom paint, etc.)
- `text_labels`: **ALL text** (part numbers, labels, stickers, VIN digits, etc.)

## Execution Plan for Better Image Data

### Phase 1: Accelerate Processing (IMMEDIATE)
**Goal**: Process all 2,448 remaining images faster

**Actions**:
1. ✅ Increase batch size from 30 → 50 images
2. ✅ Reduce sleep time from 8s → 5s between batches
3. ✅ Run multiple parallel instances (if rate limits allow)
4. ✅ Optimize concurrent processing (currently 20 concurrent)

**Expected Impact**:
- Current: ~30 images every 8s = ~135 images/hour
- Optimized: ~50 images every 5s = ~360 images/hour
- **Time to completion**: ~7 hours (vs 15 hours)

### Phase 2: Improve Extraction Quality (IN PROGRESS)
**Goal**: Ensure detailed extraction fields are populated

**Actions**:
1. ✅ Enhanced prompt with explicit extraction requirements
2. ✅ Increased max_tokens from 500 → 2000 for detailed responses
3. ✅ Always use enhanced context (vehicle YMM, receipts, manuals)
4. ⚠️ **VERIFY**: Check if OpenAI is actually returning detailed fields

**Verification Query**:
```sql
SELECT 
  image_id,
  raw_classification::text LIKE '%extracted_tags%' as has_tags,
  raw_classification::text LIKE '%colors%' as has_colors,
  raw_classification::text LIKE '%brands%' as has_brands,
  created_at
FROM ai_angle_classifications_audit
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

### Phase 3: Enhance Organization (NEXT)
**Goal**: Better image organization in gallery

**Actions**:
1. ✅ Coverage tracker shows missing angles
2. ✅ Hierarchical display (hero shots first)
3. 🔄 **IMPROVE**: Better angle mapping accuracy
4. 🔄 **ADD**: Part-based grouping (all brake images together)
5. 🔄 **ADD**: Color/material filtering
6. 🔄 **ADD**: Brand-based search

### Phase 4: Data Quality Improvements (FUTURE)
**Goal**: Higher confidence, better accuracy

**Actions**:
1. **Guardrails**: Flag low-confidence classifications for review
2. **Consensus**: When multiple images show same part, use highest confidence
3. **Manual Review**: UI for reviewing flagged classifications
4. **Re-classification**: Re-process low-confidence images with better context

## Current Processing Status

```bash
# Check script status
ps aux | grep enhance-image-classifications

# View live progress
tail -f /tmp/enhanced-image-classification.log

# Check database stats
# Run SQL queries to see classification percentage
```

## Optimization Opportunities

### 1. **Parallel Processing**
- Current: 20 concurrent requests
- Optimal: 30-40 concurrent (if rate limits allow)
- **Impact**: 50-100% faster processing

### 2. **Batch Size**
- Current: 30 images per batch
- Optimal: 50-100 images per batch
- **Impact**: Fewer API calls, faster overall

### 3. **Rate Limit Handling**
- Current: 60s wait on rate limit
- Optimal: Exponential backoff with adaptive concurrency
- **Impact**: Better throughput during rate limits

### 4. **Context Caching**
- Current: Pre-loads vehicle contexts
- Optimal: Cache across batches
- **Impact**: Faster context loading

## Next Steps

1. **Immediate**: Increase batch size and reduce sleep time
2. **Verify**: Check if detailed extraction is working
3. **Monitor**: Track processing speed and quality
4. **Iterate**: Adjust based on results

