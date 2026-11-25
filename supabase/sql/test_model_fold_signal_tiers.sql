-- Contract for 20261125083000_model_fold_signal_tiers (empty disposable PG17). The ten live signal functions and the
-- twelve live signal triggers are loaded verbatim (read from production 2026-11-25), over small fixture tables.
-- Asserts: before the migration a change on a car outside the scope sends nothing; with signal_tiers_max 1 (the value
-- the migration writes) the behaviour is the same except that a car holding a facet fold row is signalled at 9 and
-- stamped; at max 4 each car gets the tier its keyed witnesses earn (2: 20+, 3: 5+, 4: rest), the F-body car 1, the
-- excluded id nothing; absorb keeps the lower number on a pending row and takes the signal's on a done row; at max 2
-- a tier-3 car is not admitted by any writer (rows, vehicles, comment edit); a vehicles update stamps the facet fold
-- row and signals it at 9; the comment-edit patch lands once; the migration is idempotent; the gauge reads.
-- Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.model_fold_signal') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, year int, make text, model text, description text, highlights text,
  equipment text, modifications text, numbers_quote text, title text, listing_title text, bat_listing_title text,
  deleted_at timestamptz, merged_into_vehicle_id uuid REFERENCES public.vehicles (id));
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  comment_text text, comment_type text, has_question boolean);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id));
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  status text, proposed_value text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  is_superseded boolean DEFAULT false, content_text text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  vision_gate_status text);
CREATE TABLE public.model_fold_signal (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id uuid REFERENCES public.vehicles (id), reason text, origin_id uuid, at timestamptz DEFAULT now());
CREATE TABLE public.model_fold_work (vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id), state text NOT NULL DEFAULT 'pending',
  priority smallint NOT NULL DEFAULT 5, reasons text[] NOT NULL DEFAULT '{}', first_dirty_at timestamptz, dirty_at timestamptz,
  next_attempt_at timestamptz, attempts int NOT NULL DEFAULT 0, edited_origins uuid[] NOT NULL DEFAULT '{}', updated_at timestamptz);
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text, updated_at timestamptz);
INSERT INTO public.platform_config VALUES ('model_fold', '{"scopes": ["pontiac_f_body"], "signals_enabled": true, "enabled": true}', NULL, now());
CREATE TABLE public.data_set_member_grades (vehicle_id uuid REFERENCES public.vehicles (id), set_id uuid, n_witnesses int,
  PRIMARY KEY (vehicle_id, set_id));
CREATE TABLE public.vehicle_facet_grade_folds (vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id),
  folded_at timestamptz NOT NULL DEFAULT now(), evidence_changed_at timestamptz);
CREATE TABLE public.model_fold_ticks (tick_id uuid PRIMARY KEY, status text, started_at timestamptz, folded int, signals int, ms int);
CREATE TABLE public.model_fold_tick_runs (tick_id uuid, vehicle_id uuid REFERENCES public.vehicles (id), ms int);

-- live definitions (2026-11-25), in name order
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.model_fold_absorb_signals(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with s as (
    delete from public.model_fold_signal where id in (select id from public.model_fold_signal order by id limit p_limit)
    returning vehicle_id, reason, origin_id, at),
  g as (select vehicle_id, array_agg(distinct reason) reasons, min(at) f, max(at) l,
               coalesce(array_agg(distinct origin_id) filter (where origin_id is not null), '{}') edited
          from s group by vehicle_id)
  insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at, edited_origins)
  select vehicle_id, 1, reasons, f, l, now(), edited from g
  on conflict (vehicle_id) do update set
    priority = 1,
    edited_origins = (select coalesce(array_agg(distinct x), '{}') from unnest(w.edited_origins || excluded.edited_origins) x),
    reasons = case when w.state in ('done','dead') then excluded.reasons
                   else (select array_agg(distinct x order by x) from unnest(w.reasons || excluded.reasons) x) end,
    first_dirty_at = case when w.state in ('done','dead') then excluded.first_dirty_at else least(w.first_dirty_at, excluded.first_dirty_at) end,
    dirty_at = greatest(w.dirty_at, excluded.dirty_at),
    -- new input revives a dead letter with a fresh attempt budget; a leased row keeps its lease
    state = case when w.state = 'leased' then w.state else 'pending' end,
    attempts = case when w.state = 'dead' then 0 else w.attempts end,
    next_attempt_at = case when w.state in ('done','dead') then now() else w.next_attempt_at end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.model_fold_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select config_value from public.platform_config where config_key = 'model_fold' limit 1), '{}'::jsonb)
