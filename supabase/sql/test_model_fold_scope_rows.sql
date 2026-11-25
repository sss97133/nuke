-- Disposable PG17 contract for 20261125130000_model_fold_scope_rows. Synthetic rows only; model_fold_config,
-- model_fold_scope_of (the CASE), model_fold_scope_make, model_fold_in_scope, model_fold_one and model_fold_sweep are
-- the live definitions of 2026-11-25. Asserts: the rows reproduce the CASE; deploy forces nothing; the sweep walks rows
-- with sweep; a scope row change re-folds that scope's members folded before it; a no-op edit forces nothing; a new
-- scope re-folds its cars even when they already carry the current key.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb);
INSERT INTO public.platform_config VALUES ('model_fold',
  '{"scopes": ["pontiac_f_body"], "decode_scopes": ["pontiac_f_body"], "min_pass_hours": 0, "sweep_scan": 2000}');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, vin text, year int);
CREATE TABLE IF NOT EXISTS public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text,
  model text,
  code text,
  year_min integer,
  year_max integer,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  citation_url text NOT NULL CHECK (citation_url ~ '^https?://'),
  citation_title text,
  citation_locator text,
  cited_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.vehicle_decode_rules (id),
  superseded_at timestamptz,
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max),
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_decode_rules_lookup
  ON public.vehicle_decode_rules (rule_key, upper(code)) WHERE superseded_at IS NULL;
-- One current row per rule, scope and citation: a second reading of the same table supersedes, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), citation_url) WHERE superseded_at IS NULL;
ALTER TABLE public.vehicle_decode_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.model_fold_cursor (scope text NOT NULL, cursor uuid, pass_key text, verified_key text, cycle integer NOT NULL DEFAULT 0, snapshot_at timestamp with time zone, snapshot_n integer, snap_gen integer NOT NULL DEFAULT 0, snap_step integer, pass_started_at timestamp with time zone, wrapped_at timestamp with time zone, enqueued_total bigint NOT NULL DEFAULT 0, updated_at timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (scope));
CREATE TABLE public.model_fold_scope_members (scope text NOT NULL, vehicle_id uuid NOT NULL REFERENCES public.vehicles (id), gen integer NOT NULL DEFAULT 0, PRIMARY KEY (scope, vehicle_id));
CREATE TABLE public.model_fold_work (vehicle_id uuid NOT NULL REFERENCES public.vehicles (id), state text NOT NULL DEFAULT 'pending'::text, priority smallint NOT NULL DEFAULT 5, reasons text[] NOT NULL DEFAULT '{}'::text[], first_dirty_at timestamp with time zone NOT NULL DEFAULT now(), dirty_at timestamp with time zone NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamp with time zone NOT NULL DEFAULT now(), leased_until timestamp with time zone, lease_tick uuid, last_error text, folded_at timestamp with time zone, folded_key text, edited_origins uuid[] NOT NULL DEFAULT '{}'::uuid[], updated_at timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (vehicle_id));

