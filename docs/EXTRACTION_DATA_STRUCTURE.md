# Extraction Data Structure in Backend

## 📍 Database Location

**Table:** `vehicle_images`  
**Column:** `ai_scan_metadata` (JSONB type)

## 📐 Complete Data Structure

The extraction data is stored as a JSONB object in the `ai_scan_metadata` column. Here's the complete structure:

```json
{
  "appraiser": {
    "angle": "exterior_rear",
    "primary_label": "Rear View",
    "description": "Angle: Rear View • Background: boxes, other vehicles • Time: day • Positioned: No • Owner cares: No",
    "context": "Environment: garage | cluttered garage | Photo quality: amateur | Care level: low | Intent: documentation",
    "model": "gemini-2.0-flash",
    "analyzed_at": "2025-11-26T19:32:33.740Z",
    "extraction_data": {
      "angle": "exterior_rear",
      "environment": "garage",
      "context": {
        "background_objects": ["boxes", "other vehicles"],
        "surrounding_area": "cluttered garage",
        "time_of_day": "day",
        "weather_visible": false,
        "other_vehicles_visible": true
      },
      "presentation": {
        "is_positioned": false,
        "is_natural": true,
        "staging_indicators": [],
        "photo_quality": "amateur"
      },
      "care_assessment": {
        "owner_cares": false,
        "evidence": ["rust", "missing parts"],
        "condition_indicators": ["dirty", "neglected"],
        "care_level": "low"
      },
      "seller_psychology": {
        "is_staged": false,
        "intent": "documentation",
        "confidence_indicators": [],
        "transparency_level": "medium"
      }
    },
    "metadata": {
      "tokens": {
        "input": 2165,
        "output": 224,
        "total": 2389
      },
      "cost": {
        "input_cost": 0,
        "output_cost": 0,
        "total_cost": 0,
        "currency": "USD"
      },
      "efficiency": {
        "tokens_per_image": 2389,
        "images_per_1k_tokens": 0,
        "images_per_1m_tokens": 418,
        "estimated_images_per_day_free_tier": 0
      }
    }
  },
  "context_extraction": {
    "angle": "exterior_rear",
    "environment": "garage",
    "context": {
      "background_objects": ["boxes", "other vehicles"],
      "surrounding_area": "cluttered garage",
      "time_of_day": "day",
      "weather_visible": false,
      "other_vehicles_visible": true
    },
    "presentation": {
      "is_positioned": false,
      "is_natural": true,
      "staging_indicators": [],
      "photo_quality": "amateur"
    },
    "care_assessment": {
      "owner_cares": false,
      "evidence": ["rust", "missing parts"],
      "condition_indicators": ["dirty", "neglected"],
      "care_level": "low"
    },
    "seller_psychology": {
      "is_staged": false,
      "intent": "documentation",
      "confidence_indicators": [],
      "transparency_level": "medium"
    },
    "extracted_at": "2025-11-26T19:32:33.740Z",
    "model": "gemini-2.0-flash"
  }
}
```

## 🔍 Data Sections

### 1. `appraiser` Section
**Purpose:** UI-friendly formatted data for display  
**Used by:** ImageLightbox component ("What:", "Why:", "Appraiser Notes")

**Fields:**
- `angle`: Raw angle value (e.g., "exterior_rear")
- `primary_label`: Human-readable label (e.g., "Rear View")
- `description`: Formatted description string for "What:" section
- `context`: Formatted context string for "Why:" section
- `model`: AI model used (e.g., "gemini-2.0-flash")
- `analyzed_at`: ISO8601 timestamp
- `extraction_data`: Full raw extraction data (duplicate of context_extraction)
- `metadata`: Token usage and cost information

### 2. `context_extraction` Section
**Purpose:** Structured raw extraction data for programmatic access  
**Used by:** Queries, analytics, filtering

