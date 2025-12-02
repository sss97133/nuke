# Component Reference System - Population Guide

## Overview

The component reference system enables **expert-level vehicle analysis** by grounding AI identifications in factual reference data. This guide explains how to populate the system with authoritative sources.

## Database Architecture

### Core Tables

| Table | Purpose |
|-------|---------|
| `component_definitions` | Master catalog of components (what exists) |
| `reference_documents` / `library_documents` | Source materials (PDFs, manuals) |
| `reference_coverage` | Coverage map (what we have vs need) |
| `knowledge_gaps` | Missing data discovered during analysis |
| `image_analysis_records` | Analysis results with epistemic tracking |
| `component_identifications` | Per-image component IDs with citations |

---

## Step 1: Check Current Coverage

```sql
-- See what reference data we're missing
SELECT * FROM coverage_gaps_by_vehicle
ORDER BY total_blocked DESC;

-- See top priority gaps
SELECT * FROM top_priority_gaps
LIMIT 10;
```

**Example Output:**
```
| make | model_family | topics_missing | avg_coverage | total_blocked |
|------|--------------|----------------|--------------|---------------|
| Chevrolet | C/K | 5 | 15% | 47 |
```

This tells you 47 analyses are blocked due to missing C/K truck references.

---

## Step 2: Upload Reference Documents

### What to Upload

**Priority 1 - Assembly Manuals:**
- `1973-1980 Chevrolet Light Duty Truck Assembly Manual`
- `1981-1987 Chevrolet Light Duty Truck Assembly Manual`
- Focus on: Body chapter, Trim chapter, Date code appendix

**Priority 2 - Parts Catalogs:**
- `1973-1980 Chevrolet Truck Parts Catalog`
- `1981-1987 Chevrolet Truck Parts Catalog`
- Focus on: Body panels, Trim & moldings, Glass

**Priority 3 - Sales Materials:**
- Sales brochures by year (73-87)
- RPO code guides
- Paint/trim charts

**Priority 4 - Service Manuals:**
- Engine specifications
- Electrical diagrams
- Chassis specifications

### How to Upload

**Via UI (when built):**
1. Navigate to Admin → Reference Library
2. Click "Upload Document"
3. Select YMM applicability
4. Tag document type
5. Upload PDF

**Via Script (current method):**
```javascript
const { data, error } = await supabase
  .from('library_documents')
  .insert({
    library_id: 'xxx', // Get from reference_libraries
    document_type: 'assembly_manual',
    title: '1981-1987 C/K Assembly Manual',
    file_url: 'path/to/pdf',
    uploaded_by: 'user_id',
    is_factory_original: true,
    year_range_start: 1981,
    year_range_end: 1987
  })
```

---

## Step 3: Populate Component Definitions

### Current Status

**Seeded:** 12 basic components for GM C/K trucks
**Needed:** ~200-300 components for complete coverage

### Component Definition Structure

```sql
INSERT INTO component_definitions (
  make,
  model_family,
  year_range_start,
  year_range_end,
  component_category,
  component_name,
  component_subcategory,
  distinguishing_features,
  oem_part_numbers,
  common_aftermarket_brands,
  related_rpo_codes,
  identification_priority,
  year_dating_significance,
  trim_identification_value,
  originality_indicator
) VALUES (
  'Chevrolet',
  'C/K',
  1981,
  1987,
  'trim',
  'scottsdale_emblem',
  'fender_badge',
  ARRAY['Scottsdale text', '10/20/30 designation', 'chrome or black'],
  ARRAY['14023456'], -- OEM part numbers (from parts catalog)
  ARRAY['LMC Truck', 'Brothers'],
  ARRAY['YE8'], -- Related RPO codes
  10, -- High priority (visible, identifies trim)
  5,  -- Medium year significance
  10, -- Maximum trim identification value
  6   -- Moderate originality indicator
);
```

### How to Fill Component Data

**From Assembly Manual:**
- Component names (official terminology)
- Installation locations
- Date code locations (for dating body panels)
- Part number callouts

**From Parts Catalog:**
- OEM part numbers
- Year applicability ranges
- Supersession info (old part → new part)
- Variations by trim level

**From Sales Brochures:**
- Trim package contents
- Standard vs optional equipment
- Visual identifiers for trim levels
- RPO code associations

**From Your Expertise:**
- Visual identification tips
- Common aftermarket brands
- Originality indicators
- Year-specific changes

---

## Step 4: Understanding Epistemic Status

Every component identification has a **status**:

### CONFIRMED
- **When:** AI can cite a specific reference OR component is definitively identifiable
- **Example:** "Grille matches Part #14023456 per 1983 Parts Catalog p.42"
- **Confidence:** 0.85-1.0
- **Required:** `source_references` must be populated

