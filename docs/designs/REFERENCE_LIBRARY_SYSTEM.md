# Reference Library System - Design Concept

## Problem Statement

You have factory documentation (brochures, manuals, spec sheets) like:
- "1973 CHEVROLET TRUCKS Blazer" brochure
- Owner's manuals
- Factory spec sheets
- RPO code lists
- Paint code charts

**Need**: Central repository organized by Year/Make/Model where:
- Users can upload/access reference materials
- Documents are shared across all matching vehicles
- Accessible from each vehicle profile
- Community-curated knowledge base

---

## Entity Relationship Diagram

```
┌─────────────────────────┐
│  reference_libraries    │
├─────────────────────────┤
│ id (PK)                 │
│ year                    │◄────┐
│ make                    │     │
│ model                   │     │ One library per YMM
│ series (C10, K5, etc.)  │     │ (1973 Chevrolet K5 Blazer)
│ body_style              │     │
│ description             │     │
│ created_by              │     │
│ created_at              │     │
└─────────────────────────┘     │
                                │
        │ has many               │
        ▼                        │
┌─────────────────────────┐     │
│  library_documents      │     │
├─────────────────────────┤     │
│ id (PK)                 │     │
│ library_id (FK) ────────┘     │
│ document_type           │     │ Types:
│ title                   │     │ - brochure
│ file_url                │     │ - manual
│ thumbnail_url           │     │ - spec_sheet
│ page_count              │     │ - paint_codes
│ uploaded_by             │     │ - rpo_codes
│ upload_date             │     │ - wiring_diagram
│ file_size               │     │ - parts_catalog
│ tags []                 │     │
│ is_verified             │     │
└─────────────────────────┘     │
                                │
┌─────────────────────────┐     │
│  vehicles               │     │
├─────────────────────────┤     │
│ id (PK)                 │     │
│ year                    │─────┘ Match to find library
│ make                    │
│ model                   │
│ series                  │
│ body_style              │
└─────────────────────────┘
```

---

## How It Works

### 1. Auto-Link Vehicles to Library

When viewing a **1977 Chevrolet K5 Blazer**, system automatically finds:
```sql
SELECT * FROM reference_libraries
WHERE year = 1977
  AND make ILIKE 'Chevrolet'
  AND (series = 'K5' OR model ILIKE '%K5%')
ORDER BY specificity DESC
LIMIT 1;
```

**Specificity ranking**:
1. Exact match: year + make + series + body_style
2. Series match: year + make + series
3. Model match: year + make + model
4. General: year + make

### 2. Document Types

```typescript
type DocumentType = 
  | 'brochure'        // Sales brochure (your 1973 example)
  | 'owners_manual'   // Owner's manual
  | 'service_manual'  // Factory service manual
  | 'parts_catalog'   // Parts diagrams/catalog
  | 'spec_sheet'      // Technical specifications
  | 'paint_codes'     // Paint/color chart
  | 'rpo_codes'       // RPO option codes
  | 'wiring_diagram'  // Electrical diagrams
  | 'build_sheet'     // Factory build sheets
  | 'recall_notice'   // Safety recalls
  | 'tsb'             // Technical service bulletins
  | 'other';
```

### 3. UI Integration

#### A. Vehicle Profile - Reference Tab (New)
```
Left Column:
┌────────────────────────┐
│ Basic Information      │
│ Description            │
│ Comments               │
│                        │
│ ┌────────────────────┐ │ ← NEW SECTION
│ │ Reference Library  │ │
│ ├────────────────────┤ │
│ │ 📘 1973 Brochure   │ │
│ │ 📗 Owner's Manual  │ │
│ │ 📙 RPO Codes       │ │
│ │                    │ │
│ │ + Upload doc       │ │
│ └────────────────────┘ │
│                        │
│ Coverage Map           │
└────────────────────────┘
```

