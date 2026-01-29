# AI Extraction Data Flow - Where Your Brochure Data Goes

## Complete Pipeline

```
YOU UPLOAD 1973/1974 GMC BROCHURE
          ↓
┌─────────────────────────────────────────┐
│  library_documents                      │
│  - Stores PDF/images                    │
│  - Attributes to you                    │
│  - Links to library                     │
└──────────────┬──────────────────────────┘
               │ triggers AI
               ▼
┌─────────────────────────────────────────┐
│  Edge Function: parse-reference-document│
│  - GPT-4o Vision analyzes each page     │
│  - Extracts specs, colors, RPO codes    │
│  - Generates validation questions       │
└──────────────┬──────────────────────────┘
               │ stores in
               ▼
┌─────────────────────────────────────────┐
│  document_extractions (TEMP STORAGE)    │
│  - Raw AI extraction as JSONB           │
│  - Status: 'pending_review'             │
│  - Validation questions                 │
│  - Waits for your approval              │
└──────────────┬──────────────────────────┘
               │ you review & approve
               ▼
┌─────────────────────────────────────────┐
│  apply_extraction_to_specs()            │
│  - Applies data to multiple tables      │
│  - Creates proof links                  │
│  - Updates confidence scores            │
└──────────────┬──────────────────────────┘
               │ populates
               ▼
         ┌─────┴─────┬─────────────┬──────────────┐
         ▼           ▼             ▼              ▼
┌────────────┐ ┌──────────┐ ┌─────────────┐ ┌─────────────┐
│oem_vehicle │ │extracted │ │extracted    │ │spec_field   │
│_specs      │ │_paint    │ │_rpo_codes   │ │_proofs      │
│            │ │_colors   │ │             │ │             │
│Main specs  │ │Color DB  │ │Options DB   │ │Proof links  │
└────────────┘ └──────────┘ └─────────────┘ └─────────────┘
```

---

## From Your 1974 GMC Brochure - Example

### Page: "GMC Power Trains" (Engine Spec Table)

**AI Extracts**:
```json
{
  "specifications": {
    "engines": [
      {
        "code": "IN-LINE 6",
        "displacement_cid": 250,
        "horsepower": 100,
        "rpm_hp": "3600",
        "torque": 175,
        "rpm_torque": "1600",
        "bore_stroke": "3.87 x 3.53",
        "compression_ratio": "8.25"
      },
      {
        "code": "INVADER V-8",
        "displacement_cid": 307,
        "horsepower": 115,
        "rpm_hp": "3600",
        "torque": 205,
        "rpm_torque": "2000",
        "bore_stroke": "3.87 x 3.25",
        "compression_ratio": "8.50"
      },
      {
        "code": "INVADER V-8",
        "displacement_cid": 350,
        "horsepower": 155,
        "rpm_hp": "4000",
        "torque": 255,
        "rpm_torque": "2800",
        "bore_stroke": "4.0 x 3.48",
        "compression_ratio": "8.50"
      }
    ]
  }
}
```

**Stores in**:
```sql
-- 1. document_extractions (temp review)
INSERT INTO document_extractions (document_id, extracted_data, status)
VALUES ('[doc-id]', [full JSON above], 'pending_review');

-- 2. After approval, goes to oem_vehicle_specs
UPDATE oem_vehicle_specs
SET 
  engine_size = '350 CID V8',
  horsepower = 155,
  torque_ft_lbs = 255,
  engine_config = 'V8',
  source_documents = array_append(source_documents, '[doc-id]'),
  confidence_score = 95
WHERE make = 'GMC' AND series = 'K15' AND year_start = 1974;

-- 3. Creates proof for each field
INSERT INTO spec_field_proofs (spec_id, document_id, field_name, field_value, page_number, excerpt_text, confidence)
VALUES 
  ('[spec-id]', '[doc-id]', 'horsepower', '155', 10, 'INVADER V-8: 155 @ 4000 RPM', 95),
  ('[spec-id]', '[doc-id]', 'torque', '255', 10, 'NET SAE TORQUE: 255 @ 2800 RPM', 95),
  ('[spec-id]', '[doc-id]', 'bore_stroke', '4.0 x 3.48', 10, 'BORE & STROKE: 4.0 x 3.48', 95);
```

### Page: "1973 BLAZER SPECIFICATIONS" (Color Chart)

**AI Extracts**:
```json
{
  "colors": [
    {"code": "SKL", "name": "Skyline Blue", "color_family": "blue"},
    {"code": "CSG", "name": "Cosmoline Green", "color_family": "green"},
    {"code": "FW", "name": "Frost White", "color_family": "white"},
    {"code": "HWB", "name": "Hawaiian Blue", "color_family": "blue"},
    {"code": "SPG", "name": "Sport Green", "color_family": "green"},
    {"code": "SG", "name": "Spanish Gold", "color_family": "gold"},
    {"code": "CMR", "name": "Cinnamon Red", "color_family": "red"},
    {"code": "RCM", "name": "Russet Chestnut Metallic", "color_family": "brown", "is_metallic": true}
  ]
}
```

**Stores in**:
```sql
-- extracted_paint_colors table
INSERT INTO extracted_paint_colors (extraction_id, document_id, year, make, series, color_code, color_name, color_family, is_metallic)
VALUES 
  ('[ext-id]', '[doc-id]', 1973, 'Chevrolet', 'K5', 'SKL', 'Skyline Blue', 'blue', false),
  ('[ext-id]', '[doc-id]', 1973, 'Chevrolet', 'K5', 'RCM', 'Russet Chestnut Metallic', 'brown', true),
  -- ... all colors
```

