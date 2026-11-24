-- Isolated PostgreSQL 17 contract for the spec readings layer:
--   20261124020000_spec_readings, 20261124021000_spec_landing_drain, 20261124022000_spec_readings_review,
--   20261124023000_spec_readings_public_sources, 20261124024000_spec_readings_financial_cleanup,
--   20261124025000_data_set_public_counts, 20261124026000_spec_platform_scopes.
-- Synthetic rows only; never production. Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_spec_readings
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_spec_readings -f supabase/sql/test_spec_readings.sql
-- Proof: the matcher keys stated spec fields and refuses clones, parts, negations, tire sizes and GT500KR-as-GT500; the
-- producer lands run-stamped readings with their source row and column, reads public observations only and keeps no comment
-- text; the drain works decode -> plan -> apply; memberships fold into sets; both reverts leave no active rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '5s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- pg_cron stand-in: the drain migration only schedules jobs
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
     ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;

-- Minimal stand-ins for the tables and the 20261123 data-set functions these migrations extend (bodies as of 20261123)
create table public.vehicles (id uuid primary key default gen_random_uuid(), make text, model text, year int, vin text, status text, deleted_at timestamptz, merged_into_vehicle_id uuid,
 is_replica boolean, replica_quote text, is_public boolean default true, listing_title text, bat_listing_title text, title text, description text, highlights text, equipment text, modifications text, numbers_quote text,
 body_style text, canonical_body_style text, trim text, trim_level text, engine_size text, engine_displacement text, displacement text, engine_code text, engine_liters numeric,
 transmission text, transmission_type text, transmission_model text, transmission_code text, transmission_speeds int, rear_axle_ratio numeric, paint_code text, msrp numeric,
 documents_on_hand jsonb, numbers_documented_by text[]);
create table public.auction_comments (id uuid primary key default gen_random_uuid(), vehicle_id uuid, auction_event_id uuid, comment_type text, comment_text text, has_question boolean);
create table public.vehicle_observations (id uuid primary key default gen_random_uuid(), vehicle_id uuid, kind text, content_text text, is_superseded boolean, extraction_method text, structured_data jsonb, confidence_score numeric);
create table public.field_evidence (id uuid primary key default gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text, status text, source_type text, source_confidence int);
create table public.photo_text_lines (id uuid primary key default gen_random_uuid(), vehicle_id uuid, text text);
create table public.image_descriptions (id uuid primary key default gen_random_uuid(), vehicle_id uuid, description text);
create table public.vehicle_images (id uuid primary key default gen_random_uuid(), vehicle_id uuid);
create table public.vehicle_decode_rules (id bigserial primary key, rule_key text, make text, model text, code text, year_min int, year_max int, qualifiers jsonb, value jsonb, citation_url text, citation_title text, citation_locator text, cited_on date, superseded_at timestamptz);
create table public.vintage_rpo_codes (id uuid primary key default gen_random_uuid(), rpo_code text, description text, first_year smallint, last_year smallint, makes text[], manufacturer text default 'GM');
create table public.gm_rpo_library (id uuid primary key default gen_random_uuid(), rpo_code text, description text, first_year smallint, last_year smallint);
CREATE TABLE public.vehicle_code_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code','cowl_style','cowl_option')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{2,8}$'), model_year integer,
  origin_table text NOT NULL CHECK (origin_table IN ('vehicles','auction_comments')), origin_id uuid NOT NULL, origin_column text NOT NULL,
  match_text text, match_offset integer, pattern_key text NOT NULL, confidence numeric(4,3) NOT NULL, rule_version text NOT NULL, run_id text NOT NULL,
  state text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz, base_confidence numeric(4,3));
