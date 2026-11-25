-- Contract for 20261124194700_facet_claim_roles (empty disposable PG17; a minimal vehicle_facet_items holding the live
-- roles CTE head, two rows and its tail verbatim). Asserts the rows move to the table unchanged, the reader returns the
-- same output reading them, anon can read the rule rows, and the patch is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_facet_claim_roles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $function$
-- facet_items_v1
WITH x AS (SELECT 1),
roles (role, field, key, nk, detail) AS (VALUES
  ('nominal_engine_displacement', 'engine_size', 'engine.current.displacement', 'displacement', NULL::text[]),
  ('identified_transmission_housing', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('cowl_tag_style', 'fisher_style_number', 'body_style.body_tag', 'text', ARRAY['body_style', 'tag_model_year'])
),
-- The ids of the observations that can speak to a token (vehicle_facet_observation_ids), so the viewer's row
obs AS (SELECT 1)
SELECT jsonb_agg(jsonb_build_array(role, field, key, nk, detail) ORDER BY role, field) FROM roles
$function$;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_items(uuid, text) TO anon;
CREATE TEMP TABLE before AS SELECT public.vehicle_facet_items(NULL) AS j;

\ir ../migrations/20261124194700_facet_claim_roles.sql
\ir ../migrations/20261124194700_facet_claim_roles.sql

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.vehicle_facet_claim_roles) = 3, 'three rows moved';
  ASSERT (SELECT detail FROM public.vehicle_facet_claim_roles WHERE role = 'cowl_tag_style') = ARRAY['body_style', 'tag_model_year'], 'detail kept';
  ASSERT public.vehicle_facet_items(NULL) = (SELECT j FROM before), 'identical output from the table';
  ASSERT position('VALUES' IN pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) = 0, 'the list left the reader';
  ASSERT has_table_privilege('anon', 'public.vehicle_facet_claim_roles', 'SELECT'), 'anon reads the rule rows';
END $$;
SET ROLE anon;
DO $$ BEGIN ASSERT jsonb_array_length(public.vehicle_facet_items(NULL)) = 3, 'the reader works as anon'; END $$;
RESET ROLE;
\echo facet_claim_roles: ok
