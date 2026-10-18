-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_parts -f supabase/sql/test_k5_harness_parts_catalog.sql
-- Proves 20261014163000_k5_harness_parts_catalog.sql on top of net fold v2: the build catalog's cited entries land in
-- catalog_parts without price, stock or manufacturer claims; part numbers already present are left alone; the key fold
-- keys unique part numbers only and is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_net_fold_v2.sql

-- The live shapes pass 6 touches.
ALTER TABLE public.catalog_parts ADD COLUMN name text, ADD COLUMN description text, ADD COLUMN category text, ADD COLUMN subcategory text,
  ADD COLUMN manufacturer text DEFAULT 'LMC', ADD COLUMN in_stock boolean DEFAULT true, ADD COLUMN supplier_url text, ADD COLUMN application_data jsonb;
UPDATE public.catalog_parts SET name = part_number;
ALTER TABLE public.catalog_parts ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.wire_termination_specs ADD COLUMN pin_seal_pn text, ADD COLUMN pin_seal_catalog_id uuid, ADD COLUMN wedge_lock_pn text,
  ADD COLUMN wedge_lock_catalog_id uuid, ADD COLUMN connector_housing_pn text, ADD COLUMN heat_shrink_pn text, ADD COLUMN heat_shrink_catalog_id uuid,
  ADD COLUMN label_pn text, ADD COLUMN label_catalog_id uuid, ADD COLUMN boot_pn text, ADD COLUMN boot_catalog_id uuid;
INSERT INTO public.catalog_parts (part_number, name) VALUES ('DUP-1', 'duplicate a'), ('DUP-1', 'duplicate b');
UPDATE public.wire_termination_specs SET terminal_contact_pn = 'M39029/56-351', crimp_tool_pn = 'M22520/2-10' WHERE id = '00000000-0000-0000-0000-0000000b0102';
UPDATE public.wire_termination_specs SET terminal_contact_pn = 'DUP-1' WHERE id = '00000000-0000-0000-0000-0000000b0103';

\i supabase/migrations/20261014163000_k5_harness_parts_catalog.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT count(*) INTO n FROM public.catalog_parts WHERE application_data->>'loaded_by' = 'rsi pass 6 (catalog_parts_sql.py)';
  IF n <> 127 THEN RAISE EXCEPTION 'catalog rows added: %, want 127 (129 less SSC-N and M22520/2-02, already present)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_parts WHERE application_data->>'loaded_by' IS NOT NULL AND (manufacturer IS NOT NULL OR in_stock IS NOT NULL)) THEN
    RAISE EXCEPTION 'an added row claims a manufacturer or stock';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_parts WHERE application_data::text ~ '\$[0-9]' OR application_data::text ~* '\mcart\M') THEN
    RAISE EXCEPTION 'a price or purchase state reached the catalog';
  END IF;
  SELECT name INTO got FROM public.catalog_parts WHERE part_number = 'SSC-N';
  IF got IS DISTINCT FROM 'SSC-N' THEN RAISE EXCEPTION 'an existing part was overwritten: %', got; END IF;
  SELECT application_data->>'tool_code' INTO got FROM public.catalog_parts WHERE part_number = 'M22520/2-10';
  IF got IS DISTINCT FROM 'K43' THEN RAISE EXCEPTION 'tool row: %', got; END IF;

  SELECT string_agg(right(t.id::text, 4) || ':' || coalesce(tp.part_number, '-') || '/' || coalesce(cp.part_number, '-'), ' ' ORDER BY t.id) INTO got
  FROM public.wire_termination_specs t
  LEFT JOIN public.catalog_parts tp ON tp.id = t.terminal_contact_catalog_id LEFT JOIN public.catalog_parts cp ON cp.id = t.crimp_tool_catalog_id
  WHERE t.id IN ('00000000-0000-0000-0000-0000000b0101', '00000000-0000-0000-0000-0000000b0102', '00000000-0000-0000-0000-0000000b0103');
  IF got IS DISTINCT FROM '0101:SSC-N/M22520/2-02 0102:M39029/56-351/M22520/2-10 0103:-/-' THEN RAISE EXCEPTION 'keys: %', got; END IF;
  n := public.key_harness_wire_ends('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF n <> 0 THEN RAISE EXCEPTION 'the key fold is not idempotent: % keys on a re-run', n; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 20 THEN RAISE EXCEPTION 'SH needs: got %, want 20', n; END IF;
END $$;

SELECT 'test_k5_harness_parts_catalog: PASS' AS result;