CREATE UNIQUE INDEX vehicle_code_readings_active_uq ON public.vehicle_code_readings (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active';
CREATE TABLE public.vehicle_code_reading_runs (run_id text PRIMARY KEY, producer text NOT NULL, logic_version text NOT NULL, scope text NOT NULL, n_vehicles integer,
  status text NOT NULL DEFAULT 'applying', summary jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz, reverted_at timestamptz);
CREATE TABLE public.vehicle_code_readings_backup (LIKE public.vehicle_code_readings);
ALTER TABLE public.vehicle_code_readings_backup ADD COLUMN backed_up_at timestamptz NOT NULL DEFAULT now();
create table public.data_sets (id uuid primary key default gen_random_uuid(), set_kind text not null, set_key text not null, rule_version text not null, label text, provenance jsonb, created_run_id text, unique(set_kind,set_key,rule_version));
alter table public.data_sets add constraint data_sets_set_kind_check check (set_kind in ('x'));
create table public.data_set_members (id bigserial primary key, set_id uuid, member_type text, member_id uuid, vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, rule_version text, run_id text, state text default 'active', superseded_at timestamptz, superseded_run_id text);
CREATE UNIQUE INDEX data_set_members_active_uq ON public.data_set_members USING btree (set_id, member_type, member_id, basis_type, basis_id) WHERE (state = 'active'::text);
create table public.data_set_member_plan (id bigserial primary key, run_id text, action text, set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid, vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text, target_member_id bigint, state text default 'planned', skip_reason text, applied_at timestamptz, reverted_at timestamptz, set_id uuid, set_created boolean, member_row_id bigint);
create table public.data_set_runs (run_id text primary key, producer text, logic_version text, scope text, vehicle_id uuid, n_vehicles int, status text default 'planned', summary jsonb default '{}', planned_at timestamptz default now(), applied_at timestamptz, reverted_at timestamptz);
CREATE OR REPLACE FUNCTION public.data_set_replica_presented_v1(p_quote text, OUT p_series text, OUT p_app text)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_quote ~* '\mtrans[- ]?am\M' THEN 'Trans Am' WHEN p_quote ~* '\mformula\M' THEN 'Formula' END,
         CASE WHEN p_quote ~* '\msd[- ]?455\M|\msuper[- ]?duty\M' THEN 'Super Duty' END
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_comment_themes_v1(p_text text)
 RETURNS TABLE(theme text, matched text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_can_read_vehicle(p_vehicle uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_claims jsonb; v_role text; v_sub uuid; v_x record;
BEGIN
  SELECT x.id, x.is_public, x.user_id, x.owner_id, x.uploaded_by INTO v_x
    FROM public.vehicles x WHERE x.id = p_vehicle AND x.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_x.is_public IS TRUE THEN RETURN true; END IF;
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  -- No claims: privileged only on a direct database login; a request through the API gateway is never trusted without them.
  v_role := coalesce(v_claims->>'role', CASE WHEN session_user IN ('authenticator','anon','authenticated') THEN 'anon' ELSE 'service_role' END);
  IF v_role NOT IN ('anon','authenticated') THEN RETURN true; END IF;
  IF coalesce(v_claims->>'sub', '') !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  v_sub := (v_claims->>'sub')::uuid;
  RETURN coalesce(v_sub IN (v_x.user_id, v_x.owner_id, v_x.uploaded_by), false)
      OR coalesce(public.vehicle_user_has_access(p_vehicle, v_sub), false);
END
$function$
;

CREATE OR REPLACE FUNCTION public.text_code_matches_v1(p_text text)
 RETURNS TABLE(kind text, code text, match_text text, pattern_key text, base_conf numeric)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH p(kind, pattern_key, re, base_conf) AS (VALUES
    ('engine_block_casting', 'block_casting_no',
       '((?:block|engine)[^.;|•\n]{0,40}?casting\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{6,7}))\M', 0.60),
    ('engine_code', 'engine_code_label',
       '((?:engine|block)\s+(?:code|stamp(?:ed)?(?:\s+code)?|id\s+code)\s*(?:is|of|:|-|=|#)?\s*["“'']?([A-Za-z0-9]{2})["”'']?)\M', 0.60),
    ('engine_code', 'engine_stamp_after_partial_vin',
       '(engine\s+stamp\s*:?\s*[0-9]{6,8}\s+([A-Za-z0-9]{2}))\M', 0.60),
    ('engine_code', 'code_suffix',
       '(\m([A-Za-z][A-Za-z0-9])[- ](?:code|suffix)\M)', 0.50),
    ('engine_code', 'cid_code_block',
       '(\m(?:350|400|455)\s+([WXYZwxyz][A-Za-z0-9])\s+(?:block|engine)\M)', 0.55),
    ('trans_case_casting', 'trans_case_casting_no',
       '((?:trans(?:mission)?|muncie|turbo|th-?400|th-?350|m2[012]|case)[^.;|•\n]{0,30}?casting\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{7}))\M', 0.50),
    ('trans_case_casting', 'main_case',
       '((?:main\s+case\s*(?:casting)?\s*(?:no\.?|#|:)?\s*([0-9]{7}))|(?:\m([0-9]{7})\s+main\s+case))\M', 0.50),
    ('trans_tail_casting', 'tail_housing_no',
       '((?:tail\s*(?:housing|shaft\s+housing)?|extension\s+housing)\s*(?:casting)?\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{7}))\M', 0.55),
    ('paint_code', 'paint_code',
       '(paint\s+code\s*(?:is|of|:|-|#)?\s*[:#]?\s*([0-9]{2}[A-Za-z]?))\M', 0.55),
    ('paint_code', 'paint_colon_named',
       '(paint\s*:\s*([0-9]{2}[A-Za-z]?)\s*[(-])', 0.55),
    ('cowl_style', 'fisher_style',
       '(\m(2F[SUVWXsuvwx]?87)\M)', 0.60),
    ('cowl_option', 'tag_then_option',
       '((?:cowl|trim|body|fisher)\s+(?:tag|plate)[^.|•\n]{0,120}?\m(WS4|WS6|W50|W66|W72|Y82|Y84|Y85|Y88|Y89|CC1|ws4|ws6|y82|y84|y85)\M)', 0.50),
    ('cowl_option', 'option_then_tag',
       '(\m(WS4|WS6|W50|W66|W72|Y82|Y84|Y85|Y88|Y89|CC1)\M[^.|•\n]{0,60}?(?:cowl|trim|body)\s+tag)', 0.50)),
  m AS (
    SELECT p.kind, p.pattern_key, p.base_conf, x.g
      FROM p CROSS JOIN LATERAL regexp_matches(p_text, p.re, 'gi') AS x(g))
  SELECT m.kind, upper(coalesce(m.g[2], m.g[3])), left(regexp_replace(m.g[1], '\s+', ' ', 'g'), 160), m.pattern_key, m.base_conf
    FROM m
   WHERE coalesce(m.g[2], m.g[3]) IS NOT NULL
     -- a block reading must not be a head, intake, manifold, carb, distributor or transmission number
     AND NOT (m.kind = 'engine_block_casting' AND m.g[1] ~* '(head|intake|manifold|carb|distributor|trans|bell|water pump|crank)')
     AND NOT (m.kind = 'trans_case_casting' AND m.g[1] ~* '(tail|extension|intake|head|manifold|carb|block|engine|bell)')
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_rule_label(p_rule_key text, p_make text, p_code text, p_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_basis_live(p_basis_type text, p_basis_id uuid, p_vehicle uuid, p_detail jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_basis_type
    WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = p_basis_id
                                      AND o.vehicle_id = p_vehicle AND NOT coalesce(o.is_superseded, false))
    WHEN 'field_evidence' THEN EXISTS (SELECT 1 FROM public.field_evidence f WHERE f.id = p_basis_id AND f.vehicle_id = p_vehicle
                                      AND coalesce(f.status, '') NOT IN ('rejected','superseded')
                                      AND upper(btrim(f.proposed_value)) = p_detail->>'vin')
    WHEN 'vehicle_vin' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND upper(btrim(x.vin)) = p_detail->>'vin')
    WHEN 'vehicle_flag' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND x.is_replica IS TRUE
                                      AND upper(btrim(x.vin)) = p_detail->>'vin'
                                      AND (p_detail->>'cohort' IS DISTINCT FROM 'as_presented'
                                           OR ((public.data_set_replica_presented_v1(x.replica_quote)).p_series IS NOT DISTINCT FROM p_detail->>'presented_series'
                                               AND (public.data_set_replica_presented_v1(x.replica_quote)).p_app IS NOT DISTINCT FROM p_detail->>'presented_engine')))
    WHEN 'comment_rubric' THEN EXISTS (SELECT 1 FROM public.auction_comments c WHERE c.id = p_basis_id
                                      AND c.vehicle_id IS NOT DISTINCT FROM p_vehicle
                                      AND c.auction_event_id IS NOT DISTINCT FROM nullif(p_detail->>'auction_event_id', '')::uuid)
    WHEN 'code_reading' THEN EXISTS (SELECT 1 FROM public.vehicle_code_readings r WHERE r.id = p_basis_id
                                      AND r.vehicle_id = p_vehicle AND r.state = 'active'
                                      AND upper(r.code) = p_detail->>'code')
    ELSE false END
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_membership_apply_v1(p_run uuid, p_batch integer DEFAULT 200, p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE
  r record; a record; b int := 0; n int; v_ids bigint[]; v_set uuid; v_created boolean; v_new bigint; n_bad int;
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
              ORDER BY (p.action = 'add'), p.id LIMIT p_batch FOR UPDATE SKIP LOCKED LOOP
      -- a restamp's add may already have been taken together with its supersede earlier in this batch
      CONTINUE WHEN (SELECT x.state FROM public.data_set_member_plan x WHERE x.id = r.id) <> 'planned';
      n := n + 1; v_ids := v_ids || r.id;
      a := NULL;
      IF r.action = 'add' THEN
        a := r;
      ELSE
        -- a restamp is a supersede plus an add of the same (set, member, basis): both are taken in this one step
        a := NULL;
        SELECT x.* INTO a FROM public.data_set_member_plan x
         WHERE x.run_id = r.run_id AND x.action = 'add' AND x.state = 'planned' AND r.member_type = 'auction_comment'
           AND x.set_kind = r.set_kind AND x.set_key = r.set_key AND x.member_type = r.member_type
           AND x.member_id = r.member_id AND x.basis_type = r.basis_type AND x.basis_id = r.basis_id
         ORDER BY x.id LIMIT 1 FOR UPDATE;
        IF a.id IS NOT NULL AND public.data_set_basis_live(r.basis_type, r.basis_id, r.vehicle_id, r.basis_detail) THEN
          -- the comment is back on the auction of the old stamp: keep the old row
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_live_again' WHERE id = r.id;
          b_skip := b_skip + 1;
        ELSE
          UPDATE public.data_set_members SET state = 'superseded', superseded_at = now(), superseded_run_id = p_run::text
           WHERE id = r.target_member_id AND state = 'active';
          IF FOUND THEN
            UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now() WHERE id = r.id; b_app := b_app + 1;
          ELSE
            UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'not_active' WHERE id = r.id; b_skip := b_skip + 1;
          END IF;
        END IF;
        IF a.id IS NOT NULL THEN n := n + 1; v_ids := v_ids || a.id; END IF;
      END IF;
      IF a.id IS NOT NULL THEN
        IF NOT public.data_set_basis_live(a.basis_type, a.basis_id, a.vehicle_id, a.basis_detail) THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_changed' WHERE id = a.id;
          b_skip := b_skip + 1;
        ELSE
          v_set := NULL;
          INSERT INTO public.data_sets (set_kind, set_key, rule_version, label, provenance, created_run_id)
          VALUES (a.set_kind, a.set_key, 'data_set_keys_v1', a.set_label, a.set_provenance, p_run::text)
          ON CONFLICT (set_kind, set_key, rule_version) DO NOTHING RETURNING id INTO v_set;
          v_created := v_set IS NOT NULL;
          IF v_set IS NULL THEN
            SELECT s.id INTO v_set FROM public.data_sets s
             WHERE s.set_kind = a.set_kind AND s.set_key = a.set_key AND s.rule_version = 'data_set_keys_v1';
          ELSE n_sets := n_sets + 1; END IF;
          v_new := NULL;
          INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id, basis_detail,
            confidence, rule_version, run_id)
          VALUES (v_set, a.member_type, a.member_id, a.vehicle_id, a.basis_type, a.basis_id, a.basis_detail, a.confidence,
            a.member_rule_version, p_run::text)
          ON CONFLICT (set_id, member_type, member_id, basis_type, basis_id) WHERE state = 'active' DO NOTHING
          RETURNING id INTO v_new;
          IF v_new IS NULL THEN
            UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'already_member', set_id = v_set,
                   set_created = v_created WHERE id = a.id;
            b_skip := b_skip + 1;
          ELSE
            UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now(), set_id = v_set, set_created = v_created,
                   member_row_id = v_new WHERE id = a.id;
            b_app := b_app + 1;
          END IF;
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
$function$
;
CREATE OR REPLACE FUNCTION public.data_set_membership_revert_v1(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE n_restore int; n_del int; n_sets int; n_left int; n_readded int; n_kept int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_revert_v1: run required'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.member_row_id
              WHERE p.run_id = p_run::text AND p.state = 'applied' AND p.action = 'add' AND m.superseded_run_id IS NOT NULL
                AND m.superseded_run_id <> p_run::text
                AND EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = m.superseded_run_id AND x.status <> 'reverted')) THEN
    RAISE EXCEPTION 'data_set_membership_revert_v1: a later run superseded members of run %; revert it first', p_run;
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_rev_deleted
    (set_id uuid, member_type text, member_id uuid, basis_type text, basis_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_rev_deleted;
  -- 1. this run's adds go first, so a member this run restamped (supersede + add of one tuple) restores cleanly
  WITH d AS (
    DELETE FROM public.data_set_members m USING public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'add' AND p.state = 'applied' AND m.id = p.member_row_id AND m.run_id = p_run::text
    RETURNING m.set_id, m.member_type, m.member_id, m.basis_type, m.basis_id),
  i AS (INSERT INTO pg_temp.data_set_rev_deleted SELECT * FROM d RETURNING 1)
  SELECT count(*) INTO n_del FROM i;
  -- 2. this run's supersedes come back, unless a later run re-added the same (set, member, basis): that row stands
  WITH s AS (
    UPDATE public.data_set_members m SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
     WHERE m.id IN (SELECT DISTINCT ON (t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id) t.id
                      FROM public.data_set_member_plan p JOIN public.data_set_members t ON t.id = p.target_member_id
                     WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied'
                       AND t.state = 'superseded' AND t.superseded_run_id = p_run::text
                     ORDER BY t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id, t.id DESC)
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> m.id
                        AND a.set_id = m.set_id AND a.member_type = m.member_type AND a.member_id = m.member_id
                        AND a.basis_type = m.basis_type AND a.basis_id = m.basis_id)
    RETURNING m.id)
  SELECT count(*) INTO n_restore FROM s;
  SELECT count(*) INTO n_readded FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.target_member_id
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.state = 'superseded'
     AND m.superseded_run_id = p_run::text;
  UPDATE public.data_set_member_plan p SET state = 'skipped', skip_reason = 'revert_kept_readded_active'
    FROM public.data_set_members m
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.id = p.target_member_id
     AND m.state = 'superseded' AND m.superseded_run_id = p_run::text;
  -- 3. an earlier reverted run left a row superseded because a later run had re-added it. Only rows whose re-add THIS
  --    revert just deleted come back, one per (set, member, basis), and only if nothing else is active for it.
  WITH k AS (
    UPDATE public.data_set_members o SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
     WHERE o.id IN (SELECT DISTINCT ON (t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id) t.id
                      FROM public.data_set_member_plan kp
                      JOIN public.data_set_runs kr ON kr.run_id = kp.run_id AND kr.status = 'reverted'
                      JOIN public.data_set_members t ON t.id = kp.target_member_id
                      JOIN pg_temp.data_set_rev_deleted dd ON dd.set_id = t.set_id AND dd.member_type = t.member_type
                       AND dd.member_id = t.member_id AND dd.basis_type = t.basis_type AND dd.basis_id = t.basis_id
                     WHERE kp.action = 'supersede' AND kp.state = 'skipped' AND kp.skip_reason = 'revert_kept_readded_active'
                       AND t.state = 'superseded' AND t.superseded_run_id = kp.run_id
                     ORDER BY t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id, t.id DESC)
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> o.id
                        AND a.set_id = o.set_id AND a.member_type = o.member_type AND a.member_id = o.member_id
                        AND a.basis_type = o.basis_type AND a.basis_id = o.basis_id)
    RETURNING o.id)
  UPDATE public.data_set_member_plan kp SET state = 'reverted', reverted_at = now(), skip_reason = 'restored_after_readd_reverted'
   WHERE kp.action = 'supersede' AND kp.state = 'skipped' AND kp.skip_reason = 'revert_kept_readded_active'
     AND kp.target_member_id IN (SELECT id FROM k);
  GET DIAGNOSTICS n_kept = ROW_COUNT;
  WITH d AS (
    DELETE FROM public.data_sets s WHERE s.created_run_id = p_run::text
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members m WHERE m.set_id = s.id) RETURNING s.id)
  SELECT count(*) INTO n_sets FROM d;
  UPDATE public.data_set_member_plan SET state = 'reverted', reverted_at = now() WHERE run_id = p_run::text AND state = 'applied';
  SELECT count(*) INTO n_left FROM public.data_set_members m WHERE m.run_id = p_run::text;
  UPDATE public.data_set_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('restored', n_restore, 'members_deleted', n_del, 'sets_deleted', n_sets))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'supersedes_restored', n_restore, 'supersedes_kept_readded', n_readded, 'earlier_supersedes_restored', n_kept, 'members_deleted', n_del, 'sets_deleted', n_sets,
    'members_left', n_left);
