# Index All Documents - Quick Guide

## 🚀 Quick Start

**Index all service manuals, material manuals, and TDS sheets:**

```bash
cd /Users/skylar/nuke
node scripts/index-all-documents.js
```

This script will:
1. Find all unindexed documents in `library_documents`
2. Extract structure from each document
3. Chunk and index the content
4. Store chunks in `document_chunks` table
5. Show progress and summary

---

## 📋 What Gets Indexed

### Document Types
- ✅ `service_manual` - Factory service manuals
- ✅ `material_manual` - Material catalogs (paint, body work supplies)
- ✅ `tds` - Technical Data Sheets (paint mixing ratios, application guides)

### Current Status
- **4 service manuals registered** (1973, 1977, 1981, 1987 Chevy C/K)
- **0 indexed** (need to run script)

---

## 🔧 How It Works

### Step 1: Structure Extraction
```
For each document:
  ↓
Call index-service-manual edge function (mode='structure')
  ↓
AI analyzes PDF structure:
  - Table of contents
  - Section list with page ranges
  - Priority sections
  ↓
Store structure in library_documents.metadata
```

### Step 2: Chunking & Indexing
```
For each priority section:
  ↓
Call index-service-manual edge function (mode='chunk')
  ↓
AI extracts content chunks:
  - Procedures
  - Specifications
  - Charts/diagrams
  - Product information (for TDS)
  ↓
Store chunks in document_chunks table
```

---

## 📊 Edge Function: `index-service-manual`

**Location:** `supabase/functions/index-service-manual/index.ts`

**Supported Modes:**
- `structure` - Extract document structure only
- `chunk` - Chunk and index content (requires structure first)
- `full` - Do both (structure + chunk)

**Usage:**
```javascript
await supabase.functions.invoke('index-service-manual', {
  body: {
    document_id: 'uuid-here',
    mode: 'full'  // or 'structure' then 'chunk'
  }
});
```

**What It Does:**
1. Gets document from `library_documents`
2. Uses GPT-4o or Claude Sonnet (tier3) for extraction
3. For service manuals: Extracts procedures, specs, charts
4. For TDS sheets: Extracts product info, mixing ratios, application methods
5. Stores chunks in `document_chunks` table

---

## 🗄️ Database Tables

### `library_documents`
- Stores document metadata
- `metadata` field stores extracted structure
- Links to `reference_libraries` by YMM

### `document_chunks`
- Stores indexed content chunks
- Fields:
  - `document_id` - Links to library_documents
  - `document_type` - 'service_manual', 'material_manual', 'tds'
  - `page_number` - Exact page citation
  - `section_name` - Section name
  - `content` - Full text content
  - `content_type` - 'procedure', 'specification', 'chart', etc.
  - `key_topics` - Array of topics
  - TDS-specific fields: `product_name`, `mixing_ratio`, `application_method`, etc.

---

## ✅ Verification

### Check What's Indexed
```sql
-- Count chunks by document type
SELECT 
  document_type,
  COUNT(*) as chunk_count,
  COUNT(DISTINCT document_id) as document_count
FROM document_chunks
WHERE document_type IN ('service_manual', 'material_manual', 'tds')
GROUP BY document_type;

-- Check specific document
SELECT 
  COUNT(*) as chunks,
  MIN(page_number) as first_page,
  MAX(page_number) as last_page
FROM document_chunks
WHERE document_id = 'your-doc-id-here';
```

### Search Indexed Content
```sql
-- Search service manual procedures
SELECT 
  page_number,
  section_name,
  content
FROM document_chunks
WHERE document_type = 'service_manual'
  AND content ILIKE '%bumper removal%'
ORDER BY page_number;

-- Search TDS products
SELECT 
  product_name,
  brand,
  mixing_ratio,
  application_method
FROM document_chunks
WHERE document_type = 'tds'
  AND product_name ILIKE '%basecoat%';
```

---

## 🐛 Troubleshooting

