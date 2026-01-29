# Indexing System: What It Actually Does Right Now

## 🎯 Current State (December 2025)

This document explains what the indexing system **actually does** when you use it today, not what's planned.

---

## ✅ What's Working & Deployed

### 1. **Parts Catalog System** (FULLY OPERATIONAL)

**Status:** ✅ Production Ready  
**URL:** https://n-zero.dev/admin/catalog

**What's Indexed:**
- **4,951 parts** from LMC Truck catalog
- **185 parts** with product images
- **15 assembly diagrams** mapped
- **70 callout mappings** (part numbers ↔ diagram callouts)

**What You Can Do:**
1. Browse parts catalog at `/admin/catalog`
2. Search by part number or name
3. Filter by category, price, stock status
4. View assembly diagrams with callouts
5. See which parts belong to which assemblies

**How It Works:**
- Parts stored in `catalog_parts` table
- Assembly relationships in `part_assemblies` and `assembly_callouts`
- UI displays parts with prices, images, assembly context

**Edge Functions:**
- `index-reference-document` - Can extract parts from PDF catalogs (uses Gemini File API)
- `scrape-lmc-parts` - Scrapes LMC website for parts data
- `recommend-parts-for-vehicle` - Recommends parts based on vehicle context

---

### 2. **Document Upload System** (FULLY OPERATIONAL)

**Status:** ✅ Working  
**Components:** `ReferenceLibraryUpload`, `Library.tsx`

**What You Can Do:**
1. Upload PDFs via UI (Library page or vehicle profile)
2. Documents stored in `library_documents` table
3. Auto-detects document type from filename
4. Links documents to vehicle libraries (YMM-based)

**What Happens When You Upload:**

```
User uploads PDF
    ↓
File uploaded to Supabase Storage (reference-docs bucket)
    ↓
Document record created in library_documents table
    ↓
Metadata extracted: title, type, year, publisher
    ↓
Linked to reference_library (auto-created by YMM)
    ↓
Optionally triggers: parse-reference-document (if function exists)
```

**Current Upload Points:**
- `/library` - Main library page
- Vehicle profile - Reference Library section
- `ReferenceLibraryUpload` component

**Document Types Supported:**
- `service_manual` - Factory service manuals
- `material_manual` - Material catalogs
- `tds` - Technical Data Sheets
- `brochure` - Sales brochures
- `owners_manual` - Owner's manuals
- `other` - Other documents

---

### 3. **Service Manual Indexing** (PARTIALLY WORKING)

**Status:** ⚠️ Edge function deployed, needs documents indexed

**Edge Function:** `index-service-manual`

**What It Does:**
1. Takes a `document_id` from `library_documents`
2. Supports modes:
   - `structure` - Extracts TOC, sections, page ranges
   - `chunk` - Chunks content into searchable units
   - `full` - Does both
3. Uses GPT-4o or Claude Sonnet (tier3) for extraction
4. Stores chunks in `document_chunks` table

**Current State:**
- Function is deployed and working
- **4 service manuals registered** in database:
  - 1973 Chevrolet C/K Service Manual (42 MB)
  - 1977 Chevrolet C/K Service Manual (39 MB)
  - 1981 Chevrolet C/K Service Manual (49 MB)
  - 1987 Chevrolet C/K Service Manual (58 MB)
- **But:** These manuals are NOT yet indexed (chunks not created)

**To Index a Manual:**
```bash
# Via edge function
await supabase.functions.invoke('index-service-manual', {
  body: { 
    document_id: 'doc-uuid',
    mode: 'full'  // or 'structure' then 'chunk'
  }
});

# Or via script
node scripts/index-all-catalogs.js
```

**What Gets Stored:**
- Chunks in `document_chunks` table
- Each chunk has: page_number, section_name, content, key_topics
- Searchable via full-text search and vector embeddings

---

### 4. **Material Catalog Indexing** (PARTIALLY WORKING)

**Status:** ⚠️ Edge function deployed, structure ready

