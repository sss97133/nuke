# Description Intelligence Extraction System

## Mission
Transform raw BaT listing descriptions and comments into **structured, queryable vehicle intelligence data**. Extract ownership history, service records, modifications, documentation, condition notes, provenance, authenticity, awards, and rarity information.

**Scale**: 126k+ vehicles with descriptions waiting for analysis.

---

## CRITICAL: Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────┐
│  PIPELINE 1: Profile Extraction (EXISTING - DO NOT TOUCH)      │
│  ─────────────────────────────────────────────────────────────  │
│  • extract-bat-core → vehicles, vehicle_images, auction_events │
│  • extract-auction-comments → auction_comments                 │
│  • Writes to: vehicles.description (raw text blob)             │
│                                                                 │
│  STATUS: Running in background, 100% success rate              │
│  DO NOT MODIFY these functions or their output tables          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    (descriptions exist as raw text)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PIPELINE 2: Description Intelligence (THIS SYSTEM - BUILD IT) │
│  ─────────────────────────────────────────────────────────────  │
│  • READS: vehicles.description, auction_comments.comment_text  │
│  • WRITES: vehicle_intelligence (NEW table - doesn't exist yet)│
│                                                                 │
│  SAFE: Can iterate, re-run, delete output without affecting    │
│        the source vehicle profiles                              │
└─────────────────────────────────────────────────────────────────┘
```

**Golden Rule**: This system is READ-ONLY on `vehicles` table. All output goes to `vehicle_intelligence`.

---

## Constraints

- **Budget**: Minimize LLM costs. Use regex (Tier 1) for deterministic patterns first.
- **No profile pollution**: Never write to `vehicles.year`, `vehicles.make`, `vehicles.model`, `vehicles.vin`, etc.
- **Idempotent**: Running twice on same vehicle should produce identical results.
- **Versioned**: Track `extraction_version` so we can re-extract with improved logic.
- **Rollback-safe**: Can `TRUNCATE vehicle_intelligence` with zero impact on profiles.

---

## Core Loop

1. **Query vehicles needing analysis**:
   ```sql
   SELECT v.id, v.description, v.year, v.make, v.model, v.sale_price
   FROM vehicles v
   LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
   WHERE v.description IS NOT NULL
     AND LENGTH(v.description) > 100
     AND vi.id IS NULL
   ORDER BY v.sale_price DESC NULLS LAST
   LIMIT 100;
   ```

2. **Run Tier 1 regex extraction** (free, fast) for high-confidence patterns.

3. **Run Tier 2 LLM extraction** (paid, accurate) for complex data.

4. **Upsert to `vehicle_intelligence`** table.

5. **Track metrics**: coverage %, field fill rate, confidence scores.

---

## Key Files

### Specifications
- `docs/DESCRIPTION_INTELLIGENCE_SPEC.md` - Full system spec with DB schema
- `docs/BAT_DESCRIPTION_COMMENT_PATTERNS.md` - Pattern analysis from real data
- `prompts/description-intelligence-extraction.md` - LLM prompt templates

### Reference (Profile Extraction - DO NOT MODIFY)
- `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md` - The canonical BaT extraction workflow
- `supabase/functions/extract-bat-core/index.ts` - Core extractor (creates vehicles.description)
- `supabase/functions/extract-auction-comments/index.ts` - Comment extractor

### To Be Created
- `supabase/functions/analyze-vehicle-description/index.ts` - Single vehicle analysis
- `supabase/functions/batch-analyze-descriptions/index.ts` - Batch processor
- `database/migrations/YYYYMMDD_create_vehicle_intelligence.sql` - Schema

---

## Database Schema (TO BE CREATED)

```sql
CREATE TABLE IF NOT EXISTS vehicle_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Extraction metadata
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_version TEXT NOT NULL,  -- 'v1.0'
  extraction_method TEXT NOT NULL,   -- 'regex', 'llm', 'hybrid'
  extraction_confidence NUMERIC(3,2),

  -- Acquisition & Ownership
  acquisition_year INT,
  acquisition_source TEXT,  -- 'private', 'dealer', 'bat', 'estate'
  previous_bat_sale_url TEXT,
  owner_count INT,
  original_owner_type TEXT,
  is_single_family BOOLEAN,

  -- Service & Modifications
  service_events JSONB DEFAULT '[]',
  last_service_year INT,
  is_modified BOOLEAN,
  modification_level TEXT,  -- 'stock', 'mild', 'moderate', 'extensive'
  modifications JSONB DEFAULT '[]',
  parts_replaced JSONB DEFAULT '[]',

  -- Documentation
  has_service_records BOOLEAN,
  service_records_from_year INT,
  has_window_sticker BOOLEAN,
  has_owners_manual BOOLEAN,
  has_tools BOOLEAN,
  documentation_list JSONB DEFAULT '[]',

  -- Condition
  is_running BOOLEAN,
  is_driving BOOLEAN,
  is_project BOOLEAN,
  known_issues JSONB DEFAULT '[]',
  seller_condition_notes JSONB DEFAULT '[]',

  -- Provenance
  registration_states JSONB DEFAULT '[]',
  original_delivery_dealer TEXT,
  climate_history TEXT,
  rust_belt_exposure BOOLEAN,
  is_rust_free BOOLEAN,

  -- Authenticity
  matching_numbers BOOLEAN,
  is_repainted BOOLEAN,
  repaint_year INT,
  is_original_color BOOLEAN,
  replacement_components JSONB DEFAULT '[]',
  authenticity_level TEXT,

  -- Awards
  awards JSONB DEFAULT '[]',
  is_concours_quality BOOLEAN,

  -- Rarity
  production_number INT,
  total_production INT,
  special_edition_name TEXT,
  rarity_notes JSONB DEFAULT '[]',

  -- Community Intelligence (from comments)
  seller_disclosures JSONB DEFAULT '[]',
  expert_insights JSONB DEFAULT '[]',
  comparable_sales JSONB DEFAULT '[]',
  condition_concerns JSONB DEFAULT '[]',

  CONSTRAINT vehicle_intelligence_vehicle_id_key UNIQUE (vehicle_id)
);
```

---

## Tier 1: Regex Patterns (Free, Deterministic)

These patterns are reliable enough for regex extraction:

```typescript
const TIER1_PATTERNS = {
  // Ownership
  owner_count: {
    1: /\b(one|single|1|first)[- ]?owner\b/i,
    2: /\b(two|second|2nd)[- ]?owner\b/i,
    3: /\b(three|third|3rd)[- ]?owner\b/i,
  },
  is_original_owner: /\boriginal owner\b/i,

  // Acquisition
  acquisition_year: /(?:acquired|purchased)(?: by the seller)? in (\d{4})/i,
  previous_bat_sale: /(?:purchased|listed|sold) on BaT/i,

  // Documentation
  has_service_records: /\bservice records\b|\bmaintenance records\b/i,
  has_window_sticker: /\bwindow sticker\b|\bmonroney\b/i,
  has_owners_manual: /\bowner'?s? manual\b|\bbooks\b/i,
  has_tools: /\btool (?:roll|kit)\b/i,

  // Condition
  is_running_driving: /\brunning[- ]and[- ]driving\b|\bruns and drives\b/i,
  is_project: /\bproject\b|\bbarn find\b|\bneeds work\b/i,

  // Authenticity
  matching_numbers: /\bnumbers[- ]matching\b|\bmatching[- ]numbers\b/i,
  is_repainted: /\brefinished in\b|\brepainted\b|\brespray/i,
  is_original_color: /\boriginal color\b|\bfactory color\b/i,

  // Provenance
  california_car: /\bcalifornia car\b|\bCA car\b|\bremained registered in California\b/i,
  never_seen_snow: /\bnever seen snow\b|\bdry climate\b|\bnever driven in winter\b/i,
  rust_free: /\brust[- ]free\b|\bno rust\b/i,

  // Rarity
  one_of_x: /\bone of (?:only )?(\d+)\b/i,
  number_of_total: /#(\d+) of (\d+)/i,

  // Awards
  ncrs_top_flight: /\bNCRS Top Flight\b/i,
  bloomington_gold: /\bBloomington Gold\b/i,
};
```

---

## Tier 2: LLM Extraction Prompt

```
You are extracting structured data from a vehicle listing description.

