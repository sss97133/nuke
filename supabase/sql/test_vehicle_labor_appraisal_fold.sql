-- Disposable PG17: labor_fold_v1. The labor appraisal is folded into vehicle_labor_appraisal_state and the public reader
-- returns the stored row. Builds on the labor reader fixture (test_vehicle_labor_appraisal_names.sql) plus the model fold
-- signal functions as live on 2026-11-25 (model_fold_signal_ids, model_fold_rows_signal, model_fold_origin_update_signal)
-- and a model_fold_one stub holding the live anchor. Checks: stored read = computed read minus as_of on every fixture car;
-- an answered judgment request and a changed receipt line edge stamp the row stale and the reader says 'recomputing';
-- a clock-only edge restamp does not; a rule-row change moves the key; model_fold_one folds a car in scope; the signal
-- writer admits a car that has a row; a viewer-dependent rule stops the fold from storing; a private car is computed
-- at read; anon cannot call the compute, fold, scope or enqueue functions. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_names.sql

-- Inputs the fold signals on, as stubs where the reader fixture has none.
CREATE TABLE IF NOT EXISTS public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE IF NOT EXISTS public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid);
CREATE TABLE IF NOT EXISTS public.receipt_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid,
  vehicle_id uuid, retired_at timestamptz);
-- guardrail-allow(center-key-fk): vehicle_observations.id: synthetic fixture table in a disposable test database
CREATE TABLE IF NOT EXISTS public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS property_id uuid, ADD COLUMN IF NOT EXISTS is_superseded boolean DEFAULT false;
CREATE TABLE IF NOT EXISTS public.service_manual_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.receipt_line_edges ADD COLUMN IF NOT EXISTS classified_at timestamptz DEFAULT now();
ALTER TABLE public.labor_operations ADD COLUMN IF NOT EXISTS code text;

-- Model fold machinery: queue, config and signal tables as stubs; the three signal functions as live.
CREATE TABLE public.model_fold_work (vehicle_id uuid PRIMARY KEY, state text DEFAULT 'pending', priority smallint,
  reasons text[], first_dirty_at timestamptz, dirty_at timestamptz, attempts int DEFAULT 0, next_attempt_at timestamptz,
  updated_at timestamptz);
CREATE TABLE public.model_fold_signal (id bigserial PRIMARY KEY, vehicle_id uuid, reason text, origin_id uuid, priority smallint);
CREATE TABLE public.vehicle_facet_grade_folds (vehicle_id uuid PRIMARY KEY, evidence_changed_at timestamptz);
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"sweep_pending_cap": 1000}'::jsonb $$;
CREATE FUNCTION public.model_fold_signals_on() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.model_fold_signal_priority(p_id uuid, p_make text, p_model text, p_vin text, p_year integer, p_max integer)
  RETURNS smallint LANGUAGE sql STABLE AS $$ SELECT NULL::smallint $$;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vin text;