**Edge Function:** `index-service-manual` (same function, different document_type)

**What It Does:**
1. Handles `material_manual` and `tds` document types
2. Extracts product information:
   - Product name, code, brand
   - Mixing ratios (for paints)
   - Application methods
   - Safety notes
   - Coverage rates
3. Stores in `document_chunks` with TDS-specific fields

**Current State:**
- Function supports material manuals and TDS sheets
- Database schema ready (`document_chunks` has TDS fields)
- **But:** No material catalogs/TDS sheets indexed yet

**To Index a TDS Sheet:**
```bash
# Upload via Library UI first
# Then:
await supabase.functions.invoke('index-service-manual', {
  body: { 
    document_id: 'tds-doc-uuid',
    mode: 'full'
  }
});
```

---

### 5. **Parts Catalog Extraction** (WORKING)

**Status:** ✅ Edge function deployed

**Edge Function:** `index-reference-document`

**What It Does:**
1. Takes a PDF URL (parts catalog)
2. Uploads to Gemini File API (2M context window)
3. Two modes:
   - `structure` - Analyzes catalog structure (TOC, sections)
   - `extract_parts` - Extracts individual parts with part numbers, prices
4. Stores parts in `catalog_parts` table

**Current State:**
- Function is deployed and working
- Used to extract the 4,951 LMC parts
- Can process new catalogs if provided

**Example Usage:**
```javascript
await supabase.functions.invoke('index-reference-document', {
  body: {
    pdf_url: 'https://example.com/catalog.pdf',
    mode: 'extract_parts',
    page_start: 1,
    page_end: 50
  }
});
```

---

## 🔄 What Happens in the Pipeline

### When You Upload a PDF Document:

**Step 1: Upload (UI)**
```
User selects PDF file
    ↓
File uploaded to Supabase Storage
    ↓
Document record created in library_documents
    ↓
Metadata: title, type, year, publisher extracted
```

**Step 2: Indexing (Manual Trigger)**
```
User or script calls index-service-manual
    ↓
Function downloads PDF from file_url
    ↓
AI (GPT-4o/Claude) analyzes structure
    ↓
If mode='chunk' or 'full':
    AI extracts chunks from PDF
    Chunks stored in document_chunks table
    Each chunk: page_number, content, key_topics
```

**Step 3: Querying (When Needed)**
```
User searches or AI needs reference
    ↓
Query document_chunks table
    ↓
Full-text search or vector search
    ↓
Returns relevant chunks with page citations
```

---

## 📊 Current Database State

### Tables with Data:

**`catalog_parts`**
- ✅ 4,951 parts indexed
- ✅ Prices, part numbers, names
- ✅ Application data (years, models)
- ✅ Assembly relationships

**`catalog_pages`**
- ✅ Page images and text
- ✅ Linked to catalog_sources

**`catalog_diagrams`**
- ✅ 15 assembly diagrams
- ✅ Callout mappings

**`library_documents`**
- ✅ 4 service manuals registered
- ✅ Various other documents uploaded
- ⚠️ Most NOT yet indexed (no chunks)

**`document_chunks`**
- ⚠️ Empty or minimal (depends on indexing runs)
- Ready to store chunks when indexing happens

**`reference_libraries`**
- ✅ Auto-created by YMM
- ✅ Links documents to vehicles

---

## 🎯 What You Can Do Right Now

### 1. Browse Parts Catalog
- Go to `/admin/catalog`
- Search 4,951 parts
- View assembly diagrams
- See part relationships

### 2. Upload Documents
- Go to `/library` or vehicle profile
- Upload PDFs (service manuals, TDS sheets, etc.)
- Documents stored and linked to vehicles

### 3. Index Documents (Manual)
```bash
# Index a service manual
node scripts/index-all-catalogs.js

# Or via edge function
await supabase.functions.invoke('index-service-manual', {
  body: { document_id: 'doc-uuid', mode: 'full' }
});
```