END
$function$
;
CREATE OR REPLACE FUNCTION public.text_code_decode_revert_v1(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE n_bk int; n_del int; v_veh uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.vehicle_code_readings r ON r.id = m.basis_id
              WHERE m.basis_type = 'code_reading' AND m.state = 'active' AND r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_revert_v1: active data_set_members cite run %; revert the membership run first', p_run;
  END IF;
  INSERT INTO public.vehicle_code_readings_backup (id, vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text, match_offset, pattern_key, confidence, rule_version, run_id, state, created_at, reverted_at, base_confidence, backed_up_at)
  SELECT r.id, r.vehicle_id, r.kind, r.code, r.model_year, r.origin_table, r.origin_id, r.origin_column, r.match_text, r.match_offset, r.pattern_key, r.confidence, r.rule_version, r.run_id, r.state, r.created_at, r.reverted_at, r.base_confidence, now()
    FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_bk = ROW_COUNT;
  SELECT array_agg(DISTINCT r.vehicle_id) INTO v_veh FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  DELETE FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_del = ROW_COUNT;
  PERFORM public.text_code_rescore_v1(coalesce(v_veh, '{}'));
  UPDATE public.vehicle_code_reading_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('backed_up', n_bk, 'deleted', n_del))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'backed_up', n_bk, 'deleted', n_del);