#### B. Standalone Library Browser
```
/reference-library?year=1973&make=Chevrolet&series=K5

┌─────────────────────────────────────────┐
│ Reference Library                       │
│ 1973 Chevrolet K5 Blazer                │
├─────────────────────────────────────────┤
│                                         │
│ [Grid of Document Thumbnails]           │
│                                         │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │[Brochure│ │ [Manual]│ │[RPO Codes│   │
│ │  1973  ]│ │  1973  ]│ │  List]  │   │
│ │ 24 pages│ │ 156 pg ]│ │ 8 pages │   │
│ └─────────┘ └─────────┘ └─────────┘   │
│                                         │
│ Shared by 47 vehicles • 12 contributors │
│                                         │
│ + Upload new document                   │
└─────────────────────────────────────────┘
```

#### C. Document Viewer
```
Click document → Full viewer with:
- PDF reader or image viewer
- Download button
- Share link
- "Apply to my vehicle" button
- Page thumbnails
- Search/OCR text
```

---

## Database Schema

```sql
-- Main library table (one per YMM combination)
CREATE TABLE reference_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- YMM identification
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT,
  series TEXT,           -- C10, K5, K1500
  body_style TEXT,       -- Pickup, Blazer, Suburban
  trim TEXT,             -- Silverado, Cheyenne
  
  -- Metadata
  description TEXT,
  vehicle_count INTEGER DEFAULT 0,  -- How many vehicles use this library
  document_count INTEGER DEFAULT 0,
  contributor_count INTEGER DEFAULT 0,
  
  -- Admin
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_verified BOOLEAN DEFAULT FALSE,
  
  -- Unique constraint for YMM
  CONSTRAINT unique_ymm UNIQUE (year, make, series)
);

-- Documents in the library
CREATE TABLE library_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  -- Document info
  document_type TEXT NOT NULL,  -- brochure, manual, spec_sheet, etc.
  title TEXT NOT NULL,
  description TEXT,
  
  -- File storage
  file_url TEXT NOT NULL,       -- PDF or image URL in storage
  thumbnail_url TEXT,           -- Preview image
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,               -- application/pdf, image/jpeg
  
  -- Metadata
  year_published INTEGER,       -- Document's publication year
  publisher TEXT,               -- "General Motors", "Chevrolet Division"
  part_number TEXT,             -- Factory part number if available
  language TEXT DEFAULT 'en',
  
  -- Categorization
  tags TEXT[],                  -- ['restoration', 'specs', 'wiring']
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  
  -- Engagement
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  
  -- Admin
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at TIMESTAMP DEFAULT NOW(),
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track which vehicles are linked to which libraries
CREATE TABLE vehicle_reference_links (
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  library_id UUID REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  -- Auto-linked or manually added
  link_type TEXT DEFAULT 'auto',  -- 'auto', 'manual', 'suggested'
  confidence INTEGER DEFAULT 100,
  
  linked_at TIMESTAMP DEFAULT NOW(),
  
  PRIMARY KEY (vehicle_id, library_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_libraries_ymm ON reference_libraries(year, make, series);
CREATE INDEX idx_documents_library ON library_documents(library_id);
CREATE INDEX idx_documents_type ON library_documents(document_type);
CREATE INDEX idx_vehicle_refs ON vehicle_reference_links(vehicle_id);
```

---

## Component Mockups

### 1. ReferenceLibraryCard.tsx (for Vehicle Profile)

```tsx
<ReferenceLibraryCard
  vehicleId={vehicle.id}
  year={vehicle.year}
  make={vehicle.make}
  series={vehicle.series}
  collapsed={true}
  maxVisible={3}
/>
```

**Collapsed View**:
```
┌────────────────────────┐
│ Reference Library   ▼  │
├────────────────────────┤
│ 📘 1973 Brochure       │
│ 📗 Owner's Manual      │
│ 📙 RPO Codes           │
│                        │
│ + 5 more • View all    │
└────────────────────────┘
```