### INFERRED  
- **When:** Reasonable conclusion based on visual patterns but no citation
- **Example:** "Appears to be BFG KO2 tires based on tread pattern (sidewall not visible)"
- **Confidence:** 0.50-0.84
- **Required:** `inference_basis` must explain reasoning

### UNKNOWN
- **When:** Cannot determine with available information
- **Example:** "Cannot confirm fender originality - need Assembly Manual body panel date code guide"
- **Confidence:** null
- **Required:** `blocking_gaps` must list what's needed

---

## Step 5: Triggering Tier 2 Analysis

**Automatic:** When Tier 1 detects high-quality, significant images
**Manual:** Click "Advanced Analysis" button in lightbox
**Batch:** Run script to analyze all images for a vehicle

```javascript
const { data, error } = await supabase.functions.invoke('analyze-image-tier2', {
  body: {
    image_url: 'url',
    vehicle_id: 'id',
    image_id: 'id',
    user_id: 'id'
  }
})
```

---

## Step 6: Reviewing and Validating Results

**View Analysis:**
```sql
SELECT 
  image_id,
  analysis_tier,
  citation_count,
  inference_count,
  unknown_count,
  overall_confidence
FROM image_analysis_records
WHERE vehicle_id = 'xxx'
ORDER BY analyzed_at DESC;
```

**View Component IDs:**
```sql
SELECT 
  component_type,
  identification,
  status,
  confidence,
  citation_text,
  blocking_gaps
FROM component_identifications
WHERE image_id = 'xxx'
ORDER BY confidence DESC NULLS LAST;
```

**Validate Components:**
```sql
UPDATE component_identifications
SET human_validated = true,
    validated_by = 'your_user_id',
    validated_at = NOW(),
    validation_notes = 'Confirmed via physical inspection'
WHERE id = 'component_id';
```

---

## Step 7: Filling Knowledge Gaps

When analysis discovers a gap, it's logged:

```sql
SELECT 
  gap_type,
  description,
  required_reference_title,
  impact_count,
  priority
FROM knowledge_gaps
WHERE status = 'open'
ORDER BY priority DESC, impact_count DESC;
```

**To Resolve:**
1. Upload the requested reference document
2. System auto-updates `reference_coverage`
3. Trigger re-analysis of affected images
4. Gap is marked as resolved

---

## Step 8: The Feedback Loop

```
1. Analysis runs → identifies components
2. Marks some as UNKNOWN due to missing refs
3. Logs knowledge gap with impact count
4. Admin sees gap in dashboard
5. Admin uploads needed reference
6. System triggers re-analysis
7. Unknown → Confirmed (with citation)
8. Gap resolved, accuracy improves
```

Over time, as you upload more references:
- Unknown count decreases
- Citation count increases
- Overall confidence increases
- Analysis quality approaches expert-level

---

## Current Status (Dec 2, 2025)

### GM C/K Trucks (1973-1987)

| Topic | Coverage | Missing |
|-------|----------|---------|
| Body Panels | 0% | Assembly Manual needed |
| Trim Packages | 35% | Sales brochures needed |
| Paint Codes | 0% | Paint charts needed |
| Wheels/Tires | 10% | Wheel guide needed |
| Mechanical | 25% | Visual ID guide needed |

**Total Component Definitions:** 12 seeded (200+ needed)
**Total Reference Documents:** 0 uploaded
**Blocked Analyses:** TBD (will track after first Tier 2 runs)

### Next Steps

1. **Upload first reference:** 1981-1987 C/K Assembly Manual (if available)
2. **Populate component defs:** Add 50-100 more components from your expertise
3. **Test Tier 2 analysis:** Run on problematic images to see what gaps emerge
4. **Iterate:** Fill gaps based on priority/impact

---

## API Reference

### Run Tier 2 Analysis
```
POST /functions/v1/analyze-image-tier2
{
  "image_url": "...",
  "vehicle_id": "...",
  "image_id": "...",
  "user_id": "..." (optional)
}
```

### Check Vehicle Coverage
```sql
SELECT * FROM check_vehicle_reference_coverage('vehicle_id');
```

### Log Knowledge Gap (usually auto-called)
```sql
SELECT log_knowledge_gap(
  'analysis_id',
  'vehicle_id',
  'missing_reference',
  'Cannot identify grille variation without parts catalog',
  '1983 C/K Parts Catalog - Grille Section',
  ARRAY['grille', 'front_trim']
);
```

---

## Philosophy

> **"The system must know what it doesn't know."**

This isn't about making the AI hallucinate expertise. It's about:
- **Honesty:** Admitting when data is missing
- **Traceability:** Every fact has a source
- **Improvability:** Gaps are explicitly tracked and filled
- **Collaboration:** Expert knowledge (yours) + AI analysis = accurate documentation

The goal is for the AI to say:
> "I cannot confirm this is an OEM fender without the Assembly Manual body panel identification guide (pages 115-130). Please refer to this source for date stamp location and interpretation."

Not:
> "This appears to be original" (baseless guess)

