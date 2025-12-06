# Index All Documents - Status & Instructions

## ✅ Script Created & Working

**Script:** `scripts/index-all-documents.js`

**Status:** ✅ Working - Currently indexing documents

---

## 📊 Current Status

### Documents Found:
- **4 service manuals** - NOT INDEXED
  - 1973 Chevrolet Light Duty Truck Service Manual
  - 1977 Chevrolet Light Duty Truck Service Manual
  - 1981 Chevrolet Light Duty Truck 10-30 Service Manual
  - 1987 Chevrolet Light Duty Truck Service Manual

- **5 material manuals** - 1 indexed (10 chunks), 4 NOT INDEXED
  - 3M Automotive Aftermarket Division Product Catalogue 2024 ✅ (10 chunks)
  - ATI Tools Catalog ⏳
  - Car-O-Liner Solutions Catalog 2023 ⏳
  - Snap-on Catalogue 2023 ⏳
  - Snap-on Lindström Catalog 2024 ⏳

**Total:** 8 documents need indexing

---

## 🚀 How to Run

### Option 1: Run the Script
```bash
cd /Users/skylar/nuke
node scripts/index-all-documents.js
```

The script will:
1. Check all documents in `library_documents`
2. Identify which ones need indexing
3. Extract structure from each
4. Chunk and index the content
5. Store in `document_chunks` table
6. Show progress and summary

### Option 2: Index Specific Document Types

**Service manuals only:**
```bash
node scripts/index-service-manuals.js
```

**Material manuals & TDS only:**
```bash
node scripts/index-all-catalogs.js
```

---

## 🔧 Edge Function Used

**Function:** `index-service-manual`

**Location:** `supabase/functions/index-service-manual/index.ts`

**Modes:**
- `structure` - Extract document structure (TOC, sections)
- `chunk` - Chunk and index content (requires structure first)
- `full` - Do both

**Deployment:**
```bash
supabase functions deploy index-service-manual --project-ref qkgaybvrernstplzjaam
```

---

## 📈 Expected Results

### Service Manuals
- **Structure:** ~30 seconds per manual
- **Chunking:** ~2-5 minutes per manual
- **Chunks:** 200-500 chunks per manual (priority sections)

### Material Manuals
- **Structure:** ~20 seconds per manual
- **Chunking:** ~1-3 minutes per manual
- **Chunks:** 50-200 chunks per manual

**Total time:** ~30-60 minutes for all 8 documents

---

## ✅ Verification

### Check Indexing Status
```sql
-- Count chunks by document
SELECT 
  ld.title,
  ld.document_type,
  COUNT(dc.id) as chunk_count
FROM library_documents ld
LEFT JOIN document_chunks dc ON dc.document_id = ld.id
WHERE ld.document_type IN ('service_manual', 'material_manual', 'tds')
GROUP BY ld.id, ld.title, ld.document_type
ORDER BY ld.document_type, ld.title;
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
ORDER BY page_number
LIMIT 10;
```

---

## 🎯 What Happens After Indexing

Once documents are indexed:

1. **Searchable Content:**
   - All procedures, specifications, charts are searchable
   - Can find exact page numbers for citations
   - Can query by topic using `key_topics` array

2. **AI Integration:**
   - AI can cite service manual pages
   - Can find procedures for restoration work
   - Can reference TDS mixing ratios and application methods

3. **Restoration Guidance:**
   - Use indexed procedures for work steps
   - Use TDS data for material recommendations
   - Link to service manual pages for citations

---

## 📝 Script Features

✅ **Automatic Status Check:**
- Checks which documents are already indexed
- Skips documents that already have chunks
- Shows progress for each document

✅ **Error Handling:**
- Continues if one document fails
- Shows detailed error messages
- Tracks success/failure counts

✅ **Progress Tracking:**
- Shows current document being processed
- Displays chunk counts as they're created
- Final summary with totals

✅ **Rate Limit Protection:**
- 3 second delay between structure and chunking
- 5 second delay between documents
- Prevents API rate limit issues

---

## 🔗 Related Documentation

- `docs/systems/INDEX_ALL_DOCUMENTS_GUIDE.md` - Detailed guide
- `docs/systems/INDEXING_SYSTEM_EXPLAINED.md` - System overview
- `docs/systems/INDEXING_SYSTEM_CURRENT_STATE.md` - Current state

---

## 🚨 Important Notes

1. **Large Documents:** Service manuals are 1,000-2,000 pages. The function processes priority sections first. Full indexing may require multiple runs.

2. **API Costs:** Indexing uses GPT-4o or Claude Sonnet (tier3). Each manual costs ~$2-5 to index fully.

3. **Time:** Full indexing takes 30-60 minutes for all documents. The script runs sequentially to avoid rate limits.

4. **Verification:** After indexing, verify chunks were created using the SQL queries above.

---

**The script is ready to run. Execute it to index all your documents!**

