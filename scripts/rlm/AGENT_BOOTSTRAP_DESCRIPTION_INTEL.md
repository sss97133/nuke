# AGENT BOOTSTRAP: Description Intelligence System
**Target Agent**: Fresh agent with no prior context
**Time to Proficiency**: Single read
**Last Updated**: 2026-01-23

---

## TL;DR - What You're Doing

You are building a **read-only analysis layer** that transforms raw vehicle description text into structured database fields. The raw descriptions already exist in the `vehicles` table. Your job is to extract intelligence from them WITHOUT modifying the source data.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        THE ONE RULE YOU CANNOT BREAK                        │
│─────────────────────────────────────────────────────────────────────────────│
│                                                                             │
│   NEVER write to:  vehicles.year, vehicles.make, vehicles.model,           │
│                    vehicles.vin, vehicles.description, vehicles.*          │
│                                                                             │
│   ONLY write to:   vehicle_intelligence (new table you create)             │
│                                                                             │
│   WHY: Profile extraction pipeline is running. If you touch vehicles,      │
│        you corrupt 126k+ records and months of work.                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Context Load (Read These Files)

**In this exact order** - each builds on the previous:

| Order | File | Why | Read Time |
|-------|------|-----|-----------|
| 1 | `/Users/skylar/nuke/CLAUDE.md` | Project-wide context, tools, conventions | 2 min |
| 2 | `/Users/skylar/nuke/docs/DESCRIPTION_INTELLIGENCE_SPEC.md` | Full system specification | 5 min |
| 3 | `/Users/skylar/nuke/docs/BAT_DESCRIPTION_COMMENT_PATTERNS.md` | Pattern analysis from real data | 5 min |
| 4 | `/Users/skylar/nuke/prompts/description-intelligence-extraction.md` | LLM prompt templates | 3 min |
| 5 | `/Users/skylar/nuke/scripts/rlm/description_intelligence_context.md` | Detailed RLM context | 5 min |

**DO NOT READ** (yet) - these are reference only:
- `supabase/functions/extract-bat-core/index.ts` - Profile extractor, DO NOT MODIFY
- `supabase/functions/extract-auction-comments/index.ts` - Comment extractor, DO NOT MODIFY

---

## The Problem We're Solving

BaT (Bring a Trailer) descriptions are RICH with information that's not captured anywhere:

**What we have now:**
```sql
SELECT description FROM vehicles WHERE id = '...';
-- Returns: "This 1970 Chevrolet Corvette coupe was acquired by the seller
-- in 2024... Refinished in blue... powered by a replacement 350ci V8..."
```

**What we want:**
```sql
SELECT * FROM vehicle_intelligence WHERE vehicle_id = '...';
-- Returns structured JSON:
-- acquisition_year: 2024
-- is_repainted: true
-- matching_numbers: false
-- replacement_components: ["engine"]
-- service_events: [{date: "2024", description: "suspension overhaul"}]
```

---

## Your Loop (RLM-Style Autonomous Cycle)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              THE DESCRIPTION INTEL LOOP                      │
└─────────────────────────────────────────────────────────────────────────────┘