$function$
;
CREATE OR REPLACE FUNCTION public.model_fold_image_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.model_fold_signal_ids(array_remove(array[old.vehicle_id, new.vehicle_id], null), 'photo_move');
  exception when others then
    raise warning 'model_fold signal skipped (vehicle_images): %', sqlerrm;
  end;
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.model_fold_in_scope(p_make text, p_model text, p_vin text, p_year integer, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p_id is not null and p_id::text not like '9cf5b7a4%'
     and public.model_fold_scope_of(p_make, p_model, p_vin, p_year) in
         (select jsonb_array_elements_text(public.model_fold_config() -> 'scopes'))
$function$
;
CREATE OR REPLACE FUNCTION public.model_fold_origin_update_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.model_fold_signal_ids(array_remove(array[old.vehicle_id, new.vehicle_id], null), tg_table_name || '_update');
  exception when others then
    raise warning 'model_fold signal skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.model_fold_rows_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ids uuid[];
begin
  begin
    if not public.model_fold_signals_on() then return null; end if;
    -- Static SQL per branch: a branch is planned only when it runs, so new_rows/old_rows exist whenever referenced.
    if tg_op = 'INSERT' then
      select array_agg(distinct n.vehicle_id) into v_ids from new_rows n where n.vehicle_id is not null;
    elsif tg_op = 'DELETE' then
      select array_agg(distinct o.vehicle_id) into v_ids from old_rows o where o.vehicle_id is not null;
    elsif tg_table_name = 'auction_comments' then
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id or o.comment_text is distinct from n.comment_text
            or o.comment_type is distinct from n.comment_type or o.has_question is distinct from n.has_question) z
       where x is not null;
      -- An edited comment's readings carry no match text, so the fold needs to know which comments changed.
      insert into public.model_fold_signal (vehicle_id, reason, origin_id)
      select n.vehicle_id, 'auction_comment_edit', n.id
        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id
       where o.comment_text is distinct from n.comment_text
         and public.model_fold_in_scope(v.make, v.model, v.vin, v.year, v.id);
    else
      select array_agg(distinct x) into v_ids from (
        select unnest(array[o.vehicle_id, n.vehicle_id]) x from old_rows o join new_rows n on n.id = o.id
         where o.vehicle_id is distinct from n.vehicle_id) z where x is not null;
    end if;
    perform public.model_fold_signal_ids(v_ids, tg_table_name || '_' || lower(tg_op));
  exception when others then
    raise warning 'model_fold signal skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.model_fold_signal_ids(p_ids uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if p_ids is null or cardinality(p_ids) = 0 or not public.model_fold_signals_on() then return; end if;
  insert into public.model_fold_signal (vehicle_id, reason)
  select v.id, p_reason from public.vehicles v
   where v.id = any (p_ids) and public.model_fold_in_scope(v.make, v.model, v.vin, v.year, v.id);
end $function$
;
CREATE OR REPLACE FUNCTION public.model_fold_signals_on()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(current_setting('model_fold.in_tick', true), '') <> 'on'
     and coalesce((public.model_fold_config() ->> 'signals_enabled')::boolean, false)
$function$
;
CREATE OR REPLACE FUNCTION public.model_fold_vehicles_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if public.model_fold_signals_on() and (public.model_fold_in_scope(new.make, new.model, new.vin, new.year, new.id)
       or (tg_op = 'UPDATE' and public.model_fold_in_scope(old.make, old.model, old.vin, old.year, old.id))) then
      insert into public.model_fold_signal (vehicle_id, reason) values (new.id, 'vehicle_' || lower(tg_op));
    end if;
  exception when others then
    raise warning 'model_fold signal skipped (vehicles): %', sqlerrm;
  end;
  return null;
end $function$
;

