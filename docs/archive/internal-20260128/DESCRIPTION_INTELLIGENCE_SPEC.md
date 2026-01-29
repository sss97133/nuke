# Description Intelligence System Specification

**Status**: SPECIFICATION ONLY - NOT YET IMPLEMENTED
**Purpose**: Transform raw description text into structured database fields
**Decoupled From**: Profile extraction pipeline (extract-bat-core, extract-auction-comments)

---

## Architecture: Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────┐
│  PIPELINE 1: Profile Extraction (EXISTING - DO NOT MODIFY)     │
│  ─────────────────────────────────────────────────────────────  │
│  extract-bat-core → vehicles, vehicle_images, auction_events   │
│  extract-auction-comments → auction_comments                   │
│                                                                 │
│  Stores: vehicles.description (raw text)                        │
│  Stores: auction_comments.comment_text (raw text)              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    (description text exists)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PIPELINE 2: Description Intelligence (THIS SYSTEM - NEW)      │
│  ─────────────────────────────────────────────────────────────  │
│  Reads: vehicles.description, auction_comments.comment_text    │
│  Writes: vehicle_intelligence (NEW TABLE)                      │
│                                                                 │
│  Runs: Independently, after extraction, on-demand or batch     │
│  Can: Re-run without affecting source data                     │
│  Can: Be improved/iterated without touching extraction code    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Input (Read-Only)
- `vehicles.id` - Vehicle UUID
- `vehicles.description` - Raw description text from BaT
- `vehicles.year`, `vehicles.make`, `vehicles.model` - For context
- `vehicles.sale_price` - For prioritization
- `auction_comments` where `vehicle_id` matches - Raw comment text

### Output (New Table)
- `vehicle_intelligence` - Structured extraction from description + comments

---

## Database Schema

