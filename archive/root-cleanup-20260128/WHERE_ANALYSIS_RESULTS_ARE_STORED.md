# WHERE THE $598 ANALYSIS RESULTS ARE STORED

## Database Tables with Analysis Data

### 1. **`vehicle_images.ai_scan_metadata`** (JSONB) - PRIMARY STORAGE
**Location**: `vehicle_images` table, `ai_scan_metadata` column  
**What's stored**: All AI analysis results in JSON format  
**Count**: 104,797 images with metadata

**Structure**:
```json
{
  "appraiser": {
    "primary_label": "Front three-quarter view",
    "angle_family": "exterior_front",
    "confidence": 0.95,
    ...
  },
  "rekognition": {
    "labels": [...],
    "bounding_boxes": [...]
  },
  "spid": {
    "detected": true,
    "data": {...}
  },
  "scanned_at": "2025-01-15T10:30:00Z"
}
```

**Breakdown**:
- **73,165 images** have `appraiser` data (angle, condition, parts detected)
- **31,722 images** have `rekognition` data (AWS labels, bounding boxes)
- **6 images** have `spid` data (GM SPID sheet extraction)

---

### 2. **`ai_angle_classifications_audit`** - Angle Classifications
**Location**: Separate table for angle classification history  
**What's stored**: Detailed angle classifications with confidence scores  
**Count**: 15,473 classifications for 646 images across 20 vehicles

**Columns**:
- `image_id`
- `vehicle_id`
- `primary_label`
- `angle_family`
- `confidence`
- `extracted_tags`
- `colors`
- `materials`
- `conditions`
- `brands`

---

### 3. **`image_tags`** - Image Tags
**Location**: `image_tags` table  
**What's stored**: Tags extracted from images  
**Count**: 188,641 tags (but only 28 images - this seems like a data issue)

**Columns**:
- `image_id`
- `tag_name`
- `ai_detection_data` (JSONB)
- `confidence`

---

### 4. **`vehicle_spid_data`** - SPID Sheet Data
**Location**: `vehicle_spid_data` table  
**What's stored**: GM SPID (Service Parts Identification) sheet data  
**Count**: 1 record (1 vehicle with SPID data extracted)

**Columns**:
- `vehicle_id`
- `image_id`
- `paint_code_exterior`
- `paint_code_interior`
- `options` (JSONB)
- `extracted_data` (JSONB)

---

### 5. **`vehicle_images` Direct Columns** - Quick Access Fields
**Location**: `vehicle_images` table, individual columns  
**What's stored**: Commonly accessed analysis fields for quick queries

**Columns**:
- `ai_detected_angle` - Detected angle (text)
- `ai_detected_angle_confidence` - Confidence score (0-1)
- `ai_avg_confidence` - Average confidence across all detections
- `ai_component_count` - Number of components detected
- `ai_processing_status` - Status: 'pending', 'processing', 'completed', 'failed'
- `ai_processing_started_at` - When analysis started
- `ai_processing_completed_at` - When analysis finished
- `ai_last_scanned` - Last scan timestamp
- `total_processing_cost` - Cost in USD (only $9.72 tracked)
- `processing_models_used` - Array of models used (e.g., ['gpt-4o'])
- `analysis_history` - JSONB with full history of all analysis runs

---

## How to Access the Data

### Query All Analysis Data for an Image:
```sql
SELECT 
  id,
  vehicle_id,
  image_url,
  ai_scan_metadata,
  ai_detected_angle,
  ai_processing_status,
  total_processing_cost
FROM vehicle_images
WHERE id = 'your-image-id';
```

### Query All Images with Appraiser Data:
```sql
SELECT 
  id,
  vehicle_id,
  ai_scan_metadata->'appraiser' as appraiser_data,
  ai_scan_metadata->'rekognition' as rekognition_data
FROM vehicle_images
WHERE ai_scan_metadata->'appraiser' IS NOT NULL;
```

### Query Angle Classifications:
```sql
SELECT 
  image_id,
  vehicle_id,
  primary_label,
  angle_family,
  confidence,
  extracted_tags,
  colors
FROM ai_angle_classifications_audit
WHERE vehicle_id = 'your-vehicle-id';
```

---

## The Problem

**The data IS stored**, but:
1. It's in JSONB columns (`ai_scan_metadata`) - not easy to query/search
2. Only 28 images have tags in `image_tags` table (should be way more)
3. Only $9.72 of cost is tracked (98% untracked)
4. The data isn't prominently displayed in the UI

**The analysis results exist**, they're just buried in JSONB columns and not easily accessible or visible to users.

