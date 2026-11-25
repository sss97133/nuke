-- Disposable PG17: labor_fold_v1. The labor appraisal is folded into vehicle_labor_appraisal_state and the public reader
-- returns the stored row. Builds on the labor reader fixture (test_vehicle_labor_appraisal_names.sql) plus the model fold
-- signal functions as live on 2026-11-25 (model_fold_signal_ids, model_fold_rows_signal, model_fold_origin_update_signal)
-- and a model_fold_one stub holding the live anchor. Checks: stored read = computed read minus as_of on every fixture car;
-- an answered judgment request and a changed receipt line edge stamp the row stale and the reader serves the live
-- compute (state.basis computed_now); a car too slow to compute at read gets its stored read flagged 'recomputing' or the
-- not-yet-computed status, named in the gauge; a car with no state row returns the compute (never blank in scope);
-- a clock-only edge restamp does not; a rule-row change moves the key; model_fold_one folds a car in scope; the signal
-- writer admits a car that has a row; a viewer-dependent rule stops the fold from storing; a private car is computed
-- at read; anon cannot call the compute, fold, scope or enqueue functions. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_names.sql

-- Inputs the fold signals on, as stubs where the reader fixture has none.
-- Foreign keys as production has them (pg_constraint, read 2026-11-25): receipt_items.receipt_id and
-- receipt_vehicle_links.receipt_id -> receipts, receipt_vehicle_links.vehicle_id and vehicle_facet_grade_folds.vehicle_id
-- -> vehicles. The columns below have none in production:
-- guardrail-allow(center-key-fk): receipts.vehicle_id: no foreign key in production (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): model_fold_work.vehicle_id: no foreign key in production (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): model_fold_signal.vehicle_id: no foreign key in production (pg_constraint 2026-11-25)
CREATE TABLE IF NOT EXISTS public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE IF NOT EXISTS public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS public.receipt_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL, retired_at timestamptz);
-- guardrail-allow(center-key-fk): vehicle_observations.id: the table's own primary key, not a reference (fixture stub)
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
CREATE TABLE public.model_fold_signal (id bigserial PRIMARY KEY, vehicle_id uuid, reason text, origin_id uuid, priority smallint,
  at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.image_privacy_rules (rule_key text PRIMARY KEY);
ALTER TABLE public.image_privacy_rules ADD COLUMN IF NOT EXISTS field_name text, ADD COLUMN IF NOT EXISTS min_alnum int,
  ADD COLUMN IF NOT EXISTS applies_to text, ADD COLUMN IF NOT EXISTS enabled boolean;
-- photo_extracted_fields as production has it (columns read 2026-11-25); image_id and vehicle_id carry no foreign key there.
-- guardrail-allow(center-key-fk): photo_extracted_fields.image_id: no foreign key in production (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): photo_extracted_fields.vehicle_id: no foreign key in production (pg_constraint 2026-11-25)
CREATE TABLE IF NOT EXISTS public.photo_extracted_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid,
  user_id uuid, vehicle_id uuid, field_name text, value text, created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_facet_grade_folds (vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  evidence_changed_at timestamptz);
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"sweep_pending_cap": 1000, "settle_seconds": 300}'::jsonb $$;
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
\ir ../migrations/20261125210500_vehicle_labor_appraisal_fold_reapply.sql
\ir ../migrations/20261125213000_vehicle_labor_appraisal_enqueue_priority_custody.sql
\ir ../migrations/20261125213000_vehicle_labor_appraisal_enqueue_priority_custody.sql

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
    PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = r.v AND g.priority = 4
                                   AND g.reason = 'labor_logic_key'), 'seed signalled: ' || r.v);
    PERFORM public.model_fold_one(gen_random_uuid(), r.v, '{}'::jsonb);
    c := public.vehicle_labor_appraisal_compute(r.v);
    s := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(s #>> '{state,queued}' = 'true' AND s #>> '{state,basis}' = 'computed_now'
                          AND (s - 'as_of' - 'state') = (c - 'as_of'), 'a waiting signal: the live compute, basis computed_now: ' || r.v);
    DELETE FROM public.model_fold_signal WHERE vehicle_id = r.v;  -- the tick absorbed and folded it
    s := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert((s ->> 'state')::jsonb ->> 'fresh' = 'true' AND s #>> '{state,basis}' = 'stored'
                          AND s #>> '{state,label}' IS NULL, 'fresh row read: ' || r.v);
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

-- An in-scope car never folded: the live compute (lead ruling: the stored row is a cache, never a gate).
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
SET test.auth_role = 'anon';
DO $$
DECLARE vid uuid := (SELECT b.v FROM _labor_names_before b JOIN public.vehicles v ON v.id = b.v
                      WHERE v.is_public IS TRUE ORDER BY b.v LIMIT 1);
        keep public.vehicle_labor_appraisal_state%ROWTYPE; s jsonb; c jsonb;
BEGIN
  SELECT * INTO keep FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  DELETE FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  c := public.vehicle_labor_appraisal_compute(vid);
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s #>> '{state,basis}' = 'computed_now' AND s #>> '{state,computed}' = 'true'
                        AND s #>> '{state,fresh}' = 'true' AND s #>> '{state,stored_at}' IS NULL,
                        'never folded: computed now, not blank: ' || (s -> 'state')::text);
  PERFORM public.assert((s - 'as_of' - 'state') = (c - 'as_of'), 'contract: no state row returns the same read as the compute');
  PERFORM public.assert(c ? 'totals' OR c ? 'segments', 'the compute answers');
  -- A failed fold with no good read and a timeout: the status line, named in the gauge.
  INSERT INTO public.vehicle_labor_appraisal_state (vehicle_id, ms, error)
    VALUES (vid, 100, 'canceling statement due to statement timeout');  -- named by the timeout, not the ms
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s ->> 'status' = 'not_yet_computed' AND s #>> '{state,label}' = 'not yet computed'
                        AND s #>> '{state,computed}' = 'false' AND NOT (s ? 'totals'), 'too slow, never stored: status line');
  PERFORM public.assert(public.vehicle_labor_appraisal_gauge() -> 'too_slow_to_compute_at_read' ? vid::text,
                        'gauge names the slow car');
  DELETE FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  INSERT INTO public.vehicle_labor_appraisal_state SELECT keep.*;
  -- A stored read whose fold took at least half of anon's statement_timeout: stale, it serves the stored read with its
  -- as-of time and label 'recomputing', never a live compute that would time out.
  UPDATE public.vehicle_labor_appraisal_state SET ms = 7500, evidence_changed_at = folded_at + interval '1 second'
   WHERE vehicle_id = vid;
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s #>> '{state,basis}' = 'stored' AND s #>> '{state,label}' = 'recomputing'
                        AND s #>> '{state,fresh}' = 'false' AND (s ->> 'as_of')::timestamptz = keep.folded_at
                        AND (s - 'as_of' - 'state') = keep.read, 'slow car, stale: last stored read with as-of');
  PERFORM public.assert(public.vehicle_labor_appraisal_gauge() -> 'too_slow_to_compute_at_read' ? vid::text,
                        'gauge names the slow car with a row');
  -- the line is a rule row: half of anon's timeout today
  PERFORM public.assert((SELECT value FROM public.labor_fold_read_limits WHERE limit_key = 'stored_fold_share_of_anon_timeout') = 0.5
                        AND (SELECT length(basis) > 0 FROM public.labor_fold_read_limits WHERE limit_key = 'never_folded_image_line'),
                        'read limits are rule rows with a basis');
  UPDATE public.labor_fold_read_limits SET value = 0.6 WHERE limit_key = 'stored_fold_share_of_anon_timeout';
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now', 'the share row moves the line (9,000 ms)');
  UPDATE public.labor_fold_read_limits SET value = 0.5 WHERE limit_key = 'stored_fold_share_of_anon_timeout';
  UPDATE public.vehicle_labor_appraisal_state SET ms = 7499 WHERE vehicle_id = vid;
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now'
                        AND NOT (public.vehicle_labor_appraisal_gauge() -> 'too_slow_to_compute_at_read' ? vid::text),
                        'under half the timeout: computed now, not named');
  DELETE FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  INSERT INTO public.vehicle_labor_appraisal_state SELECT keep.*;