```sql
-- New table for structured intelligence extracted from descriptions
CREATE TABLE IF NOT EXISTS vehicle_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Extraction metadata
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_version TEXT NOT NULL,  -- e.g., 'v1.0', 'v1.1'
  extraction_method TEXT NOT NULL,   -- 'regex', 'llm', 'hybrid'
  extraction_confidence NUMERIC(3,2), -- 0.00 to 1.00
  source_description_length INT,
  source_comment_count INT,

  -- ═══════════════════════════════════════════════════════════
  -- ACQUISITION & OWNERSHIP
  -- ═══════════════════════════════════════════════════════════

  -- When/how seller acquired the vehicle
  acquisition_year INT,
  acquisition_source TEXT,  -- 'private', 'dealer', 'bat', 'estate', 'auction', 'family'
  acquisition_notes TEXT,

  -- Previous BaT sale (if mentioned)
  previous_bat_sale_url TEXT,
  previous_bat_sale_date DATE,
  previous_bat_sale_price NUMERIC(12,2),

  -- Ownership chain
  owner_count INT,  -- null if unknown, 1 for one-owner, etc.
  original_owner_type TEXT,  -- 'individual', 'dealer', 'museum', 'celebrity', 'company'
  original_owner_name TEXT,  -- Only if notable (celebrity, museum, etc.)
  is_single_family BOOLEAN,

  -- ═══════════════════════════════════════════════════════════
  -- SERVICE & MODIFICATION HISTORY
  -- ═══════════════════════════════════════════════════════════

  -- Structured service events
  service_events JSONB DEFAULT '[]',
  -- Format: [{"date": "2017", "mileage": 82000, "description": "Engine rebuild", "shop": "Precision Motors"}]

  last_service_year INT,
  last_service_mileage INT,

  -- Modifications
  is_modified BOOLEAN,
  modification_level TEXT,  -- 'stock', 'mild', 'moderate', 'extensive'
  modifications JSONB DEFAULT '[]',
  -- Format: [{"component": "exhaust", "description": "Billy Boat headers", "reversible": true}]

  -- Parts replaced (non-modification replacements)
  parts_replaced JSONB DEFAULT '[]',
  -- Format: ["battery", "alternator", "starter", "radiator"]

  -- ═══════════════════════════════════════════════════════════
  -- DOCUMENTATION
  -- ═══════════════════════════════════════════════════════════

  has_service_records BOOLEAN,
  service_records_from_year INT,
  has_window_sticker BOOLEAN,
  has_owners_manual BOOLEAN,
  has_books BOOLEAN,
  has_tools BOOLEAN,
  has_spare_tire BOOLEAN,
  documentation_list JSONB DEFAULT '[]',
  -- Format: ["service records", "window sticker", "books", "tool roll"]

  -- ═══════════════════════════════════════════════════════════
  -- CONDITION & ISSUES
  -- ═══════════════════════════════════════════════════════════

  is_running BOOLEAN,
  is_driving BOOLEAN,
  is_project BOOLEAN,

  known_issues JSONB DEFAULT '[]',
  -- Format: ["small dent on passenger door", "A/C blows but not cold"]

  seller_condition_notes JSONB DEFAULT '[]',
  -- Format: ["blemishes in the finish", "right rear seat belt buckle missing"]

  needs_work JSONB DEFAULT '[]',
  -- Format: ["clutch may need replacement", "needs new tires"]

  -- ═══════════════════════════════════════════════════════════
  -- PROVENANCE & LOCATION
  -- ═══════════════════════════════════════════════════════════

  registration_states JSONB DEFAULT '[]',
  -- Format: ["California", "Arizona", "Texas"]

  original_delivery_dealer TEXT,
  original_delivery_location TEXT,

  climate_history TEXT,  -- 'dry', 'mixed', 'winter', 'coastal'
  rust_belt_exposure BOOLEAN,
  is_rust_free BOOLEAN,

  -- ═══════════════════════════════════════════════════════════
  -- AUTHENTICITY & ORIGINALITY
  -- ═══════════════════════════════════════════════════════════

  matching_numbers BOOLEAN,  -- true, false, or null if not mentioned
  matching_numbers_partial TEXT,  -- 'engine', 'engine and trans', etc.

  is_repainted BOOLEAN,
  repaint_year INT,
  is_original_color BOOLEAN,
  factory_color_code TEXT,

  is_reupholstered BOOLEAN,
  reupholster_year INT,

  replacement_components JSONB DEFAULT '[]',
  -- Format: ["engine", "transmission", "rear end"]

  authenticity_level TEXT,  -- 'all-original', 'mostly-original', 'restored', 'modified', 'restomod'

  -- ═══════════════════════════════════════════════════════════
  -- AWARDS & CERTIFICATIONS
  -- ═══════════════════════════════════════════════════════════

  awards JSONB DEFAULT '[]',
  -- Format: [{"name": "NCRS Top Flight", "year": 2025, "score": 99.0}]

  certifications JSONB DEFAULT '[]',
  -- Format: ["NCRS Duntov Mark of Excellence", "Bloomington Gold"]

  is_concours_quality BOOLEAN,

  -- ═══════════════════════════════════════════════════════════
  -- RARITY & SPECIAL EDITIONS
  -- ═══════════════════════════════════════════════════════════

  production_number INT,  -- e.g., #16 of 153
  total_production INT,   -- e.g., 153
  special_edition_name TEXT,  -- e.g., "Woodward Edition"
  rarity_notes JSONB DEFAULT '[]',
  -- Format: ["one of 200 with Sport package", "rare color combination"]

  -- ═══════════════════════════════════════════════════════════
  -- COMMUNITY INTELLIGENCE (FROM COMMENTS)
  -- ═══════════════════════════════════════════════════════════

  seller_disclosures JSONB DEFAULT '[]',
  -- Format: ["compression 165-170 psi all cylinders", "transmission swapped in 2015"]

  expert_insights JSONB DEFAULT '[]',
  -- Format: ["one of ~200 with factory Sport package per expert comment"]

  comparable_sales JSONB DEFAULT '[]',
  -- Format: [{"description": "similar car", "price": 45000, "date": "2025-12", "source": "bat"}]

  condition_concerns JSONB DEFAULT '[]',
  -- Format: ["commenter noted rust on undercarriage"]

  reliability_notes JSONB DEFAULT '[]',
  -- Format: ["owner of similar reports 263k miles trouble-free"]

  -- ═══════════════════════════════════════════════════════════
  -- RAW EXTRACTION (for debugging/audit)
  -- ═══════════════════════════════════════════════════════════

  raw_extraction JSONB,  -- Full extraction output for debugging
  extraction_warnings JSONB DEFAULT '[]',  -- Any issues during extraction

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT vehicle_intelligence_vehicle_id_key UNIQUE (vehicle_id)
);

-- Index for finding vehicles that need extraction
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_vehicle_id
  ON vehicle_intelligence(vehicle_id);

-- Index for finding vehicles by extraction version (for re-extraction)
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_version
  ON vehicle_intelligence(extraction_version);
```

---

## Processing Approach

### Phase 1: Tier 1 Regex Extraction (Free, Fast)

High-confidence patterns that can be extracted deterministically:

```typescript
const TIER1_PATTERNS = {
  // Ownership
  owner_count: [
    /\b(one|single|1)[- ]?owner\b/i,           // → 1
    /\bsecond owner\b/i,                        // → 2
    /\bthird owner\b/i,                         // → 3
    /\boriginal owner\b/i,                      // → 1
  ],

  // Acquisition
  acquisition_year: /acquired (?:by the seller )?in (\d{4})/i,
  previous_bat_sale: /(?:purchased|acquired|listed|sold) on BaT in ([A-Za-z]+ \d{4}|\d{4})/i,

  // Documentation
  has_service_records: /service records|maintenance records|service history/i,
  has_window_sticker: /window sticker|monroney/i,
  has_owners_manual: /owner'?s? manual|books/i,

  // Condition
  is_running: /running[- ]and[- ]driving|runs and drives/i,
  is_project: /project|barn find|needs work/i,

  // Authenticity
  matching_numbers: /numbers[- ]matching|matching[- ]numbers/i,
  is_repainted: /refinished in|repainted|respray/i,

  // Location
  california_car: /california car|CA car|remained registered in California/i,
  never_snow: /never seen snow|never driven in winter|dry climate/i,

  // Special editions
  one_of_x: /one of (?:only )?(\d+)(?: (?:produced|built|made))?/i,
  number_of_total: /#(\d+) of (\d+)/i,
};
```

