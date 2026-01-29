# Schema Evolution Workflow

Builders, suppliers, and fabrication shops regularly expose structured data we do not capture yet. Every mapper run must surface those gaps, and the Schema Steward must turn vetted proposals into migrations. This document defines that loop.

---

## 1. Where Proposals Live

- `source_site_schemas.schema_proposals` (JSON array) contains the latest recommendations for a domain.
- Each entry should include: `name`, `description`, `fields[]`, `relationships`, `justification`, and optional `priority`.
- Mapper jobs append to this array, and Validators leave it untouched.

### Querying Open Proposals
```sql
SELECT
  domain,
  site_type,
  site_specialization,
  schema_proposals
FROM source_site_schemas
WHERE schema_proposals IS NOT NULL
  AND jsonb_array_length(schema_proposals) > 0
ORDER BY updated_at DESC;
```

---

## 2. Steward Review Checklist

1. **Validate the Source**
   - Open the referenced URLs and confirm the data truly exists.
   - Ensure it is structured enough to justify a schema addition.
2. **Assess Reuse**
   - Decide if the data belongs in an existing table, a new table, or a JSON column.
   - Consider whether the field applies to other orgs (builders vs. dealers).
3. **Design the DDL**
   - Pick column/table names that describe the data (no dealer-centric wording).
   - Include `DEFAULT` values and sensible data types.
   - Add foreign keys and indexes where needed.
   - Always include IF NOT EXISTS guards so `supabase db reset` remains idempotent.
4. **Write the Migration**
   - Place the canonical definition in the appropriate baseline migration (when practical).
   - Add a dated migration (e.g., `YYYYMMDDHHMMSS_add_builder_projects.sql`) that alters existing databases.
   - Update docs referencing the schema (schema brief, prompts if necessary).
5. **Mark Proposal as Addressed**
   - Remove or annotate the corresponding entry in `schema_proposals`.
   - Include notes in `source_site_schemas.pollution_notes` or `rarity_notes` if helpful.

### Migration Template Snippet
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'builder_projects') THEN
    CREATE TABLE builder_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
      vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
      project_code TEXT,
      stage TEXT,
      metadata JSONB DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

ALTER TABLE builder_projects
  ADD COLUMN IF NOT EXISTS supplier_org_ids UUID[] REFERENCES businesses(id)[];
```

---

## 3. Document Every Change

Whenever a schema proposal is approved:
- Update `[docs/ingestion/SCHEMA_BRIEF.md](./SCHEMA_BRIEF.md)` with the new table/fields.
- Revise `[docs/ingestion/LLM_PROMPTS.md](./LLM_PROMPTS.md)` if the mapper needs to collect the new data.
- Mention the change log in `docs/ingestion/FIXES_APPLIED.md` (optional) for quick traceability.

---

## 4. Feedback Loop

1. Mapper sees new data → writes proposal.
2. Steward implements schema → marks proposal done.
3. Mapper re-runs (or validator) to populate the new columns.
4. Extraction agent uses upgraded schema.

This process keeps the database evolving at the same pace as the market while maintaining auditability.


