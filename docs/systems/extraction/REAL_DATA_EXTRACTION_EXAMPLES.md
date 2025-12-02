# 10 Real Examples: How Images Become Database Records

## Complete Data Flow: Image → AI Analysis → Database Tables

---

## Example 1: Body Work on 1974 Chevrolet

### **Source Image**
- **Image ID**: `60e87ded-e8b5-4874-9273-2250e72e870d`
- **Vehicle**: 1974 Chevrolet
- **Image URL**: `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/.../1bdde069-4c28-4ea7-b686-5cf77f224458.jpeg`

### **AI Raw Response** (from `ai_analysis` JSONB column)
```json
{
  "work_type": "body_work",
  "work_description": "Body repair work is being performed on the vehicle's rear panel, with visible sanding and rust treatment.",
  "components": ["rear_panel"],
  "date_clues": "No visible date clues",
  "location_clues": "Outdoor environment with no specific location indicators",
  "confidence": 0.95
}
```

### **Stored in `image_work_extractions` Table**
| Column | Value |
|--------|-------|
| `id` | `uuid` (auto-generated) |
| `image_id` | `60e87ded-e8b5-4874-9273-2250e72e870d` |
| `vehicle_id` | `05f27cc4-914e-425a-8ed8-cfea35c1928d` |
| `detected_work_type` | `body_work` |
| `detected_work_description` | `Body repair work is being performed on the vehicle's rear panel, with visible sanding and rust treatment.` |
| `detected_components` | `{rear_panel}` (PostgreSQL array) |
| `overall_confidence` | `0.93` |
| `work_type_confidence` | `0.95` |
| `status` | `extracted` |
| `ai_analysis` | `{full JSON response from OpenAI}` |
| `created_at` | `2025-11-25 01:24:19.458608+00` |

---

## Example 2: Paint Work on 1983 GMC C1500

### **Source Image**
- **Image ID**: `ab4be392-977d-4ae5-8abf-e0cd5d2f1f72`
- **Vehicle**: 1983 GMC C1500

### **AI Raw Response**
```json
{
  "work_type": "paint",
  "work_description": "Body paint work visible on the vehicle's side panel.",
  "components": ["body"],
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `Body paint work visible on the vehicle's side panel.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.93` |

---

## Example 3: Custom Paint on 1932 Ford Roadster

### **Source Image**
- **Image ID**: `6c5f8067-b57e-4948-b508-b30e8576d269`
- **Vehicle**: 1932 Ford Roadster

### **AI Raw Response**
```json
{
  "work_type": "paint",
  "work_description": "Custom paint work being applied to the vehicle's body panel.",
  "components": ["body"],
  "location_clues": "Shop environment visible",
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `Custom paint work being applied to the vehicle's body panel.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.85` |

---

## Example 4: Upholstery on 1974 Chevrolet Door Panels

### **Source Image**
- **Image ID**: `48f3184d-07d6-4e59-83a2-367ffb0edf84`
- **Vehicle**: 1974 Chevrolet