### Phase 2: Tier 2 LLM Extraction (Paid, Complex)

For nuanced extraction that requires context understanding:

```typescript
const TIER2_PROMPT = `
You are extracting structured data from a vehicle listing description.
Extract ONLY what is explicitly stated - do not infer or assume.
If information is not present, use null.

Vehicle: {year} {make} {model}
Description:
---
{description}
---

Extract the following (JSON format):

1. service_events: Array of service/work performed
   - date (year or "YYYY-MM" if known)
   - mileage (if mentioned)
   - description (what was done)
   - shop (if mentioned)

2. modifications: Array of modifications made
   - component (what was modified)
   - description (the modification)
   - reversible (true/false/null)

3. known_issues: Array of disclosed problems

4. seller_condition_notes: Array of condition observations from seller

5. rarity_notes: Array of claims about rarity/special features

Return valid JSON only.
`;
```

---

## Processing Queue

### Option A: Separate Queue Table

```sql
CREATE TABLE IF NOT EXISTS description_analysis_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  priority INT DEFAULT 0,  -- Higher = process first
  status TEXT DEFAULT 'pending',  -- pending, processing, complete, failed
  attempts INT DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  CONSTRAINT description_analysis_queue_vehicle_id_key UNIQUE (vehicle_id)
);

-- Auto-populate from vehicles that have descriptions but no intelligence
INSERT INTO description_analysis_queue (vehicle_id, priority)
SELECT
  v.id,
  CASE
    WHEN v.sale_price > 100000 THEN 100
    WHEN v.sale_price > 50000 THEN 50
    WHEN v.sale_price > 25000 THEN 25
    ELSE 0
  END as priority
FROM vehicles v
LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
WHERE v.description IS NOT NULL
  AND LENGTH(v.description) > 100
  AND vi.id IS NULL
ORDER BY priority DESC;
```

### Option B: Query-Based (Simpler)

Just query vehicles that need processing:

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

---

## Edge Function Specification

### Function: `analyze-vehicle-description`

**Purpose**: Extract structured intelligence from a single vehicle's description

**Input**:
```json
{
  "vehicle_id": "uuid",
  "extraction_method": "tier1" | "tier2" | "hybrid",
  "force": false  // Re-extract even if already done
}
```

**Output**:
```json
{
  "success": true,
  "vehicle_id": "uuid",
  "extraction_version": "v1.0",
  "extraction_method": "hybrid",
  "confidence": 0.85,
  "fields_extracted": 24,
  "warnings": []
}
```

**Behavior**:
1. Fetch vehicle description and comments
2. Run Tier 1 regex extraction
3. If `extraction_method` includes LLM, run Tier 2
4. Merge results (LLM overrides regex where both exist)
5. Upsert to `vehicle_intelligence`
6. Return summary

---

### Function: `batch-analyze-descriptions`

**Purpose**: Process multiple vehicles in batch

**Input**:
```json
{
  "batch_size": 50,
  "min_sale_price": 0,
  "extraction_method": "tier1",
  "skip_existing": true
}
```

---

## Safety Guarantees

1. **Read-only on vehicles table** - Only reads description, never writes
2. **Separate output table** - All writes go to `vehicle_intelligence`
3. **Idempotent** - Can re-run without side effects
4. **Versioned** - `extraction_version` allows tracking what version extracted each row
5. **Re-extractable** - Can delete all `vehicle_intelligence` and re-run from scratch
6. **No profile pollution** - Cannot affect year/make/model/VIN/price fields

---

## Rollback Plan

If description analysis causes any issues:

```sql
-- Option 1: Delete all extracted intelligence (safe - doesn't touch vehicles)
TRUNCATE vehicle_intelligence;

-- Option 2: Delete specific version
DELETE FROM vehicle_intelligence WHERE extraction_version = 'v1.0';

-- Option 3: Drop the table entirely
DROP TABLE IF EXISTS vehicle_intelligence;
DROP TABLE IF EXISTS description_analysis_queue;
```

---

## Implementation Order

1. **Create tables** (schema above)
2. **Build Tier 1 regex extractor** (free, can run on all 126k)
3. **Test on 100 vehicles**
4. **Review results, adjust patterns**
5. **Run Tier 1 on all vehicles with descriptions**
6. **Build Tier 2 LLM extractor** (for high-value vehicles)
7. **Run Tier 2 on $50k+ vehicles**

---

## Success Metrics

- **Coverage**: % of vehicles with description that have intelligence extracted
- **Field fill rate**: Average number of non-null fields per vehicle
- **Confidence distribution**: Histogram of extraction confidence scores
- **Error rate**: % of extractions that fail or have warnings
