-- Contract: trim_not_a_code_v1 (20261122005000). Empty disposable PG17 dm_refinement_* database only; no production rows.
-- Builds the 2026-10-23 rule from its migration, replaces the rule with its live 2026-11-21 body (the ai_visual exclusion
-- that was applied directly), checks the fingerprints the migration guards on, applies the migration twice, then checks:
-- the test's verdicts, a refused trim (no fill, no agree, no provenance, evidence rejected, log 'refused'), a real trim
-- still filled, ai_visual still skipped, a non-trim field untouched by the test, and revert of a refusal.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- The columns the rule reads and writes (cited_evidence_column) and the tables it touches.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, trim text, color text, interior_color text, displacement text, license_plate text,
  engine_type text, transmission text, body_style text, drivetrain text, fuel_type text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, is_superseded boolean);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  field_name text NOT NULL, proposed_value text, source_type text, source_confidence integer,
  extraction_context text, extracted_at timestamptz DEFAULT now(), supporting_signals jsonb, contradicting_signals jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','conflicted','superseded')),
  assigned_at timestamptz, assigned_by text, raw_extraction_data jsonb, created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, field_name, source_type, proposed_value));
CREATE TABLE public.vehicle_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, field_name text NOT NULL,
  current_value text, total_confidence integer, confidence_factors jsonb, primary_source text,
  supporting_sources text[], conflicting_sources jsonb, last_verified_at timestamptz, last_verified_by text,
  updated_at timestamptz, UNIQUE (vehicle_id, field_name));
-- pg_cron stand-in for the 2026-10-23 migration's schedule and check.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job VALUES (n, s, c, true) ON CONFLICT (jobname) DO UPDATE SET schedule = s, command = c RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;

\ir ../migrations/20261023130000_cited_evidence_auto_accept.sql