CRITICAL RULES:
1. Extract ONLY what is explicitly stated - do NOT infer or assume
2. If information is unclear, use null
3. Return valid JSON only - no markdown, no explanations

VEHICLE: {year} {make} {model}
DESCRIPTION:
---
{description}
---

Extract this JSON structure:
{
  "acquisition": {"year": <int|null>, "source": <string|null>},
  "ownership": {"count": <int|null>, "notable_owner": <string|null>},
  "service_events": [{"date": <string>, "description": <string>, "shop": <string|null>}],
  "modifications": {"is_modified": <bool>, "level": <string|null>, "items": [...]},
  "documentation": {"has_service_records": <bool|null>, "items": [...]},
  "condition": {"known_issues": [...], "seller_notes": [...]},
  "provenance": {"states": [...], "climate": <string|null>},
  "authenticity": {"matching_numbers": <bool|null>, "is_repainted": <bool|null>},
  "awards": [{"name": <string>, "year": <int|null>, "score": <float|null>}],
  "rarity": {"production_number": <int|null>, "total_production": <int|null>, "notes": [...]}
}
```

---

## Example Extraction

### Input
```
Year: 1970
Make: Chevrolet
Model: Corvette Coupe

Description:
This 1970 Chevrolet Corvette coupe was acquired by the seller in 2024, and work
since then included overhauling the front suspension as well as replacing the
battery, alternator, starter, radiator, heater core, coolant hoses, valve cover
gaskets, front wheel seals, rear strut rod arms, seat belts, and power window
motors. Refinished in blue over black vinyl, the car is powered by a replacement
350ci V8 linked to a four-speed manual transmission and a limited-slip differential.
```

### Tier 1 Output (Regex)
```json
{
  "acquisition_year": 2024,
  "is_repainted": true,
  "matching_numbers": null
}
```

### Tier 2 Output (LLM)
```json
{
  "acquisition": {"year": 2024, "source": null},
  "service_events": [
    {"date": "2024", "description": "Front suspension overhaul", "shop": null},
    {"date": "2024", "description": "Replaced battery, alternator, starter, radiator, heater core, coolant hoses, valve cover gaskets, front wheel seals, rear strut rod arms, seat belts, power window motors", "shop": null}
  ],
  "authenticity": {
    "matching_numbers": false,
    "is_repainted": true,
    "replacement_components": ["engine"]
  },
  "parts_replaced": ["battery", "alternator", "starter", "radiator", "heater core", "coolant hoses", "valve cover gaskets", "front wheel seals", "rear strut rod arms", "seat belts", "power window motors"]
}
```

---

## Comment Intelligence Patterns

Comments contain seller Q&A and expert knowledge. Key patterns:

### Seller Disclosures (marked `is_seller: true`)
```
@[user] The compression test showed all cylinders between 165-170 psi
@[user] The transmission was swapped to a 5-speed in 2015
```
→ Extract as `seller_disclosures[]`

### Expert Knowledge
```
This is one of approximately 200 built with the Sport package
The VIN decodes to Dingolfing plant, September 1988 production
```
→ Extract as `expert_insights[]`

### Comparable Sales
```
Similar car sold here last month for $45k
I sold mine for $38k in 2019
```
→ Extract as `comparable_sales[]`

---

## Testing Strategy

### Unit Test: Regex Patterns
```typescript
const testCases = [
  {input: "This one-owner car...", expected: {owner_count: 1}},
  {input: "The third owner acquired...", expected: {owner_count: 3}},
  {input: "Matching numbers drivetrain", expected: {matching_numbers: true}},
  {input: "Numbers-matching 396", expected: {matching_numbers: true}},
];
```

### Integration Test: Full Extraction
1. Pick 10 vehicles with rich descriptions
2. Run extraction
3. Manually verify output accuracy
4. Calculate field fill rate

### Validation Queries
```sql
-- Coverage: % of vehicles with intelligence
SELECT
  COUNT(*) FILTER (WHERE vi.id IS NOT NULL) as analyzed,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE vi.id IS NOT NULL) / COUNT(*), 2) as pct
