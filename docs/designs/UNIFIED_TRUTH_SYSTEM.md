# Unified Truth System - Self-Reinforcing Architecture

## The Problem with Separate Systems

**Currently**:
- `oem_vehicle_specs` table (specs database)
- `reference_libraries` table (documentation)
- `vehicle_nomenclature` table (naming)

**They don't talk to each other!**
❌ Upload brochure → Specs table doesn't update
❌ Add specs → No link to proof document
❌ Missing data → No suggestion of what doc to upload

---

## Unified Architecture: Tables That Build Each Other

```
┌─────────────────────────────────────────┐
│         REFERENCE LIBRARY               │
│         (Source Documents)              │
└────────────┬────────────────────────────┘
             │
             │ validates & populates
             ▼
┌─────────────────────────────────────────┐
│         OEM VEHICLE SPECS               │
│         (Extracted Facts)               │
└────────────┬────────────────────────────┘
             │
             │ auto-applies to
             ▼
┌─────────────────────────────────────────┐
│         VEHICLES                        │
│         (Individual Instances)          │
└─────────────────────────────────────────┘
```

---

## Redesigned Schema with Cross-Links

```sql
-- ============================================
-- 1. REFERENCE LIBRARY (Source Documents)
-- ============================================

CREATE TABLE reference_libraries (
  id UUID PRIMARY KEY,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  series TEXT,
  body_style TEXT,
  
  -- CROSS-REFERENCE to specs
  oem_spec_id UUID REFERENCES oem_vehicle_specs(id),  -- ← LINKED!
  
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_ymm UNIQUE (year, make, series, body_style)
);

CREATE TABLE library_documents (
  id UUID PRIMARY KEY,
  library_id UUID REFERENCES reference_libraries(id),
  
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  
  -- ATTRIBUTION
  uploaded_by UUID REFERENCES auth.users(id),
  uploader_org_id UUID REFERENCES businesses(id),
  
  -- EXTRACTED DATA (OCR/AI)
  extracted_specs JSONB,  -- ← Specs extracted from this doc
  extraction_confidence INTEGER,
  
  -- PROOF LINKING
  validates_fields TEXT[],  -- Which spec fields this doc proves
  
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. OEM SPECS (Extracted Facts)
-- ============================================

ALTER TABLE oem_vehicle_specs ADD COLUMN IF NOT EXISTS source_documents UUID[];
  -- ← Array of library_document IDs that prove these specs

ALTER TABLE oem_vehicle_specs ADD COLUMN IF NOT EXISTS verification_status TEXT;
  -- 'unverified', 'single_source', 'multi_source', 'factory_verified'

ALTER TABLE oem_vehicle_specs ADD COLUMN IF NOT EXISTS confidence_score INTEGER;
  -- Based on number and quality of source documents

-- ============================================
-- 3. CROSS-VALIDATION TABLE
-- ============================================

CREATE TABLE spec_document_validations (
  spec_id UUID REFERENCES oem_vehicle_specs(id) ON DELETE CASCADE,
  document_id UUID REFERENCES library_documents(id) ON DELETE CASCADE,
  
  -- WHAT this document validates
  validated_fields JSONB,  -- {"horsepower": 165, "torque": 255, "weight": 4400}
  
  -- HOW it validates
  page_number INTEGER,     -- Where in the doc
  excerpt_text TEXT,       -- Actual text from document
  confidence INTEGER,      -- How confident the extraction is
  
  -- WHO verified
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP,
  
  PRIMARY KEY (spec_id, document_id)
);

-- ============================================
-- 4. FEEDBACK LOOP FUNCTIONS
-- ============================================

-- When document is uploaded, extract and validate specs
CREATE OR REPLACE FUNCTION process_uploaded_document()
RETURNS TRIGGER AS $$
DECLARE
  v_library RECORD;
  v_spec_id UUID;
BEGIN
  -- Get library info
  SELECT * INTO v_library
  FROM reference_libraries
  WHERE id = NEW.library_id;
  
  -- Find corresponding OEM spec entry
  SELECT id INTO v_spec_id
  FROM oem_vehicle_specs
  WHERE make ILIKE v_library.make
    AND year_start <= v_library.year
    AND (year_end IS NULL OR year_end >= v_library.year)
    AND (series = v_library.series OR series IS NULL)
  LIMIT 1;
  
  -- Link library to spec
  IF v_spec_id IS NOT NULL THEN
    UPDATE reference_libraries
    SET oem_spec_id = v_spec_id
    WHERE id = NEW.library_id;
    
    -- Add this doc as source for the spec
    UPDATE oem_vehicle_specs
    SET source_documents = array_append(
      COALESCE(source_documents, ARRAY[]::UUID[]),
      NEW.id
    )
    WHERE id = v_spec_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_process_doc
  AFTER INSERT ON library_documents
  FOR EACH ROW
  EXECUTE FUNCTION process_uploaded_document();

-- When specs are updated, check against library docs
CREATE OR REPLACE FUNCTION validate_spec_update()
RETURNS TRIGGER AS $$
DECLARE
  v_doc_count INTEGER;
BEGIN
  -- Count how many documents support this spec
  SELECT COUNT(*) INTO v_doc_count
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  WHERE rl.oem_spec_id = NEW.id;
  
  -- Update verification status
  IF v_doc_count = 0 THEN
    NEW.verification_status := 'unverified';
    NEW.confidence_score := 30;
  ELSIF v_doc_count = 1 THEN
    NEW.verification_status := 'single_source';
    NEW.confidence_score := 70;
  ELSIF v_doc_count >= 2 THEN
    NEW.verification_status := 'multi_source';
    NEW.confidence_score := 95;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_specs
  BEFORE INSERT OR UPDATE ON oem_vehicle_specs
  FOR EACH ROW
  EXECUTE FUNCTION validate_spec_update();
```

