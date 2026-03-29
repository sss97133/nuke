# P01: Add Audit Trail Fields

## Context
Read these before executing:
- `docs/library/technical/schematics/observation-system.md` — how vehicle_observations works
- `docs/library/technical/engineering-manual/04-observation-system.md` — ingest-observation internals
- `docs/library/reference/encyclopedia/README.md` Section 20 — audit trail spec
- `docs/library/intellectual/theoreticals/observation-half-life-model.md` — why provenance on data matters

## Problem
When a field is wrong, you can't trace who wrote it. `vehicle_observations` has `source_id` and `confidence_score` but is missing:
- `agent_tier` — which model (haiku/sonnet/opus/human/system) produced this observation
- `extraction_method` — how it was extracted (llm_extraction/html_parse/ocr/api_response/manual_input)
- `raw_source_ref` — URL or ID of the raw archived page this was extracted from
- `extracted_by` — which specific edge function or MCP tool performed the extraction

## Scope
One migration + one function update to `ingest-observation`.

## Steps

1. Read the current `vehicle_observations` schema:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'vehicle_observations'
ORDER BY ordinal_position;
```

2. Read `supabase/functions/ingest-observation/index.ts` to understand the current input schema and what's already captured.

3. Write a migration adding audit columns:
```sql
ALTER TABLE vehicle_observations
  ADD COLUMN IF NOT EXISTS agent_tier text,
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS raw_source_ref text,
  ADD COLUMN IF NOT EXISTS extracted_by text;

-- Add CHECK constraints for valid values
ALTER TABLE vehicle_observations
  ADD CONSTRAINT vo_agent_tier_check
  CHECK (agent_tier IS NULL OR agent_tier = ANY(ARRAY[
    'haiku', 'sonnet', 'opus', 'human', 'system', 'migration'
  ]));

ALTER TABLE vehicle_observations
  ADD CONSTRAINT vo_extraction_method_check
  CHECK (extraction_method IS NULL OR extraction_method = ANY(ARRAY[
    'llm_extraction', 'html_parse', 'ocr', 'api_response', 'manual_input',
    'image_analysis', 'firecrawl', 'graphql', 'migration'
  ]));

COMMENT ON COLUMN vehicle_observations.agent_tier IS 'Which AI model tier or input method produced this observation. Owned by ingest-observation.';
COMMENT ON COLUMN vehicle_observations.extraction_method IS 'How the raw source was converted to structured data. Owned by ingest-observation.';
COMMENT ON COLUMN vehicle_observations.raw_source_ref IS 'URL or ID of the archived raw page this was extracted from. Links to listing_page_snapshots or direct URL.';
COMMENT ON COLUMN vehicle_observations.extracted_by IS 'Name of the edge function or MCP tool that performed the extraction.';
```

4. Update `supabase/functions/ingest-observation/index.ts`:
- Add `agent_tier`, `extraction_method`, `raw_source_ref`, `extracted_by` to the input schema
- Pass them through to the INSERT statement
- These fields should be optional (nullable) — old callers won't break

5. Deploy the updated function:
```bash
cd /Users/skylar/nuke && supabase functions deploy ingest-observation --no-verify-jwt
```

## Verify
```sql
-- Columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'vehicle_observations'
AND column_name IN ('agent_tier', 'extraction_method', 'raw_source_ref', 'extracted_by');
-- Should return 4 rows

-- Constraints exist
SELECT conname FROM pg_constraint
WHERE conrelid = 'vehicle_observations'::regclass
AND conname LIKE 'vo_%';

-- Test insert via function (call ingest-observation with new fields populated)
-- Then verify:
SELECT agent_tier, extraction_method, raw_source_ref, extracted_by
FROM vehicle_observations
ORDER BY created_at DESC LIMIT 1;
-- New fields should be populated
```

## Anti-Patterns
- Do NOT make the new columns NOT NULL. Existing rows don't have them. Old callers don't send them. They must be nullable.
- Do NOT modify any other table. Only `vehicle_observations`.
- Do NOT modify any extractor. Only `ingest-observation`. The extractors will be updated in P03.
- Do NOT rename existing columns.

## Library Contribution
After completing:
- Update `docs/library/reference/dictionary/tables.md` — add the new columns to the `vehicle_observations` entry
- Update `docs/library/technical/schematics/observation-system.md` — add audit fields to the schema section
