-- Revert of 20261123181000_data_set_membership_review_fixes: puts back the 20261123180000 bodies of
-- data_set_can_read_vehicle, data_set_basis_live, data_set_candidates_v1 and data_set_membership_revert_v1, and drops
-- data_set_replica_presented_v1. Run before revert_20261123180000_data_set_membership.sql.
begin;
set local lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.data_set_can_read_vehicle(uuid);
CREATE OR REPLACE FUNCTION public.data_set_can_read_vehicle(p_vehicle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH c AS (
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb AS j)
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles x, c
     WHERE x.id = p_vehicle AND x.deleted_at IS NULL
       AND (x.is_public IS TRUE
            OR coalesce(c.j->>'role', 'service_role') NOT IN ('anon','authenticated')
            OR (c.j->>'sub') IN (x.user_id::text, x.uploaded_by::text)))
$function$;

CREATE OR REPLACE FUNCTION public.data_set_basis_live(p_basis_type text, p_basis_id uuid, p_vehicle uuid, p_detail jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE p_basis_type
    WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = p_basis_id
                                      AND o.vehicle_id = p_vehicle AND NOT coalesce(o.is_superseded, false))
    WHEN 'field_evidence' THEN EXISTS (SELECT 1 FROM public.field_evidence f WHERE f.id = p_basis_id AND f.vehicle_id = p_vehicle
                                      AND coalesce(f.status, '') NOT IN ('rejected','superseded')
                                      AND upper(btrim(f.proposed_value)) = p_detail->>'vin')
    WHEN 'vehicle_vin' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND upper(btrim(x.vin)) = p_detail->>'vin')
    WHEN 'vehicle_flag' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND x.is_replica IS TRUE)
    WHEN 'comment_rubric' THEN EXISTS (SELECT 1 FROM public.auction_comments c WHERE c.id = p_basis_id
                                      AND c.vehicle_id IS NOT DISTINCT FROM p_vehicle)
    ELSE false END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
RETURNS TABLE (set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid,
  vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH v AS (
    SELECT x.id, upper(btrim(x.vin)) AS vin, x.year, lower(btrim(x.make)) AS mk, x.is_replica, x.replica_quote
      FROM public.vehicles x
     WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
       AND x.status IS DISTINCT FROM 'merged'),
  -- gm_1972_1980_car_vin_v1: 2 (Pontiac) + series + body (2) + engine + year digit + plant + serial (6).
  vin AS (
    SELECT v.*, substr(v.vin, 2, 1) AS series, substr(v.vin, 3, 2) AS body, substr(v.vin, 5, 1) AS eng,
           substr(v.vin, 7, 1) AS plant,
           CASE substr(v.vin, 6, 1) WHEN '0' THEN 1980 ELSE 1970 + substr(v.vin, 6, 1)::int END AS dyear
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^2[A-Z][0-9]{2}[A-Z][02-9][A-Z][0-9]{6}$'),
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
     ) k(kind, skey, lbl)),
  vin_out AS (
    SELECT r.kind, lower(r.skey),
           CASE WHEN r.kind = 'vin_cohort' THEN
                  nullif(concat_ws('; ', r.lbl->'series'->>'label', r.lbl->'engine'->>'label'), '')
                ELSE r.lbl->>'label' END,
           jsonb_build_object('decode_rule', 'gm_1972_1980_car_vin_v1', 'rules', coalesce(r.lbl, '{}'::jsonb)),
           'vehicle'::text, r.id, r.id,
           CASE WHEN r.fe_id IS NOT NULL THEN 'field_evidence' ELSE 'vehicle_vin' END,
           coalesce(r.fe_id, r.id),
           jsonb_build_object('vin', r.vin, 'positions', jsonb_build_object('series', r.series, 'body', r.body,
             'engine', r.eng, 'year', r.dyear, 'plant', r.plant)),
           CASE WHEN r.fe_id IS NOT NULL THEN least(greatest(coalesce(r.source_confidence, 90), 1), 100) / 100.0 ELSE 0.80 END,
           'gm_1972_1980_car_vin_v1'::text
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
  -- Replicas (vehicles.is_replica): as built = the VIN cohort; as presented = replica_presented_v1 read of replica_quote,
  -- resolved to VIN codes through the decode rules for that year (no rule, no as-presented membership).
  rep AS (
    SELECT b.*,
           CASE WHEN b.replica_quote ~* '\mtrans[- ]?am\M' THEN 'Trans Am' WHEN b.replica_quote ~* '\mformula\M' THEN 'Formula' END AS p_series,
           CASE WHEN b.replica_quote ~* '\msd[- ]?455\M|\msuper[- ]?duty\M' THEN 'Super Duty' END AS p_app
      FROM vin_basis b WHERE b.is_replica IS TRUE),
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
                              'presented_engine', r.p_app, 'read_from', 'vehicles.replica_quote'),
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
$function$;

CREATE OR REPLACE FUNCTION public.data_set_membership_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE n_restore int; n_del int; n_sets int; n_left int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_revert_v1: run required'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.member_row_id
              WHERE p.run_id = p_run::text AND p.state = 'applied' AND p.action = 'add' AND m.superseded_run_id IS NOT NULL
                AND m.superseded_run_id <> p_run::text
                AND EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = m.superseded_run_id AND x.status <> 'reverted')) THEN
    RAISE EXCEPTION 'data_set_membership_revert_v1: a later run superseded members of run %; revert it first', p_run;
  END IF;
  WITH s AS (
    UPDATE public.data_set_members m SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
      FROM public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.id = p.target_member_id
       AND m.superseded_run_id = p_run::text
    RETURNING p.id)
  SELECT count(*) INTO n_restore FROM s;
  WITH d AS (
    DELETE FROM public.data_set_members m USING public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'add' AND p.state = 'applied' AND m.id = p.member_row_id AND m.run_id = p_run::text
    RETURNING p.id)
  SELECT count(*) INTO n_del FROM d;
  WITH d AS (
    DELETE FROM public.data_sets s WHERE s.created_run_id = p_run::text
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members m WHERE m.set_id = s.id) RETURNING s.id)
  SELECT count(*) INTO n_sets FROM d;
  UPDATE public.data_set_member_plan SET state = 'reverted', reverted_at = now() WHERE run_id = p_run::text AND state = 'applied';
  SELECT count(*) INTO n_left FROM public.data_set_members m WHERE m.run_id = p_run::text;
  UPDATE public.data_set_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('restored', n_restore, 'members_deleted', n_del, 'sets_deleted', n_sets))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'supersedes_restored', n_restore, 'members_deleted', n_del, 'sets_deleted', n_sets,
    'members_left', n_left);
END
$function$;

DROP FUNCTION IF EXISTS public.data_set_replica_presented_v1(text);
REVOKE ALL ON FUNCTION public.data_set_membership_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_candidates_v1(uuid[]) FROM PUBLIC, anon, authenticated;
commit;