CREATE TRIGGER a09_model_fold_signal AFTER UPDATE OF vehicle_id, vision_gate_status ON public.vehicle_images FOR EACH ROW WHEN (((old.vehicle_id IS DISTINCT FROM new.vehicle_id) OR (old.vision_gate_status IS DISTINCT FROM new.vision_gate_status))) EXECUTE FUNCTION model_fold_image_signal();
CREATE TRIGGER model_fold_signal_del AFTER DELETE ON public.auction_comments REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.auction_comments REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.auction_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.field_evidence REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.vehicle_observations REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_ins AFTER INSERT ON public.vehicles FOR EACH ROW EXECUTE FUNCTION model_fold_vehicles_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE OF is_superseded, content_text, vehicle_id ON public.vehicle_observations FOR EACH ROW WHEN (((old.is_superseded IS DISTINCT FROM new.is_superseded) OR (old.content_text IS DISTINCT FROM new.content_text) OR (old.vehicle_id IS DISTINCT FROM new.vehicle_id))) EXECUTE FUNCTION model_fold_origin_update_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE OF status, proposed_value, vehicle_id ON public.field_evidence FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.proposed_value IS DISTINCT FROM new.proposed_value) OR (old.vehicle_id IS DISTINCT FROM new.vehicle_id))) EXECUTE FUNCTION model_fold_origin_update_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE OF vin, year, make, model, description, highlights, equipment, modifications, numbers_quote, title, listing_title, bat_listing_title, deleted_at, merged_into_vehicle_id ON public.vehicles FOR EACH ROW WHEN (((old.vin IS DISTINCT FROM new.vin) OR (old.year IS DISTINCT FROM new.year) OR (old.make IS DISTINCT FROM new.make) OR (old.model IS DISTINCT FROM new.model) OR (old.description IS DISTINCT FROM new.description) OR (old.highlights IS DISTINCT FROM new.highlights) OR (old.equipment IS DISTINCT FROM new.equipment) OR (old.modifications IS DISTINCT FROM new.modifications) OR (old.numbers_quote IS DISTINCT FROM new.numbers_quote) OR (old.title IS DISTINCT FROM new.title) OR (old.listing_title IS DISTINCT FROM new.listing_title) OR (old.bat_listing_title IS DISTINCT FROM new.bat_listing_title) OR (old.deleted_at IS DISTINCT FROM new.deleted_at) OR (old.merged_into_vehicle_id IS DISTINCT FROM new.merged_into_vehicle_id))) EXECUTE FUNCTION model_fold_vehicles_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE ON public.auction_comments REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();
CREATE TRIGGER model_fold_signal_upd AFTER UPDATE ON public.auction_events REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION model_fold_rows_signal();

RESET check_function_bodies;

-- fixtures (disposable database only): P an F-body car, A/B/C Fords with 25 / 6 / 0 keyed witnesses, G a Ford with
-- 0 witnesses that holds a facet fold row, X the excluded id (50 witnesses).
INSERT INTO public.vehicles (id, year, make, model) VALUES
 ('00000000-0000-0000-0000-00000000000a', 1973, 'Pontiac', 'Firebird'),
 ('00000000-0000-0000-0000-0000000000a1', 1968, 'Ford', 'Mustang'),
 ('00000000-0000-0000-0000-0000000000b1', 1970, 'Ford', 'Torino'),
 ('00000000-0000-0000-0000-0000000000c1', 1999, 'Ford', 'Ranger'),
 ('00000000-0000-0000-0000-0000000000d1', 1988, 'Ford', 'Bronco'),
 ('9cf5b7a4-0000-0000-0000-000000000001', 1972, 'Ford', 'Maverick');