END $$;
RESET test.auth_role;

-- Lead condition (1): a never-folded car over the size line answers the status at once, without computing, and the
-- gauge names it while the seed has it queued. The compute is replaced by one that fails, so a compute call fails the case.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
DO $$
DECLARE vid uuid := (SELECT b.v FROM _labor_names_before b JOIN public.vehicles v ON v.id = b.v
                      WHERE v.is_public IS TRUE ORDER BY b.v LIMIT 1);
        keep public.vehicle_labor_appraisal_state%ROWTYPE; s jsonb; t0 timestamptz; ms numeric;
        d text := pg_get_functiondef('public.vehicle_labor_appraisal_compute(uuid)'::regprocedure);
        n int := (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = vid);
BEGIN
  PERFORM public.assert(n >= 1, 'fixture car has a photo: ' || n);
  SELECT * INTO keep FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  DELETE FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  UPDATE public.labor_fold_read_limits SET value = n WHERE limit_key = 'never_folded_image_line';
  EXECUTE $x$CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_compute(p_vehicle_id uuid) RETURNS jsonb
           LANGUAGE plpgsql STABLE AS $b$ BEGIN RAISE EXCEPTION 'computed at read'; END $b$ $x$;
  t0 := clock_timestamp();
  s := public.vehicle_labor_appraisal(vid);
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  PERFORM public.assert(s ->> 'status' = 'not_yet_computed' AND s #>> '{state,label}' = 'not yet computed' AND ms < 100,
                        format('never folded, over the line: status in %s ms, no compute: %s', round(ms, 1), s));
  INSERT INTO public.model_fold_signal (vehicle_id, reason, priority) VALUES (vid, 'labor_logic_key', 4);
  PERFORM public.assert(public.vehicle_labor_appraisal_gauge() -> 'too_slow_to_compute_at_read' ? vid::text,
                        'gauge names the never-folded car over the line while it is queued');
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  EXECUTE d;
  UPDATE public.labor_fold_read_limits SET value = n + 1 WHERE limit_key = 'never_folded_image_line';
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now', 'under the line: computed now');
  -- the size test is for a car with no stored read only: a folded car over the line, stale, is computed now
  INSERT INTO public.vehicle_labor_appraisal_state SELECT keep.*;
  UPDATE public.labor_fold_read_limits SET value = n WHERE limit_key = 'never_folded_image_line';
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = folded_at + interval '1 second' WHERE vehicle_id = vid;
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now', 'folded car over the line: its fold ms decides');
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = keep.evidence_changed_at WHERE vehicle_id = vid;
  UPDATE public.labor_fold_read_limits SET value = 500 WHERE limit_key = 'never_folded_image_line';