---

## Self-Reinforcing Examples

### Example 1: You Upload 1973 Brochure

```
1. Upload brochure PDF
   ↓
2. System OCRs: "165 HP, 255 ft-lbs torque, 4400 lbs"
   ↓
3. Finds oem_vehicle_specs for 1973 K5
   ↓
4. Compares extracted vs stored:
   - Stored: 165 HP ✓ (matches)
   - Stored: 255 torque ✓ (matches)
   - Stored: NULL weight ✗ (missing)
   ↓
5. AUTO-UPDATE specs table:
   UPDATE oem_vehicle_specs
   SET weight_lbs = 4400,
       source_documents = array_append(source_documents, [brochure-id]),
       verification_status = 'factory_verified',
       confidence_score = 95
   ↓
6. Now every 1973 K5 has verified weight spec!
```

### Example 2: Someone Adds Wrong Data

```
User adds 1973 K5 Blazer:
- Enters "V6" for engine

System checks:
1. Query oem_vehicle_specs for 1973 K5
2. Finds: engine_config = 'V8'
3. Checks source: library_documents → "1973 Brochure, page 12"
4. Warns user:
   "Factory spec: V8 only
    Your entry: V6
    Source: 1973 Chevrolet Trucks Brochure
    This indicates modification or error"
5. Links to actual brochure page as proof
```

### Example 3: Missing Data Suggestions

```
oem_vehicle_specs for 1973 K5:
- paint_codes: NULL ← Missing data

System checks library:
- No paint code chart uploaded

Suggests to contributors:
"📊 1973 Chevrolet K5 library is 85% complete
 Missing:
 - Paint code chart
 - Interior trim codes
 - Option package details
 
 Upload these to help 2 vehicles"
```

---

## Bidirectional Flow

### Library → Specs → Vehicles
```
Upload brochure
  ↓
Extract specs (OCR/AI)
  ↓
Populate oem_vehicle_specs
  ↓
Auto-apply to vehicles
  ↓
Validate user input
```

### Vehicles → Specs → Library
```
Many users enter same spec
  ↓
Pattern emerges in oem_vehicle_specs
  ↓
System suggests: "Upload factory doc to verify"
  ↓
You upload proof
  ↓
Confidence score increases
```

---

## Updated Schema

```sql
-- Link specs to their proof documents
ALTER TABLE oem_vehicle_specs 
  ADD COLUMN source_documents UUID[],  -- Array of library_document IDs
  ADD COLUMN verification_status TEXT,
  ADD COLUMN confidence_score INTEGER;

-- Link libraries to their spec entries
ALTER TABLE reference_libraries
  ADD COLUMN oem_spec_id UUID REFERENCES oem_vehicle_specs(id);

-- Track which fields each document validates
CREATE TABLE spec_document_validations (
  spec_id UUID REFERENCES oem_vehicle_specs(id),
  document_id UUID REFERENCES library_documents(id),
  validated_fields JSONB,    -- What this doc proves
  page_number INTEGER,       -- Where in doc
  extraction_method TEXT,    -- 'ocr', 'manual', 'ai'
  confidence INTEGER,
  PRIMARY KEY (spec_id, document_id)
);
```

---

**This creates a self-reinforcing truth system where**:
- Documents validate specs
- Specs validate user input  
- Gaps suggest what docs to upload
- Everything stays accurate and provable

Ready to implement this unified approach? 🎯
