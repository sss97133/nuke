-- Revert of 20261124020000_spec_readings.sql.
-- Order: membership runs first (newest first), then reading runs, then objects.
--   select public.data_set_membership_revert_v1('<membership run id>');   -- each data_set_membership_v2 run, newest first
--   select public.text_code_decode_revert_v1('<reading run id>');         -- each text_code_decode_v2 run; backs rows up, then deletes
-- The run ids applied in production are listed in the PR description and in vehicle_code_reading_runs / data_set_runs
-- (producer text_code_decode_v2 / data_set_membership_v2). Then run the block below, which puts back the definitions that
-- were live before this migration.
begin;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.vehicle_code_readings WHERE rule_version = 'text_code_decode_v2' AND state = 'active') THEN
    RAISE EXCEPTION 'revert the text_code_decode_v2 runs first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_runs WHERE producer = 'data_set_membership_v2' AND status <> 'reverted') THEN
    RAISE EXCEPTION 'revert the data_set_membership_v2 runs first';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
 RETURNS TABLE(set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid, vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH v AS (
    SELECT x.id, upper(btrim(x.vin)) AS vin, x.year, lower(btrim(x.make)) AS mk, x.is_replica, x.replica_quote
      FROM public.vehicles x
     WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
       AND x.status IS DISTINCT FROM 'merged'),
  -- Pontiac Firebird VIN formats (vehicle_decode_rules cite the chart for each position):
  --   gm_1970_1971_car_vin_v1: 2 + series (2 digits, e.g. 28 = Trans Am) + body (2) + year digit (0/1) + plant + serial (6); no engine
  --   gm_1972_1980_car_vin_v1: 2 + series + body (2) + engine + year (2-9, A = 1980) + plant + serial (6)
  --   gm_1981_17_vin_v1: 1G2 + restraint + series + body (2) + engine + check + B (1981) + plant + serial (6)
  vin AS (
    SELECT v.*, substr(v.vin, 2, 1) AS series, substr(v.vin, 3, 2) AS body, substr(v.vin, 5, 1) AS eng,
           substr(v.vin, 7, 1) AS plant,
           CASE substr(v.vin, 6, 1) WHEN 'A' THEN 1980 ELSE 1970 + substr(v.vin, 6, 1)::int END AS dyear,
           'gm_1972_1980_car_vin_v1'::text AS fmt
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 2, 2), substr(v.vin, 4, 2), NULL::text, substr(v.vin, 7, 1),
           1970 + substr(v.vin, 6, 1)::int, 'gm_1970_1971_car_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^22[3468]87[01][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 5, 1), substr(v.vin, 6, 2), substr(v.vin, 8, 1), substr(v.vin, 11, 1),
           1981, 'gm_1981_17_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'),
  vin_ok AS (SELECT * FROM vin WHERE vin.year IS NULL OR vin.year = vin.dyear),
  vin_basis AS (
    SELECT o.*, fe.id AS fe_id, fe.source_confidence,
           -- a model-scoped VIN character rule applies only when the VIN's body code is one that model's rule lists
           EXISTS (SELECT 1 FROM public.vehicle_decode_rules b WHERE b.rule_key = 'vin_body_code' AND b.superseded_at IS NULL
                    AND lower(b.make) = o.mk AND b.code = o.body
                    AND (b.year_min IS NULL OR b.year_min <= o.dyear) AND (b.year_max IS NULL OR b.year_max >= o.dyear)) AS body_ruled
      FROM vin_ok o
      LEFT JOIN LATERAL (
        SELECT f.id, f.source_confidence FROM public.field_evidence f
         WHERE f.vehicle_id = o.id AND f.source_type = 'gm_vin_chart' AND f.field_name = 'vin'
           AND upper(btrim(f.proposed_value)) = o.vin AND coalesce(f.status, '') NOT IN ('rejected','superseded')
         ORDER BY f.source_confidence DESC NULLS LAST, f.id LIMIT 1) fe ON true),
  vin_rows AS (
    SELECT b.*, k.kind, k.skey, k.lbl
      FROM vin_basis b
     CROSS JOIN LATERAL (VALUES
       ('vin_cohort', format('%s:%s:%s%s:%s', b.mk, b.dyear, b.series, b.body, b.eng),
          CASE WHEN b.body_ruled THEN jsonb_build_object('series', public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear),
                                                         'engine', public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear)) END),
       ('vin_series', format('%s:%s:%s%s', b.mk, b.dyear, b.series, b.body),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear) END),
       ('vin_engine', format('%s:%s:%s', b.mk, b.dyear, b.eng),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear) END),
       ('plant_year', format('%s:%s:%s', b.mk, b.dyear, b.plant),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_plant_char', b.mk, b.plant, b.dyear) END)
     ) k(kind, skey, lbl)
     WHERE b.eng IS NOT NULL OR k.kind IN ('vin_series','plant_year')),
  vin_out AS (
    SELECT r.kind, lower(r.skey),
           CASE WHEN r.kind = 'vin_cohort' THEN
                  CASE WHEN r.lbl->'series'->>'label' IS NOT NULL AND r.lbl->'engine'->>'label' IS NOT NULL
                       THEN (r.lbl->'series'->>'label') || '; ' || (r.lbl->'engine'->>'label') END
                ELSE r.lbl->>'label' END,
           jsonb_build_object('decode_rule', r.fmt, 'rules', coalesce(r.lbl, '{}'::jsonb)),
           'vehicle'::text, r.id, r.id,
           CASE WHEN r.fe_id IS NOT NULL THEN 'field_evidence' ELSE 'vehicle_vin' END,
           coalesce(r.fe_id, r.id),
           jsonb_build_object('vin', r.vin, 'positions', jsonb_build_object('series', r.series, 'body', r.body,
             'engine', r.eng, 'year', r.dyear, 'plant', r.plant)),
           CASE WHEN r.fe_id IS NOT NULL THEN least(greatest(coalesce(r.source_confidence, 90), 1), 100) / 100.0 ELSE 0.80 END,
           r.fmt
      FROM vin_rows r),
  -- Photo decode observations (one reviewer's reading of one photo each).
  obs AS (
    SELECT o.id, o.vehicle_id, o.extraction_method AS m, o.structured_data AS sd,
           least(greatest(coalesce(o.confidence_score, 0.5), 0.01), 1) AS conf, v.year, v.mk,
           CASE WHEN o.structured_data->>'tag_model_year' ~ '^[0-9]{2}$' THEN 1900 + (o.structured_data->>'tag_model_year')::int
                ELSE v.year END AS tyear
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id
     WHERE o.extraction_method IN ('cowl_tag_decode_v1','engine_block_decode_v1','trans_id_stamp_decode_v1')
       AND NOT coalesce(o.is_superseded, false)),
  obs_codes AS (
    SELECT o.*, e.kind, upper(btrim(e.code)) AS code, e.rule_key
      FROM obs o
     CROSS JOIN LATERAL (VALUES
       ('engine_block_casting', CASE WHEN o.m = 'engine_block_decode_v1' THEN o.sd->>'engine_block_casting' END, 'block_casting'),
       ('engine_code', CASE WHEN o.m = 'engine_block_decode_v1' THEN coalesce(o.sd->>'engine_code_stamp', o.sd->>'engine_code') END, 'engine_stamp_code'),
       ('trans_case_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_case_casting', o.sd->>'case_casting') END, 'transmission_case_casting'),
       ('trans_tail_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_tailhousing_casting', o.sd->>'transmission_tailhousing') END, 'transmission_tailhousing_casting'),
       ('paint_code', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'paint_code', o.sd->'body_tag_paint_code'->>'lower') END, 'body_tag_paint_code'),
       ('cowl_style', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'fisher_style_number', o.sd->>'body_tag_style') END, 'body_tag_style_number'),
       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code')
     ) e(kind, code, rule_key)
     WHERE e.code IS NOT NULL AND btrim(e.code) ~ '^[A-Za-z0-9]{1,12}$' AND o.mk IS NOT NULL
       AND (e.kind NOT IN ('paint_code','cowl_style','plant_year') OR o.tyear IS NOT NULL)
       AND (e.kind <> 'plant_year' OR btrim(e.code) ~ '^[A-Za-z]$')),
  obs_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'paint_code' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'cowl_style' THEN format('%s:%s', c.tyear, c.code)
             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey,
           public.data_set_rule_label(CASE WHEN c.kind = 'plant_year' THEN 'vin_plant_char' ELSE c.rule_key END, c.mk, c.code,
             CASE WHEN c.kind IN ('paint_code','cowl_style','plant_year') THEN c.tyear END) AS lbl,
           CASE WHEN c.sd->>'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 AND EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = (c.sd->>'image_id')::uuid AND vi.vehicle_id = c.vehicle_id)
                THEN (c.sd->>'image_id')::uuid END AS image_id
      FROM obs_codes c),
  obs_out AS (
    SELECT k.kind, k.skey, k.lbl->>'label', jsonb_build_object('decode_rule', k.m, 'rules', k.lbl),
           mt.member_type, mt.member_id, k.vehicle_id, 'observation'::text, k.id,
           jsonb_build_object('claim_role', k.sd->>'claim_role', 'code', k.code), k.conf, k.m
      FROM obs_keyed k
     CROSS JOIN LATERAL (VALUES ('vehicle', k.vehicle_id), ('image', k.image_id)) mt(member_type, member_id)
     WHERE mt.member_id IS NOT NULL),
  -- Text code readings (vehicle_code_readings, text_code_decode_v1): one cited read of one code in one origin row each.
  crd AS (
    SELECT r.id, r.vehicle_id, r.kind, upper(r.code) AS code, r.model_year AS tyear, r.confidence AS conf, v.mk,
           r.origin_table, r.origin_id, r.origin_column, r.rule_version,
           CASE r.kind WHEN 'engine_block_casting' THEN 'block_casting' WHEN 'engine_code' THEN 'engine_stamp_code'
                       WHEN 'trans_case_casting' THEN 'transmission_case_casting'
                       WHEN 'trans_tail_casting' THEN 'transmission_tailhousing_casting'
                       WHEN 'paint_code' THEN 'body_tag_paint_code' WHEN 'cowl_style' THEN 'body_tag_style_number'
                       WHEN 'cowl_option' THEN 'body_tag_option_code' END AS rule_key
      FROM public.vehicle_code_readings r JOIN v ON v.id = r.vehicle_id
     WHERE r.state = 'active' AND v.mk IS NOT NULL
       AND (r.kind NOT IN ('paint_code','cowl_style','cowl_option') OR r.model_year IS NOT NULL)),
  crd_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'paint_code' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'cowl_style' THEN format('%s:%s', c.tyear, c.code)
             WHEN 'cowl_option' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey,
           public.data_set_rule_label(c.rule_key, c.mk, c.code,
             CASE WHEN c.kind IN ('paint_code','cowl_style','cowl_option') THEN c.tyear END) AS lbl
      FROM crd c),
  crd_out AS (
    SELECT k.kind, k.skey, k.lbl->>'label', jsonb_build_object('decode_rule', k.rule_version, 'rules', k.lbl),
           'vehicle'::text, k.vehicle_id, k.vehicle_id, 'code_reading'::text, k.id,
           jsonb_build_object('code', k.code, 'origin_table', k.origin_table, 'origin_id', k.origin_id,
                              'origin_column', k.origin_column), k.conf, k.rule_version
      FROM crd_keyed k),
  -- Replicas (vehicles.is_replica): as built = the VIN cohort; as presented = replica_presented_v1 read of replica_quote,
  -- resolved to VIN codes through the decode rules for that year (no rule, no as-presented membership).
  rep AS (
    SELECT b.*,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_series,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_app
      FROM vin_basis b WHERE b.is_replica IS TRUE AND b.eng IS NOT NULL),
  rep_codes AS (
    SELECT r.*,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_series_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'series' = r.p_series AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS ps,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_engine_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'application' = r.p_app AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS pe
      FROM rep r),
  rep_out AS (
    SELECT 'replica_cohort'::text, lower(format('as_built:%s:%s:%s%s:%s', r.mk, r.dyear, r.series, r.body, r.eng)),
           NULL::text, jsonb_build_object('rule', 'replica_cohort_v1', 'cohort', 'as_built'),
           'vehicle'::text, r.id, r.id, 'vehicle_flag'::text, r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_built', 'vin', r.vin), 0.80::numeric, 'replica_cohort_v1'::text
      FROM rep_codes r
    UNION ALL
    SELECT 'replica_cohort', lower(CASE WHEN r.pe IS NOT NULL THEN format('as_presented:%s:%s:%s%s:%s', r.mk, r.dyear, r.ps, r.body, r.pe)
                                        ELSE format('as_presented:%s:%s:%s%s', r.mk, r.dyear, r.ps, r.body) END),
           concat_ws(' ', r.p_series, r.p_app), jsonb_build_object('rule', 'replica_presented_v1', 'cohort', 'as_presented'),
           'vehicle', r.id, r.id, 'vehicle_flag', r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_presented', 'presented_series', r.p_series,
                              'presented_engine', r.p_app, 'read_from', 'vehicles.replica_quote', 'vin', r.vin),
           0.50, 'replica_presented_v1'
      FROM rep_codes r WHERE r.ps IS NOT NULL),
  com_out AS (
    SELECT 'comment_theme'::text, t.theme, NULL::text, jsonb_build_object('rubric', 'comment_theme_v1'),
           'auction_comment'::text, c.id, c.vehicle_id, 'comment_rubric'::text, c.id,
           jsonb_build_object('matched', t.matched, 'auction_event_id', c.auction_event_id), 0.50::numeric, 'comment_theme_v1'::text
      FROM public.auction_comments c
      JOIN v ON v.id = c.vehicle_id
     CROSS JOIN LATERAL public.data_set_comment_themes_v1(c.comment_text) t
     WHERE c.comment_type IS DISTINCT FROM 'bid' AND c.comment_type IS DISTINCT FROM 'sold')
  SELECT * FROM vin_out
  UNION ALL SELECT * FROM obs_out
  UNION ALL SELECT * FROM rep_out
  UNION ALL SELECT * FROM com_out
  UNION ALL SELECT * FROM crd_out
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
              JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme','cowl_option']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_scope_vehicles(p_scope text, p_vehicle uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_scope
    WHEN 'vehicle' THEN ARRAY[p_vehicle]
    WHEN 'pontiac_f_body' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'pontiac'
                                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'))
  END