CREATE OR REPLACE FUNCTION public.model_fold_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select config_value from public.platform_config where config_key = 'model_fold' limit 1), '{}'::jsonb)
$function$;
CREATE OR REPLACE FUNCTION public.model_fold_scope_of(p_make text, p_model text, p_vin text, p_year integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when lower(p_make) = 'pontiac' and (coalesce(p_model, '') ~* 'firebird|trans ?am'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
         or upper(btrim(coalesce(p_vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$') then 'pontiac_f_body'
    when lower(p_make) = 'ford' and p_year between 1965 and 1973 and coalesce(p_model, '') ~* 'mustang' then 'ford_mustang_65_73'
    when lower(p_make) = 'chevrolet' and p_year between 1967 and 1969 and coalesce(p_model, '') ~* 'camaro' then 'chevrolet_camaro_67_69'
  end
$function$;
CREATE OR REPLACE FUNCTION public.model_fold_scope_make(p_scope text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_scope when 'pontiac_f_body' then 'pontiac' when 'ford_mustang_65_73' then 'ford'
                      when 'chevrolet_camaro_67_69' then 'chevrolet' end
$function$;
CREATE OR REPLACE FUNCTION public.model_fold_in_scope(p_make text, p_model text, p_vin text, p_year integer, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p_id is not null and p_id::text not like '9cf5b7a4%'
     and public.model_fold_scope_of(p_make, p_model, p_vin, p_year) in
         (select jsonb_array_elements_text(public.model_fold_config() -> 'scopes'))
$function$;
CREATE OR REPLACE FUNCTION public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  t0 timestamptz := clock_timestamp(); v_inv uuid[]; v_dec uuid; v_mem uuid := gen_random_uuid();
  r jsonb; p jsonb; a jsonb; v public.vehicles; v_exists boolean; n_add int := 0; v_decoder text;
begin
  if p_vehicle::text like '9cf5b7a4%' then return jsonb_build_object('skipped', 'excluded'); end if;
  select * into v from public.vehicles where id = p_vehicle;
  v_exists := found;
  v_inv := public.model_fold_invalidate_readings(p_vehicle, p_edited);
  if v_exists and public.model_fold_scope_of(v.make, v.model, v.vin, v.year) in
       (select jsonb_array_elements_text(p_cfg -> 'decode_scopes')) then
    v_dec := gen_random_uuid();
    v_decoder := coalesce(p_cfg ->> 'decoder', 'text_code_decode_v2');
    if v_decoder !~ '^text_code_decode_v[0-9]+$'
       or to_regprocedure(format('public.%s(uuid,text,uuid,integer,integer,integer)', v_decoder)) is null then
      raise exception 'model_fold: decoder % is not an existing text_code_decode_vN(uuid,text,uuid,int,int,int)', v_decoder;
    end if;
    execute format('select public.%I($1, $2, $3, $4, $5, $6)', v_decoder)
      into r using v_dec, 'vehicle'::text, p_vehicle, 50, 1, null::int;
    n_add := coalesce((r ->> 'inserted_this_slice')::int, 0);
  elsif cardinality(v_inv) > 0 then
    perform public.text_code_rescore_v1(array[p_vehicle]);
  end if;
  if not v_exists then
    -- Vehicle row gone: nothing to plan from; any members it had stay for the membership producer's own scopes.
    insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids, ms)
    values (p_tick, p_vehicle, null, null, v_inv, (extract(epoch from clock_timestamp() - t0) * 1000)::int);
    return jsonb_build_object('vehicle_missing', true, 'invalidated', cardinality(v_inv));
  end if;
  p := public.data_set_membership_plan_v1(v_mem, 'vehicle', p_vehicle);
  a := public.data_set_membership_apply_v1(v_mem, 500, 200, false);
  perform public.data_set_grade_vehicle(p_vehicle);
  -- facet_grades_fold_v1: the viewer-independent facet grades of a car in scope (a failure lands in its folds row)
  if public.vehicle_facet_grades_in_scope(p_vehicle) then
    perform public.vehicle_facet_grades_fold(p_vehicle);
  end if;
  -- facet_grades_fold_v1_end
  insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids,
                                           readings_added, members_applied, members_superseded, ms)
  values (p_tick, p_vehicle, v_dec, v_mem, v_inv, n_add, coalesce((a ->> 'applied')::int, 0),
          coalesce((p ->> 'planned_supersede')::int, 0), (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  return jsonb_build_object('decode_run', v_dec, 'membership_run', v_mem, 'invalidated', cardinality(v_inv),
                            'readings_added', n_add, 'applied', coalesce((a ->> 'applied')::int, 0),
                            'superseded', coalesce((p ->> 'planned_supersede')::int, 0));
end $function$;
CREATE OR REPLACE FUNCTION public.model_fold_sweep(p_key text, p_cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  s text; c public.model_fold_cursor; v_ids uuid[]; v_last uuid; n_q int; total int := 0; out jsonb := '{}';
  v_step int; v_gen int; v_lo int; v_hi int;
  v_scan int := coalesce((p_cfg ->> 'sweep_scan')::int, 2000);
  v_settle int := coalesce((p_cfg ->> 'settle_seconds')::int, 300);
begin
  for s in select jsonb_array_elements_text(p_cfg -> 'scopes') loop
    insert into public.model_fold_cursor (scope) values (s) on conflict do nothing;
    select * into c from public.model_fold_cursor where scope = s for update;
    -- Snapshot refresh is chunked by model-year bucket (the (lower(make), year) index) so one step stays well under the
    -- cron statement timeout; the new generation replaces the old one only after its last bucket.
    if c.snap_step is not null or (c.cursor is null and (c.snapshot_at is null
        or c.snapshot_at < now() - make_interval(hours => coalesce((p_cfg ->> 'snapshot_max_age_hours')::int, 6)))) then
      v_step := coalesce(c.snap_step, 0);
      v_gen := case when c.snap_step is null then c.snap_gen + 1 else c.snap_gen end;
      v_lo := (array[-32768, 1960, 1968, 1971, 1974, 1977, 1980, 1984, 1993, null])[v_step + 1];
      v_hi := (array[1959, 1967, 1970, 1973, 1976, 1979, 1983, 1992, 32767, null])[v_step + 1];
      insert into public.model_fold_scope_members as m (scope, vehicle_id, gen)
      select s, v.id, v_gen from public.vehicles v
       where lower(v.make) = public.model_fold_scope_make(s)
         and (case when v_step = 9 then v.year is null else v.year between v_lo and v_hi end)
         and v.id::text not like '9cf5b7a4%'
         and public.model_fold_scope_of(v.make, v.model, v.vin, v.year) = s
      on conflict (scope, vehicle_id) do update set gen = excluded.gen;
      get diagnostics n_q = row_count;
      if v_step < 9 then
        update public.model_fold_cursor set snap_step = v_step + 1, snap_gen = v_gen, updated_at = now() where scope = s;
      else
        delete from public.model_fold_scope_members where scope = s and gen <> v_gen;
        update public.model_fold_cursor set snap_step = null, snap_gen = v_gen, snapshot_at = now(), verified_key = null,
               snapshot_n = (select count(*) from public.model_fold_scope_members where scope = s), updated_at = now()
         where scope = s;
      end if;
      out := out || jsonb_build_object(s, jsonb_build_object('snapshot_step', v_step, 'rows', n_q));
      return out || jsonb_build_object('_queued', total, '_snapshot', true);
    end if;
    if c.cursor is null and c.verified_key is not distinct from p_key then continue; end if;
    -- A new full pass (logic changed) starts at most every min_pass_hours; signalled vehicles still fold right away.
    if c.cursor is null and c.pass_started_at > now() - make_interval(hours => coalesce((p_cfg ->> 'min_pass_hours')::int, 6)) then
      continue;
    end if;
    if (select count(*) from public.model_fold_work where state = 'pending' and priority >= 5)
       >= coalesce((p_cfg ->> 'sweep_pending_cap')::int, 1000) then continue; end if;
    select array_agg(vehicle_id order by vehicle_id) into v_ids from (
      select m.vehicle_id from public.model_fold_scope_members m
       where m.scope = s and m.vehicle_id > coalesce(c.cursor, '00000000-0000-0000-0000-000000000000'::uuid)
       order by m.vehicle_id limit v_scan) z;
    v_last := v_ids[cardinality(v_ids)];
    insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at)
    select x, 5, array['sweep'], now() - make_interval(secs => v_settle), now() - make_interval(secs => v_settle), now()
      from unnest(coalesce(v_ids, '{}')) x
     where not exists (select 1 from public.model_fold_work w2 where w2.vehicle_id = x
                         and (w2.state in ('pending','leased') or w2.folded_key is not distinct from p_key
                              or (w2.state = 'dead' and w2.updated_at > now() - interval '1 day')))
    on conflict (vehicle_id) do update set state = 'pending', priority = 5, reasons = array['sweep'],
      first_dirty_at = excluded.first_dirty_at, dirty_at = excluded.dirty_at, next_attempt_at = now(), attempts = 0,
      updated_at = now()
     where w.state = 'done' or (w.state = 'dead' and w.updated_at <= now() - interval '1 day');
    get diagnostics n_q = row_count;
    total := total + n_q;
    if coalesce(cardinality(v_ids), 0) < v_scan then
      update public.model_fold_cursor set cursor = null, cycle = cycle + 1, wrapped_at = now(),
             -- a pass that started this tick (single chunk) is verified too
             verified_key = case when c.cursor is null or pass_key is not distinct from p_key then p_key end,
             pass_started_at = case when c.cursor is null then now() else pass_started_at end,
             pass_key = null, enqueued_total = enqueued_total + n_q, updated_at = now() where scope = s;
    else
      update public.model_fold_cursor set cursor = v_last,
             pass_key = case when c.cursor is null then p_key when pass_key is distinct from p_key then null else pass_key end,
             pass_started_at = case when c.cursor is null then now() else pass_started_at end,
             enqueued_total = enqueued_total + n_q, updated_at = now() where scope = s;
    end if;
    out := out || jsonb_build_object(s, jsonb_build_object('scanned', coalesce(cardinality(v_ids), 0), 'queued', n_q));
  end loop;
  return out || jsonb_build_object('_queued', total);
end $function$;


INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url) VALUES
  ('vin_format', 'Pontiac', 'gm_1970_1971_car_vin_v1', 1970, 1971, '{"regex": "^22[3468]87[01][A-Z][0-9]{6}$", "positions": {"series": [2, 2], "body": [4, 2], "plant": [7, 1], "year": [6, 1]}, "year_chars": {"0": 1970, "1": 1971}}', 'https://example.org/v'),
  ('vin_format', 'Pontiac', 'gm_1972_1980_car_vin_v1', 1972, 1980, '{"regex": "^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$", "positions": {"series": [2, 1], "body": [3, 2], "engine": [5, 1], "plant": [7, 1], "year": [6, 1]}, "year_chars": {"3": 1973}}', 'https://example.org/v'),
  ('vin_format', 'Pontiac', 'gm_1981_17_vin_v1', 1981, 1981, '{"regex": "^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$", "positions": {"series": [5, 1], "body": [6, 2], "engine": [8, 1], "plant": [11, 1], "year": [10, 1]}, "year_chars": {"B": 1981}}', 'https://example.org/v');
INSERT INTO public.vehicles VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Pontiac', 'Firebird Formula', NULL, 1973),
  ('a0000000-0000-0000-0000-000000000002', 'PONTIAC', 'Coupe', '2V87X3N123456', 1973),
  ('a0000000-0000-0000-0000-000000000003', 'Pontiac', 'LeMans', '2D37X3N123456', 1973),
  ('a0000000-0000-0000-0000-000000000004', 'Pontiac', 'Hardtop', '223870N123456', 1970),
  ('a0000000-0000-0000-0000-000000000005', 'Pontiac', 'Sport', '1G2AW87X5BL123456', 1981),
  ('a0000000-0000-0000-0000-000000000006', 'Ford', 'Mustang', NULL, 1966),
  ('a0000000-0000-0000-0000-000000000007', 'Ford', 'Mustang', NULL, 1980),
  ('a0000000-0000-0000-0000-000000000008', 'Chevrolet', 'Camaro SS', NULL, 1968),
  ('a0000000-0000-0000-0000-000000000009', 'Chevrolet', 'C10', 'CCL148F123456', 1978),
  ('a0000000-0000-0000-0000-00000000000a', 'Pontiac', 'Trans Am', NULL, NULL);
CREATE TABLE public.scope_before AS SELECT id, public.model_fold_scope_of(make, model, vin, year) AS scope FROM public.vehicles;
INSERT INTO public.model_fold_work (vehicle_id, state, priority, folded_key, folded_at)
SELECT id, 'done', 5, 'K', now() - interval '1 hour' FROM public.vehicles;

\ir ../migrations/20261125130000_model_fold_scope_rows.sql
\ir ../migrations/20261125130000_model_fold_scope_rows.sql
SET client_min_messages = warning;

DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.scope_before b JOIN public.vehicles v USING (id)
              WHERE public.model_fold_scope_of(v.make, v.model, v.vin, v.year) IS DISTINCT FROM b.scope) THEN
    RAISE EXCEPTION 'scope rows differ from the CASE: %', (SELECT jsonb_agg(jsonb_build_object('id', b.id, 'before', b.scope,
      'after', public.model_fold_scope_of(v.make, v.model, v.vin, v.year))) FROM public.scope_before b JOIN public.vehicles v USING (id)); END IF;
  IF (SELECT count(*) FROM public.scope_before WHERE scope = 'pontiac_f_body') <> 5 THEN RAISE EXCEPTION 'fixture: expected 5 F-body cars'; END IF;
  IF (SELECT array_agg(scope ORDER BY scope) FROM public.model_fold_scopes WHERE sweep AND decode) <> ARRAY['pontiac_f_body']
     OR EXISTS (SELECT 1 FROM public.model_fold_scopes WHERE scope <> 'pontiac_f_body' AND (sweep OR decode)) THEN RAISE EXCEPTION 'flags not from config'; END IF;
  IF EXISTS (SELECT 1 FROM public.model_fold_cursor) THEN RAISE EXCEPTION 'deploy created or forced a cursor'; END IF;
  IF public.model_fold_scope_make('chevrolet_camaro_67_69') <> 'chevrolet' THEN RAISE EXCEPTION 'scope_make'; END IF;
  IF NOT public.model_fold_in_scope('Pontiac', 'Coupe', '2V87X3N123456', 1973, 'a0000000-0000-0000-0000-000000000002')
     OR public.model_fold_in_scope('Chevrolet', 'Camaro', NULL, 1968, 'a0000000-0000-0000-0000-000000000008')
     OR public.model_fold_in_scope('Pontiac', 'Firebird', NULL, 1973, '9cf5b7a4-0000-0000-0000-000000000000') THEN RAISE EXCEPTION 'in_scope'; END IF;
  IF position('fs.decode' IN pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure)) = 0
     OR position('decode_scopes' IN pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'model_fold_one still reads decode_scopes'; END IF;
  IF NOT has_table_privilege('anon', 'public.model_fold_scopes', 'select') OR has_table_privilege('anon', 'public.model_fold_scopes', 'insert') THEN
    RAISE EXCEPTION 'grants'; END IF;
END $t$;

-- a full sweep (10 snapshot steps, then the pass): every F-body car already carries key K, nothing is queued
DO $s$ BEGIN FOR i IN 1..12 LOOP PERFORM public.model_fold_sweep('K', public.model_fold_config()); END LOOP; END $s$;
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.model_fold_scope_members WHERE scope = 'pontiac_f_body') <> 5 THEN
    RAISE EXCEPTION 'members: % (expected the 5 F-body cars)', (SELECT count(*) FROM public.model_fold_scope_members); END IF;
  IF EXISTS (SELECT 1 FROM public.model_fold_work WHERE state <> 'done') THEN RAISE EXCEPTION 'unforced pass re-queued folded cars'; END IF;
END $t$;

-- a no-op edit (note only) forces nothing
UPDATE public.model_fold_scopes SET note = note || ' (checked)' WHERE scope = 'pontiac_f_body';
DO $t$ BEGIN IF (SELECT forced_at FROM public.model_fold_cursor WHERE scope = 'pontiac_f_body') IS NOT NULL THEN RAISE EXCEPTION 'note edit forced a pass'; END IF; END $t$;

-- a pattern change forces the scope: its members folded before the change are queued, other cars are not
UPDATE public.model_fold_scopes SET model_pattern = 'firebird|trans ?am|formula' WHERE scope = 'pontiac_f_body';
DO $s$ BEGIN FOR i IN 1..12 LOOP PERFORM public.model_fold_sweep('K', public.model_fold_config()); END LOOP; END $s$;
DO $t$ BEGIN
  IF (SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM public.model_fold_work WHERE state = 'pending')
     IS DISTINCT FROM ARRAY['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
                            'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005',
                            'a0000000-0000-0000-0000-00000000000a']::uuid[] THEN
    RAISE EXCEPTION 'forced pass queued %', (SELECT array_agg(vehicle_id) FROM public.model_fold_work WHERE state = 'pending'); END IF;
END $t$;

-- a new scope (its cars were folded by signals under the current key) is walked and its cars re-folded
INSERT INTO public.model_fold_scopes (scope, make, model_pattern, sweep, decode, ord, note)
VALUES ('chevrolet_test_trucks', 'chevrolet', '^c10$', true, true, 40, 'test scope for light trucks');
DO $s$ BEGIN FOR i IN 1..12 LOOP PERFORM public.model_fold_sweep('K', public.model_fold_config()); END LOOP; END $s$;
DO $t$ BEGIN
  IF (SELECT state FROM public.model_fold_work WHERE vehicle_id = 'a0000000-0000-0000-0000-000000000009') <> 'pending' THEN
    RAISE EXCEPTION 'new scope did not re-fold its car'; END IF;
  IF (SELECT state FROM public.model_fold_work WHERE vehicle_id = 'a0000000-0000-0000-0000-000000000008') <> 'done' THEN
    RAISE EXCEPTION 'a car outside every swept scope was queued'; END IF;
END $t$;
\echo model_fold_scope_rows: ok