START:
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: VALIDATE ENVIRONMENT                                                │
│─────────────────────────────────────────────────────────────────────────────│
│ □ Check if vehicle_intelligence table exists                                 │
│ □ If not → CREATE IT FIRST (schema in spec doc)                             │
│ □ Check profile extraction status (should be running, don't touch)          │
│ □ Get count of vehicles needing analysis                                     │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: FETCH BATCH                                                         │
│─────────────────────────────────────────────────────────────────────────────│
│ SELECT v.id, v.description, v.year, v.make, v.model, v.sale_price           │
│ FROM vehicles v                                                              │
│ LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id                   │
│ WHERE v.description IS NOT NULL                                              │
│   AND LENGTH(v.description) > 100                                            │
│   AND vi.id IS NULL  -- Not yet analyzed                                     │
│ ORDER BY v.sale_price DESC NULLS LAST                                        │
│ LIMIT 100;                                                                   │
│                                                                              │
│ WHY sale_price DESC: High-value vehicles first = more ROI on analysis       │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: TIER 1 - REGEX EXTRACTION (FREE)                                    │
│─────────────────────────────────────────────────────────────────────────────│
│ For each vehicle:                                                            │
│   □ Run deterministic regex patterns                                         │
│   □ Extract: owner_count, acquisition_year, matching_numbers,               │
│              has_service_records, is_repainted, is_rust_free...             │
│   □ Store results with extraction_method = 'regex'                          │
│                                                                              │
│ COST: $0                                                                     │
│ ACCURACY: High for boolean flags, medium for complex data                   │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: TIER 2 - LLM EXTRACTION (PAID)                                      │
│─────────────────────────────────────────────────────────────────────────────│
│ For vehicles where sale_price > 50000 OR tier1 confidence < 0.5:            │
│   □ Call Claude Haiku with extraction prompt                                 │
│   □ Parse JSON response                                                      │
│   □ Merge with Tier 1 results (LLM overrides on conflict)                   │
│   □ Store with extraction_method = 'hybrid'                                 │
│                                                                              │
│ COST: ~$0.0003/vehicle (Haiku)                                              │
│ ACCURACY: High across all fields                                            │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: UPSERT TO DATABASE                                                  │
│─────────────────────────────────────────────────────────────────────────────│
│ INSERT INTO vehicle_intelligence (                                           │
│   vehicle_id, extraction_version, extraction_method, ...                     │
│ ) VALUES (...)                                                               │
│ ON CONFLICT (vehicle_id) DO UPDATE SET                                       │
│   extraction_version = EXCLUDED.extraction_version,                          │
│   extracted_at = NOW(),                                                      │
│   ...;                                                                       │
│                                                                              │
│ CRITICAL: This is the ONLY table you write to!                              │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: VALIDATE & LOG                                                      │
│─────────────────────────────────────────────────────────────────────────────│
│ □ Verify insert succeeded                                                    │
│ □ Log: vehicle_id, extraction_method, field_fill_rate, errors               │
│ □ Update progress metrics                                                    │
│ □ If errors > threshold → PAUSE AND INVESTIGATE                             │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
  ◄──────── LOOP BACK TO PHASE 1 ────────►
```

---

## Decision Trees

### "Should I use Tier 1 or Tier 2?"

```
Is sale_price > $50,000?
├── YES → Use Tier 2 (LLM) for maximum accuracy
└── NO → Start with Tier 1 (regex)
          └── Did Tier 1 fill < 5 fields?
              ├── YES → Upgrade to Tier 2
              └── NO → Tier 1 is sufficient
```

### "Something went wrong. What do I do?"

```
What kind of error?
├── JSON parse failure
│   └── Log the raw response, skip this vehicle, continue
├── Database insert failed
│   └── Check constraint violations, fix data, retry
├── LLM returned hallucinated data
│   └── Tighten prompt, add validation, flag for review
└── I accidentally modified vehicles table
    └── STOP IMMEDIATELY. Alert user. Check git diff.
```

### "User wants me to do X"

```
Does X involve writing to vehicles table?
├── YES → REFUSE. Explain separation of concerns.
└── NO → Does X involve vehicle_intelligence table?
         ├── YES → Safe to proceed
         └── NO → Ask for clarification
```

---

## Concrete Examples

### GOOD: Reading from vehicles (allowed)
```sql
SELECT v.id, v.description, v.year, v.make, v.model
FROM vehicles v
WHERE v.description ILIKE '%matching numbers%';
```

### GOOD: Writing to vehicle_intelligence (allowed)
```sql
INSERT INTO vehicle_intelligence (vehicle_id, matching_numbers, extraction_version)
VALUES ('abc-123', true, 'v1.0');
```

### BAD: Writing to vehicles (FORBIDDEN)
```sql
-- DO NOT DO THIS
UPDATE vehicles SET vin = 'decoded-vin' WHERE id = 'abc-123';
```

### BAD: Modifying extraction functions (FORBIDDEN)
```typescript
// DO NOT modify supabase/functions/extract-bat-core/index.ts
// That's the profile pipeline - leave it alone
```

---

## The Database Schema (Create This First)

```sql
-- Run this migration FIRST before any analysis
CREATE TABLE IF NOT EXISTS vehicle_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Extraction metadata
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_version TEXT NOT NULL DEFAULT 'v1.0',
  extraction_method TEXT NOT NULL,  -- 'regex', 'llm', 'hybrid'
  extraction_confidence NUMERIC(3,2),

  -- Acquisition & Ownership
  acquisition_year INT,
  acquisition_source TEXT,
  previous_bat_sale_url TEXT,
  owner_count INT,
  original_owner_type TEXT,
  is_single_family BOOLEAN,

  -- Service & Modifications
  service_events JSONB DEFAULT '[]',
  last_service_year INT,
  is_modified BOOLEAN,
  modification_level TEXT,
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

  -- Raw extraction output (for debugging/re-processing)
  raw_tier1_output JSONB,
  raw_tier2_output JSONB,
  extraction_notes JSONB DEFAULT '[]',

  CONSTRAINT vehicle_intelligence_vehicle_id_key UNIQUE (vehicle_id)
);