### Edge Function Not Found
```bash
# Deploy the function
cd /Users/skylar/nuke
supabase functions deploy index-service-manual --project-ref qkgaybvrernstplzjaam
```

### Missing API Keys
The function needs LLM API keys configured:
- OpenAI API key (for GPT-4o)
- Or Anthropic API key (for Claude Sonnet)

Set in Supabase Dashboard → Settings → Edge Functions → Secrets

### Rate Limits
The script includes delays between documents to avoid rate limits:
- 3 seconds between structure and chunking
- 5 seconds between documents

If you hit rate limits, increase these delays in the script.

### Large Documents
Service manuals are large (1,000-2,000 pages). The function processes priority sections first. To index all sections, you may need to run multiple times or modify the function to process all sections.

---

## 📈 Expected Results

### Service Manuals
- **Structure extraction:** ~30 seconds per manual
- **Chunking:** ~2-5 minutes per manual (depends on priority sections)
- **Chunks created:** 200-500 chunks per manual (for priority sections)

### TDS Sheets
- **Structure extraction:** ~10 seconds per sheet
- **Chunking:** ~30 seconds per sheet
- **Chunks created:** 5-20 chunks per sheet

### Material Manuals
- **Structure extraction:** ~20 seconds per manual
- **Chunking:** ~1-3 minutes per manual
- **Chunks created:** 50-200 chunks per manual

---

## 🎯 Next Steps After Indexing

1. **Test Search:**
   ```sql
   SELECT * FROM document_chunks 
   WHERE content ILIKE '%your search term%';
   ```

2. **Use in AI Analysis:**
   - AI can now cite service manual pages
   - Can find procedures and specifications
   - Can reference TDS mixing ratios

3. **Build Restoration Guidance:**
   - Use indexed procedures for work steps
   - Use TDS data for material recommendations
   - Link to service manual pages for citations

---

## 📝 Script Output Example

```
🚀 INDEX ALL DOCUMENTS
============================================================

📚 Found 4 documents to process:

  service_manual: 4 documents

Checking indexing status...

  ⏳ 1973 Chevrolet C/K Service Manual (service_manual) - NOT INDEXED
  ⏳ 1977 Chevrolet C/K Service Manual (service_manual) - NOT INDEXED
  ⏳ 1981 Chevrolet C/K Service Manual (service_manual) - NOT INDEXED
  ⏳ 1987 Chevrolet C/K Service Manual (service_manual) - NOT INDEXED

📋 4 documents need indexing:
  1. 1973 Chevrolet C/K Service Manual (service_manual)
  2. 1977 Chevrolet C/K Service Manual (service_manual)
  3. 1981 Chevrolet C/K Service Manual (service_manual)
  4. 1987 Chevrolet C/K Service Manual (service_manual)

Starting indexing process...

============================================================
[1/4] 1973 Chevrolet C/K Service Manual
Type: service_manual
ID: a72c9b20-ea63-4e2d-ac27-89ccd896c98a

Step 1: Extracting structure...
📚 Indexing document a72c9b20... [structure]...
✅ Success
   Found 12 sections
   Total pages: 1247

⏳ Waiting 3 seconds before chunking...

Step 2: Chunking and indexing...
📚 Indexing document a72c9b20... [chunk]...
✅ Success
   Created 342 chunks
   Indexed 8 sections

✅ Document fully indexed!

...

📊 INDEXING SUMMARY
============================================================

Total documents processed: 4
✅ Successfully indexed: 4
❌ Failed: 0

Final chunk counts by document:
  ✅ 1973 Chevrolet C/K Service Manual: 342 chunks
  ✅ 1977 Chevrolet C/K Service Manual: 298 chunks
  ✅ 1981 Chevrolet C/K Service Manual: 415 chunks
  ✅ 1987 Chevrolet C/K Service Manual: 387 chunks

Total chunks by type:
  service_manual: 1442 chunks

✅ Indexing process complete!
```

---

**Run the script to index all your documents!**

