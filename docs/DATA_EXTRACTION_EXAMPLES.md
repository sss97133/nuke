# Real Data Extraction Examples - How Images Become Database Records

## Overview

This document shows **10 real examples** of how vehicle images are analyzed by AI and how that data flows into database tables.

---

## Example 1: Upholstery Work on Interior

### **Image**
- **Image ID**: `71b45687-17a2-47a8-9669-e5ad021f7354`
- **Vehicle**: 1974 Ford Bronco
- **URL**: `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/.../e31f00c4-0561-4941-9eed-d1195f7207d3.jpeg`

### **AI Analysis (Raw Response)**
```json
{
  "work_type": "upholstery",
  "work_description": "Interior work involving the footwell area, possibly related to carpet or pedal covers.",
  "components": ["carpet", "pedals"],
  "confidence": 0.87
}
```

### **Stored in `image_work_extractions` Table**
| Column | Value |
|--------|-------|
| `detected_work_type` | `upholstery` |
| `detected_work_description` | `Interior work involving the footwell area, possibly related to carpet or pedal covers.` |
| `detected_components` | `{carpet,pedals}` |
| `overall_confidence` | `0.87` |
| `status` | `extracted` |

### **Next Stage: Component Details**
When Stage 2 runs, this would extract:
- Carpet material, condition, color
- Pedal type, condition, brand
- Footwell area details

---

## Example 2: Paint Work on Body

### **Image**
- **Vehicle**: Classic Car
- **Work Type**: Paint

### **AI Analysis**
```json
{
  "work_type": "paint",
  "work_description": "The vehicle's body has been freshly painted with a glossy finish.",
  "components": ["body", "fender"],
  "confidence": 0.93
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `The vehicle's body has been freshly painted with a glossy finish.` |
| `detected_components` | `{body,fender}` |
| `overall_confidence` | `0.93` |

### **What Stage 2 Would Extract**
- Paint color, finish type (glossy/matte)
- Fender condition, rust, damage
- Paint quality, coverage
- Brand of paint (if visible)

---

## Example 3: Body Work on Truck Bed

### **Image**
- **Work Type**: Body Work

