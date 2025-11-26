# Image Extraction Indexing by Model

## Overview

Image extractions are now indexed by model name, allowing you to:
- Run extractions with different models and compare results
- Track which model extracted which data
- Maintain multiple extraction versions per image

## Data Structure

Extractions are stored in `vehicle_images.ai_scan_metadata` with the following structure:

```json
{
  "extractions": {
    "gemini-1.5-flash": {
      "model": "gemini-1.5-flash",
      "extracted_at": "2025-01-27T12:00:00Z",
      "angle": "exterior_front",
      "primary_label": "Front View",
      "description": "Angle: Front View • Background: garage, tools",
      "context": "Environment: garage | Photo quality: professional",
      "extraction_data": { /* full extraction */ },
      "metadata": {
        "tokens": { "input": 1000, "output": 200, "total": 1200 },
        "cost": { "input_cost": 0, "output_cost": 0, "total_cost": 0 },
        "efficiency": { /* efficiency metrics */ },
        "model_tier": "free",
        "finish_reason": "STOP"
      },
      "context_extraction": {
        "angle": "exterior_front",
        "environment": "garage",
        "context": { /* context data */ },
        "presentation": { /* presentation data */ },
        "care_assessment": { /* care assessment */ },
        "seller_psychology": { /* seller psychology */ }
      }
    },
    "gemini-2.0-flash": {
      /* Same structure, different model */
    }
  },
  "extraction_models": ["gemini-1.5-flash", "gemini-2.0-flash"],
  "last_extracted_at": "2025-01-27T12:00:00Z",
  "appraiser": { /* Latest extraction for backward compatibility */ },
  "context_extraction": { /* Latest context extraction */ }
}
```

## Usage

### Batch Extract All Images

```bash
# Extract all images with current model
node scripts/batch-extract-all-images.js

# Force re-extraction (even if already extracted)
node scripts/batch-extract-all-images.js --force
```

### Query Extractions by Model

```sql
-- Get all images extracted with a specific model
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'angle' as angle,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'primary_label' as label
FROM vehicle_images
WHERE ai_scan_metadata->'extractions'->'gemini-1.5-flash' IS NOT NULL;

-- Compare extractions from different models
SELECT 
  id,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'angle' as model_1_5_angle,
  ai_scan_metadata->'extractions'->'gemini-2.0-flash'->>'angle' as model_2_0_angle
FROM vehicle_images
WHERE ai_scan_metadata->'extractions'->'gemini-1.5-flash' IS NOT NULL
  AND ai_scan_metadata->'extractions'->'gemini-2.0-flash' IS NOT NULL;

-- List all models that have extracted each image
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extraction_models' as models
FROM vehicle_images
WHERE ai_scan_metadata->'extraction_models' IS NOT NULL;
```

### Compare Extractions

Use the comparison script to analyze differences between models:

```bash
node scripts/compare-extractions.js <image_id> [model1] [model2]
```

## Backward Compatibility

The `appraiser` and `context_extraction` fields are maintained for backward compatibility:
- They contain the **latest** extraction (most recent `extracted_at`)
- UI components can continue using these fields
- New code should use `extractions[modelName]` for model-specific data

## Adding New Models

When running extractions with a new model:

1. The extraction is automatically indexed by model name
2. The model is added to `extraction_models` array
3. The latest extraction becomes the primary (`appraiser` field)
4. All previous extractions remain accessible via `extractions[modelName]`

## Best Practices

1. **Always specify model name** when querying extractions
2. **Compare models** before switching to a new one
3. **Keep extraction history** - don't delete old extractions
4. **Use `--force` flag** sparingly - only when you need to re-extract