**Fields:**
- `angle`: Image angle (exterior_front, interior_front_seats, engine_bay, etc.)
- `environment`: Where photo was taken (garage, driveway, street, etc.)
- `context`: Background context
  - `background_objects`: Array of objects in background
  - `surrounding_area`: Description of surrounding area
  - `time_of_day`: day, night, dusk, dawn, indoor
  - `weather_visible`: boolean
  - `other_vehicles_visible`: boolean
- `presentation`: Photo presentation details
  - `is_positioned`: Was vehicle positioned/staged?
  - `is_natural`: Natural/unposed photo?
  - `staging_indicators`: Array of staging indicators
  - `photo_quality`: professional, amateur, cellphone, other
- `care_assessment`: Owner care indicators
  - `owner_cares`: boolean
  - `evidence`: Array of evidence (e.g., ["rust", "missing parts"])
  - `condition_indicators`: Array (e.g., ["dirty", "neglected"])
  - `care_level`: "high", "medium", "low", "unknown"
- `seller_psychology`: Seller mindset indicators
  - `is_staged`: boolean
  - `intent`: "selling", "showcase", "documentation", "casual"
  - `confidence_indicators`: Array
  - `transparency_level`: "high", "medium", "low"
- `extracted_at`: ISO8601 timestamp
- `model`: AI model used

## 📊 How to Query This Data

### Get angle for an image:
```sql
SELECT ai_scan_metadata->'appraiser'->>'angle' as angle
FROM vehicle_images WHERE id = 'your-image-id';
```

### Get care assessment:
```sql
SELECT 
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' as care_level,
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'owner_cares' as owner_cares
FROM vehicle_images 
WHERE id = 'your-image-id';
```

### Find all images with low care level:
```sql
SELECT id, image_url
FROM vehicle_images
WHERE ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' = 'low';
```

### Get all angles for a vehicle:
```sql
SELECT 
  id, 
  ai_scan_metadata->'appraiser'->>'primary_label' as angle,
  ai_scan_metadata->'context_extraction'->>'environment' as environment
FROM vehicle_images
WHERE vehicle_id = 'your-vehicle-id' 
  AND ai_scan_metadata->'appraiser' IS NOT NULL;
```

### Find staged vs natural photos:
```sql
SELECT 
  id,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged' as is_staged,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' as intent
FROM vehicle_images
WHERE vehicle_id = 'your-vehicle-id'
  AND ai_scan_metadata->'context_extraction' IS NOT NULL;
```

### Count images by angle:
```sql
SELECT 
  ai_scan_metadata->'appraiser'->>'angle' as angle,
  COUNT(*) as count
FROM vehicle_images
WHERE vehicle_id = 'your-vehicle-id'
  AND ai_scan_metadata->'appraiser'->>'angle' IS NOT NULL
GROUP BY ai_scan_metadata->'appraiser'->>'angle';
```

## 🔧 Schema Details

### Table: `vehicle_images`
- **Column:** `ai_scan_metadata` (JSONB)
- **Type:** JSONB (PostgreSQL binary JSON)
- **Indexed:** Can create GIN index for faster queries:
  ```sql
  CREATE INDEX idx_vehicle_images_ai_metadata ON vehicle_images USING GIN (ai_scan_metadata);
  ```

### Additional Columns:
- `ai_last_scanned` (TIMESTAMPTZ): When the image was last analyzed
- `ai_component_count` (INTEGER): Count of detected components (legacy)
- `ai_avg_confidence` (DECIMAL): Average confidence score (legacy)

## 💡 Usage Notes

1. **Dual Structure**: Data is stored in both `appraiser` (UI-friendly) and `context_extraction` (structured) for flexibility
2. **Query Performance**: Use JSONB operators (`->`, `->>`) for efficient queries
3. **Indexing**: Consider GIN indexes if querying frequently
4. **Updates**: The `save-extraction-results-to-db.js` script handles formatting and saving
5. **Realtime Updates**: Frontend automatically refreshes via Supabase Realtime subscriptions