### 4. Search Indexed Content
```sql
-- Search service manual chunks
SELECT * FROM document_chunks
WHERE document_type = 'service_manual'
  AND content ILIKE '%bumper removal%';

-- Search parts catalog
SELECT * FROM catalog_parts
WHERE name ILIKE '%bumper%';
```

---

## ⚠️ What's NOT Working Yet

### 1. **Automatic Indexing on Upload**
- Documents upload successfully
- But indexing must be triggered manually
- No automatic chunking when PDF is uploaded

### 2. **Restoration Score Calculation**
- Algorithm defined in docs
- Not implemented yet
- No edge function for scoring

### 3. **Guidance Generation**
- Concept documented
- Not implemented yet
- No automatic guidance from scores

### 4. **Material Catalog Data**
- System ready to index TDS sheets
- But no TDS sheets indexed yet
- Need to upload and index them

### 5. **Service Manual Chunks**
- 4 manuals registered
- But chunks not created yet
- Need to run indexing

---

## 🔧 How to Use It Today

### Scenario 1: Upload and Index a Service Manual

```bash
# 1. Upload via UI (Library page)
# 2. Get document_id from library_documents
# 3. Index it:
node scripts/index-all-catalogs.js

# Or manually:
await supabase.functions.invoke('index-service-manual', {
  body: { 
    document_id: 'your-doc-id',
    mode: 'full'
  }
});
```

### Scenario 2: Extract Parts from Catalog PDF

```javascript
// If you have a catalog PDF URL:
await supabase.functions.invoke('index-reference-document', {
  body: {
    pdf_url: 'https://example.com/catalog.pdf',
    mode: 'extract_parts',
    page_start: 1,
    page_end: 50
  }
});
```

### Scenario 3: Search Indexed Content

```sql
-- Find parts
SELECT * FROM catalog_parts 
WHERE name ILIKE '%bumper%' 
  AND application_data->>'years' @> '[1973]';

-- Find service manual procedures
SELECT content, page_number 
FROM document_chunks
WHERE document_type = 'service_manual'
  AND content ILIKE '%bumper removal%';
```

---

## 📈 What's Next

### Immediate Priorities:
1. **Index the 4 registered service manuals**
   - Run `index-service-manual` on each
   - Create chunks for searchability

2. **Upload and index TDS sheets**
   - Upload paint/material TDS sheets
   - Index them for material lookup

3. **Build restoration scoring**
   - Implement scoring algorithm
   - Create edge function
   - Integrate with image analysis

4. **Build guidance generation**
   - Query all catalogs
   - Generate recommendations
   - Display in UI

---

## 🎬 Real Example: What Happens Now

### User uploads a service manual PDF:

1. **Upload happens:**
   - File → Supabase Storage
   - Record → `library_documents`
   - Linked to vehicle library

2. **Indexing (if triggered):**
   - Function analyzes PDF structure
   - Extracts chunks (procedures, specs)
   - Stores in `document_chunks`

3. **Querying (when needed):**
   - User or AI searches chunks
   - Finds relevant procedures
   - Returns with page citations

**Current limitation:** Step 2 (indexing) must be done manually. It doesn't happen automatically on upload.

---

## 📝 Summary

**What Works:**
- ✅ Parts catalog (4,951 parts, browseable)
- ✅ Document upload (PDFs stored)
- ✅ Service manual indexing function (deployed)
- ✅ Material catalog indexing function (deployed)
- ✅ Parts extraction function (deployed)

**What's Missing:**
- ⚠️ Automatic indexing on upload
- ⚠️ Service manuals not yet chunked (4 registered, 0 indexed)
- ⚠️ Material catalogs not yet indexed
- ⚠️ Restoration scoring not implemented
- ⚠️ Guidance generation not implemented

**The infrastructure is there, but the indexing needs to be triggered and the restoration guidance needs to be built.**

---

**This is the current state: the pipes are built, but they need to be filled with indexed data and connected to restoration guidance.**