INSERT INTO public.data_set_member_grades VALUES
 ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 15), ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 10),
 ('00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 6), ('9cf5b7a4-0000-0000-0000-000000000001', gen_random_uuid(), 50);
INSERT INTO public.vehicle_facet_grade_folds (vehicle_id, folded_at) VALUES ('00000000-0000-0000-0000-0000000000d1', now() - interval '1 hour');

-- one observation on every car, through the live statement trigger (disposable database only)
CREATE FUNCTION pg_temp.touch_all() RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.vehicle_observations (vehicle_id, content_text) SELECT id, 'x' FROM public.vehicles $f$;

-- Before: only the F-body car is heard.
SELECT pg_temp.touch_all();
DO $$ BEGIN
  IF (SELECT array_agg(DISTINCT vehicle_id) FROM public.model_fold_signal) <> ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[] THEN
    RAISE EXCEPTION 'baseline: %', (SELECT array_agg(vehicle_id) FROM public.model_fold_signal); END IF;
END $$;
DELETE FROM public.model_fold_signal;

\ir ../migrations/20261125083000_model_fold_signal_tiers.sql
\ir ../migrations/20261125083000_model_fold_signal_tiers.sql
RESET statement_timeout; RESET lock_timeout;
CREATE FUNCTION pg_temp.sig() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT coalesce(jsonb_object_agg(vehicle_id::text, p), '{}'::jsonb)
  FROM (SELECT vehicle_id, max(priority) AS p FROM public.model_fold_signal GROUP BY 1) s $f$;

DO $$ DECLARE d text; s jsonb; BEGIN
  d := pg_get_functiondef('public.model_fold_rows_signal()'::regprocedure);
  IF (length(d) - length(replace(d, 'model_fold_signal_tiers_v1', ''))) / length('model_fold_signal_tiers_v1') <> 1 THEN
    RAISE EXCEPTION 'comment-edit branch patched wrong'; END IF;
  IF (SELECT config_value->>'signal_tiers_max' FROM public.platform_config WHERE config_key = 'model_fold') <> '1' THEN
    RAISE EXCEPTION 'signal_tiers_max not written as 1'; END IF;

  -- max 1: today's behaviour, plus the facet-fold car at 9 (and stamped)
  PERFORM pg_temp.touch_all();
  s := pg_temp.sig();
  IF s <> '{"00000000-0000-0000-0000-00000000000a": 1, "00000000-0000-0000-0000-0000000000d1": 9}'::jsonb THEN
    RAISE EXCEPTION 'max 1: %', s; END IF;
  IF (SELECT evidence_changed_at FROM public.vehicle_facet_grade_folds WHERE vehicle_id = '00000000-0000-0000-0000-0000000000d1') IS NULL THEN
    RAISE EXCEPTION 'facet fold row not stamped'; END IF;
  PERFORM public.model_fold_absorb_signals(1000);
  IF (SELECT priority FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a') <> 1
     OR (SELECT priority FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-0000000000d1') <> 9 THEN
    RAISE EXCEPTION 'absorb at max 1'; END IF;
  DELETE FROM public.model_fold_work;

  -- max 4: tiers by keyed witnesses; a pending row keeps the lower number; a done row takes the signal's
  UPDATE public.platform_config SET config_value = config_value || '{"signal_tiers_max": 4}' WHERE config_key = 'model_fold';
  INSERT INTO public.model_fold_work (vehicle_id, state, priority, dirty_at, first_dirty_at, next_attempt_at) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'pending', 5, now(), now(), now()),
    ('00000000-0000-0000-0000-0000000000b1', 'done', 1, now(), now(), now());
  PERFORM pg_temp.touch_all();
  s := pg_temp.sig();
  IF s <> '{"00000000-0000-0000-0000-00000000000a": 1, "00000000-0000-0000-0000-0000000000a1": 2,
           "00000000-0000-0000-0000-0000000000b1": 3, "00000000-0000-0000-0000-0000000000c1": 4,
           "00000000-0000-0000-0000-0000000000d1": 4}'::jsonb THEN
    RAISE EXCEPTION 'max 4 tiers: %', s; END IF;
  PERFORM public.model_fold_absorb_signals(1000);
  IF (SELECT priority FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') <> 2
     OR (SELECT priority FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') <> 3
     OR (SELECT state FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') <> 'pending'
     OR EXISTS (SELECT 1 FROM public.model_fold_work WHERE vehicle_id::text LIKE '9cf5b7a4%') THEN
    RAISE EXCEPTION 'absorb at max 4: %', (SELECT jsonb_agg(to_jsonb(w)) FROM public.model_fold_work w); END IF;

  -- max 2: a tier-3 car is admitted by no writer; a tier-2 comment edit is; the facet-fold car is signalled at 9
  UPDATE public.platform_config SET config_value = config_value || '{"signal_tiers_max": 2}' WHERE config_key = 'model_fold';
  INSERT INTO public.auction_comments (vehicle_id, comment_text) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'a'), ('00000000-0000-0000-0000-0000000000b1', 'b');
  DELETE FROM public.model_fold_signal;
  UPDATE public.vehicle_facet_grade_folds SET evidence_changed_at = NULL;
  UPDATE public.auction_comments SET comment_text = comment_text || ' edited';
  UPDATE public.vehicles SET description = 'changed' WHERE id IN ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1');
  INSERT INTO public.field_evidence (vehicle_id, status) VALUES ('00000000-0000-0000-0000-0000000000b1', 'accepted');
  IF EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION 'tier 3 admitted at max 2: %', (SELECT jsonb_agg(reason) FROM public.model_fold_signal
                                                    WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1'
                   AND reason = 'auction_comment_edit' AND priority = 2) THEN
    RAISE EXCEPTION 'tier-2 comment edit missing: %', pg_temp.sig(); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = '00000000-0000-0000-0000-0000000000d1'
                   AND reason = 'vehicle_update' AND priority = 9)
     OR (SELECT evidence_changed_at FROM public.vehicle_facet_grade_folds WHERE vehicle_id = '00000000-0000-0000-0000-0000000000d1') IS NULL THEN
    RAISE EXCEPTION 'facet-fold car not signalled or stamped on a vehicles update'; END IF;
  RAISE NOTICE 'gauge %', public.model_fold_queue_gauge();
END $$;
\echo model_fold_signal_tiers: ok
