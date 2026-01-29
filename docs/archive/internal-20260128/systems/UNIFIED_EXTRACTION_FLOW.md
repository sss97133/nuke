# Unified Extraction Flow: Extract → AI Proof → Re-extract

## Current Tools Assessment

### ✅ Existing Extraction Tools

1. **`scrape-multi-source`** - Firecrawl + Schema extraction + LLM fallback
   - ✅ Handles bot protection
   - ✅ Schema-based structured extraction
   - ✅ LLM fallback
   - ✅ Works for dealer inventory

2. **`extract-vehicle-data-ai`** - OpenAI GPT-4o extraction
   - ✅ Universal extraction from any HTML
   - ✅ Good normalization
   - ❌ No confidence scoring

3. **`scrape-vehicle`** - DOM parsing + regex
   - ✅ Fast, lightweight
   - ✅ Source-specific patterns (VIN, dealer info)
   - ❌ Fails on JS-heavy sites

4. **`ai-proofread-pending`** - AI proofreading + backfilling
   - ✅ Already does Extract → Proof → Re-extract
   - ✅ Backfills missing fields
   - ❌ Separate from main extraction flow

### ❌ Missing Components

1. **Unified extraction orchestrator** - Chains extraction → proof → re-extract
2. **Confidence scoring** - Measure extraction quality
3. **Source-specific adapters** - Custom extractors for known sources
4. **Re-extraction trigger** - Automatically re-extract when confidence is low

---

## Proposed Unified Flow

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Initial Extraction                             │
│                                                          │
│  1a. Detect Source Type (URL pattern matching)          │
│  1b. Try Source-Specific Adapter (if exists)            │
│  1c. Fallback: scrape-multi-source (Firecrawl + Schema) │
│  1d. Fallback: extract-vehicle-data-ai (LLM)            │
│  1e. Last Resort: scrape-vehicle (DOM + Regex)          │
│                                                          │
│  → Extract with confidence score                        │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│  STEP 2: AI Proofreading                                │
│                                                          │
│  2a. Validate extracted data with AI                    │
│  2b. Check data completeness                            │
│  2c. Identify missing critical fields                   │
│  2d. Calculate confidence score                         │
│                                                          │
│  → Confidence >= 0.8: Accept & continue                 │
│  → Confidence < 0.8: Flag for re-extraction             │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Re-extract Missing Data                        │
│                                                          │
│  3a. Identify missing fields from proofreading          │
│  3b. Re-scrape with targeted extraction                 │
│  3c. Use ai-proofread-pending logic for backfilling     │
│  3d. Merge results (prioritize new data)                │
│                                                          │
│  → Final data with improved completeness                │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Create Unified Extraction Orchestrator

**New Function**: `extract-with-proof-and-backfill`

This function will:
1. Try multiple extraction strategies
2. Run AI proofreading on results
3. Re-extract missing data if needed
4. Return unified result with confidence

### Phase 2: Enhance Existing Tools

**Enhance `scrape-multi-source`**:
- Add confidence scoring to extraction results
- Return extraction method used
- Flag missing critical fields

**Enhance `ai-proofread-pending`**:
- Accept extraction results directly (not just URLs)
- Return confidence scores
- List missing fields for re-extraction

### Phase 3: Source-Specific Adapters

Create adapters for top sources:
- Craigslist (partially exists in scrape-vehicle)
- Classic.com (exists in index-classic-com-dealer)
- DealerFire
- DealerSocket
- Bring a Trailer (exists in comprehensive-bat-extraction)

---

## Flow Diagram

```
User/System Request
    ↓
extract-with-proof-and-backfill()
    ↓
┌─────────────────────────────────────┐
│ Detect Source Type                  │
│ → Match URL pattern                 │
│ → Select extraction strategy        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Strategy 1: Source Adapter          │
│ (if exists)                         │
│ → Fast, accurate                    │
│ → confidence: 0.9+                  │
└─────────────────────────────────────┘
    ↓ (if fails)
┌─────────────────────────────────────┐
│ Strategy 2: scrape-multi-source     │
│ → Firecrawl + Schema                │
│ → LLM fallback                      │
│ → confidence: 0.7-0.9               │
└─────────────────────────────────────┘
    ↓ (if fails)
┌─────────────────────────────────────┐
│ Strategy 3: extract-vehicle-data-ai │
│ → Pure LLM extraction               │
│ → confidence: 0.6-0.8               │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ AI Proofreading                     │
│ → Use ai-proofread-pending logic    │
│ → Validate data quality             │
│ → Identify missing fields           │
│ → Calculate confidence              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Decision Point                      │
│                                     │
│ confidence >= 0.8?                  │
│   YES → Return results              │
│   NO  → Re-extract missing fields   │
└─────────────────────────────────────┘
    ↓ (if confidence < 0.8)
┌─────────────────────────────────────┐
│ Re-extract Missing Data             │
│ → Focus on missing critical fields  │
│ → Use targeted AI prompts           │
│ → Merge with existing data          │
└─────────────────────────────────────┘
    ↓
Return Final Results
    ↓
Store in Database
    ↓
Queue for processing (if needed)