### Page: Interior Trim Levels

**AI Extracts**:
```json
{
  "trim_levels": [
    {
      "name": "Sierra Grande",
      "code": "YE9",
      "features": [
        "Herringbone nylon cloth and vinyl trim",
        "Deep foam cushion",
        "Full-gauge instrument panel",
        "Padded armrests",
        "Color-keyed carpeting"
      ]
    },
    {
      "name": "Sierra",
      "code": "Z84",
      "features": [
        "All-vinyl seat trim",
        "Deep foam cushion",
        "Door trim panels",
        "Chrome front bumper"
      ]
    }
  ]
}
```

**Stores in**:
```sql
-- Updates oem_vehicle_specs with available trims
UPDATE oem_vehicle_specs
SET notes = jsonb_set(
  COALESCE(notes::jsonb, '{}'::jsonb),
  '{available_trims}',
  '["Sierra Grande (YE9)", "Sierra (Z84)", "Super-Custom (Z62)", "Custom"]'::jsonb
)
WHERE year_start = 1974 AND make = 'GMC';
```

---

## Tables Data Lands In

### 1. `document_extractions` (Staging/Review)
**Purpose**: Temporary storage for AI extraction before approval
**Lifecycle**: Created → Reviewed → Approved → Applied → Archived
```
Column              | What It Stores
--------------------|------------------------------------------
extracted_data      | Full JSON from GPT-4 (everything)
validation_questions| AI-generated clarifications
user_corrections    | Your edits/confirmations
status              | pending_review → approved → applied
```

### 2. `oem_vehicle_specs` (Permanent Specs)
**Purpose**: Canonical source of factory specifications
**Updated by**: Approved extractions
```
Column              | Example from Your Brochure
--------------------|------------------------------------------
engine_size         | "350 CID V8"
horsepower          | 155 (from engine table)
torque_ft_lbs       | 255 (from engine table)
wheelbase_inches    | 106.5 (from dimensions)
curb_weight_lbs     | [extracted from specs]
source_documents[]  | [your-brochure-id]
confidence_score    | 95 (factory verified)
```

### 3. `extracted_paint_colors` (Color Database)
**Purpose**: Every factory color ever offered
**Queryable**: Find available colors for any YMM
```
Row Example from Your Brochure:
year: 1973
make: Chevrolet
series: K5
color_code: "70"
color_name: "Cardinal Red"
color_family: "red"
is_verified: true
```

### 4. `extracted_rpo_codes` (Options Database)
**Purpose**: Every RPO code and what it means
**Queryable**: Validate user's RPO codes
```
Row Example:
year: 1973
series: K5
rpo_code: "YE9"
description: "Cheyenne Super / Silverado Trim Package"
category: "interior"
is_verified: true
```

### 5. `spec_field_proofs` (Proof System)
**Purpose**: Link each fact to its source page
**Enables**: Clickable "See brochure page 10" links
```
Row Example:
spec_id: [1974-gmc-k15-spec-id]
document_id: [your-brochure-id]
field_name: "horsepower"
field_value: "155"
page_number: 10
excerpt_text: "INVADER V-8: 155 @ 4000 RPM"
confidence: 95
```

---

## What Gets Extracted from Your Brochures

### ✅ From Spec Tables (Page with dimensions/engine tables)
- Wheelbase: 106.5" (2WD), various for 4WD
- Front Overhang, Rear Overhang, Ground Clearance
- Box Length, Width, Depth
- All engine options with HP/Torque/RPM
- Transmission types and gear ratios
- Axle ratios
- Tire sizes

### ✅ From Color Charts
- Standard Colors: Skyline Blue, Cosmoline Green, Frost White, etc.
- Color codes for each
- Metallic finishes noted
- Two-tone combinations

### ✅ From Options Pages
- Performance equipment checkboxes
- Appearance options
- Trailer towing equipment
- All RPO codes visible

### ✅ From Interior Pages
- Trim level names and codes (YE9, Z84, Z62)
- Seat materials (Herringbone nylon, all-vinyl, etc.)
- Color options per trim
- Feature lists per package

### ✅ From Emblems/Badges
- GMC shield variant (1974 design)
- Placement locations
- Chrome vs. painted options

---

## Accuracy Guarantee System

**Every extracted field has proof**:
```
User views 1974 GMC spec:
Horsepower: 155

Hovers → Tooltip shows:
"Source: 1974 GMC Trucks Brochure, Page 10
 Excerpt: 'INVADER V-8: 155 @ 4000 RPM'
 Confidence: 95%
 [View Page]"

Clicks → Opens brochure to exact page
```

---

## ✅ Backend Complete - Ready for Your Uploads!

**All Tables Created**:
- ✅ `document_extractions` - AI output staging
- ✅ `spec_field_proofs` - Proof linking
- ✅ `extracted_paint_colors` - Color database
- ✅ `extracted_rpo_codes` - Options database
- ✅ `oem_vehicle_specs` - Final specs (already existed, now cross-linked)

**Edge Function Deployed**:
- ✅ `parse-reference-document` - GPT-4o Vision extractor

**Next**: Upload your brochures at `/library` and AI will extract EVERYTHING from those detailed spec tables! 📊✨