END $$;

-- An answer lands: the row goes stale and the reader serves the stored read flagged; the next fold makes it fresh.
CREATE TEMP TABLE fold_v AS SELECT b.v FROM _labor_names_before b JOIN public.vehicles v ON v.id = b.v
  WHERE v.is_public IS TRUE ORDER BY b.v LIMIT 1;
UPDATE public.evidence_judgment_requests SET answer = '{"fixture": true}'::jsonb
 WHERE id = (SELECT min(id::text)::uuid FROM public.evidence_judgment_requests WHERE vehicle_id = (SELECT v FROM fold_v));
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v); s jsonb; st public.vehicle_labor_appraisal_state%ROWTYPE; g jsonb;
BEGIN
  SELECT * INTO st FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s #>> '{state,basis}' = 'computed_now' AND s #>> '{state,computed}' = 'true'
                        AND (s #>> '{state,evidence_changed_at}')::timestamptz > (s #>> '{state,stored_at}')::timestamptz,
                        'answer stamps stale: computed now, with stored_at and evidence_changed_at');
  PERFORM public.assert((s - 'as_of' - 'state') = (public.vehicle_labor_appraisal_compute(vid) - 'as_of'),
                        'stale row: the live compute, not the stored read');
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = vid AND g.priority = 2),
                        'a labor-input signal on a car with a row is admitted at priority 2');
  PERFORM public.vehicle_labor_appraisal_fold(vid);
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'stored', 'refold makes it fresh');
  g := public.vehicle_labor_appraisal_gauge();
  PERFORM public.assert((g ->> 'stamps_answered_24h')::int >= 1 AND (g ->> 'stale_p50_s') IS NOT NULL
                        AND (g ->> 'stale_p90_s')::numeric >= (g ->> 'stale_p50_s')::numeric,
                        'gauge: stamp-to-fold seconds measured ' || g::text);
  -- A failed fold keeps the last good read and serves it with the error beside it.
  SELECT * INTO st FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = vid;
  UPDATE public.vehicle_labor_appraisal_state SET error = 'fixture_failure' WHERE vehicle_id = vid;
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s #>> '{state,error}' = 'fixture_failure' AND s #>> '{state,fresh}' = 'false'
                        AND s #>> '{state,basis}' = 'stored' AND s #>> '{state,label}' = 'recomputing'
                        AND (s - 'as_of' - 'state') = st.read, 'errored fold: last good read served with state.error');
  PERFORM public.vehicle_labor_appraisal_fold(vid);
