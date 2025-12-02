# Service Manual Indexing - Status Report

## ✅ Manuals Registered in Library

| Year | Title | Size | Document ID | Library ID | Status |
|------|-------|------|-------------|------------|--------|
| 1973 | Chevrolet Light Duty Truck Service Manual | 42 MB | `a72c9b20-...` | `c79824a5-...` | ✅ Registered |
| 1977 | Chevrolet Light Duty Truck Service Manual | 39 MB | `fd8813c9-...` | `84003e42-...` | ✅ Registered |
| 1981 | Chevrolet Light Duty Truck 10-30 Service Manual | 49 MB | `b8b4fe19-...` | `57da05fa-...` | ✅ Registered |
| 1987 | Chevrolet Light Duty Truck Service Manual | 58 MB | `f6ab9240-...` | `8345b1c3-...` | ✅ Registered |

**Total:** 188 MB of factory documentation  
**Source:** 73-87chevytrucks.com (community-hosted GM archives)  
**Authority Level:** 10/10 (factory original)

---

## What Needs to Be Built: The Indexing Pipeline

### Challenge

These are **massive documents** (1,000-2,000 pages each). We cannot:
- Load entire PDF into AI context
- Store full text in database
- Process sequentially (would take hours)

### Solution: Smart Extraction + Vector Indexing

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: PDF ANALYSIS (Identify Structure)                 │
├─────────────────────────────────────────────────────────────┤
│ Tool: GPT-4o Vision on first 10 pages                      │
│ Extract:                                                    │
│   - Table of Contents                                       │
│   - Section list with page ranges                           │
│   - Document structure                                      │
│ Output: Section map for targeted extraction                │
│ Cost: ~$0.10 per manual                                     │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: PRIORITY SECTION EXTRACTION                       │
├─────────────────────────────────────────────────────────────┤
│ Extract ONLY relevant sections:                            │
│   ✓ Body & Frame (panel ID, date codes)                    │
│   ✓ Specifications (dimensions, weights, codes)            │
│   ✓ Trim & Accessories (package content)                   │
│   ✓ Paint & Color (paint code charts)                      │
│   ✗ Skip: Repair procedures, wiring, torque specs          │
│                                                             │
│ Tool: pdf-lib or pdf.js for text extraction               │
│ Extract: ~20% of pages (~200-300 pages per manual)         │
│ Output: Raw text by page                                   │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: INTELLIGENT CHUNKING                              │
├─────────────────────────────────────────────────────────────┤
│ Chunk by semantic units, not arbitrary size:               │
│   - One procedure = one chunk                               │
│   - One spec table = one chunk                              │
│   - One subsection = one chunk                              │
│                                                             │
│ Preserve context:                                           │
│   - Section heading                                         │
│   - Page number (exact citation)                            │
│   - Diagrams present (yes/no)                               │
│   - Part numbers mentioned                                  │
│                                                             │
│ Target: 500-1000 tokens per chunk                          │
│ Output: ~500-800 chunks per manual (2,000-3,000 total)     │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 4: EMBEDDING GENERATION                              │
├─────────────────────────────────────────────────────────────┤
│ For each chunk:                                             │
│   - Generate vector embedding (OpenAI ada-002)              │
│   - Store in reference_chunks table                         │
│   - Link to library_documents                               │
│                                                             │
│ Cost: ~$0.10 per 1M tokens                                 │
│ Estimated: ~2M tokens total = $0.20                        │
│ Time: ~5-10 minutes for all 4 manuals                      │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 5: STRUCTURED DATA EXTRACTION                        │
├─────────────────────────────────────────────────────────────┤
│ Use GPT-4o to extract from chunks:                         │
│   - Specification tables → oem_vehicle_specs                │
│   - Paint code charts → extracted_paint_colors              │
│   - RPO code lists → extracted_rpo_codes                    │
│   - Part diagrams → reference_visuals                       │
│                                                             │
│ Each extraction includes EXACT PAGE CITATION                │
│ Cost: ~$0.50-1.00 total                                    │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ RESULT: Queryable Knowledge Base                           │
├─────────────────────────────────────────────────────────────┤
│ 2,000-3,000 searchable chunks                              │
│ Each chunk includes:                                        │
│   - Full text                                               │
│   - Vector embedding                                        │
│   - Exact page number                                       │
│   - Section context                                         │
│                                                             │
│ Query time: ~10ms vector search                             │
│ Retrieved: Top 5 relevant chunks (500-2500 tokens)          │
│ AI can cite: "per 1981 Service Manual page 247"            │
└─────────────────────────────────────────────────────────────┘
```

---

## The Indexing Pipeline (To Build)

### Edge Function: `index-reference-document`

```typescript
// Input
{
  "document_id": "b8b4fe19-...",  // 1981 Service Manual
  "extraction_mode": "full",       // 'full', 'priority_only', 'specific_pages'
  "specific_sections": []          // Optional: only extract these sections
}

