-- Data-set membership: a link between two records is membership in the same data set.
--
-- Why. Nuke already reads the facts that put a car beside other cars (its VIN's series, engine and plant characters,
-- the block and transmission castings read off its photos, its cowl tag paint and style, whether it is a replica,
-- what auction comments talk about), but none of those groupings is on record, so "what else is in my sets, and how
-- did those cars sell?" took one-off queries. This file records each grouping as a data set and each record that
-- belongs to it as a member, so any car can ask that question through two readers.
--
-- Axiom. Only the origin record is proven. A member row is an inference that cites the origin row it came from
-- (basis_type + basis_id: a vehicle_observations row, a field_evidence row, the vehicles row whose VIN or replica flag
-- was read, or the auction_comments row the rubric matched) with a confidence. No evidence, no membership: a car whose
-- VIN does not parse, or whose decoded year disagrees with its profile, is simply not in a VIN set (unknown stays
-- unknown). A set's label is the cited vehicle_decode_rules value for its code, or NULL when no rule covers it.
--
-- Tables.
--   data_sets          one row per (set_kind, set_key, rule_version); label and provenance cite the decode rule.
--   data_set_members   one row per (set, member, basis); state active | superseded; run_id of the run that added it.
--   data_set_runs      one row per producer run (scope, counts, status).
--   data_set_member_plan  the run's plan and log: every add or supersede a run planned, applied, skipped or reverted
--                      (the backup: nothing changes that is not planned here first).
-- Set kinds (keys are lower case): vin_cohort 'pontiac:1973:s87:d' (series + body + engine), vin_series
--   'pontiac:1973:s87', vin_engine 'pontiac:1973:d', plant_year 'pontiac:1973:n' (VIN and cowl tag), cowl_style
--   '1973:2fs87', engine_block_casting '9799140', engine_code 'pontiac:yh', trans_case_casting '3851325',
--   trans_tail_casting '3857584', paint_code 'pontiac:1973:75', replica_cohort 'as_built:<vin_cohort key>' and
--   'as_presented:<vin_cohort or vin_series key>', comment_theme '<theme>' (comment_theme_v1 keyword rubric).
-- Producer (service role only, dry by default): data_set_membership_plan_v1(run, scope, vehicle) ->
--   data_set_membership_apply_v1(run, batch <= 500, max_batches, dry) -> data_set_membership_revert_v1(run).
--   Re-planning after evidence changes plans 'supersede' for active members whose basis no longer holds.
-- Readers (anon): vehicle_data_sets(vehicle) and data_set_comps(set | vehicle, basis) - sale stats of the members'
--   auction_events_canonical rows on one price basis, one row per listing.
-- Not stored: comment text or author (a comment member is its id and the matched term only), photo URLs.
-- Contract: supabase/sql/test_data_set_membership.sql
-- Revert of this file: supabase/sql/revert_20261123180000_data_set_membership.sql (revert each run first).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.data_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_kind text NOT NULL CHECK (set_kind IN ('vin_cohort','vin_series','vin_engine','plant_year','cowl_style',
    'engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code','replica_cohort',
    'comment_theme')),
  set_key text NOT NULL CHECK (set_key <> '' AND set_key = lower(btrim(set_key))),
  rule_version text NOT NULL,
  label text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_kind, set_key, rule_version)
);
COMMENT ON TABLE public.data_sets IS
  'Shared data sets (20261123180000): a link between records is membership in the same set. label = cited vehicle_decode_rules value, NULL when no rule covers the code.';

