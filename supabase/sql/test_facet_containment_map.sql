-- Contract for 20261124195300_facet_containment_map (empty disposable PG17; 194500, 194900 and 195100 applied first to a
-- minimal vehicle_facet_items holding the live anchors verbatim). The per-item map gives every result 195100's contract
-- asserts (same rule), the reader still runs as anon, the map is callable alone, and the patch is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_decode_rules') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;
CREATE TABLE public.vehicle_decode_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, make text, code text,
  year_min int, year_max int, qualifiers jsonb DEFAULT '{}', superseded_at timestamptz);
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max) VALUES
 ('body_tag_style_number', 'Pontiac', '2FS87', 1973, 1973), ('body_tag_plant_code', 'Pontiac', 'N', 1973, 1973);
CREATE TABLE public.canonical_body_styles (canonical_name text PRIMARY KEY, aliases text[], is_active boolean DEFAULT true);
INSERT INTO public.canonical_body_styles VALUES ('PICKUP', ARRAY['pickup', 'truck', 'crew cab']), ('COUPE', ARRAY['coupe', 'hardtop coupe']);
CREATE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT nullif(regexp_replace(lower(btrim(p_value)), '\s+', ' ', 'g'), '') $f$;
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
-- facet_items_v1
WITH v AS (SELECT 'Pontiac'::text AS make, 1973 AS year),
t AS (SELECT * FROM (VALUES
  ('model.recorded', 'text', 'Mustang Coupe 289'), ('model.recorded', 'text', 'Mustang'),
  ('model.alt', 'text', 'Charger 360'), ('model.alt', 'text', 'Charger 318'), ('model.alt', 'text', 'Charger'),
  ('body_style.recorded', 'text', 'Truck'), ('body_style.recorded', 'text', 'PICKUP'),
  ('body_style.body_tag', 'text', '73 2FS87'), ('body_style.body_tag', 'text', '2FS87'),
  ('paint.current.recorded', 'text', 'blue'), ('paint.current.recorded', 'text', 'blue and white'),
  ('paint.two', 'text', 'blue'), ('paint.two', 'text', 'white'), ('paint.two', 'text', 'blue and white'),
  ('body_style.recorded', 'text', 'pickup truck, long bed'),
  ('engine.current.displacement', 'displacement', '400'), ('engine.current.displacement', 'displacement', '400 cid')) x(key, nk, val)),
-- One row per (item, independent source, stated value): the observation-writer mirror and its observation count once.
td AS (
  SELECT DISTINCT key, norm
  FROM (SELECT t.*, public.vehicle_facet_norm(t.nk, t.val) AS norm FROM t) x
  WHERE norm IS NOT NULL
)
SELECT jsonb_object_agg(key, n) FROM (SELECT key, count(*) AS n FROM td GROUP BY key) q
$function$;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_items(uuid, text) TO anon;

\ir ../migrations/20261124194500_facet_key_formats.sql
\ir ../migrations/20261124194900_facet_containment_and_vocabulary.sql
\ir ../migrations/20261124195100_facet_containment_chain.sql
\ir ../migrations/20261124195300_facet_containment_map.sql
\ir ../migrations/20261124195300_facet_containment_map.sql

DO $$
DECLARE j jsonb := public.vehicle_facet_items(NULL);
BEGIN
  ASSERT (j->>'model.recorded')::int = 1, 'contained wording merges: ' || j::text;
  ASSERT (j->>'model.alt')::int = 3, 'two values each containing a third stay apart (conflict kept): ' || j::text;
  ASSERT (j->>'body_style.recorded')::int = 1, 'vocabulary alias, then containment, merges: ' || j::text;
  ASSERT (j->>'paint.two')::int = 3, 'blue / white / blue and white stay apart: ' || j::text;
  ASSERT (j->>'body_style.body_tag')::int = 1, 'format row still applies';
  ASSERT (j->>'paint.current.recorded')::int = 1, 'one tone of two is compatible';
  ASSERT (j->>'engine.current.displacement')::int = 2, 'non-text items are not merged by containment';
  ASSERT public.vehicle_facet_key_norm('body_style.recorded', 'text', 'Hardtop Coupe', 'Pontiac', 1973) = 'coupe', 'alias to class';
  ASSERT public.vehicle_facet_key_norm('body_style.recorded', 'text', 'Wagon', 'Pontiac', 1973) = 'wagon', 'no class: as before';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'facet_containment_chain_v2', 'g')) = 1, 'patched once';
  ASSERT position('tc0 AS' IN pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) = 0, 'the scan is gone';
  ASSERT (SELECT count(*) FROM public.vehicle_facet_containment_map(ARRAY['blue', 'white', 'blue and white'])) = 0, 'map: no chain, no merge';
  ASSERT (SELECT norm FROM public.vehicle_facet_containment_map(ARRAY['blue', 'blue and white'])) = 'blue and white', 'map: chain merges';
END $$;
SET ROLE anon;
DO $$ BEGIN ASSERT (public.vehicle_facet_items(NULL)->>'model.recorded')::int = 1, 'the reader runs as anon'; END $$;
RESET ROLE;
\echo facet_containment_map: ok