CREATE OR REPLACE FUNCTION public.model_fold_signal_ids(p_ids uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_max int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  -- model_fold_signal_tiers_v1 (R1): a change to any source of a car stops its folded facet grades being read
  update public.vehicle_facet_grade_folds set evidence_changed_at = clock_timestamp() where vehicle_id = any (p_ids);
  if not public.model_fold_signals_on() then return; end if;
  v_max := coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1);
  insert into public.model_fold_signal (vehicle_id, reason, priority)
  select v.id, p_reason, coalesce(p.pr, 9) from public.vehicles v
   cross join lateral (select public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year, v_max) as pr) p
   where v.id = any (p_ids)
     and (p.pr is not null
          or (v.id::text not like '9cf5b7a4%' and exists (select 1 from public.vehicle_facet_grade_folds f where f.vehicle_id = v.id)));
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
    -- model_fold_signal_tiers_v1: no early return; model_fold_signal_ids stamps facet folds whether signals are on
    -- and checks signals_on itself before it inserts.
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
      if public.model_fold_signals_on() then
      insert into public.model_fold_signal (vehicle_id, reason, origin_id, priority) /* model_fold_signal_tiers_v1 */
      select n.vehicle_id, 'auction_comment_edit', n.id, p.pr
        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id
        cross join lateral (select public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year,
          coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1)) as pr) p
       where o.comment_text is distinct from n.comment_text
         and p.pr is not null;
      end if;
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
CREATE FUNCTION public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
declare t0 timestamptz := clock_timestamp();
begin
  -- facet_grades_fold_v1_end
  return jsonb_build_object('ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $function$;

\ir ../migrations/20261125141500_labor_hours_basis.sql
\ir ../migrations/20261125153000_vehicle_labor_appraisal_fold.sql
\ir ../migrations/20261125153000_vehicle_labor_appraisal_fold.sql

-- Every fixture car is in scope through one judgment request row (the fixture's own rows, or one added here).
INSERT INTO public.evidence_judgment_requests (vehicle_id, question_kind, status)
  SELECT b.v, 'fold_scope_fixture', 'open' FROM _labor_names_before b
   WHERE NOT EXISTS (SELECT 1 FROM public.evidence_judgment_requests j WHERE j.vehicle_id = b.v);
SET test.auth_role = 'anon';
DO $$
DECLARE r record; c jsonb; s jsonb; n int := 0;
BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal_enqueue() ->> 'queued' IS NOT NULL, 'enqueue runs');
  FOR r IN SELECT b.v FROM _labor_names_before b JOIN public.vehicles v ON v.id = b.v
            WHERE v.is_public IS TRUE AND v.deleted_at IS NULL LOOP
    PERFORM public.assert(public.vehicle_labor_appraisal_in_scope(r.v), 'in scope: ' || r.v);
    PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = r.v AND g.priority = 9
                                   AND g.reason = 'labor_logic_key'), 'seed signalled: ' || r.v);
    PERFORM public.model_fold_one(gen_random_uuid(), r.v, '{}'::jsonb);
    c := public.vehicle_labor_appraisal_compute(r.v);
    s := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert((s ->> 'state')::jsonb ->> 'fresh' = 'true', 'fresh row read: ' || r.v);
    PERFORM public.assert((s - 'as_of' - 'state') = (c - 'as_of'), 'stored read = computed read: ' || r.v);
    n := n + 1;
  END LOOP;
  PERFORM public.assert(n >= 2, format('fixture folds %s cars', n));
  PERFORM public.assert((SELECT count(*) FROM public.vehicle_labor_appraisal_state WHERE error IS NULL AND read IS NOT NULL) = n,
                        'one stored row per folded car');
  DELETE FROM public.model_fold_signal;  -- the queue absorbs them
  PERFORM public.assert((public.vehicle_labor_appraisal_enqueue() ->> 'queued')::int = 0, 'nothing to seed once fresh');
  PERFORM public.assert((public.vehicle_labor_appraisal_gauge() ->> 'off_key')::int = 0
                        AND (public.vehicle_labor_appraisal_gauge() ->> 'errored')::int = 0, 'gauge: 0 off key, 0 errored');
END $$;
RESET test.auth_role;

-- An answer lands: the row goes stale and the reader withholds the old number; the next fold makes it fresh.
CREATE TEMP TABLE fold_v AS SELECT b.v FROM _labor_names_before b JOIN public.vehicles v ON v.id = b.v
  WHERE v.is_public IS TRUE ORDER BY b.v LIMIT 1;
UPDATE public.evidence_judgment_requests SET answer = '{"fixture": true}'::jsonb
 WHERE id = (SELECT min(id::text)::uuid FROM public.evidence_judgment_requests WHERE vehicle_id = (SELECT v FROM fold_v));
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v); s jsonb;
BEGIN
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s ->> 'status' = 'recomputing' AND NOT (s ? 'totals'), 'answer stamps stale: recomputing, no hours');
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = vid), 'a car with a row is admitted to the queue');
  PERFORM public.vehicle_labor_appraisal_fold(vid);
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,fresh}' = 'true', 'refold makes it fresh');
END $$;

-- A receipt line edge: a classified_at restamp signals nothing; a changed system signals.
INSERT INTO public.receipts (id, vehicle_id) SELECT '20000000-0000-0000-0000-000000000001', v FROM fold_v;
INSERT INTO public.receipt_items (id, receipt_id)
  SELECT e.receipt_item_id, '20000000-0000-0000-0000-000000000001' FROM public.receipt_line_edges e
   WHERE e.classifier = 'system' ORDER BY e.receipt_item_id LIMIT 1 ON CONFLICT DO NOTHING;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;
UPDATE public.receipt_line_edges SET classified_at = now() + interval '1 hour'
 WHERE receipt_item_id = (SELECT min(id::text)::uuid FROM public.receipt_items) AND classifier = 'system';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) #>> '{state,fresh}' = 'true', 'clock-only restamp: still fresh');