END $$;

-- A receipt line edge: a classified_at restamp signals nothing; a changed system signals.
INSERT INTO public.receipts (id, vehicle_id) SELECT '20000000-0000-0000-0000-000000000001', v FROM fold_v;
INSERT INTO public.receipt_items (id, receipt_id)
  SELECT e.receipt_item_id, '20000000-0000-0000-0000-000000000001' FROM public.receipt_line_edges e
   WHERE e.classifier = 'system' ORDER BY e.receipt_item_id LIMIT 1 ON CONFLICT DO NOTHING;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;
DELETE FROM public.model_fold_signal;
UPDATE public.receipt_line_edges SET classified_at = now() + interval '1 hour'
 WHERE receipt_item_id = (SELECT min(id::text)::uuid FROM public.receipt_items) AND classifier = 'system';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) #>> '{state,basis}' = 'stored', 'clock-only restamp: still fresh');
END $$;
UPDATE public.receipt_line_edges SET system_key = 'paint'
 WHERE receipt_item_id = (SELECT min(id::text)::uuid FROM public.receipt_items) AND classifier = 'system';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) #>> '{state,basis}' = 'computed_now', 'changed edge: stale, computed now');
END $$;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;

-- A plain INSERT of a labor input on a car with a row stamps it and is admitted at priority 2 (the new-input path).
DELETE FROM public.model_fold_signal;
INSERT INTO public.receipts (id, vehicle_id) SELECT '20000000-0000-0000-0000-000000000002', v FROM fold_v;
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v);
BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now', 'receipt insert: stamped stale, computed now');
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal g WHERE g.vehicle_id = vid AND g.priority = 2),
                        'receipt insert: admitted at priority 2');
END $$;
-- A stamp older than 24.8 days (int milliseconds overflow) still folds and logs its wait.
UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = now() - interval '400 days',
       folded_at = now() - interval '401 days' WHERE vehicle_id = (SELECT v FROM fold_v);
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v); r jsonb;
BEGIN
  r := public.vehicle_labor_appraisal_fold(vid);
  PERFORM public.assert(NOT (r ? 'error'), 'old stamp folds: ' || r::text);
  PERFORM public.assert((SELECT wait_ms FROM public.vehicle_labor_appraisal_fold_runs WHERE vehicle_id = vid ORDER BY id DESC LIMIT 1)
                        > 400::bigint * 86400 * 1000 - 1, 'old stamp: wait logged in bigint ms');
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'stored', 'old stamp: fresh after fold');
END $$;

-- The two-session race (ta-skeptic): a stamp clocked before the fold began but committed after it carries
-- evidence_changed_at <= folded_at; its signal (same transaction) keeps the read not fresh until a fold answers it.
DO $$
DECLARE vid uuid := (SELECT v FROM fold_v); s jsonb;
BEGIN
  PERFORM public.vehicle_labor_appraisal_fold(vid);
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = folded_at - interval '1 second' WHERE vehicle_id = vid;
  INSERT INTO public.model_fold_signal (vehicle_id, reason, priority) VALUES (vid, 'late_commit_fixture', 2);
  s := public.vehicle_labor_appraisal(vid);
  PERFORM public.assert(s #>> '{state,basis}' = 'computed_now' AND s #>> '{state,queued}' = 'true', 'late-committed stamp: computed now');
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  INSERT INTO public.model_fold_work (vehicle_id, state, priority, dirty_at, first_dirty_at) VALUES (vid, 'pending', 2, now(), now());
  PERFORM public.assert(public.vehicle_labor_appraisal(vid) #>> '{state,basis}' = 'computed_now', 'absorbed into pending work: computed now');
  -- the seed leaves a pending car alone (re-signalling would push dirty_at forward and starve settle)
  UPDATE public.vehicle_labor_appraisal_state SET error = 'fixture_failure' WHERE vehicle_id = vid;
  PERFORM public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = vid), 'seed skips a pending car');
  UPDATE public.model_fold_work SET state = 'done' WHERE vehicle_id = vid;
  PERFORM public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((SELECT at FROM public.model_fold_signal WHERE vehicle_id = vid) <= now() - interval '300 seconds',
                        'seed signal is clocked settle_seconds back, claimable at the next tick');
  PERFORM public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((SELECT count(*) FROM public.model_fold_signal WHERE vehicle_id = vid) = 1, 'a second seed run adds nothing');
  DELETE FROM public.model_fold_signal WHERE vehicle_id = vid;
  DELETE FROM public.model_fold_work WHERE vehicle_id = vid;
  PERFORM public.vehicle_labor_appraisal_fold(vid);