FROM vehicles v
LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
WHERE v.description IS NOT NULL AND LENGTH(v.description) > 100;

-- Field fill rate
SELECT
  AVG(CASE WHEN owner_count IS NOT NULL THEN 1 ELSE 0 END) as owner_count_fill,
  AVG(CASE WHEN has_service_records IS NOT NULL THEN 1 ELSE 0 END) as service_records_fill,
  AVG(CASE WHEN matching_numbers IS NOT NULL THEN 1 ELSE 0 END) as matching_numbers_fill
FROM vehicle_intelligence;
```

---

## Implementation Order

1. **Create `vehicle_intelligence` table** (schema above)
2. **Build Tier 1 regex extractor** edge function
3. **Test on 100 vehicles**, validate output
4. **Run Tier 1 on all vehicles** with descriptions (~126k, free)
5. **Build Tier 2 LLM extractor** using prompt template
6. **Run Tier 2 on $50k+ vehicles** (~10k, ~$500 at Haiku rates)
7. **Build comment analyzer** for seller disclosures + expert insights
8. **Create analysis queries** for the structured data

---

## Cost Estimates

| Method | Vehicles | Cost |
|--------|----------|------|
| Tier 1 Regex | 126k | $0 |
| Tier 2 Haiku | 126k | ~$30 |
| Tier 2 Sonnet | 10k (high-value) | ~$50 |

---

## Success Metrics

- **Coverage**: 100% of vehicles with descriptions have `vehicle_intelligence` row
- **Field fill rate**: Average 15+ non-null fields per vehicle
- **Confidence**: Average extraction_confidence > 0.7
- **Zero regressions**: Profile extraction pipeline unaffected

---

## Rollback

If anything breaks:
```sql
-- Safe: only affects intelligence, not profiles
TRUNCATE vehicle_intelligence;
DROP TABLE IF EXISTS vehicle_intelligence;
```

---

## CLI Commands (Future)

```bash
# Analyze single vehicle
./scripts/analyze-description.sh <vehicle_id>

# Batch analyze (Tier 1 only)
./scripts/batch-analyze-descriptions.sh --tier1 --limit 1000

# Batch analyze (hybrid)
./scripts/batch-analyze-descriptions.sh --hybrid --min-price 50000
```

---

## Current State

### Profile Extraction (RUNNING)
- **Status**: 135+ vehicles extracted, 0 failures
- **Script**: `./scripts/bat-bulk-extract.sh`
- **Log**: `logs/bat-bulk-extract/extract-20260123.log`

### Description Intelligence (NOT STARTED)
- **Schema**: Defined in `docs/DESCRIPTION_INTELLIGENCE_SPEC.md`
- **Patterns**: Analyzed in `docs/BAT_DESCRIPTION_COMMENT_PATTERNS.md`
- **Prompt**: Ready in `prompts/description-intelligence-extraction.md`
- **Next step**: Create `vehicle_intelligence` table

---

## RLM_INPUT_FILES

- docs/DESCRIPTION_INTELLIGENCE_SPEC.md
- docs/BAT_DESCRIPTION_COMMENT_PATTERNS.md
- prompts/description-intelligence-extraction.md
- docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
- supabase/functions/extract-bat-core/index.ts
- supabase/functions/extract-auction-comments/index.ts
