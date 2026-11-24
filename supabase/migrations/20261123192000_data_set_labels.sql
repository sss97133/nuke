-- Data-set labels (20261123192000)
--  * engine_code sets are keyed make:code with no year, so their label is the cited meaning only when every year's rule agrees
--    (same as the photo-observation path); a text reading no longer labels the set with its own year's meaning.
--  * data_set_label_backfill_v1(run): sets created before a decoder existed keep label NULL; this writes the cited label now
--    derivable from the set key, stamps provenance.label_backfill_run, and data_set_label_backfill_revert_v1(run) clears
--    exactly the labels that run wrote.
begin;
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
RETURNS TABLE (set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid,
  vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
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


CREATE OR REPLACE FUNCTION public.data_set_key_label_v1(p_kind text, p_key text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH k AS (SELECT string_to_array(p_key, ':') AS a)
  SELECT CASE
    WHEN p_kind = 'vin_series' AND a[1] = 'pontiac' AND a[2] ~ '^[0-9]{4}$' THEN
      public.data_set_rule_label('vin_series_char', a[1], upper(left(a[3], length(a[3]) - 2)), a[2]::int)->>'label'
    WHEN p_kind = 'vin_engine' AND a[1] = 'pontiac' AND a[2] ~ '^[0-9]{4}$' THEN
      public.data_set_rule_label('vin_engine_char', a[1], upper(a[3]), a[2]::int)->>'label'
    WHEN p_kind = 'plant_year' AND a[1] = 'pontiac' AND a[2] ~ '^[0-9]{4}$' THEN
      public.data_set_rule_label('vin_plant_char', a[1], upper(a[3]), a[2]::int)->>'label'
    WHEN p_kind = 'vin_cohort' AND a[1] = 'pontiac' AND a[2] ~ '^[0-9]{4}$' THEN
      (SELECT CASE WHEN s IS NOT NULL AND e IS NOT NULL THEN s || '; ' || e END
         FROM (SELECT public.data_set_rule_label('vin_series_char', a[1], upper(left(a[3], length(a[3]) - 2)), a[2]::int)->>'label' AS s,
                      public.data_set_rule_label('vin_engine_char', a[1], upper(a[4]), a[2]::int)->>'label' AS e) z)
    WHEN p_kind = 'engine_code' THEN public.data_set_rule_label('engine_stamp_code', a[1], upper(a[2]), NULL)->>'label'
  END
  FROM k
$function$;

CREATE OR REPLACE FUNCTION public.data_set_label_backfill_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n_set int; n_fix int;
BEGIN
  -- engine_code sets labelled from one year's rule by run a006's text readings: re-derive from all years (NULL when they differ)
  WITH f AS (
    UPDATE public.data_sets s SET label = public.data_set_key_label_v1(s.set_kind, s.set_key),
           provenance = s.provenance || jsonb_build_object('label_backfill_run', p_run::text, 'label_before', s.label)
     WHERE s.set_kind = 'engine_code' AND s.rule_version = 'data_set_keys_v1' AND s.label IS NOT NULL
       AND (s.created_run_id = '5d1a7c2e-0f3b-4c8e-9a61-20261123a006'
            OR s.provenance->>'label_backfill_run' = '5d1a7c2e-0f3b-4c8e-9a61-20261123a006')
       AND s.label IS DISTINCT FROM public.data_set_key_label_v1(s.set_kind, s.set_key)
    RETURNING 1)
  SELECT count(*) INTO n_fix FROM f;
  WITH u AS (
    UPDATE public.data_sets s SET label = public.data_set_key_label_v1(s.set_kind, s.set_key),
           provenance = s.provenance || jsonb_build_object('label_backfill_run', p_run::text, 'label_before', NULL)
     WHERE s.set_kind IN ('vin_series','vin_engine','plant_year','vin_cohort','engine_code') AND s.rule_version = 'data_set_keys_v1'
       AND s.label IS NULL AND public.data_set_key_label_v1(s.set_kind, s.set_key) IS NOT NULL
    RETURNING 1)
  SELECT count(*) INTO n_set FROM u;
  RETURN jsonb_build_object('run_id', p_run, 'labelled', n_set, 'relabelled_engine_code', n_fix);
END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_label_backfill_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n int;
BEGIN
  WITH u AS (
    UPDATE public.data_sets s SET label = s.provenance->>'label_before',
           provenance = s.provenance - 'label_backfill_run' - 'label_before'
     WHERE s.provenance->>'label_backfill_run' = p_run::text RETURNING 1)
  SELECT count(*) INTO n FROM u;
  RETURN jsonb_build_object('run_id', p_run, 'restored', n);
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_key_label_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_label_backfill_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_label_backfill_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_key_label_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_label_backfill_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_label_backfill_revert_v1(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.data_set_candidates_v1(uuid[]) FROM PUBLIC, anon, authenticated;
commit;