END $$;

-- The key moves when a labor callee is replaced or a receipt line rule row is edited.
DO $$
DECLARE k0 text := public.vehicle_labor_appraisal_logic_key(); d text;
BEGIN
  PERFORM public.assert((SELECT count(*) FROM pg_proc WHERE proname = 'receipt_line_system') > 0, 'fixture has receipt_line_system');
  d := pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'receipt_line_system' LIMIT 1));
  EXECUTE regexp_replace(d, '\$function\$\s*$', '') || E'\n-- fixture edit\n$function$';
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() <> k0, 'callee replaced: key moves');
  EXECUTE d;
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() = k0, 'callee restored: key back');
  UPDATE public.receipt_line_rules SET status = status || '' WHERE rule_id = (SELECT min(rule_id) FROM public.receipt_line_rules);
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() = k0, 'no-op rule update: same key');
  CREATE TEMP TABLE rl0 AS SELECT * FROM public.receipt_line_rules;
  UPDATE public.receipt_line_rules SET status = 'retired_fixture' WHERE rule_id = (SELECT min(rule_id) FROM public.receipt_line_rules);
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() <> k0, 'receipt_line_rules edit: key moves');
  UPDATE public.receipt_line_rules r SET status = r0.status FROM rl0 r0 WHERE r0.rule_id = r.rule_id;
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() = k0, 'rule restored: key back');
END $$;

-- A classifier that starts calling an unlisted function: the closure check names it and the gauge reports it.
CREATE FUNCTION public.labor_fixture_helper() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
DO $$
DECLARE d text := pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'receipt_line_system' LIMIT 1));
BEGIN
  PERFORM public.assert(public.labor_fold_logic_unlisted() IS NULL, 'closure complete before the edit');
  EXECUTE regexp_replace(d, '\$function\$\s*$', '') || E'\n-- calls labor_fixture_helper() now\n$function$';
  PERFORM public.assert(public.labor_fold_logic_unlisted() LIKE '%labor_fixture_helper (called by receipt_line_system)%',
                        'unlisted callee named: ' || coalesce(public.labor_fold_logic_unlisted(), 'null'));
  PERFORM public.assert(public.vehicle_labor_appraisal_gauge() ->> 'unlisted_callees' LIKE '%labor_fixture_helper%', 'gauge reports it');
  EXECUTE d;
END $$;
DROP FUNCTION public.labor_fixture_helper();

-- A no-op update keeps the key; a rule row edit moves it, every row is stale, and the seed signals them again.
CREATE TEMP TABLE key0 AS SELECT public.vehicle_labor_appraisal_logic_key() AS k;
UPDATE public.labor_hours_bases SET meaning = meaning WHERE basis_key = 'uncited_seed';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() = (SELECT k FROM key0), 'no-op update: same key');
END $$;
UPDATE public.labor_hours_bases SET meaning = meaning || ' (fixture edit)' WHERE basis_key = 'uncited_seed';
DO $$ BEGIN
  PERFORM public.assert(public.vehicle_labor_appraisal((SELECT v FROM fold_v)) #>> '{state,key_current}' = 'false'
                        AND public.vehicle_labor_appraisal((SELECT v FROM fold_v)) #>> '{state,basis}' = 'computed_now'
                        AND public.vehicle_labor_appraisal((SELECT v FROM fold_v)) ? 'segments', 'rule change: computed now, flagged off key');
  PERFORM public.assert(public.vehicle_labor_appraisal_logic_key() <> (SELECT k FROM key0), 'rule edit: key moves');
  PERFORM public.assert((public.vehicle_labor_appraisal_gauge() ->> 'off_key')::int > 0, 'gauge: rows off key after the edit');
  DELETE FROM public.model_fold_signal;
  PERFORM public.assert((public.vehicle_labor_appraisal_enqueue() ->> 'queued')::int > 0, 'rule change: seed signals again');
  PERFORM public.assert((public.vehicle_labor_appraisal_enqueue() ->> 'queued')::int = 0, 'seed does not signal a car twice');