### **AI Analysis**
```json
{
  "work_type": "body_work",
  "work_description": "The truck bed has been restored with new wood paneling and paint.",
  "components": ["truck_bed"],
  "confidence": 0.77
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `body_work` |
| `detected_work_description` | `The truck bed has been restored with new wood paneling and paint.` |
| `detected_components` | `{truck_bed}` |
| `overall_confidence` | `0.77` |

### **Stage 2 Details**
- Wood type, condition
- Bed liner material
- Paint on bed
- Hardware (bolts, strips)

---

## Example 4: Disassembled Body Parts

### **AI Analysis**
```json
{
  "work_type": "body_work",
  "work_description": "Disassembled vehicle parts are organized for body repair or replacement.",
  "components": ["license_plate_frame", "reflectors", "mirrors"],
  "confidence": 0.90
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `body_work` |
| `detected_work_description` | `Disassembled vehicle parts are organized for body repair or replacement.` |
| `detected_components` | `{license_plate_frame,reflectors,mirrors}` |
| `overall_confidence` | `0.90` |

### **Stage 2 Would Extract**
- Each part's condition
- Part numbers (if visible)
- Brand/manufacturer
- Damage assessment per part

---

## Example 5: Engine Work

### **AI Analysis**
```json
{
  "work_type": "engine",
  "work_description": "Engine work is visible with a focus on the engine components.",
  "components": ["engine"],
  "confidence": 0.85
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `engine` |
| `detected_work_description` | `Engine work is visible with a focus on the engine components.` |
| `detected_components` | `{engine}` |
| `overall_confidence` | `0.85` |

### **Stage 2 Detailed Extraction**
- Specific engine parts (carburetor, alternator, distributor)
- Engine condition, leaks, wear
- Aftermarket modifications
- Brand names visible

---

## Example 6: Suspension Work

### **AI Analysis**
```json
{
  "work_type": "suspension",
  "work_description": "Suspension and exhaust system inspection or repair visible on vehicle lift.",
  "components": ["suspension", "exhaust"],
  "confidence": 0.77
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `suspension` |
| `detected_work_description` | `Suspension and exhaust system inspection or repair visible on vehicle lift.` |
| `detected_components` | `{suspension,exhaust}` |
| `overall_confidence` | `0.77` |

### **Stage 2 Details**
- Shock absorber condition
- Spring type, condition
- Exhaust routing, condition
- Lift kit details (if aftermarket)

---

## Example 7: Paint with Protective Covering

### **AI Analysis**
```json
{
  "work_type": "paint",
  "work_description": "Body paint work on a vehicle, possibly involving protective covering.",
  "components": ["body"],
  "confidence": 0.93
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `Body paint work on a vehicle, possibly involving protective covering.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.93` |

---

## Example 8: Fresh Paint Job

### **AI Analysis**
```json
{
  "work_type": "paint",
  "work_description": "The vehicle appears to have a fresh paint job with a glossy finish.",
  "components": ["body"],
  "confidence": 0.90
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `The vehicle appears to have a fresh paint job with a glossy finish.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.90` |

---

## Example 9: Blue Paint Job

### **AI Analysis**
```json
{
  "work_type": "paint",
  "work_description": "The vehicle appears to have undergone a fresh paint job, with a shiny blue finish.",
  "components": ["body"],
  "confidence": 0.90
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `The vehicle appears to have undergone a fresh paint job, with a shiny blue finish.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.90` |

---

## Example 10: No Visible Work

### **AI Analysis**
```json
{
  "work_type": "other",
  "work_description": "No visible work being performed on the vehicle.",
  "components": [],
  "confidence": 0.90
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `other` |
| `detected_work_description` | `No visible work being performed on the vehicle.` |
| `detected_components` | `{}` |
| `overall_confidence` | `0.90` |

---

## Data Flow Diagram

```
IMAGE UPLOADED
    ↓
┌─────────────────────────────────────┐
│  vehicle_images table               │
│  - image_url                        │
│  - vehicle_id                       │
│  - ai_processing_status = 'pending' │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│  Stage 1: intelligent-work-detector │
│  - Analyzes image with GPT-4o       │
│  - Extracts: work_type, description, │
│    components, confidence            │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│  image_work_extractions table       │
│  - detected_work_type               │
│  - detected_work_description        │
│  - detected_components[]             │
│  - overall_confidence               │
│  - ai_analysis (full JSON)           │
│  - status = 'extracted'             │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│  Stage 2: detailed-component-extract│
│  - Analyzes same image in detail    │
│  - Extracts: specific parts,         │
│    conditions, brands, materials    │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│  ai_component_detections table      │
│  - component_name                   │
│  - component_category               │
│  - confidence_score                 │
│  - condition, brand, material       │
│  - ai_reasoning                     │
└─────────────────────────────────────┘
```

---

## Table Schema Reference

### **`image_work_extractions` Table**
Stores Stage 1 (basic work detection) results:

```sql
CREATE TABLE image_work_extractions (
  id UUID PRIMARY KEY,
  image_id UUID REFERENCES vehicle_images(id),
  vehicle_id UUID REFERENCES vehicles(id),
  
  -- Stage 1 Results
  detected_work_type TEXT,              -- 'paint', 'upholstery', 'engine', etc.
  detected_work_description TEXT,       -- Full description from AI
  detected_components TEXT[],            -- ['body', 'fender', 'seats']
  detected_date DATE,                    -- When work was done
  detected_location_address TEXT,        -- Where work was done
  
  -- Confidence Scores
  work_type_confidence NUMERIC(3,2),     -- 0.0-1.0
  date_confidence NUMERIC(3,2),
  location_confidence NUMERIC(3,2),
  overall_confidence NUMERIC(3,2),        -- Combined score
  
  -- AI Metadata
  ai_analysis JSONB,                    -- Full AI response
  ai_model TEXT,                         -- 'gpt-4o'
  extraction_method TEXT,                -- 'ai_vision'
  
  -- Status
  status TEXT,                           -- 'extracted', 'detailed_extracted'
  processing_stage TEXT,                 -- 'stage1_basic', 'stage2_detailed'
  processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **`ai_component_detections` Table**
Stores Stage 2 (detailed component extraction) results:

```sql
CREATE TABLE ai_component_detections (
  id UUID PRIMARY KEY,
  vehicle_image_id UUID REFERENCES vehicle_images(id),
  
  -- Component Info
  component_name VARCHAR(255),           -- 'brake caliper', 'fender', 'seat'
  component_category VARCHAR(100),       -- 'braking', 'body', 'interior'
  
  -- AI Analysis
  confidence_score DECIMAL(3,2),         -- 0.0-1.0
  ai_reasoning TEXT,                     -- Full explanation
  ai_model VARCHAR(50),                  -- 'gpt-4o'
  
  -- Location
  quadrant VARCHAR(20),                 -- 'front_left', 'driver_side'
  bounding_box JSONB,                    -- Pixel coordinates (future)
  
  -- Quality Control
  human_verified BOOLEAN DEFAULT FALSE,
  false_positive BOOLEAN DEFAULT FALSE,
  
  detection_timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Real Query Examples

### **Get All Work Extractions for a Vehicle**
```sql
SELECT 
  vi.image_url,
  iwe.detected_work_type,
  iwe.detected_work_description,
  iwe.detected_components,
  iwe.overall_confidence
FROM image_work_extractions iwe
JOIN vehicle_images vi ON vi.id = iwe.image_id
WHERE iwe.vehicle_id = '83f6f033-a3c3-4cf4-a85e-a60d2c588838'
ORDER BY iwe.created_at DESC;
```

### **Get All Components Detected in an Image**
```sql
SELECT 
  component_name,
  component_category,
  confidence_score,
  ai_reasoning
FROM ai_component_detections
WHERE vehicle_image_id = '71b45687-17a2-47a8-9669-e5ad021f7354'
ORDER BY confidence_score DESC;
```

### **Get Complete Pipeline Status**
```sql
SELECT * FROM processing_pipeline_status
WHERE vehicle_id = '83f6f033-a3c3-4cf4-a85e-a60d2c588838'
ORDER BY image_id;
```

---

## Summary

1. **Image Uploaded** → Stored in `vehicle_images`
2. **Stage 1 Processing** → AI extracts work type, description, components → Stored in `image_work_extractions`
3. **Stage 2 Processing** → AI extracts detailed parts, conditions, brands → Stored in `ai_component_detections`
4. **Data is Queryable** → All tables linked by `image_id` and `vehicle_id`

Each stage builds on the previous, extracting more detailed and useful data that flows into structured database tables.