CREATE TABLE IF NOT EXISTS public.data_set_members (
  id bigserial PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES public.data_sets(id),
  member_type text NOT NULL CHECK (member_type IN ('vehicle','image','receipt','receipt_item','auction_event',
    'auction_comment','observation')),
  member_id uuid NOT NULL,
  vehicle_id uuid,
  basis_type text NOT NULL CHECK (basis_type IN ('observation','field_evidence','vehicle_vin','vehicle_flag','comment_rubric')),
  basis_id uuid NOT NULL,
  basis_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  rule_version text NOT NULL,
  run_id text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','superseded')),
  superseded_by bigint REFERENCES public.data_set_members(id),
  superseded_at timestamptz,
  superseded_run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS data_set_members_active_uq
  ON public.data_set_members (set_id, member_type, member_id, basis_type, basis_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS data_set_members_set_idx
  ON public.data_set_members (set_id, member_type) INCLUDE (vehicle_id, member_id, confidence) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS data_set_members_vehicle_idx
  ON public.data_set_members (vehicle_id, set_id) INCLUDE (member_type, confidence) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS data_set_members_member_idx
  ON public.data_set_members (member_type, member_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS data_set_members_run_idx ON public.data_set_members (run_id);
COMMENT ON TABLE public.data_set_members IS
  'Members of data_sets (20261123180000). Each row is an inference citing its origin row (basis_type, basis_id) with a confidence; superseded rows are kept.';

CREATE TABLE IF NOT EXISTS public.data_set_runs (
  run_id text PRIMARY KEY,
  producer text NOT NULL,
  logic_version text NOT NULL,
  scope text NOT NULL,
  vehicle_id uuid,
  n_vehicles integer,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','applying','applied','reverted')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  planned_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reverted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.data_set_member_plan (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL REFERENCES public.data_set_runs(run_id),
  action text NOT NULL CHECK (action IN ('add','supersede')),
  set_kind text NOT NULL,
  set_key text NOT NULL,
  set_label text,
  set_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  member_type text NOT NULL,
  member_id uuid NOT NULL,
  vehicle_id uuid,
  basis_type text NOT NULL,
  basis_id uuid NOT NULL,
  basis_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL,
  member_rule_version text NOT NULL,
  target_member_id bigint,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','applied','skipped','reverted')),
  skip_reason text,
  set_id uuid,
  set_created boolean,
  member_row_id bigint,
  planned_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_set_member_plan_run_idx ON public.data_set_member_plan (run_id, state, id);

ALTER TABLE public.data_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_set_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_set_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_set_member_plan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_sets, public.data_set_members, public.data_set_runs, public.data_set_member_plan
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.data_set_members_id_seq, public.data_set_member_plan_id_seq FROM PUBLIC, anon, authenticated;

-- The cited decode rule for a code: its value as the label when exactly one live rule value covers it, else NULL
-- (no rule, or rules that disagree), with every matching rule id in provenance.
CREATE OR REPLACE FUNCTION public.data_set_rule_label(p_rule_key text, p_make text, p_code text, p_year integer)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH r AS (
    SELECT d.id, d.value FROM public.vehicle_decode_rules d
     WHERE d.rule_key = p_rule_key AND d.superseded_at IS NULL
       AND upper(d.code) = upper(p_code)
       AND (d.make IS NULL OR lower(d.make) = lower(p_make))
       AND (p_year IS NULL OR ((d.year_min IS NULL OR d.year_min <= p_year) AND (d.year_max IS NULL OR d.year_max >= p_year))))
  SELECT jsonb_build_object('rule_key', p_rule_key,
           'label', CASE WHEN (SELECT count(DISTINCT value) FROM r) = 1 THEN (SELECT min(value::text) FROM r) END,
           'rule_ids', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM r), '[]'::jsonb),
           'rule_values', (SELECT count(DISTINCT value) FROM r))
$function$;

-- comment_theme_v1: a fixed, versioned keyword rubric. Returns each theme a comment's text matches and the matched term.
CREATE OR REPLACE FUNCTION public.data_set_comment_themes_v1(p_text text)
RETURNS TABLE (theme text, matched text) LANGUAGE sql IMMUTABLE AS $function$
  SELECT t.theme, lower((regexp_match(p_text, '(' || t.re || ')', 'i'))[1])
    FROM (VALUES
      ('sd_authenticity',   '\msd[- ]?455\M|\msuper[- ]?duty\M'),
      ('replica_clone',     '\mreplicas?\M|\mclone[ds]?\M|\mtribute\M|\mre-?creation\M'),
      ('muncie_4speed',     '\mmuncie\M|\m(4|four)[- ]?speed\M|\mm2[012]\M'),
      ('documentation_phs', '\mphs\M|pontiac historic|\mbuild sheet\M|window sticker|protect-?o-?plate|billing (history|card)'),
      ('numbers_matching',  'numbers[- ]?matching|matching[- ]?numbers|\mnumbers match|original (engine|motor|drivetrain)'),
      ('rust_bodywork',     '\mrust(y|ed|ing)?\M|\mbondo\M|body ?filler')
    ) t(theme, re)
   WHERE p_text IS NOT NULL AND p_text ~* t.re
$function$;

-- Every membership the evidence supports for the given vehicles (live profiles only). One row per (set, member, basis).
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

-- Whether a planned member's origin row still says what it said when the run was planned.
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

-- The vehicles a scope covers. 'vehicle' = p_vehicle; 'pontiac_f_body' = every Pontiac profile whose model reads
-- Firebird or Trans Am, or whose 1972-80 VIN carries the Firebird body code 87. Deleted and merged profiles are
-- included so their active members can be superseded; candidates come from live profiles only.
CREATE OR REPLACE FUNCTION public.data_set_scope_vehicles(p_scope text, p_vehicle uuid)
RETURNS uuid[] LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE p_scope
    WHEN 'vehicle' THEN ARRAY[p_vehicle]
    WHEN 'pontiac_f_body' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'pontiac'
                                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][02-9][A-Z][0-9]{6}$'))
  END
$function$;

-- Producer step 1 (the backup): record every membership the run would add and every active membership in scope it
-- would supersede (its basis no longer supports it), before anything changes.
CREATE OR REPLACE FUNCTION public.data_set_membership_plan_v1(p_run uuid, p_scope text DEFAULT 'vehicle', p_vehicle uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE v_ids uuid[]; n_add int; n_sup int; n_cand int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v1: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body') THEN RAISE EXCEPTION 'data_set_membership_plan_v1: unknown scope %', p_scope; END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v1: scope vehicle needs a vehicle'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'data_set_membership_plan_v1: run % already planned', p_run;
  END IF;
  v_ids := coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}');
  INSERT INTO public.data_set_runs (run_id, producer, logic_version, scope, vehicle_id, n_vehicles)
  VALUES (p_run::text, 'data_set_membership_v1', 'data_set_membership/20261123180000.1', p_scope, p_vehicle, cardinality(v_ids));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_cand (LIKE public.data_set_member_plan INCLUDING DEFAULTS) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_cand;
  INSERT INTO pg_temp.data_set_cand (id, run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT 0, p_run::text, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM (SELECT DISTINCT ON (c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id) c0.*
            FROM public.data_set_candidates_v1(v_ids) c0
           ORDER BY c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id, c0.confidence DESC) c;
  GET DIAGNOSTICS n_cand = ROW_COUNT;
  ANALYZE pg_temp.data_set_cand;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT c.run_id, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM pg_temp.data_set_cand c
   WHERE NOT EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
                      WHERE m.state = 'active' AND s.set_kind = c.set_kind AND s.set_key = c.set_key
                        AND s.rule_version = 'data_set_keys_v1' AND m.member_type = c.member_type
                        AND m.member_id = c.member_id AND m.basis_type = c.basis_type AND m.basis_id = c.basis_id)
   ORDER BY c.vehicle_id, c.set_kind, c.set_key, c.member_type, c.member_id;
  GET DIAGNOSTICS n_add = ROW_COUNT;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, member_type, member_id, vehicle_id, basis_type,
    basis_id, basis_detail, confidence, member_rule_version, target_member_id)
  SELECT p_run::text, 'supersede', s.set_kind, s.set_key, m.member_type, m.member_id, m.vehicle_id, m.basis_type,
         m.basis_id, m.basis_detail, m.confidence, m.rule_version, m.id
    FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
   WHERE m.state = 'active' AND m.vehicle_id = ANY (v_ids)
     AND NOT EXISTS (SELECT 1 FROM pg_temp.data_set_cand c
                      WHERE c.set_kind = s.set_kind AND c.set_key = s.set_key AND c.member_type = m.member_type
                        AND c.member_id = m.member_id AND c.basis_type = m.basis_type AND c.basis_id = m.basis_id)
   ORDER BY m.id;
  GET DIAGNOSTICS n_sup = ROW_COUNT;

  UPDATE public.data_set_runs SET summary = jsonb_build_object('candidates', n_cand, 'planned_add', n_add, 'planned_supersede', n_sup)
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'scope', p_scope, 'vehicles', cardinality(v_ids), 'candidates', n_cand,
    'planned_add', n_add, 'planned_supersede', n_sup,
    'by_kind', (SELECT jsonb_object_agg(k, n) FROM (SELECT p.action || ':' || p.set_kind || ':' || p.member_type AS k, count(*) AS n
                  FROM public.data_set_member_plan p WHERE p.run_id = p_run::text GROUP BY 1) s));