END $$;
UPDATE public.receipt_line_edges SET system_key = 'paint'
 WHERE receipt_item_id = (SELECT min(id::text)::uuid FROM public.receipt_items) AND classifier = 'system';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) ->> 'status' = 'recomputing', 'changed edge: recomputing');
END $$;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;

-- A no-op update keeps the key; a rule row edit moves it, every row is stale, and the seed signals them again.
CREATE TEMP TABLE key0 AS SELECT public.vehicle_labor_appraisal_logic_key() AS k;
UPDATE public.labor_hours_bases SET meaning = meaning WHERE basis_key = 'uncited_seed';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() = (SELECT k FROM key0), 'no-op update: same key');
END $$;
UPDATE public.labor_hours_bases SET meaning = meaning || ' (fixture edit)' WHERE basis_key = 'uncited_seed';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) ->> 'status' = 'recomputing', 'rule change: recomputing');
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() <> (SELECT k FROM key0), 'rule edit: key moves');
  PERFORM public.assert((public.vehicle_labor_appraisal_gauge() ->> 'off_key')::int > 0, 'gauge: rows off key after the edit');
  DELETE FROM public.model_fold_signal;
  PERFORM public.assert((public.vehicle_labor_appraisal_enqueue() ->> 'queued')::int > 0, 'rule change: seed signals again');
  PERFORM public.assert((public.vehicle_labor_appraisal_enqueue() ->> 'queued')::int = 0, 'seed does not signal a car twice');
END $$;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;

-- A viewer-dependent rule: the fold refuses to store and the reader computes at read.
UPDATE public.labor_stage_rules SET evidence_requirements = jsonb_set(coalesce(evidence_requirements, '{}'::jsonb), '{all}',
         coalesce(evidence_requirements -> 'all', '[]'::jsonb) || '[{"type": "facet_truthy", "key": "fixture"}]'::jsonb)
 WHERE segment_key = (SELECT min(segment_key) FROM public.labor_stage_rules WHERE active);
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v);
BEGIN
  PERFORM public.vehicle_labor_appraisal_fold(vid);
  PERFORM public.assert((SELECT error FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid) = 'viewer_dependent_rule',
                        'viewer-dependent rule: not stored');
  PERFORM public.assert((public.vehicle_labor_appraisal(vid) - 'as_of') = (public.vehicle_labor_appraisal_compute(vid) - 'as_of'),
                        'errored row: computed at read');
END $$;

-- A private car is computed at read (the compute step keeps the visibility test).
UPDATE public.vehicles SET is_public = false WHERE id = (SELECT v FROM fold_v);
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) IS NOT DISTINCT FROM
                        public.vehicle_labor_appraisal_compute((SELECT v FROM fold_v)), 'private car: same as compute');
  PERFORM public.assert(NOT public.vehicle_labor_appraisal_in_scope((SELECT v FROM fold_v)), 'private car: out of scope');
END $$;

DO $$ BEGIN
  PERFORM public.assert(has_function_privilege('anon', 'public.vehicle_labor_appraisal(uuid)', 'EXECUTE'), 'anon reads');
  PERFORM public.assert(NOT has_function_privilege('anon', 'public.vehicle_labor_appraisal_compute(uuid)', 'EXECUTE'), 'anon cannot compute');
  PERFORM public.assert(NOT has_function_privilege('anon', 'public.vehicle_labor_appraisal_fold(uuid)', 'EXECUTE'), 'anon cannot fold');
  PERFORM public.assert(NOT has_function_privilege('anon', 'public.vehicle_labor_appraisal_enqueue(integer)', 'EXECUTE'), 'anon cannot enqueue');
  PERFORM public.assert(NOT has_function_privilege('anon', 'public.vehicle_labor_appraisal_gauge()', 'EXECUTE'), 'anon cannot gauge');
  PERFORM public.assert(NOT has_table_privilege('anon', 'public.vehicle_labor_appraisal_state', 'SELECT'), 'anon cannot read the state table');
  PERFORM public.assert(position('labor_fold_v1' IN pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure)) > 0
                        AND position('labor_fold_v1' IN pg_get_functiondef('public.model_fold_signal_ids(uuid[],text)'::regprocedure)) > 0,
                        'both model fold functions patched once');
END $$;
\echo labor_fold: ok