-- The rule as deployed on 2026-11-21 (pg_get_functiondef, verbatim): the committed body plus the ai_visual exclusion.
CREATE OR REPLACE FUNCTION public.accept_cited_field_evidence(p_run_id uuid, p_limit integer DEFAULT 200, p_vehicle_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record; col text; cur text; img uuid; doc text; prov jsonb; act text;
  n_filled int := 0; n_agreed int := 0; n_conflict int := 0; n_prov int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  if p_run_id is null then raise exception 'accept_cited_field_evidence: run_id required'; end if;
  for r in
    select fe.* from field_evidence fe
    where fe.status = 'pending'
      and fe.source_type IS DISTINCT FROM 'ai_visual'
      and (p_vehicle_id is null or fe.vehicle_id = p_vehicle_id)
      and coalesce(btrim(fe.proposed_value), '') <> ''
      and (fe.raw_extraction_data ? 'photo_id' or fe.raw_extraction_data ? 'image_id' or fe.raw_extraction_data ? 'document_id')
    order by fe.created_at, fe.id
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of fe skip locked
  loop
    img := null; doc := null;
    if coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select i.id into img from vehicle_images i
       where i.id = coalesce(r.raw_extraction_data->>'photo_id', r.raw_extraction_data->>'image_id')::uuid
         and i.vehicle_id = r.vehicle_id and i.is_superseded is not true;
    end if;
    doc := nullif(btrim(r.raw_extraction_data->>'document_id'), '');
    continue when img is null and doc is null;   -- citation not resolvable: leave pending

    col := cited_evidence_column(r.field_name);
    select to_jsonb(p) into prov from vehicle_field_provenance p
     where p.vehicle_id = r.vehicle_id and p.field_name = coalesce(col, r.field_name);
    if col is not null then
      execute format('select %I::text from vehicles where id = $1', col) into cur using r.vehicle_id;
    else
      cur := null;
    end if;

    act := case when col is null then 'provenance_only'
                when coalesce(btrim(cur), '') = '' then 'filled'
                when cited_evidence_values_agree(r.field_name, cur, r.proposed_value) then 'agreed'
                else 'conflict' end;

    insert into cited_evidence_accept_log(run_id, evidence_id, vehicle_id, field_name, column_name, action,
      proposed_value, prev_column_value, prev_evidence_status, prev_raw_extraction_data, prev_provenance)
    values (p_run_id, r.id, r.vehicle_id, r.field_name, col, act, r.proposed_value, cur, r.status,
      r.raw_extraction_data, prov);

    if act = 'conflict' then
      update field_evidence set status = 'conflicted',
        contradicting_signals = coalesce(contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'existing_value', cur, 'column', col, 'at', now()))
       where id = r.id;
      insert into vehicle_field_provenance(vehicle_id, field_name, current_value, conflicting_sources, updated_at)
      values (r.vehicle_id, col, cur, jsonb_build_array(jsonb_build_object('evidence_id', r.id, 'value', r.proposed_value,
        'image_id', img, 'document_id', doc, 'run_id', p_run_id)), now())
      on conflict (vehicle_id, field_name) do update set
        conflicting_sources = coalesce(vehicle_field_provenance.conflicting_sources, '[]'::jsonb) || excluded.conflicting_sources,
        updated_at = now();
      n_conflict := n_conflict + 1;
      continue;
    end if;

    if act = 'filled' then
      execute format('update vehicles set %I = $1 where id = $2', col) using r.proposed_value, r.vehicle_id;
    end if;

    update field_evidence set status = 'accepted', assigned_at = now(), assigned_by = 'cited_evidence_auto_accept_v1',
      -- an aliased field (registration_plate) is filed under its column so the field's provenance lists it
      field_name = case when col is not null and col <> r.field_name and not exists (select 1 from field_evidence x
        where x.vehicle_id = r.vehicle_id and x.field_name = col and x.source_type = r.source_type
          and x.proposed_value = r.proposed_value) then col else field_name end,
      raw_extraction_data = case when img is not null and not (coalesce(raw_extraction_data, '{}'::jsonb) ? 'photo_id')
        then coalesce(raw_extraction_data, '{}'::jsonb) || jsonb_build_object('photo_id', img) else raw_extraction_data end,
      supporting_signals = coalesce(supporting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'action', act, 'image_id', img, 'document_id', doc, 'at', now()))
     where id = r.id;

    insert into vehicle_field_provenance(vehicle_id, field_name, current_value, total_confidence, confidence_factors,
      primary_source, supporting_sources, last_verified_at, last_verified_by, updated_at)
    values (r.vehicle_id, coalesce(col, r.field_name), case when act = 'agreed' then cur else r.proposed_value end,
      least(greatest(coalesce(r.source_confidence, 70), 0), 100),
      jsonb_build_object('rule', 'cited_evidence_auto_accept_v1', 'run_id', p_run_id, 'evidence_id', r.id,
        'image_id', img, 'document_id', doc, 'source_type', r.source_type),
      'field_evidence:' || r.source_type, array[coalesce('image:' || img::text, 'document:' || doc)], now(),
      'cited_evidence_auto_accept_v1', now())
    on conflict (vehicle_id, field_name) do update set
      current_value = excluded.current_value,
      total_confidence = greatest(coalesce(vehicle_field_provenance.total_confidence, 0), excluded.total_confidence),
      confidence_factors = coalesce(vehicle_field_provenance.confidence_factors, '{}'::jsonb) || excluded.confidence_factors,
      primary_source = coalesce(vehicle_field_provenance.primary_source, excluded.primary_source),
      supporting_sources = (select array_agg(distinct s) from unnest(coalesce(vehicle_field_provenance.supporting_sources, '{}') || excluded.supporting_sources) s),
      last_verified_at = now(), last_verified_by = excluded.last_verified_by, updated_at = now();

    if act = 'filled' then n_filled := n_filled + 1;
    elsif act = 'agreed' then n_agreed := n_agreed + 1;
    else n_prov := n_prov + 1; end if;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'filled', n_filled, 'agreed', n_agreed,
    'provenance_only', n_prov, 'accepted', n_filled + n_agreed + n_prov, 'conflicts', n_conflict);
end $function$;

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE, label; END $$;