END $$;
SELECT public.vehicle_labor_appraisal_fold(v) FROM fold_v;

-- Privacy: the stored read is the logged-out form. Production auth.role()/auth.uid() (request claims) and the live
-- privacy chain (vehicle_image_privacy_withheld, image_stage_custody_external, vehicle_viewer_tied, the gallery test's
-- privacy clause, definitions read 2026-11-25) replace the fixture stubs from here on.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS is_external boolean, ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS exif_data jsonb;
CREATE OR REPLACE FUNCTION public.image_stage_custody_external(p_is_external boolean, p_user_id uuid, p_source text, p_exif jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  select case
    when p_is_external is not true then false
    when p_user_id is not null and p_source = 'iphoto'
         and p_exif -> 'source_rendition' ->> 'contract' = 'photos_cached_preview_v1' then false
    else true
  end $function$;
CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN (SELECT auth.role()) = 'service_role' THEN true WHEN (SELECT auth.uid()) IS NULL THEN false ELSE false END $$;
CREATE OR REPLACE FUNCTION public.vehicle_image_privacy_withheld(p_image_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT CASE
    WHEN (SELECT auth.role()) = 'service_role' THEN false
    WHEN (SELECT auth.role()) IS NULL AND session_user <> 'authenticator' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.photo_extracted_fields f
      JOIN public.image_privacy_rules r
        ON r.field_name = f.field_name AND r.enabled AND r.applies_to = 'custody'
      JOIN public.vehicle_images i ON i.id = f.image_id
      WHERE f.image_id = p_image_id
        AND length(regexp_replace(upper(f.value), '[^A-Z0-9]', '', 'g')) >= r.min_alnum
        AND NOT public.image_stage_custody_external(i.is_external, i.user_id, i.source, i.exif_data)
        AND i.user_id IS DISTINCT FROM (SELECT auth.uid())
        AND NOT public.vehicle_viewer_tied(i.vehicle_id))
  END $function$;
DO $$
DECLARE d text := pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images)'::regprocedure);
BEGIN
  d := regexp_replace(d, '\s*\$function\$\s*$', E'\n     AND NOT public.vehicle_image_privacy_withheld(($1).id)\n$function$');
  EXECUTE d;
END $$;

DO $$
DECLARE
  car uuid := '10000000-0000-0000-0000-000000000001';
  img uuid := 'a0000000-0000-0000-0000-000000000020';
  before_signals int;
BEGIN
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) LIKE '%' || img || '%',
                        'privacy: the photo is in the stored read before it is withheld');
  -- the uploader's own camera photo (is_external false) with a keyed plate reading: withheld from a visitor
  UPDATE public.vehicle_images SET is_external = false, user_id = '99000000-0000-0000-0000-000000000001' WHERE id = img;
  INSERT INTO public.image_privacy_rules (rule_key, field_name, min_alnum, applies_to, enabled) VALUES ('plate', 'plate', 5, 'custody', true);
  DELETE FROM public.model_fold_signal;
  INSERT INTO public.photo_extracted_fields (image_id, field_name, value) VALUES (img, 'plate', 'FIX 1234');
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car AND reason = 'labor_photo_extracted_fields_insert'),
                        'privacy: a reading under a privacy rule signals the photo''s car');
  PERFORM public.assert(NOT public.vehicle_image_privacy_withheld(img), 'privacy: a session with no claims sees the photo (the hole)');
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM public.assert(public.vehicle_image_privacy_withheld(img), 'privacy: anon does not');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) NOT LIKE '%' || img || '%',
                        'privacy: the fold stores the logged-out form (photo absent)');
  PERFORM public.assert(coalesce(current_setting('request.jwt.claims', true), '') = ''
                        AND coalesce(current_setting('request.jwt.claim.role', true), '') = '',
                        'privacy: the fold puts the caller''s claims back');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert(current_setting('request.jwt.claims', true) = '{"role":"service_role"}',
                        'privacy: a service caller''s claims come back too');
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) NOT LIKE '%' || img || '%',
                        'privacy: a service-role fold still stores the logged-out form');
  PERFORM set_config('request.jwt.claims', '', true);
  -- a correction that drops the reading below the rule signals again
  DELETE FROM public.model_fold_signal;
  UPDATE public.photo_extracted_fields SET value = 'X1' WHERE image_id = img;
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car AND reason = 'labor_photo_extracted_fields_update'),
                        'privacy: a corrected reading signals');
  UPDATE public.photo_extracted_fields SET created_at = created_at;
  PERFORM public.assert((SELECT count(*) FROM public.model_fold_signal WHERE reason = 'labor_photo_extracted_fields_update') = 1,
                        'privacy: an update that changes no reading signals nothing');
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) LIKE '%' || img || '%',
                        'privacy: below the rule the photo is back');
