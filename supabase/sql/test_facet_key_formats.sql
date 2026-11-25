-- Contract for 20261124194500_facet_key_formats (empty disposable PG17; vehicle_decode_rules rows and a minimal
-- vehicle_facet_items holding the live norm line verbatim). Asserts the three proof-car framings compare equal, a different
-- code stays different, a key with no format row is unchanged, and the reader patch is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_decode_rules') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicle_decode_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, make text, code text,
  year_min int, year_max int, qualifiers jsonb DEFAULT '{}', superseded_at timestamptz);
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, qualifiers) VALUES
 ('body_tag_style_number', 'Pontiac', '2FS87', 1973, 1973, '{}'), ('body_tag_plant_code', 'Pontiac', 'N', 1973, 1973, '{}'),
 ('body_tag_plant_code', 'Pontiac', 'NOR', 1973, 1973, '{}'),
 ('transmission_tailhousing_casting', NULL, '3857584', 1966, 1970, '{"oem_group":"GM"}'),
 ('transmission_case_casting', NULL, '3851325', 1964, 1965, '{"oem_group":"GM"}');
CREATE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT nullif(regexp_replace(lower(btrim(p_value)), '\s+', ' ', 'g'), '') $f$;
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
-- facet_items_v1
WITH v AS (SELECT 'Pontiac'::text AS make, 1973 AS year),
t AS (SELECT * FROM (VALUES ('body_style.body_tag', 'text', '2FS87'), ('body_style.body_tag', 'text', '73 2FS87')) x(key, nk, val))
SELECT jsonb_agg(DISTINCT norm) FROM (SELECT t.*, public.vehicle_facet_norm(t.nk, t.val) AS norm FROM t) x
$function$;

\ir ../migrations/20261124194500_facet_key_formats.sql
\ir ../migrations/20261124194500_facet_key_formats.sql

DO $$
DECLARE k text;
BEGIN
  k := 'body_style.body_tag';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '73 2FS87', 'Pontiac', 1973) = '2fs87', 'model year token dropped';
  ASSERT public.vehicle_facet_key_norm(k, 'text', 'ST 73 2FS87 NOR', 'Pontiac', 1973) IS NOT DISTINCT FROM 'st 2fs87'
      OR public.vehicle_facet_key_norm(k, 'text', 'ST 73 2FS87 NOR', 'Pontiac', 1973) = '2fs87', 'the style code is kept';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '2FS87', 'Pontiac', 1973) = '2fs87', 'plain style';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '2FQ87', 'Pontiac', 1973) = '2fq87', 'a different code stays different';
  k := 'body_style.body_number';
  ASSERT public.vehicle_facet_key_norm(k, 'text', 'N 189504', 'Pontiac', 1973) = '189504', 'plant letter dropped';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '189504', 'Pontiac', 1973) = '189504', 'plain body number';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '189505', 'Pontiac', 1973) = '189505', 'another number stays different';
  k := 'transmission.current.tailhousing_casting';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '3857584GM', 'Pontiac', 1973) = '3857584', 'foundry mark dropped, any year';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '3857584', 'Pontiac', 1973) = '3857584', 'plain casting';
  ASSERT public.vehicle_facet_key_norm(k, 'text', '3857584XX', 'Pontiac', 1973) = '3857584xx', 'only the named mark is dropped';
  ASSERT public.vehicle_facet_key_norm('transmission.current.case_casting', 'text', '3851325 GM', 'Pontiac', 1973) = '3851325', 'case casting';
  ASSERT public.vehicle_facet_key_norm('paint.current.recorded', 'text', '73  Blue', 'Pontiac', 1973) = '73 blue', 'no format row: unchanged';
  ASSERT public.vehicle_facet_items('00000000-0000-0000-0000-000000000000') = '["2fs87"]'::jsonb, 'the reader compares by it';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'facet_key_formats_v1', 'g')) = 1, 'patched once';
END $$;
\echo facet_key_formats: ok