END
$function$;

-- Producer step 2: apply a planned run in batches (dry by default). Each add re-checks its origin row first; each batch
-- is read back (every applied add has its member row, every applied supersede left its row superseded) or the call aborts.
CREATE OR REPLACE FUNCTION public.data_set_membership_apply_v1(p_run uuid, p_batch integer DEFAULT 200,
  p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE
  r record; b int := 0; n int; v_ids bigint[]; v_set uuid; v_created boolean; v_new bigint; n_bad int;
  n_app int := 0; n_skip int := 0; n_sets int := 0; v_batches jsonb := '[]'; b_app int; b_skip int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_apply_v1: run required'; END IF;
  IF p_batch NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch must be 1..500'; END IF;
  IF p_max_batches NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: max_batches must be 1..200'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = p_run::text AND x.status IN ('planned','applying','applied')) THEN
    RAISE EXCEPTION 'data_set_membership_apply_v1: run % is not planned (or was reverted)', p_run;
  END IF;
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', true,
      'planned', (SELECT jsonb_object_agg(k, c) FROM (SELECT p.action || ':' || p.set_kind AS k, count(*) AS c
                    FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned' GROUP BY 1) s),
      'would_take_now', least(p_batch * p_max_batches,
        (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned')));
  END IF;
  UPDATE public.data_set_runs SET status = 'applying' WHERE run_id = p_run::text;
  WHILE b < p_max_batches LOOP
    n := 0; b_app := 0; b_skip := 0; v_ids := '{}';
    FOR r IN SELECT p.* FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned'
              ORDER BY p.id LIMIT p_batch FOR UPDATE SKIP LOCKED LOOP
      n := n + 1; v_ids := v_ids || r.id;
      IF r.action = 'add' THEN
        IF NOT public.data_set_basis_live(r.basis_type, r.basis_id, r.vehicle_id, r.basis_detail) THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_changed' WHERE id = r.id;
          b_skip := b_skip + 1; CONTINUE;
        END IF;
        v_set := NULL;
        INSERT INTO public.data_sets (set_kind, set_key, rule_version, label, provenance, created_run_id)
        VALUES (r.set_kind, r.set_key, 'data_set_keys_v1', r.set_label, r.set_provenance, p_run::text)
        ON CONFLICT (set_kind, set_key, rule_version) DO NOTHING RETURNING id INTO v_set;
        v_created := v_set IS NOT NULL;
        IF v_set IS NULL THEN
          SELECT s.id INTO v_set FROM public.data_sets s
           WHERE s.set_kind = r.set_kind AND s.set_key = r.set_key AND s.rule_version = 'data_set_keys_v1';
        ELSE n_sets := n_sets + 1; END IF;
        v_new := NULL;
        INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id, basis_detail,
          confidence, rule_version, run_id)
        VALUES (v_set, r.member_type, r.member_id, r.vehicle_id, r.basis_type, r.basis_id, r.basis_detail, r.confidence,
          r.member_rule_version, p_run::text)
        ON CONFLICT (set_id, member_type, member_id, basis_type, basis_id) WHERE state = 'active' DO NOTHING
        RETURNING id INTO v_new;
        IF v_new IS NULL THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'already_member', set_id = v_set,
                 set_created = v_created WHERE id = r.id;
          b_skip := b_skip + 1;
        ELSE
          UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now(), set_id = v_set, set_created = v_created,
                 member_row_id = v_new WHERE id = r.id;
          b_app := b_app + 1;
        END IF;
      ELSE
        UPDATE public.data_set_members SET state = 'superseded', superseded_at = now(), superseded_run_id = p_run::text
         WHERE id = r.target_member_id AND state = 'active';
        IF FOUND THEN
          UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now() WHERE id = r.id; b_app := b_app + 1;
        ELSE
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'not_active' WHERE id = r.id; b_skip := b_skip + 1;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN n = 0;
    b := b + 1;
    SELECT count(*) INTO n_bad FROM public.data_set_member_plan p
      LEFT JOIN public.data_set_members m ON m.id = coalesce(p.member_row_id, p.target_member_id)
     WHERE p.id = ANY (v_ids) AND p.state = 'applied'
       AND (m.id IS NULL
            OR (p.action = 'add' AND (m.run_id <> p.run_id OR m.set_id IS DISTINCT FROM p.set_id OR m.member_id <> p.member_id))
            OR (p.action = 'supersede' AND (m.state <> 'superseded' OR m.superseded_run_id IS DISTINCT FROM p.run_id)));
    IF n_bad > 0 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch % verify failed: % applied plan rows do not match', b, n_bad; END IF;
    IF b_app + b_skip <> n THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch % took % rows, % applied, % skipped', b, n, b_app, b_skip; END IF;
    n_app := n_app + b_app; n_skip := n_skip + b_skip;
    v_batches := v_batches || jsonb_build_array(jsonb_build_object('batch', b, 'rows', n, 'applied', b_app, 'skipped', b_skip));
  END LOOP;
  UPDATE public.data_set_runs x
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'planned')
                       THEN 'applying' ELSE 'applied' END,
         applied_at = now(),
         summary = x.summary || jsonb_build_object('applied', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'applied'),
                                                    'skipped', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'skipped'),
                                                    'sets_created', (SELECT count(*) FROM public.data_sets s WHERE s.created_run_id = x.run_id))
   WHERE x.run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'dry', false, 'batches', b, 'applied', n_app, 'skipped', n_skip, 'sets_created', n_sets,
    'per_batch', v_batches,
    'still_planned', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned'));
END
$function$;

-- Revert a run: its supersedes are restored, its added members deleted, and the sets it created that are left with no
-- members deleted. A member a later run superseded is restored only by reverting that later run first.
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

-- Whether the caller may read a vehicle's memberships: public profiles to everyone; others to the service role or the
-- profile's owner.
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

-- Reader: the data sets a vehicle belongs to, with the evidence behind each and how many vehicles share it.
CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '8s'
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
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

-- Sale stats for one set: the auction_events_canonical rows of its member vehicles (comment themes: the auctions the
-- member comments were posted on), one row per listing (canonical_listing_url, else source_url), the subject vehicle
-- and its same-VIN profiles left out. Sold = outcome sold, a positive price on p_basis, not typed not-sold, not a
-- duplicate; converted to USD with fx_usd_rate when the currency is known. Unsold outcomes report their high bid,
-- which is not a sale price.
CREATE OR REPLACE FUNCTION public.data_set_comps_one(p_set_id uuid, p_exclude_vehicle uuid, p_basis price_basis_t)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH s AS (SELECT * FROM public.data_sets WHERE id = p_set_id),
  ex AS (SELECT upper(btrim(x.vin)) AS vin FROM public.vehicles x WHERE x.id = p_exclude_vehicle AND nullif(btrim(x.vin), '') IS NOT NULL),
  mv AS (
    SELECT DISTINCT m.vehicle_id FROM public.data_set_members m, s
     WHERE m.set_id = s.id AND m.state = 'active' AND m.member_type = 'vehicle' AND s.set_kind <> 'comment_theme'
       AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev_ids AS (
    SELECT ae.id FROM mv JOIN public.auction_events_canonical ae ON ae.vehicle_id = mv.vehicle_id
    UNION
    SELECT c.auction_event_id FROM public.data_set_members m JOIN s ON s.id = m.set_id
      JOIN public.auction_comments c ON c.id = m.member_id
     WHERE s.set_kind = 'comment_theme' AND m.state = 'active' AND m.member_type = 'auction_comment'
       AND c.auction_event_id IS NOT NULL AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev AS (
    SELECT DISTINCT ON (coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text))
           ae.id, ae.vehicle_id, ae.outcome, ae.auction_end_date, ae.currency_code, ae.high_bid,
           (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price
                         WHEN 'net_to_owner' THEN ae.net_to_owner END) AS amt,
           ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
             AND NOT (coalesce(ae.raw_data, '{}'::jsonb) ? 'duplicate_of') AS is_sold
      FROM ev_ids JOIN public.auction_events_canonical ae ON ae.id = ev_ids.id
      LEFT JOIN public.vehicles x ON x.id = ae.vehicle_id
     WHERE ae.vehicle_id IS DISTINCT FROM p_exclude_vehicle
       AND NOT EXISTS (SELECT 1 FROM ex WHERE ex.vin = upper(btrim(x.vin)))
     ORDER BY coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text),
              (ae.outcome = 'sold') DESC, ae.auction_end_date DESC NULLS LAST, ae.id),
  priced AS (
    SELECT ev.*, CASE WHEN ev.currency_code IS NULL THEN ev.amt ELSE round(ev.amt * fx.rate, 0) END AS usd,
           ev.currency_code IS NULL AS unconverted,
           extract(year FROM ev.auction_end_date)::int AS yr
      FROM ev LEFT JOIN LATERAL (SELECT f.rate FROM public.fx_usd_rate(ev.currency_code, (ev.auction_end_date AT TIME ZONE 'UTC')::date) f LIMIT 1) fx
        ON ev.currency_code IS NOT NULL
     WHERE ev.is_sold AND ev.amt > 0),
  sold AS (SELECT * FROM priced WHERE usd IS NOT NULL)
  SELECT jsonb_build_object(
    'set_id', s.id, 'set_kind', s.set_kind, 'set_key', s.set_key, 'label', s.label,
    'member_vehicles', (SELECT count(*) FROM mv),
    'listings', (SELECT count(*) FROM ev),
    'price_basis', p_basis::text,
    'sold', (SELECT jsonb_build_object('n', count(*), 'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY usd),
                                       'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY usd),
                                       'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY usd),
                                       'min', min(usd), 'max', max(usd),
                                       'n_currency_unknown', count(*) FILTER (WHERE unconverted)) FROM sold),
    'sold_by_period', (SELECT coalesce(jsonb_agg(jsonb_build_object('period', p.period, 'n', p.n, 'median', p.med) ORDER BY p.period), '[]'::jsonb)
                         FROM (SELECT CASE WHEN yr IS NULL THEN 'unknown' WHEN yr < 2015 THEN 'before_2015'
                                           WHEN yr < 2020 THEN '2015_2019' ELSE yr::text END AS period,
                                      count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY usd) AS med
                                 FROM sold GROUP BY 1) p),
    'by_outcome', (SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o.outcome, 'n', o.n, 'median_high_bid_not_a_sale', o.hb) ORDER BY o.n DESC), '[]'::jsonb)
                     FROM (SELECT e2.outcome, count(*) AS n,
                                  CASE WHEN e2.outcome <> 'sold'
                                       THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY e2.high_bid) FILTER (WHERE e2.high_bid > 0 AND e2.currency_code IS NOT DISTINCT FROM 'USD') END AS hb
                             FROM (SELECT coalesce(ev.outcome, 'unknown') AS outcome, ev.high_bid, ev.currency_code FROM ev) e2
                            GROUP BY e2.outcome) o))
  FROM s