$function$;

CREATE OR REPLACE FUNCTION public.text_code_rescore_v1(p_vehicles uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int; n_m int;
BEGIN
  WITH k AS (
    SELECT r.id, CASE WHEN r.kind <> 'cowl_option'
                       AND max(r.code) OVER (PARTITION BY r.vehicle_id, r.kind) <> min(r.code) OVER (PARTITION BY r.vehicle_id, r.kind)
                      THEN round(r.base_confidence * 0.6, 3) ELSE r.base_confidence END AS c
      FROM public.vehicle_code_readings r WHERE r.vehicle_id = ANY (p_vehicles) AND r.state = 'active'),
  u AS (UPDATE public.vehicle_code_readings r SET confidence = k.c FROM k WHERE r.id = k.id AND r.confidence IS DISTINCT FROM k.c
        RETURNING 1)
  SELECT count(*) INTO n FROM u;
  WITH u AS (
    UPDATE public.data_set_members m SET confidence = r.confidence
      FROM public.vehicle_code_readings r
     WHERE m.basis_type = 'code_reading' AND m.basis_id = r.id AND m.state = 'active'
       AND r.vehicle_id = ANY (p_vehicles) AND r.state = 'active' AND m.confidence IS DISTINCT FROM r.confidence
    RETURNING 1)
  SELECT count(*) INTO n_m FROM u;
  RETURN n + n_m;
END
$function$;

DROP FUNCTION IF EXISTS public.field_latent_sources_v1(text, integer);
DROP FUNCTION IF EXISTS public.field_coverage_snapshot_v1(text, text, text);
DROP FUNCTION IF EXISTS public.data_set_membership_plan_v2(uuid, text, uuid, text[], integer, integer);
DROP FUNCTION IF EXISTS public.data_set_code_candidates_v1(uuid[], text[]);
DROP FUNCTION IF EXISTS public.data_set_code_key_v1(text, text, integer, text);
DROP FUNCTION IF EXISTS public.text_code_decode_v2(uuid, text, uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS public.text_rpo_known_v1(text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.text_spec_matches_v2(text, text, text, text);
DROP INDEX IF EXISTS public.data_set_members_code_basis_idx;
-- field_coverage_snapshots and coverage_sample_vehicles hold counts and ids only; they are kept on purpose.
ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_kind_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_kind_check CHECK (kind IN ('engine_block_casting',
  'engine_code','trans_case_casting','trans_tail_casting','paint_code','cowl_style','cowl_option'));
ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_code_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_code_check CHECK (code ~ '^[A-Z0-9]{2,8}$');
ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_origin_table_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_origin_table_check
  CHECK (origin_table IN ('vehicles','auction_comments'));
DELETE FROM public.data_sets s WHERE s.set_kind IN ('body_style','trim_level','engine_cid','trans_type','trans_speeds','trans_model',
  'axle_ratio','interior_trim_code','rpo_code','build_month','dealer_zone','documentation')
  AND NOT EXISTS (SELECT 1 FROM public.data_set_members m WHERE m.set_id = s.id);
ALTER TABLE public.data_sets DROP CONSTRAINT IF EXISTS data_sets_set_kind_check;
ALTER TABLE public.data_sets ADD CONSTRAINT data_sets_set_kind_check CHECK (set_kind IN ('vin_cohort','vin_series','vin_engine',
  'plant_year','cowl_style','cowl_option','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
  'replica_cohort','comment_theme'));
commit;
