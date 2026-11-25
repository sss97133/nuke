-- Contract for 20261124193800_data_set_trans_from_decode (empty disposable PG17; dependencies stubbed, fixtures synthetic).
-- The live data_set_candidates_v1 is long; this database holds its photo decode branch as live (obs, obs_codes,
-- obs_keyed, the two anchored lines verbatim) and asserts: a trans_id_stamp_decode_v1 reading admits trans_type (the facet
-- normaliser's value) and trans_speeds keyed '<make>:<value>' like the text readings; an alternatives model is not
-- admitted; other decodes are unchanged; the patch is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, year int);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, extraction_method text, structured_data jsonb,
  confidence_score numeric, is_superseded boolean);
CREATE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN s IS NULL OR s = '' THEN NULL
              WHEN p_kind = 'transmission_type' THEN CASE WHEN s ~ 'auto' THEN 'automatic' WHEN s ~ '(manual|speed|muncie)' THEN 'manual' END
              ELSE s END
  FROM (SELECT lower(btrim(p_value))) t(s) $f$;
CREATE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
RETURNS TABLE(set_kind text, set_key text, basis_type text, basis_id uuid)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH v AS (SELECT x.id, x.year, lower(btrim(x.make)) AS mk FROM public.vehicles x WHERE x.id = ANY (p_vehicles)),
  obs AS (
    SELECT o.id, o.vehicle_id, o.extraction_method AS m, o.structured_data AS sd, v.year, v.mk, v.year AS tyear
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id
     WHERE o.extraction_method IN ('cowl_tag_decode_v1','engine_block_decode_v1','trans_id_stamp_decode_v1')
       AND NOT coalesce(o.is_superseded, false)),
  obs_codes AS (
    SELECT o.*, e.kind, upper(btrim(e.code)) AS code, e.rule_key
      FROM obs o
     CROSS JOIN LATERAL (VALUES
       ('trans_case_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_case_casting', o.sd->>'case_casting') END, 'transmission_case_casting'),
       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code')
     ) e(kind, code, rule_key)
     WHERE e.code IS NOT NULL AND btrim(e.code) ~ '^[A-Za-z0-9]{1,12}$' AND o.mk IS NOT NULL),
  obs_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey
      FROM obs_codes c)
  SELECT k.kind, k.skey, 'observation'::text, k.id FROM obs_keyed k
$function$;

INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001', 'Pontiac', 1973);
INSERT INTO public.vehicle_observations VALUES
 ('0b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'trans_id_stamp_decode_v1',
  '{"transmission":"Muncie 4-speed manual","transmission_speeds":"4","transmission_model":"Muncie M20 or M21","transmission_case_casting":"3851325"}', 0.8, false),
 ('0b000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'trans_id_stamp_decode_v1',
  '{"transmission":"unknown","transmission_speeds":"10 speed"}', 0.8, false),
 ('0b000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'cowl_tag_decode_v1', '{"assembly_plant_code":"N"}', 0.8, false);

\ir ../migrations/20261124193800_data_set_trans_from_decode.sql
\ir ../migrations/20261124193800_data_set_trans_from_decode.sql

DO $$
DECLARE got text;
BEGIN
  SELECT string_agg(set_kind || '=' || set_key, ',' ORDER BY set_kind, set_key) INTO got
    FROM public.data_set_candidates_v1(ARRAY['10000000-0000-0000-0000-000000000001'::uuid]);
  ASSERT got = 'plant_year=pontiac:1973:n,trans_case_casting=3851325,trans_speeds=pontiac:4,trans_type=pontiac:manual',
    'trans_type and trans_speeds from the decode, keyed like the text readings; no model; others unchanged; got ' || got;
  ASSERT (SELECT count(*) FROM public.data_set_candidates_v1(ARRAY['10000000-0000-0000-0000-000000000001'::uuid]) WHERE set_kind = 'trans_model') = 0,
    'an alternatives model is not admitted';
END $$;
\echo data_set_trans_from_decode: ok
