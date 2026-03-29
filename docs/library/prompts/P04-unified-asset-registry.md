# P04: Unified Asset Registry

## Context
Read these before executing:
- `docs/library/reference/encyclopedia/README.md` Section 1 — unified asset layer spec
- `docs/library/reference/dictionary/tables.md` — current vehicles table schema
- `docs/library/technical/schematics/entity-relationships.md` — current entity map

## Prerequisites
P00-P03 verified. The observation system is receiving data. Entity resolution uses the universal matcher. Audit trail is populated.

## Problem
Vehicles exist as a standalone entity type. Art, publishing, and future verticals need a shared parent. Cross-domain queries ("show me everything this collector owns") need a common key.

## Scope
One new table. One migration to backfill existing vehicles. One FK addition.

## Steps

1. Create the `assets` registry table:
```sql
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL,
  display_title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text DEFAULT 'active',

  CONSTRAINT assets_type_check CHECK (asset_type = ANY(ARRAY['vehicle', 'artwork']))
);

CREATE INDEX idx_assets_type ON assets(asset_type);
CREATE INDEX idx_assets_status ON assets(status);

COMMENT ON TABLE assets IS 'Universal asset registry. Every vehicle, artwork, and future entity type gets a row. Enables cross-domain queries and shared provenance. See ENCYCLOPEDIA Section 1.';
COMMENT ON COLUMN assets.asset_type IS 'Domain type: vehicle, artwork, or future types. Drives which domain-specific table holds the detail.';
COMMENT ON COLUMN assets.display_title IS 'Human-readable title. For vehicles: "1984 Chevrolet K10". For artworks: "Untitled, 1982". Generated from domain-specific fields.';
```

2. Add `asset_id` to vehicles:
```sql
ALTER TABLE vehicles ADD COLUMN asset_id uuid REFERENCES assets(id);
CREATE INDEX idx_vehicles_asset_id ON vehicles(asset_id);
COMMENT ON COLUMN vehicles.asset_id IS 'FK to unified assets registry. Every vehicle has an asset entry. Enables cross-domain queries.';
```

3. Backfill — create an asset row for every existing vehicle. BATCH THIS per hard rules:
```sql
DO $$
DECLARE
  batch_size INT := 1000;
  affected INT;
BEGIN
  LOOP
    WITH to_update AS (
      SELECT id, year, make, model
      FROM vehicles
      WHERE asset_id IS NULL
      LIMIT batch_size
    ),
    new_assets AS (
      INSERT INTO assets (asset_type, display_title, created_at)
      SELECT
        'vehicle',
        COALESCE(year::text, '') || ' ' || COALESCE(make, '') || ' ' || COALESCE(model, ''),
        COALESCE(v.created_at, now())
      FROM to_update v
      RETURNING id, display_title
    )
    UPDATE vehicles v
    SET asset_id = na.id
    FROM new_assets na, to_update tu
    WHERE v.id = tu.id
    AND na.display_title = COALESCE(tu.year::text, '') || ' ' || COALESCE(tu.make, '') || ' ' || COALESCE(tu.model, '');

    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
    RAISE NOTICE 'Backfilled % vehicles', affected;
  END LOOP;
END $$;
```

NOTE: The backfill above uses display_title for joining which may not be unique. A safer approach:

```sql
DO $$
DECLARE
  rec RECORD;
  new_asset_id uuid;
  counter INT := 0;
BEGIN
  FOR rec IN SELECT id, year, make, model, created_at FROM vehicles WHERE asset_id IS NULL LOOP
    INSERT INTO assets (asset_type, display_title, created_at)
    VALUES (
      'vehicle',
      COALESCE(rec.year::text, '') || ' ' || COALESCE(rec.make, '') || ' ' || COALESCE(rec.model, ''),
      COALESCE(rec.created_at, now())
    )
    RETURNING id INTO new_asset_id;

    UPDATE vehicles SET asset_id = new_asset_id WHERE id = rec.id;

    counter := counter + 1;
    IF counter % 1000 = 0 THEN
      PERFORM pg_sleep(0.1);
      RAISE NOTICE 'Backfilled % vehicles', counter;
    END IF;
  END LOOP;
  RAISE NOTICE 'Total backfilled: %', counter;
END $$;
```

4. Update `vehicle_observations` to optionally reference `asset_id`:
```sql
ALTER TABLE vehicle_observations ADD COLUMN asset_id uuid REFERENCES assets(id);
CREATE INDEX idx_vo_asset_id ON vehicle_observations(asset_id);
COMMENT ON COLUMN vehicle_observations.asset_id IS 'FK to unified asset registry. Set alongside vehicle_id for cross-domain observation queries. Will eventually replace vehicle_id as primary.';
```

5. Update `ingest-observation` to set `asset_id` when `vehicle_id` is set:
- After resolving vehicle_id, look up the vehicle's asset_id and set it on the observation
- This is a small code change in `supabase/functions/ingest-observation/index.ts`

## Verify
```sql
-- Assets table exists and is populated
SELECT count(*) FROM assets WHERE asset_type = 'vehicle';
-- Should match: SELECT count(*) FROM vehicles WHERE asset_id IS NOT NULL;

-- Every vehicle has an asset
SELECT count(*) FROM vehicles WHERE asset_id IS NULL;
-- Should be 0

-- Cross-domain query works
SELECT a.asset_type, a.display_title, v.year, v.make, v.model
FROM assets a
JOIN vehicles v ON v.asset_id = a.id
LIMIT 5;

-- New observations get asset_id
SELECT asset_id FROM vehicle_observations
ORDER BY created_at DESC LIMIT 1;
-- Should not be null (if a new observation was ingested after deploy)
```

## Anti-Patterns
- Do NOT modify existing vehicle queries. They continue using `vehicles.id`. The asset_id is additive.
- Do NOT make asset_id NOT NULL on vehicles yet. Backfill first, verify, then consider constraint.
- Do NOT create art tables in this prompt. That's P05.
- Do NOT rename vehicle_id to asset_id on any table. The migration is gradual.
- Do NOT run the backfill without batching. Statement timeout is 120s. ~18K vehicles at 1K/batch = 18 batches = safe.

## Library Contribution
After completing:
- Add `assets` table to `docs/library/reference/dictionary/tables.md`
- Update `docs/library/technical/schematics/entity-relationships.md` — add assets table and FK from vehicles
- Update `docs/library/reference/almanac/README.md` — add asset count
- Update `docs/library/reference/encyclopedia/README.md` Section 1 — mark as implemented