END $$;

-- The seed (20261125213000): a stored read citing a photo a visitor may no longer see is re-folded, and a car already
-- waiting in model_fold_work behind other work is lowered to the seed's priority with its clocks kept.
DO $$
DECLARE
  car uuid := '10000000-0000-0000-0000-000000000001';
  img uuid := 'a0000000-0000-0000-0000-000000000020';
  r jsonb;
  t0 timestamptz := '2026-11-25 10:28:03+00';
BEGIN
  -- custody moves on vehicle_images alone, which signals nothing
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  UPDATE public.vehicle_images SET is_external = true WHERE id = img;
  UPDATE public.photo_extracted_fields SET value = 'FIX 1234' WHERE image_id = img;
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) LIKE '%' || img || '%',
                        'custody: an outside photo with a plate reading is in the stored read');
  DELETE FROM public.model_fold_signal;
  DELETE FROM public.model_fold_work WHERE vehicle_id = car;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car) AND (r ->> 'cites_withheld_photo')::int = 0,
                        'custody: a fresh read citing only shown photos is not seeded: ' || r::text);
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  UPDATE public.vehicle_images SET is_external = false WHERE id = img;
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car), 'custody: the photo row change signals nothing');
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert(EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car AND reason = 'labor_logic_key')
                        AND (r ->> 'cites_withheld_photo')::int = 1, 'custody: the seed signals a read citing a withheld photo: ' || r::text);
  PERFORM public.assert(coalesce(current_setting('request.jwt.claims', true), '') = '', 'custody: the seed puts the caller''s claims back');
  DELETE FROM public.model_fold_signal;
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.assert((SELECT read::text FROM public.vehicle_labor_appraisal_state WHERE vehicle_id = car) NOT LIKE '%' || img || '%',
                        'custody: the re-fold drops the photo');
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car), 'custody: then nothing to seed');

  -- ta-skeptic must-fix: a cited photo moved to another car, or marked sensitive, is withheld too. The photo is shown
  -- first (outside custody), so only the car test or the sensitive flag can withhold it.
  UPDATE public.vehicle_images SET is_external = true WHERE id = img;
  UPDATE public.vehicle_labor_appraisal_state SET read = jsonb_set(read, '{segments}',
           (read -> 'segments') || jsonb_build_array(jsonb_build_object('fixture_cite', jsonb_build_object('image_id', img::text))))
       , read_hash = NULL  -- a tampered fixture read; the fold keeps a read whose hash is unchanged
   WHERE vehicle_id = car;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 0, 'custody: the shown photo cited on its own car is not withheld: ' || r::text);
  DELETE FROM public.model_fold_signal;
  UPDATE public.vehicle_images SET vehicle_id = '10000000-0000-0000-0000-000000000002' WHERE id = img;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 1, 'custody: a cited photo moved to another car is withheld: ' || r::text);
  UPDATE public.vehicle_images SET vehicle_id = car, is_sensitive = true WHERE id = img;
  DELETE FROM public.model_fold_signal;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 1, 'custody: a cited photo marked sensitive is withheld: ' || r::text);
  UPDATE public.vehicle_images SET is_sensitive = false WHERE id = img;
  DELETE FROM public.model_fold_signal;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 0, 'custody: back on its car, not sensitive: shown again: ' || r::text);
  -- should-fix (a): one non-uuid image_id string counts as withheld and does not fail the run
  UPDATE public.vehicle_labor_appraisal_state SET read = jsonb_set(read, '{segments}',
           (read -> 'segments') || '[{"fixture_cite": {"image_id": "not-a-uuid"}}]'::jsonb)
       , read_hash = NULL  -- a tampered fixture read; the fold keeps a read whose hash is unchanged
   WHERE vehicle_id = car;
  DELETE FROM public.model_fold_signal;
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 1, 'custody: a non-uuid image_id is withheld, the run survives: ' || r::text);
  DELETE FROM public.model_fold_signal;
  PERFORM public.vehicle_labor_appraisal_fold(car);
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((r ->> 'cites_withheld_photo')::int = 0 AND NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car),
                        'custody: re-fold clears the fixture citations: ' || r::text);
  -- should-fix (b): the bump is capped at p_limit
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = folded_at + interval '1 second';
  INSERT INTO public.model_fold_work (vehicle_id, state, priority, reasons, dirty_at, first_dirty_at, next_attempt_at)
  SELECT s.vehicle_id, 'pending', 9, '{sweep}', t0, t0, t0 FROM public.vehicle_labor_appraisal_state s
   WHERE NOT EXISTS (SELECT 1 FROM public.model_fold_work w WHERE w.vehicle_id = s.vehicle_id);
  PERFORM public.assert((SELECT count(*) FROM public.model_fold_work WHERE state = 'pending' AND priority = 9) >= 2, 'cap: two waiting cars');
  r := public.vehicle_labor_appraisal_enqueue(1);
  PERFORM public.assert((r ->> 'raised')::int = 1, 'cap: p_limit 1 raises one waiting car: ' || r::text);
  DELETE FROM public.model_fold_work WHERE dirty_at = t0;
  DELETE FROM public.model_fold_signal;
  PERFORM public.vehicle_labor_appraisal_fold(s.vehicle_id) FROM public.vehicle_labor_appraisal_state s;
  DELETE FROM public.model_fold_signal;

  -- a stale car waiting at priority 9 is lowered to 4; its clocks stay; no second signal
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = folded_at + interval '1 second' WHERE vehicle_id = car;
  INSERT INTO public.model_fold_work (vehicle_id, state, priority, reasons, dirty_at, first_dirty_at, next_attempt_at)
  VALUES (car, 'pending', 9, '{sweep}', t0, t0, t0 + interval '5 minutes');
  r := public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((SELECT priority = 4 AND reasons = '{labor_logic_key,sweep}' AND dirty_at = t0 AND first_dirty_at = t0
                                AND next_attempt_at = t0 + interval '5 minutes' FROM public.model_fold_work WHERE vehicle_id = car)
                        AND (r ->> 'raised')::int = 1 AND NOT EXISTS (SELECT 1 FROM public.model_fold_signal WHERE vehicle_id = car),
                        'priority: a waiting stale car is lowered to 4, clocks kept, not re-signalled: ' || r::text);
  UPDATE public.model_fold_work SET priority = 9, state = 'leased' WHERE vehicle_id = car;
  PERFORM public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((SELECT priority FROM public.model_fold_work WHERE vehicle_id = car) = 9, 'priority: a leased row is left alone');
  UPDATE public.model_fold_work SET state = 'pending' WHERE vehicle_id = car;
  -- one transaction has one now(): clear the stamp set a second ahead of it, then fold
  UPDATE public.vehicle_labor_appraisal_state SET evidence_changed_at = NULL WHERE vehicle_id = car;
  PERFORM public.vehicle_labor_appraisal_fold(car);
  PERFORM public.vehicle_labor_appraisal_enqueue();
  PERFORM public.assert((SELECT priority FROM public.model_fold_work WHERE vehicle_id = car) = 9, 'priority: a fresh car keeps its place');
  DELETE FROM public.model_fold_work WHERE vehicle_id = car;
END $$;

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
  PERFORM public.assert(NOT has_table_privilege('anon', 'public.vehicle_labor_appraisal_fold_runs', 'SELECT'), 'anon cannot read fold runs');
  PERFORM public.assert(position('labor_fold_v1' IN pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure)) > 0
                        AND position('labor_fold_v1' IN pg_get_functiondef('public.model_fold_signal_ids(uuid[],text)'::regprocedure)) > 0,
                        'both model fold functions patched once');
END $$;
\echo labor_fold: ok