**Expanded View**:
```
┌────────────────────────┐
│ Reference Library   ▲  │
├────────────────────────┤
│                        │
│ 📘 Sales Brochure      │
│    24 pages • 1973     │
│    [Download] [View]   │
│                        │
│ 📗 Owner's Manual      │
│    156 pages • 1973    │
│    [Download] [View]   │
│                        │
│ 📙 RPO Option Codes    │
│    8 pages • 1967-86   │
│    [Download] [View]   │
│                        │
│ 🔧 Service Manual      │
│    842 pages • 1973-87 │
│    [Download] [View]   │
│                        │
│ 🎨 Paint Codes Chart   │
│    12 pages • 1973-80  │
│    [Download] [View]   │
│                        │
│ ──────────────────────│
│ Shared by 47 vehicles  │
│ 12 contributors        │
│                        │
│ + Upload document      │
│ Browse full library →  │
└────────────────────────┘
```

### 2. Document Upload Flow

```
Click "+ Upload document"
  ↓
┌────────────────────────┐
│ Upload to Library      │
├────────────────────────┤
│ Document Type:         │
│ [Dropdown ▼]           │
│ - Sales Brochure       │
│ - Owner's Manual       │
│ - Service Manual       │
│ - Parts Catalog        │
│ - Spec Sheet           │
│ - Paint Codes          │
│ - RPO Codes            │
│ - Wiring Diagram       │
│                        │
│ Title:                 │
│ [1973 Blazer Brochure] │
│                        │
│ [Drag PDF/Images Here] │
│                        │
│ ✓ Share with all 1973  │
│   Chevrolet K5 Blazers │
│                        │
│ [Cancel] [Upload]      │
└────────────────────────┘
```

### 3. Library Browser Page

```
/reference-library

┌─────────────────────────────────────────┐
│ Reference Library Search                │
├─────────────────────────────────────────┤
│ Year: [1973 ▼] Make: [Chevrolet ▼]     │
│ Series: [K5 ▼] Body: [Blazer ▼]        │
│                                         │
│ [Search] or [Browse All]                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 1973 Chevrolet K5 Blazer                │
│ 8 documents • 47 vehicles • 12 users    │
├─────────────────────────────────────────┤
│                                         │
│ [Grid of Documents with Thumbnails]    │
│                                         │
│ Popular Libraries:                      │
│ • 1973-1987 GM Trucks (234 docs)        │
│ • 1967-1972 C/K Series (156 docs)       │
│ • K5 Blazer All Years (89 docs)         │
└─────────────────────────────────────────┘
```

---

## UI Flow Examples

### Example 1: Viewing 1977 K5 Blazer Profile

```
User opens: /vehicle/[k5-blazer-id]

Left Column Shows:
┌────────────────────────┐
│ Reference Library      │
├────────────────────────┤
│ 📘 1973-80 Brochure    │ ← Your brochure image
│ 📗 Owner's Manual      │
│ 📙 RPO Codes (67-86)   │
│                        │
│ View all 8 docs →      │
└────────────────────────┘
```

Click "1973-80 Brochure":
- Opens PDF viewer
- Shows your scanned brochure
- Download button
- "Used by 47 K5 Blazers" badge

### Example 2: User Uploads New Document

```
User has 1973 K5 Blazer service manual PDF

1. Opens vehicle profile
2. Clicks "+ Upload document" in Reference Library
3. Selects "Service Manual"
4. Uploads PDF
5. System asks: "Share with all 1973 K5 Blazers?"
6. User confirms
7. Document now available to all 47 matching vehicles
```

### Example 3: Community Building

```
User A: Uploads 1973 brochure
User B: Uploads RPO code list
User C: Uploads wiring diagram
User D: Uploads paint code chart

All users with 1973 K5 Blazers now have access to all 4 docs!

Reference Library becomes collaborative knowledge base.
```

---

## Database Schema (Detailed)