END
$function$
;

ALTER TABLE public.vehicles ADD COLUMN user_id uuid, ADD COLUMN owner_id uuid, ADD COLUMN uploaded_by uuid;
CREATE FUNCTION public.observation_is_public(p_kind text, p_data jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice') $$;

\i supabase/migrations/20261124020000_spec_readings.sql
\i supabase/migrations/20261124021000_spec_landing_drain.sql
\i supabase/migrations/20261124022000_spec_readings_review.sql
\i supabase/migrations/20261124023000_spec_readings_public_sources.sql
\i supabase/migrations/20261124024000_spec_readings_financial_cleanup.sql
\i supabase/migrations/20261124025000_data_set_public_counts.sql
\i supabase/migrations/20261124026000_spec_platform_scopes.sql

-- 1. matcher cases
CREATE TEMP TABLE spec_cases AS
WITH t(name, txt, src, mk, model, kind, code, expect) AS (VALUES
  ('cid',            'powered by a 455ci V8',                          'listing', 'Pontiac',   'Firebird', 'engine_cid',        '455',           true),
  ('speeds',         'paired with a four-speed manual transmission',   'listing', 'Pontiac',   'Firebird', 'trans_speeds',      '4',             true),
  ('type',           'paired with a four-speed manual transmission',   'listing', 'Pontiac',   'Firebird', 'trans_type',        'MANUAL',        true),
  ('axle',           'a 3.42 Safe-T-Track rear end',                   'listing', 'Pontiac',   'Firebird', 'axle_ratio',        '3.42',          true),
  ('axle to one',    'running 3.73:1 gears',                           'listing', 'Chevrolet', 'Camaro',   'axle_ratio',        '3.73',          true),
  ('build month',    'It was built in July 1973 at Norwood',           'listing', 'Pontiac',   'Firebird', 'build_date',        '1973-07',       true),
  ('build of part',  'The engine was built in July 1973',              'listing', 'Pontiac',   'Firebird', 'build_date',        '1973-07',       false),
  ('msrp',           'the original sticker price was $4,204',          'listing', 'Pontiac',   'Firebird', 'original_msrp',     '4204',          true),
  ('phs',            'accompanied by PHS documentation',               'listing', 'Pontiac',   'Firebird', 'documentation',     'PHS',           true),
  ('no build sheet', 'No build sheet was found.',                      'listing', 'Pontiac',   'Firebird', 'documentation',     'BUILD_SHEET',   false),
  ('marti',          'A Deluxe Marti Report is included',              'listing', 'Ford',      'Mustang',  'documentation',     'MARTI',         true),
  ('ford letter',    'an R-code 428 Cobra Jet car',                    'listing', 'Ford',      'Mustang',  'engine_code',       'R',             true),
  ('ford paint',     'Paint code T.',                                  'listing', 'Ford',      'Mustang',  'paint_code',        'T',             true),
  ('dso',            'DSO 84',                                         'listing', 'Ford',      'Mustang',  'dealer_zone',       '84',            true),
  ('trim code',      'trim code 232',                                  'listing', 'Pontiac',   'Firebird', 'interior_trim_code','232',           true),
  ('rpo label',      'RPO code U58',                                   'listing', 'Pontiac',   'Firebird', 'rpo_code',          'U58',           true),
  ('tire not rpo',   'F70-14 tires',                                   'listing', 'Pontiac',   'Firebird', 'rpo_code',          'F70',           false),
  ('m22',            'Muncie M22 rock crusher',                        'listing', 'Chevrolet', 'Camaro',   'trans_model',       'M22',           true),
  ('bmw m20',        'the M20 six',                                    'listing', 'BMW',       '325i',     'trans_model',       'M20',           false),
  ('trim title',     '1973 Pontiac Firebird Trans Am 455',             'title',   'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      true),
  ('clone',          'This Trans Am clone started life as a base car', 'lead',    'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      false),
  ('not a real',     'Not a real Trans Am.',                           'lead',    'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      false),
  ('style stripes',  'Z/28-style stripes',                             'title',   'Chevrolet', 'Camaro',   'trim_level',        'Z28',           false),
  ('gt 390',         '1967 Ford Mustang GT 390',                       'title',   'Ford',      'Mustang',  'trim_level',        'GT',            true),
  ('gt350 not gt',   '1966 Ford Mustang GT-350',                       'title',   'Ford',      'Mustang',  'trim_level',        'GT',            false),
  ('kr is kr',       '1968 Shelby GT-500-KR',                          'title',   'Shelby',    'GT500',    'trim_level',        'SHELBY_GT500KR',true),
  ('kr not gt500',   '1968 Shelby GT-500-KR',                          'title',   'Shelby',    'GT500',    'trim_level',        'SHELBY_GT500',  false),
  ('gt500',          '1967 Shelby GT500 fastback',                     'title',   'Shelby',    'GT500',    'trim_level',        'SHELBY_GT500',  true),
  ('body',           '1969 Ford Mustang Fastback',                     'title',   'Ford',      'Mustang',  'body_style',        'FASTBACK',      true),
  ('dealer',         'It was sold new at Example Pontiac in Ohio',     'listing', 'Pontiac',   'Firebird', 'selling_dealer',    'STATED',        true))
SELECT t.name, t.expect = EXISTS (SELECT 1 FROM public.text_spec_matches_v2(t.txt, t.src, t.mk, t.model) m
                                   WHERE m.kind = t.kind AND m.code = t.code) AS ok
  FROM t;
SELECT pg_temp.ok('matcher: ' || name, ok) FROM spec_cases ORDER BY name;

-- 2. producer, drain and fold on synthetic cars
INSERT INTO public.vintage_rpo_codes (rpo_code, description, first_year, last_year, makes) VALUES
  ('L78', '396ci V8 375hp', 1965, 1970, '{Chevrolet}'), ('M22', 'Muncie M22', 1965, 1974, '{Chevrolet,Pontiac}');
INSERT INTO public.vehicles (id, make, model, year, listing_title, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Ford', 'Mustang', 1969, '1969 Ford Mustang Mach 1 428 Cobra Jet 4-Speed',
   'This 1969 Ford Mustang Mach 1 fastback is an R-code car. It is accompanied by a Deluxe Marti Report and DSO 84. Paint code T. 3.91:1 Traction-Lok. It was built in March 1969 and the original sticker price was $4,204.'),
  ('00000000-0000-0000-0000-000000000002', 'Chevrolet', 'Camaro', 1969, '1969 Chevrolet Camaro RS/SS 396 4-Speed',
   'This 1969 Chevrolet Camaro SS coupe has an L78 and an M22 with a 4.10 posi. No Protect-O-Plate is included. Trim code 711.'),
  ('00000000-0000-0000-0000-000000000003', 'Chevrolet', 'Camaro', 1968, '1968 Chevrolet Camaro Z/28 Tribute',
   'This 1968 Camaro Z/28 tribute coupe uses a 350 V8 and TH400.');
INSERT INTO public.auction_comments (vehicle_id, comment_type, comment_text) VALUES
  ('00000000-0000-0000-0000-000000000002', 'comment', 'The 12-bolt 3.73 gears are not original; the L78 code on the block matches.'),
  ('00000000-0000-0000-0000-000000000002', 'bid', '3.73');
INSERT INTO public.vehicle_observations (vehicle_id, kind, content_text, extraction_method) VALUES
  ('00000000-0000-0000-0000-000000000002', 'provenance', 'Private note: the car has a Marti Report and a 3.55 rear.', 'llm_extraction'),
  ('00000000-0000-0000-0000-000000000002', 'listing', 'Speaker-only correction: it has PHS documents.', 'garage_owner_correction_v1');
INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, status, source_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'transmission', 'Four-Speed Manual Transmission', 'pending', NULL),
  ('00000000-0000-0000-0000-000000000002', 'transmission', 'Five-Speed Manual Transmission', 'pending', 'invoice');

SELECT public.field_coverage_snapshot_v1('contract', 'before', 'chevrolet_camaro_67_69');
INSERT INTO public.spec_landing_jobs (job_id, step_kind, run_id, scope, step, batch, depends_on) VALUES
  ('d', 'decode', '11111111-1111-1111-1111-111111111112', 'chevrolet_camaro_67_69', 1, 1, NULL),
  ('p', 'plan',   '22222222-2222-2222-2222-222222222222', 'chevrolet_camaro_67_69', 1, 1, 'd'),
  ('a', 'apply',  '22222222-2222-2222-2222-222222222222', 'chevrolet_camaro_67_69', 2, 500, 'p');
SELECT public.spec_landing_drain_v1(20000);
SELECT pg_temp.ok('drain finished decode, plan and apply', (SELECT bool_and(status = 'done') FROM public.spec_landing_jobs));
SELECT pg_temp.ok('readings landed with run, source row, column and confidence',
  (SELECT count(*) > 0 AND bool_and(run_id = '11111111-1111-1111-1111-111111111112' AND origin_id IS NOT NULL
          AND origin_column IS NOT NULL AND confidence > 0)
     FROM public.vehicle_code_readings WHERE rule_version = 'text_code_decode_v2'));
SELECT pg_temp.ok('L78 and M22 keyed as RPO codes', (SELECT count(DISTINCT code) = 2 FROM public.vehicle_code_readings
  WHERE kind = 'rpo_code' AND code IN ('L78', 'M22') AND vehicle_id = '00000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('tribute car gets no Z28 trim', NOT EXISTS (SELECT 1 FROM public.vehicle_code_readings
  WHERE vehicle_id = '00000000-0000-0000-0000-000000000003' AND kind = 'trim_level'));
SELECT pg_temp.ok('comment readings keep no text', NOT EXISTS (SELECT 1 FROM public.vehicle_code_readings
  WHERE origin_table = 'auction_comments' AND match_text IS NOT NULL));
SELECT pg_temp.ok('private observations and financial evidence are not read', NOT EXISTS (SELECT 1 FROM public.vehicle_code_readings
  WHERE origin_table IN ('vehicle_observations', 'field_evidence') AND vehicle_id = '00000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('readings folded into sets', (SELECT count(*) > 0 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
  WHERE m.state = 'active' AND s.set_kind = 'rpo_code' AND s.set_key = 'chevrolet:1969:l78'));
SELECT public.field_coverage_snapshot_v1('contract', 'after', 'chevrolet_camaro_67_69');
SELECT pg_temp.ok('before and after snapshots coexist', (SELECT count(DISTINCT phase) = 2 FROM public.field_coverage_snapshots
  WHERE snapshot_id = 'contract'));
SELECT pg_temp.ok('after snapshot shows the RPO codes keyed', (SELECT keyed = 1 FROM public.field_coverage_snapshots
  WHERE snapshot_id = 'contract' AND phase = 'after' AND field = 'rpo_option_codes'));
SELECT public.data_set_public_counts_refresh_v1();
SELECT pg_temp.ok('public counts cached and read', (SELECT pc.public_vehicles = 1 FROM public.data_set_public_counts pc
  JOIN public.data_sets s ON s.id = pc.set_id WHERE s.set_kind = 'rpo_code' AND s.set_key = 'chevrolet:1969:l78')
  AND (SELECT bool_and((e->>'public_vehicles_in_set')::int >= 1 AND e->>'public_vehicles_counted_at' IS NOT NULL)
         FROM jsonb_array_elements(public.vehicle_data_sets('00000000-0000-0000-0000-000000000002')->'sets') e));
SELECT pg_temp.ok('count refresh scheduled', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-public-counts'));
SELECT pg_temp.ok('drain jobs scheduled', (SELECT count(*) = 3 FROM cron.job WHERE jobname LIKE 'spec-landing-drain-%'));

-- 3. revert by run
SELECT public.data_set_membership_revert_v1('22222222-2222-2222-2222-222222222222');
SELECT public.text_code_decode_revert_v1('11111111-1111-1111-1111-111111111112');
SELECT pg_temp.ok('reverts leave no active readings or members',
  NOT EXISTS (SELECT 1 FROM public.vehicle_code_readings WHERE run_id = '11111111-1111-1111-1111-111111111112')
  AND NOT EXISTS (SELECT 1 FROM public.data_set_members WHERE state = 'active' AND run_id = '22222222-2222-2222-2222-222222222222'));
SELECT pg_temp.ok('reverted readings are backed up', (SELECT count(*) > 0 FROM public.vehicle_code_readings_backup
  WHERE run_id = '11111111-1111-1111-1111-111111111112'));

-- 4. platform buckets leave the landed cohorts out; the pause switch stops the drain
INSERT INTO public.vehicles (id, make, model, year, listing_title) VALUES
  ('00000000-0000-0000-0000-000000000004', 'Porsche', '911', 1973, '1973 Porsche 911 Targa 5-Speed'),
  ('01000000-0000-0000-0000-000000000005', 'Porsche', '911', 1974, '1974 Porsche 911 Coupe');
SELECT pg_temp.ok('platform_hex_00 holds only non-cohort cars of that bucket',
  public.data_set_scope_vehicles('platform_hex_00', NULL) = ARRAY['00000000-0000-0000-0000-000000000004'::uuid]);
SELECT pg_temp.ok('platform_hex_01 is the next bucket',
  public.data_set_scope_vehicles('platform_hex_01', NULL) = ARRAY['01000000-0000-0000-0000-000000000005'::uuid]);
SELECT pg_temp.ok('platform_hex_ff has no upper bound', public.data_set_scope_vehicles('platform_hex_ff', NULL) IS NULL);
UPDATE public.spec_landing_control SET paused = true WHERE id = 1;
INSERT INTO public.spec_landing_jobs (job_id, step_kind, run_id, scope, step, batch) VALUES
  ('p00', 'decode', '11111111-1111-1111-1111-111111111113', 'platform_hex_00', 10, 10);
SELECT public.spec_landing_drain_v1(5000);
SELECT pg_temp.ok('paused drain takes no job', (SELECT ticks = 0 FROM public.spec_landing_jobs WHERE job_id = 'p00'));
UPDATE public.spec_landing_control SET paused = false WHERE id = 1;
SELECT public.spec_landing_drain_v1(5000);
SELECT pg_temp.ok('platform bucket decoded', (SELECT status = 'done' FROM public.spec_landing_jobs WHERE job_id = 'p00')
  AND EXISTS (SELECT 1 FROM public.vehicle_code_readings WHERE run_id = '11111111-1111-1111-1111-111111111113' AND kind = 'body_style' AND code = 'TARGA'));
UPDATE public.spec_landing_control SET max_layer_bytes = 1 WHERE id = 1;
INSERT INTO public.spec_landing_jobs (job_id, step_kind, run_id, scope, step, batch) VALUES
  ('p01', 'decode', '11111111-1111-1111-1111-111111111114', 'platform_hex_01', 10, 10);
SELECT public.spec_landing_drain_v1(5000);
SELECT pg_temp.ok('size cap holds platform jobs', (SELECT ticks = 0 FROM public.spec_landing_jobs WHERE job_id = 'p01'));