$function$;

-- Reader: comps for one set (p_set_id), or for every set a vehicle belongs to (p_vehicle_id). For a replica's
-- as-presented set the genuine cohort with the same VIN key is added (role genuine_cohort), so a replica is read both
-- as built (its own VIN sets) and as presented (replicas presented the same way, and the real cars).
CREATE OR REPLACE FUNCTION public.data_set_comps(p_set_id uuid DEFAULT NULL, p_vehicle_id uuid DEFAULT NULL,
  p_basis price_basis_t DEFAULT 'hammer')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'data_set_comps: price basis required (hammer | gross_incl_premium | net_to_owner; bases are never mixed)';
  END IF;
  IF p_set_id IS NULL AND p_vehicle_id IS NULL THEN RAISE EXCEPTION 'data_set_comps: set or vehicle required'; END IF;
  IF p_vehicle_id IS NOT NULL AND NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH own AS (
    SELECT DISTINCT m.set_id FROM public.data_set_members m
     WHERE p_set_id IS NULL AND m.vehicle_id = p_vehicle_id AND m.state = 'active'
    UNION SELECT p_set_id WHERE p_set_id IS NOT NULL),
  tgt AS (
    SELECT o.set_id, 'member'::text AS role, NULL::uuid AS for_set FROM own o
    UNION ALL
    SELECT g.id, 'genuine_cohort', s.id
      FROM own o JOIN public.data_sets s ON s.id = o.set_id
      JOIN public.data_sets g ON g.rule_version = s.rule_version
       AND g.set_kind = CASE WHEN array_length(string_to_array(substr(s.set_key, 14), ':'), 1) = 4 THEN 'vin_cohort' ELSE 'vin_series' END
       AND g.set_key = substr(s.set_key, 14)
     WHERE s.set_kind = 'replica_cohort' AND s.set_key LIKE 'as_presented:%')
  SELECT jsonb_build_object('vehicle_id', p_vehicle_id, 'set_id', p_set_id, 'price_basis', p_basis::text,
           'logic_version', 'data_set_membership/20261123180000.1',
           'sets', coalesce(jsonb_agg(public.data_set_comps_one(t.set_id, p_vehicle_id, p_basis)
                                        || jsonb_build_object('role', t.role, 'for_set', t.for_set)
                                      ORDER BY t.role DESC, t.set_id), '[]'::jsonb))
    INTO v_out FROM tgt t;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_membership_plan_v1(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_candidates_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_comps_one(uuid, uuid, price_basis_t) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_data_sets(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.data_set_comps(uuid, uuid, price_basis_t) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_plan_v1(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_revert_v1(uuid) TO service_role;

commit;