### **AI Raw Response**
```json
{
  "work_type": "upholstery",
  "work_description": "The door panel is being prepared for reupholstery, with old material stripped away.",
  "components": ["door_panels"],
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `upholstery` |
| `detected_work_description` | `The door panel is being prepared for reupholstery, with old material stripped away.` |
| `detected_components` | `{door_panels}` |
| `overall_confidence` | `0.93` |

---

## Example 5: Fresh Blue Paint on 1983 GMC C1500

### **Source Image**
- **Image ID**: `87385624-8fc3-4179-9f38-cb95b2c0dd3e`
- **Vehicle**: 1983 GMC C1500

### **AI Raw Response**
```json
{
  "work_type": "paint",
  "work_description": "The vehicle's rear body appears to have been freshly painted in a light blue color.",
  "components": ["body"],
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `The vehicle's rear body appears to have been freshly painted in a light blue color.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.93` |

---

## Example 6: Front Bumper Installation on 1973 Volkswagen Thing

### **Source Image**
- **Image ID**: `f9fc57d7-f7b7-4fdb-a729-3ea86f7820ed`
- **Vehicle**: 1973 Volkswagen Thing

### **AI Raw Response**
```json
{
  "work_type": "body_work",
  "work_description": "Front bumper installation or adjustment on a vehicle.",
  "components": ["bumper", "headlight"],
  "location_clues": "Shop environment visible",
  "confidence": 0.9
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `body_work` |
| `detected_work_description` | `Front bumper installation or adjustment on a vehicle.` |
| `detected_components` | `{bumper,headlight}` |
| `overall_confidence` | `0.82` |

---

## Example 7: Rust Repair on 1974 Chevrolet

### **Source Image**
- **Image ID**: `cada7649-b1e5-46e9-b10e-b775d1c361fd`
- **Vehicle**: 1974 Chevrolet

### **AI Raw Response**
```json
{
  "work_type": "body_work",
  "work_description": "Rust repair and panel preparation for bodywork.",
  "components": ["body", "fender"],
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `body_work` |
| `detected_work_description` | `Rust repair and panel preparation for bodywork.` |
| `detected_components` | `{body,fender}` |
| `overall_confidence` | `0.93` |

---

## Example 8: Primer Coat on 1983 GMC C1500

### **Source Image**
- **Image ID**: `3cdf46d4-2e50-4044-b980-221f9a792398`
- **Vehicle**: 1983 GMC C1500

### **AI Raw Response**
```json
{
  "work_type": "paint",
  "work_description": "The vehicle appears to have a primer coat applied, indicating preparation for painting.",
  "components": ["body"],
  "location_clues": "Residential area visible",
  "confidence": 0.9
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `paint` |
| `detected_work_description` | `The vehicle appears to have a primer coat applied, indicating preparation for painting.` |
| `detected_components` | `{body}` |
| `overall_confidence` | `0.82` |

---

## Example 9: Seat Reupholstery on 1932 Ford Roadster

### **Source Image**
- **Image ID**: `67d8bf02-175d-4cbe-9b33-6c43bc46c094`
- **Vehicle**: 1932 Ford Roadster

### **AI Raw Response**
```json
{
  "work_type": "upholstery",
  "work_description": "Interior work focusing on seat reupholstery and door panel installation.",
  "components": ["seats", "door_panels"],
  "location_clues": "Shop environment visible",
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `upholstery` |
| `detected_work_description` | `Interior work focusing on seat reupholstery and door panel installation.` |
| `detected_components` | `{seats,door_panels}` |
| `overall_confidence` | `0.85` |

---

## Example 10: Interior Reupholstery on 1974 Chevrolet

### **Source Image**
- **Image ID**: `d853aba7-44a1-4b9f-bd7f-d336724cd2e0`
- **Vehicle**: 1974 Chevrolet

### **AI Raw Response**
```json
{
  "work_type": "upholstery",
  "work_description": "Interior reupholstery work is being performed, focusing on seats and door panels.",
  "components": ["seats", "door_panels"],
  "confidence": 0.95
}
```

### **Stored in Database**
| Column | Value |
|--------|-------|
| `detected_work_type` | `upholstery` |
| `detected_work_description` | `Interior reupholstery work is being performed, focusing on seats and door panels.` |
| `detected_components` | `{seats,door_panels}` |
| `overall_confidence` | `0.93` |

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: IMAGE UPLOADED                                      │
│                                                             │
│ vehicle_images table:                                       │
│ - id: 60e87ded-e8b5-4874-9273-2250e72e870d                 │
│ - vehicle_id: 05f27cc4-914e-425a-8ed8-cfea35c1928d        │
│ - image_url: https://.../1bdde069-4c28-4ea7-b686-...jpeg  │
│ - ai_processing_status: 'pending'                          │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: AI ANALYSIS (intelligent-work-detector)            │
│                                                             │
│ OpenAI GPT-4o Vision API called with:                       │
│ - Image URL                                                 │
│ - Prompt: "Analyze this vehicle work photo..."             │
│                                                             │
│ AI Returns JSON:                                            │
│ {                                                           │
│   "work_type": "body_work",                                │
│   "work_description": "Body repair work...",               │
│   "components": ["rear_panel"],                            │
│   "confidence": 0.95                                        │
│ }                                                           │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: DATA STORED IN image_work_extractions              │
│                                                             │
│ INSERT INTO image_work_extractions:                         │
│ - image_id: 60e87ded-e8b5-4874-9273-2250e72e870d          │
│ - vehicle_id: 05f27cc4-914e-425a-8ed8-cfea35c1928d        │
│ - detected_work_type: 'body_work'                          │
│ - detected_work_description: 'Body repair work...'        │
│ - detected_components: ARRAY['rear_panel']                │
│ - overall_confidence: 0.93                                │
│ - ai_analysis: '{full JSON response}'                      │
│ - status: 'extracted'                                      │
│ - created_at: 2025-11-25 01:24:19                         │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: STAGE 2 PROCESSING (detailed-component-extractor)  │
│                                                             │
│ Same image analyzed again with more detailed prompt:        │
│ - Extract ALL visible components                            │
│ - Condition of each part                                    │
│ - Brands, materials, locations                              │
│                                                             │
│ AI Returns Array:                                           │
│ [                                                           │
│   {                                                         │
│     "component_name": "rear_panel",                        │
│     "component_category": "body",                          │
│     "condition": "fair",                                    │
│     "condition_details": "Rust treatment visible",         │
│     "confidence": 0.95                                     │
│   }                                                         │
│ ]                                                           │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: DATA STORED IN ai_component_detections             │
│                                                             │
│ INSERT INTO ai_component_detections (for each component):   │
│ - vehicle_image_id: 60e87ded-e8b5-4874-9273-2250e72e870d  │
│ - component_name: 'rear_panel'                             │
│ - component_category: 'body'                               │
│ - confidence_score: 0.95                                   │
│ - ai_reasoning: 'Condition: fair. Rust treatment...'      │
│ - detection_timestamp: 2025-11-25 01:25:00                │
└─────────────────────────────────────────────────────────────┘
```

---

## SQL Queries to See the Data

### **View All Work Extractions**
```sql
SELECT 
  vi.image_url,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  iwe.detected_work_type,
  iwe.detected_work_description,
  iwe.detected_components,
  iwe.overall_confidence,
  iwe.created_at
FROM image_work_extractions iwe
JOIN vehicle_images vi ON vi.id = iwe.image_id
JOIN vehicles v ON v.id = iwe.vehicle_id
ORDER BY iwe.created_at DESC;
```

### **View Components Extracted (Stage 2)**
```sql
SELECT 
  vi.image_url,
  acd.component_name,
  acd.component_category,
  acd.confidence_score,
  acd.ai_reasoning
FROM ai_component_detections acd
JOIN vehicle_images vi ON vi.id = acd.vehicle_image_id
ORDER BY acd.detection_timestamp DESC;
```

### **Complete Pipeline View**
```sql
SELECT * FROM processing_pipeline_status
WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
ORDER BY image_id;
```

---

## Summary

**10 Real Examples Shown:**
1. Body work on rear panel (1974 Chevrolet)
2. Paint work on side panel (1983 GMC C1500)
3. Custom paint work (1932 Ford Roadster)
4. Door panel reupholstery (1974 Chevrolet)
5. Fresh blue paint (1983 GMC C1500)
6. Front bumper installation (1973 Volkswagen Thing)
7. Rust repair (1974 Chevrolet)
8. Primer coat (1983 GMC C1500)
9. Seat reupholstery (1932 Ford Roadster)
10. Interior reupholstery (1974 Chevrolet)

**Each Example Shows:**
- ✅ Source image reference
- ✅ Raw AI response (JSON)
- ✅ How data is stored in `image_work_extractions` table
- ✅ Complete data flow from image → AI → database

**Tables Filled:**
- `image_work_extractions` - Stage 1 (work type, description, components)
- `ai_component_detections` - Stage 2 (detailed parts, conditions, brands)

All data is **real** and **queryable** in your database right now.

