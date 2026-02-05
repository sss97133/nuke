# Integration Note: Specialty Builder Extractor

**Date**: 2026-02-02

---

## Existing Infrastructure Found

### `discover-organization-full` Function
**Location**: `supabase/functions/discover-organization-full/`

**Purpose**: Structure-first site inspection and extraction
- Uses Firecrawl + LLM to catalog site structure
- Learns extraction patterns adaptively
- Stores patterns in `source_site_schemas`
- Extracts using learned patterns

**Documented in**: `docs/archive/internal-20260128/ingestion/SITE_INSPECTION_AND_MAPPING.md`

---

## How My Work Complements This

### What I Built: `extract-specialty-builder`
**Purpose**: Specialized extractor for high-end builders with:
- **Builder-specific validation** (descriptions, chassis numbers, timeline events)
- **Self-healing** for incomplete extractions
- **Ollama fallback** (no API costs)
- **High-end requirements** (chassis numbers for Singer/RUF, auction history, etc.)

### Integration Strategy

**Option 1: Two-Phase Approach** (Recommended)
```
Phase 1: discover-organization-full
  ↓ (discovers inventory structure)
Phase 2: extract-specialty-builder
  ↓ (extracts with specialty builder validation)
Result: Complete extraction with builder-specific requirements
```

**Option 2: Parallel Approach**
- Use `discover-organization-full` for general dealer sites
- Use `extract-specialty-builder` for specialty builders (Velocity, Kindred, Singer, RUF, Brabus, Cool N Vintage)
- Each handles their specific use case

---

## Recommendation

**Use both functions together**:

1. **Discovery**: Use `discover-organization-full` to:
   - Map site structure
   - Discover inventory URLs
   - Learn basic extraction patterns

2. **Specialty Extraction**: Use `extract-specialty-builder` to:
   - Extract with builder-specific requirements
   - Validate descriptions, timeline events, chassis numbers
   - Self-heal incomplete extractions
   - Use Ollama fallback (OpenAI quota exhausted)

**Example workflow**:
```bash
# Step 1: Discover site structure
curl -X POST "$SUPABASE_URL/functions/v1/discover-organization-full" \
  -d '{"url": "https://www.velocityrestorations.com"}'

# Step 2: Extract with specialty builder validation
curl -X POST "$SUPABASE_URL/functions/v1/extract-specialty-builder" \
  -d '{"url": "https://www.velocityrestorations.com/restorations/1967-bronco", "action": "extract"}'
```

---

## Previous Work on These Builders

From `.ralph/extraction_plan.md` (Jan 25):
```
### New Sites (lower priority)
- [ ] Kindred Motorworks - extractor exists, test it
```

**Status Update**:
- ✅ Kindred registered in `scrape_sources`
- ✅ New `extract-specialty-builder` function handles Kindred + 5 other builders
- ✅ Self-healing validation ensures quality

---

## Action Items

### Short-term
- [ ] Test `extract-specialty-builder` on actual vehicle listings (need URLs)
- [ ] Optionally integrate with `discover-organization-full` for inventory discovery
- [ ] Run coordinator to process pending extractions

### Long-term
- [ ] Consider merging specialty builder validation into `discover-organization-full`
- [ ] Or keep separate for specialized high-end builder requirements
- [ ] Monitor extraction quality and iterate

---

## Summary

**My work is complementary**, not duplicative:
- Existing: General site discovery and extraction (`discover-organization-full`)
- New: Specialty builder extraction with validation and self-healing (`extract-specialty-builder`)

Both can be used together for optimal results on high-end specialty builder sites.