-- The fingerprints the migration's guard accepts are the bodies read in production on 2026-11-21.
SELECT pg_temp.check(md5(pg_get_functiondef('public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure))
  = '45df8148a07e96b345f12ed3e93c5df4', 'live accept body fingerprint'); -- gitleaks:allow (function-definition fingerprint, not a secret)
SELECT pg_temp.check(md5(pg_get_functiondef('public.revert_cited_evidence_run(uuid)'::regprocedure))
  = '16a74ef41ad32aeb2529257c654d0428', 'live revert body fingerprint'); -- gitleaks:allow (function-definition fingerprint, not a secret)

\ir ../migrations/20261122005000_cited_evidence_trim_not_a_code.sql
-- A second run is a no-op past the guard (the bodies now carry the marker).
\ir ../migrations/20261122005000_cited_evidence_trim_not_a_code.sql

-- Under PostgREST safeupdate every UPDATE needs a WHERE.
DO $$ BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM regexp_split_to_table((SELECT prosrc FROM pg_proc WHERE oid = 'public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure)
      || (SELECT prosrc FROM pg_proc WHERE oid = 'public.revert_cited_evidence_run(uuid)'::regprocedure), ';') s
    -- ON CONFLICT ... DO UPDATE belongs to an INSERT, which safeupdate does not police
    WHERE regexp_replace(s, 'do update', '', 'gi') ~* '\mUPDATE\M' AND s !~* '\mWHERE\M'),
    'an UPDATE without WHERE fails under safeupdate';
END $$;

-- 1. The test's verdicts: every code read off a plate in the 2026-11-21 log, and real trims it must keep.
SELECT pg_temp.check(public.trim_value_is_code(v, m), format('code: %s / %s', v, m)) FROM (VALUES
  ('10A', 'Ford'), ('67', 'Ford'), ('U 67', 'Ford'), ('289', 'Ford'), ('10', 'Chevrolet'), ('400', 'Chevrolet'),
  ('8400', 'Chevrolet'), ('2500', 'GMC'), (' 10A ', 'FORD'), ('6 SPEED', 'Chevrolet'), ('4-Speed', 'Porsche'),
  ('5spd', 'BMW'), ('63A', 'Ford'), ('20A', 'Chevrolet'), ('427', 'Chevrolet'), ('62', 'Ford'),
  ('88', 'Chevrolet'), ('442', 'Ford'), ('500', 'Chevrolet'), ('440', 'Plymouth'), ('3X', 'Ford')) t(v, m);
SELECT pg_temp.check(NOT public.trim_value_is_code(v, m), format('trim: %s / %s', v, m)) FROM (VALUES
  ('Custom', 'Chevrolet'), ('Cheyenne Super', 'Chevrolet'), ('SS 396', 'Chevrolet'), ('Z/28', 'Chevrolet'),
  ('Z28', 'Chevrolet'), ('Z 28', 'Chevrolet'), ('Z06', 'Chevrolet'), ('442', 'Oldsmobile'), ('500', 'Ford'),
  ('Mach 1', 'Ford'), ('GT', 'Ford'), ('Sierra Classic', 'GMC'), ('TRANS AM', 'Pontiac'), ('SD-455', 'Pontiac'),
  ('A51', 'Pontiac'), ('4S', 'Porsche'), ('911S', 'Porsche'), ('300E', 'Mercedes-Benz'), ('470', 'Lexus'),
  ('335i', 'BMW'), ('88', 'Oldsmobile'), ('62', 'Cadillac'), ('210', 'Chevrolet'), ('225', 'Buick'), ('3X', 'GMC'),
  ('300C', 'Chrysler'), ('440', 'Dodge'), ('550', 'AMC'), ('800', 'International'), ('170', 'Dodge'),
  ('300', 'Chevrolet'), ('300', 'Chrysler'), ('98', 'OLDSMOBILE'), ('10A', NULL), ('', 'Ford'), (NULL, 'Ford')) t(v, m);

-- 2. The rule.
INSERT INTO public.vehicles (id, make, trim) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Ford', NULL),        -- empty trim, plate code read: refused
  ('00000000-0000-0000-0000-000000000002', 'Ford', '67'),        -- junk already in the column, agreeing code: refused
  ('00000000-0000-0000-0000-000000000003', 'Chevrolet', NULL),   -- real trim: filled
  ('00000000-0000-0000-0000-000000000004', 'Ford', NULL),        -- ai_visual code: skipped as before
  ('00000000-0000-0000-0000-000000000005', 'Chevrolet', NULL);   -- color "10" is not a trim question: filled
INSERT INTO public.vehicle_images (id, vehicle_id) SELECT ('10000000-0000-0000-0000-00000000000' || n)::uuid,
  ('00000000-0000-0000-0000-00000000000' || n)::uuid FROM generate_series(1, 5) n;
INSERT INTO public.field_evidence (id, vehicle_id, field_name, proposed_value, source_type, raw_extraction_data, created_at) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'trim', '10A', 'image_document_read',
   '{"image_id":"10000000-0000-0000-0000-000000000001"}', now() - interval '5 min'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'trim', '67', 'image_document_read',
   '{"image_id":"10000000-0000-0000-0000-000000000002"}', now() - interval '4 min'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'trim', 'Custom', 'image_document_read',
   '{"photo_id":"10000000-0000-0000-0000-000000000003"}', now() - interval '3 min'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'trim', '10A', 'ai_visual',
   '{"image_id":"10000000-0000-0000-0000-000000000004"}', now() - interval '2 min'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'color', '10', 'image_document_read',
   '{"image_id":"10000000-0000-0000-0000-000000000005"}', now() - interval '1 min');

DO $$
DECLARE r jsonb;
BEGIN
  r := public.accept_cited_field_evidence('30000000-0000-0000-0000-000000000001', 200, NULL);
  PERFORM pg_temp.check(r->>'refused' = '2' AND r->>'filled' = '2' AND r->>'agreed' = '0' AND r->>'conflicts' = '0',
    'counts: ' || r::text);
END $$;
SELECT pg_temp.check((SELECT trim IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000001'), 'code not filled');
SELECT pg_temp.check((SELECT trim = '67' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002'), 'column untouched');
SELECT pg_temp.check((SELECT trim = 'Custom' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000003'), 'real trim filled');
SELECT pg_temp.check((SELECT color = '10' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000005'), 'other field filled');
SELECT pg_temp.check((SELECT trim IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000004'), 'ai_visual skipped');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE id = '20000000-0000-0000-0000-000000000004') = 'pending', 'ai_visual stays pending');
SELECT pg_temp.check((SELECT count(*) FROM public.field_evidence WHERE id IN ('20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002') AND status = 'rejected'
  AND contradicting_signals @> '[{"rule":"trim_not_a_code_v1"}]') = 2, 'refused evidence rejected with the rule named');
SELECT pg_temp.check((SELECT count(*) FROM public.cited_evidence_accept_log WHERE action = 'refused'
  AND prev_evidence_status = 'pending') = 2, 'refusals logged with the prior status');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.vehicle_field_provenance WHERE vehicle_id IN
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')), 'no provenance for a refusal');
-- A rejected row leaves the pending window: a second run decides nothing.
DO $$ DECLARE r jsonb; BEGIN
  r := public.accept_cited_field_evidence('30000000-0000-0000-0000-000000000002', 200, NULL);
  PERFORM pg_temp.check(r->>'refused' = '0' AND r->>'accepted' = '0', 'second run: ' || r::text);
END $$;

-- 3. Revert restores a refusal's status only, and the fills as before.
DO $$ DECLARE r jsonb; BEGIN
  r := public.revert_cited_evidence_run('30000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.check(r->>'reverted' = '4', 'reverted: ' || r::text);
END $$;
SELECT pg_temp.check((SELECT count(*) FROM public.field_evidence WHERE status = 'pending') = 5, 'all evidence pending again');
SELECT pg_temp.check((SELECT trim IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000003'), 'fill reverted');
SELECT pg_temp.check((SELECT trim = '67' FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002'), 'refusal revert leaves the column');

\echo 'test_cited_evidence_trim_not_a_code: ok'
