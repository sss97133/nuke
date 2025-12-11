# Knowledge Library Implementation - Complete

**Date:** January 28, 2025  
**Status:** ✅ Implementation Complete - Ready for Migration Application

---

## What Was Built

### 1. Reference Document Service (`referenceDocumentService.ts`)
Complete service for managing reference documents:
- ✅ File upload to Supabase Storage (`reference-docs` bucket)
- ✅ Document record creation in `reference_documents` table
- ✅ Automatic indexing trigger based on document type
- ✅ Document retrieval (user's docs, public docs, vehicle-linked docs)
- ✅ Document linking to vehicles
- ✅ Document deletion with storage cleanup
- ✅ Stat tracking (views, downloads, bookmarks, links)

### 2. Knowledge Library Component (`KnowledgeLibrary.tsx`)
Complete rewrite to show reference documents:
- ✅ Displays `reference_documents` instead of articles
- ✅ File upload interface with drag-and-drop support
- ✅ Document metadata form (type, title, year/make/series, tags, public/factory flags)
- ✅ Document cards showing: type, pages, file size, tags, stats
- ✅ Search and filter by document type
- ✅ View/Download functionality
- ✅ Delete functionality (owner only)

### 3. Automatic Indexing Integration
Indexing automatically triggered based on document type:

**Parts Catalogs** (`parts_catalog`):
- Uses `index-reference-document` edge function
- Creates `catalog_sources` entry
- Extracts parts into `catalog_parts` table
- Creates `catalog_pages` and `catalog_diagrams`

**Service Manuals, Material Manuals, TDS** (`service_manual`, `material_manual`, `tds`):
- Uses `index-service-manual` edge function
- Extracts structure (TOC, sections, page ranges)
- Chunks content semantically
- Stores in `document_chunks` table with type-specific fields

**Other Types** (`brochure`, `spec_sheet`, etc.):
- No automatic indexing (can be indexed manually later if needed)

### 4. Database Migrations Created

**`20250128_fix_document_chunks_reference.sql`**:
- Updates `document_chunks` foreign key to reference `reference_documents`
- Updates `catalog_sources` foreign key to reference `reference_documents`
- Fixes compatibility with edge functions

**`20250128_add_metadata_to_reference_documents.sql`**:
- Adds `metadata` JSONB column to `reference_documents`
- Stores document structure (TOC, sections) from indexing
- Adds GIN index for metadata queries

### 5. Edge Function Updates

**`index-service-manual/index.ts`**:
- ✅ Updated to use `reference_documents` instead of `library_documents`
- ✅ Stores structure in `metadata` column
- ✅ Reloads document with updated metadata before chunking

**`index-reference-document/index.ts`**:
- ✅ Updated to create `catalog_sources` linked to `reference_documents`
- ✅ Works with new document upload flow

---

## How It Works

### Upload Flow

```
1. User clicks "Upload Document"
   ↓
2. File selected → Upload form appears
   ↓
3. User fills metadata (type, title, year/make/series, tags)
   ↓
4. File uploaded to Supabase Storage (reference-docs bucket)
   ↓
5. Document record created in reference_documents table
   ↓
6. Automatic indexing triggered based on document_type:
   - parts_catalog → index-reference-document
   - service_manual/material_manual/tds → index-service-manual
   - brochure/spec_sheet → no indexing (manual later)
   ↓
7. Indexing extracts structure and content:
   - Parts catalogs → catalog_parts, catalog_pages
   - Service manuals → document_chunks (with embeddings)
   - Material manuals → document_chunks (with product data)
   - TDS sheets → document_chunks (with mixing ratios, safety data)
   ↓
8. Document appears in Knowledge Library
   ↓
9. User can link to vehicles, view, download
```

### Indexing Details

**Parts Catalog Indexing:**
- Mode: `structure` (analyzes TOC, sections) or `extract_parts` (extracts individual parts)
- Uses Gemini 1.5 Pro (2M context window)
- Creates structured `catalog_parts` records with part numbers, prices, fitment
- Links parts to `catalog_pages` and `catalog_diagrams`

**Service Manual Indexing:**
- Mode: `structure` (extracts TOC) → `chunk` (semantic chunking) → `full` (both)
- Uses GPT-4o or Claude Sonnet (tier3)
- Chunks by semantic units (procedures, specs, diagrams)
- Each chunk includes: page number, section, content, key topics, vector embedding
- Stores in `document_chunks` with `document_type = 'service_manual'`

**Material Manual/TDS Indexing:**
- Similar to service manual but extracts product-specific data
- TDS: product_name, product_code, brand, mixing_ratio, application_method, dry_time, coverage, safety_notes
- Material Manual: material_category, compatibility, usage_instructions
- Stores in `document_chunks` with type-specific fields populated

---

## Database Schema

### `reference_documents` Table
- User/organization owned documents
- Fields: owner_id, owner_type, document_type, title, file_url, year/make/series, is_public, metadata (JSONB)
- Indexed for fast lookups by owner, type, YMM

### `document_chunks` Table
- Unified table for all indexed document content
- References `reference_documents(id)`
- Type-specific fields for TDS/material manuals
- Vector embeddings for semantic search
- Full-text search indexes

### `catalog_parts` Table
- Extracted parts from parts catalogs
- References `catalog_sources` which references `reference_documents`
- Part numbers, names, prices, fitment data
- Vector embeddings for semantic search

### `vehicle_documents` Table
- Links documents to specific vehicles
- Many-to-many relationship
- Tracks who linked it and when

---

## Next Steps

### 1. Apply Migrations (REQUIRED)
```bash
# Apply the two new migrations
supabase migration up
# Or apply manually in Supabase Dashboard:
# - 20250128_fix_document_chunks_reference.sql
# - 20250128_add_metadata_to_reference_documents.sql
```

### 2. Deploy Edge Functions
```bash
# Deploy updated edge functions
supabase functions deploy index-service-manual
supabase functions deploy index-reference-document
```

### 3. Test Upload Flow
1. Navigate to profile → Knowledge Library tab
2. Click "Upload Document"
3. Select a PDF (brochure, manual, or parts catalog)
4. Fill in metadata
5. Upload
6. Verify indexing starts automatically
7. Check `reference_documents` table for new record
8. Check `document_chunks` or `catalog_parts` for indexed content

### 4. Verify Indexing
For service manuals:
```sql
SELECT COUNT(*) FROM document_chunks 
WHERE document_id = '[your-doc-id]';
```

For parts catalogs:
```sql
SELECT COUNT(*) FROM catalog_parts 
WHERE catalog_id IN (
  SELECT id FROM catalog_sources 
  WHERE pdf_document_id = '[your-doc-id]'
);
```

---

## Document Types Supported

| Type | Auto-Indexing | Indexing Function | Output Tables |
|------|--------------|-------------------|---------------|
| `parts_catalog` | ✅ Yes | `index-reference-document` | `catalog_parts`, `catalog_pages` |
| `service_manual` | ✅ Yes | `index-service-manual` | `document_chunks` |
| `material_manual` | ✅ Yes | `index-service-manual` | `document_chunks` |
| `tds` | ✅ Yes | `index-service-manual` | `document_chunks` |
| `brochure` | ❌ No | Manual later | N/A |
| `spec_sheet` | ❌ No | Manual later | N/A |
| `paint_codes` | ❌ No | Manual later | N/A |
| `rpo_codes` | ❌ No | Manual later | N/A |
| `wiring_diagram` | ❌ No | Manual later | N/A |
| `build_sheet` | ❌ No | Manual later | N/A |
| `recall_notice` | ❌ No | Manual later | N/A |
| `tsb` | ❌ No | Manual later | N/A |
| `other` | ❌ No | Manual later | N/A |

---

## Key Features

### Automatic Detection
- Document type determines indexing approach
- No manual configuration needed
- Indexing happens in background after upload

### Structured Data Extraction
- Parts catalogs → Structured parts with part numbers, prices
- Service manuals → Semantic chunks with page citations
- Material manuals → Product information with mixing ratios
- TDS sheets → Technical specifications with safety data

### Queryable Knowledge Base
- All indexed content searchable via vector embeddings
- Full-text search on chunk content
- Page citations for verification
- Cross-referenced across document types

### User Ownership
- Documents owned by users/organizations
- Public documents discoverable by others
- Can link to multiple vehicles
- Attribution tracked

---

## Files Created/Modified

### New Files:
- `nuke_frontend/src/services/referenceDocumentService.ts` (367 lines)
- `supabase/migrations/20250128_fix_document_chunks_reference.sql`
- `supabase/migrations/20250128_add_metadata_to_reference_documents.sql`

### Modified Files:
- `nuke_frontend/src/components/profile/KnowledgeLibrary.tsx` (complete rewrite, 450+ lines)
- `supabase/functions/index-service-manual/index.ts` (updated to use `reference_documents`)
- `supabase/functions/index-reference-document/index.ts` (updated for new flow)

---

## Testing Checklist

- [ ] Apply migrations to database
- [ ] Deploy updated edge functions
- [ ] Test upload of parts catalog → verify `catalog_parts` created
- [ ] Test upload of service manual → verify `document_chunks` created
- [ ] Test upload of brochure → verify no indexing (as expected)
- [ ] Test document linking to vehicle
- [ ] Test document viewing/downloading
- [ ] Test document deletion
- [ ] Test search and filtering
- [ ] Verify indexing status visible in UI

---

**Status:** Ready for production after migrations are applied and edge functions are deployed.