-- Performance indexes
CREATE INDEX idx_vehicle_intelligence_extraction_version
  ON vehicle_intelligence(extraction_version);
CREATE INDEX idx_vehicle_intelligence_extraction_method
  ON vehicle_intelligence(extraction_method);
CREATE INDEX idx_vehicle_intelligence_matching_numbers
  ON vehicle_intelligence(matching_numbers) WHERE matching_numbers IS NOT NULL;
CREATE INDEX idx_vehicle_intelligence_owner_count
  ON vehicle_intelligence(owner_count) WHERE owner_count IS NOT NULL;
```

---

## Tier 1 Regex Patterns (TypeScript Reference)

```typescript
const TIER1_EXTRACTORS = {
  // === OWNERSHIP ===
  owner_count: (desc: string): number | null => {
    const patterns = [
      { pattern: /\b(one|single|1|first)[- ]?owner\b/i, value: 1 },
      { pattern: /\b(two|second|2nd)[- ]?owner\b/i, value: 2 },
      { pattern: /\b(three|third|3rd)[- ]?owner\b/i, value: 3 },
      { pattern: /\b(four|fourth|4th)[- ]?owner\b/i, value: 4 },
    ];
    for (const { pattern, value } of patterns) {
      if (pattern.test(desc)) return value;
    }
    return null;
  },

  // === ACQUISITION ===
  acquisition_year: (desc: string): number | null => {
    const match = desc.match(/(?:acquired|purchased)(?: by the seller)? in (\d{4})/i);
    return match ? parseInt(match[1], 10) : null;
  },

  previous_bat_sale: (desc: string): boolean => {
    return /(?:previously|sold|listed) on (?:BaT|Bring a Trailer)/i.test(desc);
  },

  // === DOCUMENTATION ===
  has_service_records: (desc: string): boolean | null => {
    if (/\bservice records\b|\bmaintenance records\b|\bservice history\b/i.test(desc)) return true;
    return null; // Don't assume false
  },

  service_records_from_year: (desc: string): number | null => {
    const match = desc.match(/service records (?:dating to|from|since) (\d{4})/i);
    return match ? parseInt(match[1], 10) : null;
  },

  has_window_sticker: (desc: string): boolean | null => {
    return /\bwindow sticker\b|\bmonroney\b/i.test(desc) ? true : null;
  },

  has_owners_manual: (desc: string): boolean | null => {
    return /\bowner'?s? manual\b|\bbooks\b/i.test(desc) ? true : null;
  },

  has_tools: (desc: string): boolean | null => {
    return /\btool (?:roll|kit)\b|\btools\b/i.test(desc) ? true : null;
  },

  // === CONDITION ===
  is_running_driving: (desc: string): { running: boolean; driving: boolean } | null => {
    if (/\bruns and drives\b|\brunning[- ]and[- ]driving\b/i.test(desc)) {
      return { running: true, driving: true };
    }
    return null;
  },

  is_project: (desc: string): boolean => {
    return /\bproject\b|\bbarn find\b|\bneeds work\b|\bfor restoration\b/i.test(desc);
  },

  // === AUTHENTICITY ===
  matching_numbers: (desc: string): boolean | null => {
    if (/\bnumbers[- ]matching\b|\bmatching[- ]numbers\b/i.test(desc)) return true;
    if (/\bnon[- ]?matching\b|\breplacement (?:engine|motor|drivetrain)/i.test(desc)) return false;
    return null;
  },

  is_repainted: (desc: string): boolean | null => {
    if (/\brefinished in\b|\brepainted\b|\brespray/i.test(desc)) return true;
    if (/\boriginal paint\b/i.test(desc)) return false;
    return null;
  },

  is_original_color: (desc: string): boolean | null => {
    if (/\boriginal color\b|\bfactory color\b/i.test(desc)) return true;
    if (/\brefinished in [a-z]+ over/i.test(desc)) return false; // "Refinished in blue over..."
    return null;
  },

  // === PROVENANCE ===
  registration_states: (desc: string): string[] => {
    const states: string[] = [];
    if (/\bcalifornia car\b|\bCA car\b|\bregistered in California\b/i.test(desc)) states.push('CA');
    if (/\bflorida car\b|\bFL car\b/i.test(desc)) states.push('FL');
    if (/\barizona car\b|\bAZ car\b/i.test(desc)) states.push('AZ');
    if (/\btexas car\b|\bTX car\b/i.test(desc)) states.push('TX');
    // Add more as needed
    return states;
  },

  climate_history: (desc: string): string | null => {
    if (/\bnever seen snow\b|\bdry climate\b|\bsouthwest car\b/i.test(desc)) return 'dry';
    if (/\bcoastal\b|\bsalt air\b/i.test(desc)) return 'coastal';
    if (/\bmidwest\b|\brust belt\b/i.test(desc)) return 'winter';
    return null;
  },

  is_rust_free: (desc: string): boolean | null => {
    if (/\brust[- ]free\b|\bno rust\b/i.test(desc)) return true;
    if (/\brust\b|\bcorrosion\b/i.test(desc) && !/rust[- ]free|no rust/i.test(desc)) return false;
    return null;
  },

  // === RARITY ===
  production_numbers: (desc: string): { number: number; total: number } | null => {
    // "#16 of 153" or "number 16 of 153"
    let match = desc.match(/#(\d+) of (\d+)/i) || desc.match(/number (\d+) of (\d+)/i);
    if (match) return { number: parseInt(match[1]), total: parseInt(match[2]) };

    // "one of 153" or "one of only 153"
    match = desc.match(/\bone of (?:only )?(\d+)\b/i);
    if (match) return { number: null, total: parseInt(match[1]) };

    return null;
  },

  special_edition: (desc: string): string | null => {
    const patterns = [
      /\b(\w+ Edition)\b/i,
      /\b(Limited Edition)\b/i,
      /\b(Anniversary Edition)\b/i,
      /\b(Special Edition)\b/i,
    ];
    for (const pattern of patterns) {
      const match = desc.match(pattern);
      if (match) return match[1];
    }
    return null;
  },

  // === AWARDS ===
  awards: (desc: string): Array<{ name: string; year?: number; score?: number }> => {
    const awards: Array<{ name: string; year?: number; score?: number }> = [];

    // NCRS Top Flight
    const ncrsMatch = desc.match(/NCRS Top Flight(?: (?:Award|score))?(?: (?:of|with) )?(\d+\.?\d*)?/i);
    if (ncrsMatch) {
      awards.push({
        name: 'NCRS Top Flight',
        score: ncrsMatch[1] ? parseFloat(ncrsMatch[1]) : undefined
      });
    }

    // Bloomington Gold
    if (/\bBloomington Gold\b/i.test(desc)) {
      awards.push({ name: 'Bloomington Gold' });
    }

    // NCRS Duntov
    if (/\bNCRS Duntov\b/i.test(desc)) {
      awards.push({ name: 'NCRS Duntov Mark of Excellence' });
    }

    return awards;
  },
};
```

---

## LLM Prompt (Tier 2)

Located at: `/Users/skylar/nuke/prompts/description-intelligence-extraction.md`

**Key points:**
- System prompt emphasizes EXPLICIT extraction only (no inference)
- User prompt includes vehicle context (year, make, model, price)
- Output is strict JSON
- Model: Claude Haiku for cost ($0.0003/vehicle)
- Upgrade to Sonnet for $100k+ vehicles

---

## Validation Queries

### Coverage Report
```sql
SELECT
  COUNT(*) FILTER (WHERE vi.id IS NOT NULL) as analyzed,
  COUNT(*) as total_with_descriptions,
  ROUND(100.0 * COUNT(*) FILTER (WHERE vi.id IS NOT NULL) / COUNT(*), 2) as coverage_pct
FROM vehicles v
LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
WHERE v.description IS NOT NULL AND LENGTH(v.description) > 100;
```

### Field Fill Rate
```sql
SELECT
  COUNT(*) as total,
  AVG(CASE WHEN owner_count IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC(3,2) as owner_count_fill,
  AVG(CASE WHEN has_service_records IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC(3,2) as service_records_fill,
  AVG(CASE WHEN matching_numbers IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC(3,2) as matching_numbers_fill,
  AVG(CASE WHEN is_repainted IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC(3,2) as repainted_fill,
  AVG(CASE WHEN acquisition_year IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC(3,2) as acquisition_fill
FROM vehicle_intelligence;
```

### High-Value Gap Analysis
```sql
SELECT v.id, v.year, v.make, v.model, v.sale_price
FROM vehicles v
LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
WHERE v.description IS NOT NULL
  AND v.sale_price > 100000
  AND vi.id IS NULL
ORDER BY v.sale_price DESC
LIMIT 20;
```

---

## Emergency Rollback

If ANYTHING goes wrong:

```sql
-- Safe: Only affects intelligence table, not source data
TRUNCATE vehicle_intelligence;

-- Or nuclear option:
DROP TABLE IF EXISTS vehicle_intelligence;

-- Verify profiles are intact:
SELECT COUNT(*) FROM vehicles WHERE description IS NOT NULL;
-- Should match what you started with
```

---

## Current System State

As of 2026-01-23:

| Component | Status |
|-----------|--------|
| Profile Extraction | RUNNING - 200+ extracted, 126k pending |
| vehicle_intelligence table | NOT CREATED YET |
| Tier 1 Extractor | SPEC COMPLETE, not implemented |
| Tier 2 Extractor | PROMPT COMPLETE, not implemented |
| Analysis Queries | NOT BUILT |

**Your first task**: Create the `vehicle_intelligence` table.

---

## Loop Shell Reference

Use `/Users/skylar/nuke/scripts/description-intel-loop.sh` for monitoring:

```bash
# Check status
./scripts/description-intel-loop.sh --status

# Test extraction on sample
./scripts/description-intel-loop.sh --test

# Run Tier 1 batch
./scripts/description-intel-loop.sh --tier1 --limit 100

# Run hybrid batch (Tier 1 + Tier 2 for expensive vehicles)
./scripts/description-intel-loop.sh --hybrid --limit 50
```

---

## Success Metrics

You're done when:
- [ ] `vehicle_intelligence` table exists with proper schema
- [ ] Coverage: 100% of vehicles with descriptions have intelligence rows
- [ ] Field fill rate: Average 10+ non-null fields per vehicle
- [ ] Zero modifications to `vehicles` table
- [ ] Profile extraction pipeline still running with 0 new failures

---

## FAQ

**Q: Can I add a new field to vehicle_intelligence?**
A: Yes! That table is yours. Just run ALTER TABLE.

**Q: Can I fix a typo in vehicles.description?**
A: NO. That's the source data. Log the issue and move on.

**Q: The LLM is returning bad data for some vehicles. What do I do?**
A: Adjust the prompt, add validation, flag the vehicle for manual review. Never modify source.

**Q: How do I know if profile extraction is still running?**
A: `./scripts/bat-bulk-extract.sh --status`

**Q: What if I need data from comments?**
A: Read from `auction_comments` table. Same rule: READ-ONLY.

---

## Files You'll Create

```
supabase/functions/analyze-vehicle-description/index.ts  -- Single vehicle analyzer
supabase/functions/batch-analyze-descriptions/index.ts   -- Batch processor
database/migrations/20260123_create_vehicle_intelligence.sql
scripts/run-description-intel.sh  -- Orchestration script
```

---

## Files You Must NOT Modify

```
supabase/functions/extract-bat-core/index.ts
supabase/functions/extract-auction-comments/index.ts
supabase/functions/bat-simple-extract/index.ts
supabase/functions/bat-batch-extract/index.ts
scripts/bat-bulk-extract.sh
```

---

END OF BOOTSTRAP DOCUMENT. You now have everything needed to build the Description Intelligence System safely.