```sql
-- ============================================
-- REFERENCE LIBRARY SYSTEM
-- ============================================

-- Main library (one per YMM combination)
CREATE TABLE IF NOT EXISTS reference_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- YMM identification
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT,
  series TEXT,              -- C10, K5, K1500, etc.
  body_style TEXT,          -- Pickup, Blazer, Suburban
  trim TEXT,                -- Silverado, Cheyenne (optional)
  
  -- Description of this library
  description TEXT,
  notes TEXT,
  
  -- Stats (computed)
  vehicle_count INTEGER DEFAULT 0,
  document_count INTEGER DEFAULT 0,
  contributor_count INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  
  -- Admin
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  
  -- Unique per YMM
  CONSTRAINT unique_reference_library UNIQUE (year, make, series, body_style)
);

-- Documents in each library
CREATE TABLE IF NOT EXISTS library_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  -- Document metadata
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- File info
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,
  
  -- Publishing info
  year_published INTEGER,
  year_range_start INTEGER,  -- If doc covers multiple years
  year_range_end INTEGER,
  publisher TEXT,            -- "General Motors", "Chevrolet Division"
  part_number TEXT,          -- GM part number if available
  language TEXT DEFAULT 'en',
  
  -- Categorization
  tags TEXT[],
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  quality_rating INTEGER,   -- 1-5 stars
  
  -- Engagement metrics
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  
  -- Admin
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link vehicles to libraries (auto-generated)
CREATE TABLE IF NOT EXISTS vehicle_reference_links (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  link_type TEXT DEFAULT 'auto',  -- 'auto', 'manual', 'suggested'
  confidence INTEGER DEFAULT 100,
  match_reason TEXT,              -- 'exact_ymm', 'series_match', etc.
  
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  linked_by UUID REFERENCES auth.users(id),
  
  PRIMARY KEY (vehicle_id, library_id)
);

-- User bookmarks
CREATE TABLE IF NOT EXISTS library_document_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  notes TEXT,
  bookmarked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (user_id, document_id)
);

-- Indexes
CREATE INDEX idx_ref_lib_ymm ON reference_libraries(year, make, series);
CREATE INDEX idx_lib_docs_library ON library_documents(library_id);
CREATE INDEX idx_lib_docs_type ON library_documents(document_type);
CREATE INDEX idx_vehicle_ref_links ON vehicle_reference_links(vehicle_id);
CREATE INDEX idx_lib_docs_verified ON library_documents(is_verified, is_factory_original);

-- Views
CREATE OR REPLACE VIEW reference_library_stats AS
SELECT 
  rl.id,
  rl.year,
  rl.make,
  rl.series,
  rl.body_style,
  COUNT(DISTINCT ld.id) as document_count,
  COUNT(DISTINCT vrl.vehicle_id) as vehicle_count,
  COUNT(DISTINCT ld.uploaded_by) as contributor_count,
  SUM(ld.download_count) as total_downloads,
  MAX(ld.uploaded_at) as last_updated
FROM reference_libraries rl
LEFT JOIN library_documents ld ON ld.library_id = rl.id
LEFT JOIN vehicle_reference_links vrl ON vrl.library_id = rl.id
GROUP BY rl.id;

-- Function: Auto-link vehicle to appropriate library
CREATE OR REPLACE FUNCTION auto_link_vehicle_to_library(p_vehicle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_vehicle RECORD;
  v_library_id UUID;
BEGIN
  -- Get vehicle data
  SELECT year, make, model, series, body_style INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  -- Find or create matching library
  SELECT id INTO v_library_id
  FROM reference_libraries
  WHERE year = v_vehicle.year
    AND make ILIKE v_vehicle.make
    AND (series = v_vehicle.series OR series IS NULL)
    AND (body_style = v_vehicle.body_style OR body_style IS NULL)
  ORDER BY 
    CASE WHEN series = v_vehicle.series THEN 1 ELSE 2 END,
    CASE WHEN body_style = v_vehicle.body_style THEN 1 ELSE 2 END
  LIMIT 1;
  
  -- Create library if doesn't exist
  IF v_library_id IS NULL THEN
    INSERT INTO reference_libraries (year, make, model, series, body_style)
    VALUES (v_vehicle.year, v_vehicle.make, v_vehicle.model, v_vehicle.series, v_vehicle.body_style)
    RETURNING id INTO v_library_id;
  END IF;
  
  -- Link vehicle to library
  INSERT INTO vehicle_reference_links (vehicle_id, library_id, link_type, match_reason)
  VALUES (p_vehicle_id, v_library_id, 'auto', 'ymm_match')
  ON CONFLICT (vehicle_id, library_id) DO NOTHING;
  
  RETURN v_library_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-link new vehicles
CREATE OR REPLACE FUNCTION trigger_auto_link_vehicle()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM auto_link_vehicle_to_library(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_link_vehicle_library
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_link_vehicle();
```