// Processing
1. Download PDF from file_url
2. Extract TOC (GPT-4o Vision on first 10 pages)
3. Identify priority sections based on document_type
4. Extract text page-by-page from priority sections
5. Chunk by semantic units (procedures, tables, subsections)
6. Generate embeddings (ada-002)
7. Store in reference_chunks with page citations
8. Extract structured data (specs, codes, diagrams)
9. Update coverage tracking

// Output
{
  "chunks_created": 487,
  "sections_indexed": 8,
  "pages_processed": 243,
  "specs_extracted": 45,
  "paint_codes_extracted": 67,
  "rpo_codes_extracted": 32,
  "processing_time": "8m 32s",
  "cost_estimate": "$0.35"
}
```

### Required Tools

1. **PDF.js or pdf-lib** - Text extraction
2. **OpenAI GPT-4o** - TOC analysis, structured extraction
3. **OpenAI ada-002** - Embeddings
4. **LangChain or custom** - Chunking logic

### Storage Requirements

```
Per Manual:
- Raw PDF: 40-60 MB (keep at source URL)
- Extracted chunks: ~500 × 800 tokens = ~400K tokens = ~2 MB text
- Embeddings: 500 × 1536 floats × 4 bytes = ~3 MB vectors
- Total per manual: ~5 MB indexed data

All 4 Manuals:
- Total indexed: ~20 MB
- Storage cost: Minimal (well within free tier)
```

---

## Page Citation Example

### How It Works

**User asks:** "How do I identify if this fender is original?"

**System queries:**
```sql
SELECT content, page_number, section_heading 
FROM reference_chunks
WHERE document_id IN (
  SELECT id FROM library_documents 
  WHERE year_range_start <= 1983 
  AND year_range_end >= 1983
)
ORDER BY embedding <=> query_embedding('fender panel date code identification')
LIMIT 5;
```

**Returns:**
```
Page 247 (Body & Frame):
"All body panels are stamped with a date code during manufacturing. 
Fenders: Code located on inner panel, rear upper edge near firewall.
Format: [Month Letter][Year Digit]. Example: 3A = March 1983, 7F = July 1977.
Refer to Date Code Chart on page 1465 for complete reference."

Page 248 (Body & Frame):
"To verify panel originality: 1) Locate date stamp, 2) Decode using chart,
3) Verify date is within 6 months of vehicle production date..."
```

**AI responds:**
> "To confirm fender originality, check the inner panel's rear upper edge for a date code stamp. The format is [Month Letter][Year Digit] - for example, '3A' means March 1983. This information comes from the **1981 Chevrolet Service Manual, pages 247-248**. The date should be within 6 months of your vehicle's production date to indicate an original panel."

**Citation format:**
- **Source:** 1981 Chevrolet Service Manual
- **Pages:** 247-248
- **Section:** Body & Frame - Panel Identification
- **Authority:** 10/10 (factory original)

---

## Current Status

✅ **Downloaded:** All 4 manuals (188 MB)  
✅ **Registered:** library_documents entries created  
✅ **Linked:** Associated with C/K reference libraries  
⏳ **Indexing:** Pipeline needs to be built  
⏳ **Chunks:** reference_chunks table ready but empty  
⏳ **Embeddings:** Waiting for extraction

---

## Next Steps (Indexing Pipeline)

The indexing pipeline is a substantial build (~500-800 lines of code). It needs:

1. **PDF processing library** (pdf.js or similar)
2. **TOC extraction logic** (GPT-4o Vision)
3. **Section prioritization** (based on document type)
4. **Semantic chunking** (preserve procedure/table boundaries)
5. **Embedding generation** (ada-002 API calls)
6. **Batch processing** (handle timeouts, retries)
7. **Progress tracking** (show % indexed)

**Estimated build time:** 2-4 hours  
**Estimated indexing time:** 10-15 minutes per manual  
**Estimated cost:** ~$1-2 total for all 4 manuals

---

## Immediate Workaround

While building the full pipeline, I can:

**Option A:** Index specific sections you need NOW
- Tell me "Extract 1981 Manual pages 245-260 (Body Panel ID)"
- I'll extract just those pages immediately
- Quick turnaround (~10 minutes)

**Option B:** Build minimal pipeline first
- Extract TOC + Specifications only (fastest value)
- ~1 hour to build
- Get paint codes, specs, RPO codes indexed today

**Option C:** Build complete pipeline
- Full semantic chunking, all sections
- ~3-4 hours to build
- Complete coverage

**Your call** - what's the priority?