---

## Usage Examples

### Example 1: Your 1973 Brochure

```sql
-- 1. Create library for 1973 Chevrolet K5 Blazer
INSERT INTO reference_libraries (year, make, series, body_style, created_by)
VALUES (1973, 'Chevrolet', 'K5', 'Blazer', [your-user-id]);

-- 2. Upload the brochure
INSERT INTO library_documents (
  library_id,
  document_type,
  title,
  file_url,
  page_count,
  year_published,
  is_factory_original,
  uploaded_by
) VALUES (
  [library-id],
  'brochure',
  '1973 Chevrolet Trucks - Blazer',
  'storage://reference-docs/1973-chevy-k5-brochure.pdf',
  24,
  1973,
  true,
  [your-user-id]
);

-- 3. System auto-links all matching vehicles
-- Any 1973 K5 Blazer now has access to this brochure!
```

### Example 2: RPO Code List (Spans Years)

```sql
-- Library for 1967-1986 GM Trucks (generic)
INSERT INTO reference_libraries (year, make, series, description)
VALUES (1973, 'Chevrolet', NULL, '1967-1986 GM Trucks - applies to C/K series');

-- RPO document spans multiple years
INSERT INTO library_documents (
  library_id,
  document_type,
  title,
  year_range_start,
  year_range_end,
  ...
) VALUES (
  [library-id],
  'rpo_codes',
  'GM RPO Codes 1967-1986',
  1967,
  1986,
  ...
);
```

---

## Access Control (RLS Policies)

```sql
-- Everyone can view reference libraries
CREATE POLICY "ref_libraries_public_read" ON reference_libraries
  FOR SELECT TO public
  USING (true);

-- Authenticated users can create libraries
CREATE POLICY "ref_libraries_auth_create" ON reference_libraries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Everyone can view documents
CREATE POLICY "lib_docs_public_read" ON library_documents
  FOR SELECT TO public
  USING (true);

-- Authenticated users can upload documents
CREATE POLICY "lib_docs_auth_upload" ON library_documents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

-- Track downloads and views (no auth required for stats)
CREATE POLICY "lib_docs_public_stats" ON library_documents
  FOR UPDATE TO public
  USING (true)
  WITH CHECK (true);
```

---

## Implementation Plan

### Phase 1: Database (30 min)
1. Create tables (reference_libraries, library_documents, vehicle_reference_links)
2. Create indexes
3. Create auto-link function
4. Backfill libraries for existing vehicles

### Phase 2: Components (3 hours)
1. `ReferenceLibraryCard.tsx` - For vehicle profile left column
2. `LibraryDocumentUploader.tsx` - Upload modal
3. `DocumentViewer.tsx` - PDF/image viewer
4. `LibraryBrowser.tsx` - Standalone page (future)

### Phase 3: Integration (1 hour)
1. Add to VehicleProfile left column
2. Wire up upload flow
3. Test with your 1973 brochure

### Phase 4: Enhancement (future)
1. OCR text extraction for searchability
2. Auto-categorization with AI
3. Community voting on quality
4. Version tracking (updated editions)

---

## Approval Checklist

**Approve to proceed?**

- [ ] ERD structure looks good?
- [ ] Auto-linking logic makes sense?
- [ ] Document types cover your needs?
- [ ] UI placement in left column OK?
- [ ] Want this implemented now or later?

**If approved, I'll**:
1. Create migration with tables
2. Build ReferenceLibraryCard component
3. Add to VehicleProfile left column
4. Let you upload your 1973 brochure as first document

Ready to build when you say go! 🚀

