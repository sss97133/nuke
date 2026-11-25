-- model_fold_signal_tiers_v1: the model fold hears a change on any car; scope becomes a priority, not a gate.
--
-- WHY. Owner: "Programmatic means i ask for this car but we implement the same goals triggers loops and graphs to make
-- the same happen for all others." Every model_fold_signal writer admitted a car only through model_fold_in_scope
-- (config scopes = [pontiac_f_body], 15,808 cars), so a change on any other car was never re-folded. Measured
-- 2026-11-25 over 24 h: 124 signals; 16,665 folds, every one an F-body car.
--
-- ROWS.
--   model_fold_signal.priority          the queue priority a signal asks for (absorb keeps the lowest number).
--   model_fold_priority_tiers           rule rows: tier 2..9 and the basis a car must meet for it, one per row:
--                                        min_keyed_witnesses over counted_classes (grade rows of the car witnessed by a
--                                        keyed class: decode, registered photo reading, paper receipt), or min_photos
--                                        (vehicles.image_count), or neither (any car). Tier 1 = the config scopes.
--                                        Queue order only; nothing reads a tier as truth.
--   model_fold_config.signal_tiers_max  the widest tier admitted. 1 here = today's behaviour exactly. Widening is this
--                                        config value (2, then 3, then 4), each after the queue gauge shows a day of
--                                        fold ms and queue age at the previous one; never before the grade backfill ends.
-- WRITERS CHANGED. model_fold_signal_ids, model_fold_vehicles_signal, vehicle_facet_grades_evidence_changed (#3862)
--   and the comment-edit branch of model_fold_rows_signal take the car's tier from model_fold_signal_priority and drop the make gate; the
--   origin-update and image triggers call model_fold_signal_ids, so they follow. model_fold_absorb_signals writes the
--   lowest priority of a car's signals (a pending row keeps the lower of its own and the signal's).
-- DEFAULT. model_fold_signal.priority defaults to 9: a writer that names no priority queues last, not first
--   (ta-skeptic M2). Rows waiting at migration time keep 1 (they are all config-scope signals).
-- R1 (ta-skeptic on #3862). Every car passed to model_fold_signal_ids, and every vehicles update, stamps
--   vehicle_facet_grade_folds.evidence_changed_at, whatever its tier and whether signals are on, so a folded facet grade
--   is never read past a change to any of the car's sources. A stamped car must fold again or its overlay is off for
--   good, so a car holding a vehicle_facet_grade_folds row is signalled even when its tier is not admitted, at
--   priority 9, the lowest (only the #3862 facet-fold cars: ~46k with vehicle_field_evidence rows).
-- NOT CHANGED. model_fold_sweep (the logic-key re-lap) stays on the config scopes; model_fold_in_scope is still what
--   it reads. Decoding (decode_scopes) is unchanged; outside it a fold re-plans membership and grades.
-- CAPACITY (board 2026-11-25 22:3x PT). Ceiling ~82k folds/day at 210 ms a fold; cars changed a day 8.9k measured
--   (observations, comments, new cars), up to ~35k with field_evidence and vehicles updates (2% samples).
-- REVERT. Restore the five function bodies from 20261124040000 / 20261124045000 (or set signal_tiers_max 1, which is
--   the old behaviour); the column, table and gauge can stay.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.model_fold_signal ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 1;
ALTER TABLE public.model_fold_signal ALTER COLUMN priority SET DEFAULT 9;

CREATE TABLE IF NOT EXISTS public.model_fold_priority_tiers (
  tier smallint PRIMARY KEY CHECK (tier BETWEEN 2 AND 9),
  min_keyed_witnesses integer CHECK (min_keyed_witnesses >= 1),
  counted_classes text[] CHECK (counted_classes <@ ARRAY['decode', 'reading_registered', 'receipt']),
  min_photos integer CHECK (min_photos >= 1),
  note text NOT NULL CHECK (length(btrim(note)) >= 12),
  CHECK ((min_keyed_witnesses IS NULL) = (counted_classes IS NULL)),
  CHECK (num_nonnulls(min_keyed_witnesses, min_photos) <= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.model_fold_priority_tiers IS
  'model_fold_signal_tiers_v1: queue order only. A car outside the fold scopes gets the lowest tier whose basis it meets: min_keyed_witnesses = grade rows of the car (data_set_member_grades) whose witness_classes overlap counted_classes; min_photos = vehicles.image_count; neither = any car. Admitted when tier <= model_fold_config.signal_tiers_max.';
ALTER TABLE public.model_fold_priority_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_fold_priority_tiers_read ON public.model_fold_priority_tiers;
CREATE POLICY model_fold_priority_tiers_read ON public.model_fold_priority_tiers FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.model_fold_priority_tiers FROM anon, authenticated;
GRANT SELECT ON public.model_fold_priority_tiers TO anon, authenticated;
GRANT ALL ON public.model_fold_priority_tiers TO service_role;
INSERT INTO public.model_fold_priority_tiers (tier, min_keyed_witnesses, counted_classes, min_photos, note) VALUES
  (2, 1, ARRAY['decode', 'reading_registered', 'receipt'], NULL,
   'queue priority, not truth. Basis: cars with at least one grade row witnessed by a keyed class (VIN/code decode, registered photo reading, paper receipt). Measured 2026-11-25 over the cars graded so far (backfill ~27%): 1,315 cars, 5,021 rows; per car p50 4, max 13. Fleet-wide grade witness entries are 436,638 mentioned, 249,929 claim, 4,621 decode, 41 photo reading, so keyed evidence is thin and this tier is small.'),
  (3, NULL, NULL, 20,
   'queue priority, not truth. Basis (fallback while keyed evidence is thin): cars with 20+ photos (vehicles.image_count), the cars a photo read could key. 1% sample 2026-11-25: ~428k of ~1.08M public cars (~789k with any photo, ~218k with 100+).'),
  (4, NULL, NULL, NULL, 'queue priority, not truth. Basis: every remaining car; folded last, on change only.')
ON CONFLICT (tier) DO NOTHING;

UPDATE public.platform_config SET config_value = config_value || '{"signal_tiers_max": 1}'::jsonb, updated_at = now()
 WHERE config_key = 'model_fold' AND NOT (config_value ? 'signal_tiers_max');

-- The tier a change on this car asks for, or NULL when it is not admitted (tier above p_max, or the excluded id).
CREATE OR REPLACE FUNCTION public.model_fold_signal_priority(p_id uuid, p_make text, p_model text, p_vin text, p_year integer,
                                                              p_max integer)
RETURNS smallint LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE t smallint;
BEGIN
  IF p_id IS NULL OR p_id::text LIKE '9cf5b7a4%' THEN RETURN NULL; END IF;
  IF public.model_fold_in_scope(p_make, p_model, p_vin, p_year, p_id) THEN RETURN 1; END IF;
  IF coalesce(p_max, 1) < 2 THEN RETURN NULL; END IF;
  SELECT r.tier INTO t FROM public.model_fold_priority_tiers r
   WHERE (r.min_keyed_witnesses IS NULL AND r.min_photos IS NULL)
      OR (r.min_keyed_witnesses IS NOT NULL
          AND (SELECT count(*) FROM public.data_set_member_grades g
                WHERE g.vehicle_id = p_id AND g.witness_classes && r.counted_classes) >= r.min_keyed_witnesses)
      OR (r.min_photos IS NOT NULL
          AND (SELECT coalesce(v.image_count, 0) FROM public.vehicles v WHERE v.id = p_id) >= r.min_photos)
   ORDER BY r.tier LIMIT 1;
  RETURN CASE WHEN t <= p_max THEN t END;
END $$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.model_fold_vehicles_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_max int; v_pr smallint;
begin
  begin
    -- model_fold_signal_tiers_v1 (R1)
    if tg_op = 'UPDATE' then
      update public.vehicle_facet_grade_folds set evidence_changed_at = clock_timestamp() where vehicle_id = new.id;
    end if;
    if public.model_fold_signals_on() then
      v_max := coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1);
      v_pr := least(public.model_fold_signal_priority(new.id, new.make, new.model, new.vin, new.year, v_max),
                    case when tg_op = 'UPDATE'
                         then public.model_fold_signal_priority(old.id, old.make, old.model, old.vin, old.year, v_max) end);
      if v_pr is null and tg_op = 'UPDATE' and new.id::text not like '9cf5b7a4%'
         and exists (select 1 from public.vehicle_facet_grade_folds f where f.vehicle_id = new.id) then
        v_pr := 9;
      end if;
      if v_pr is not null then
        insert into public.model_fold_signal (vehicle_id, reason, priority) values (new.id, 'vehicle_' || lower(tg_op), v_pr);
      end if;
    end if;
  exception when others then
    raise warning 'model_fold signal skipped (vehicles): %', sqlerrm;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.model_fold_absorb_signals(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with s as (
    delete from public.model_fold_signal where id in (select id from public.model_fold_signal order by id limit p_limit)
    returning vehicle_id, reason, origin_id, at, priority),
  g as (select vehicle_id, array_agg(distinct reason) reasons, min(at) f, max(at) l, min(priority) pr,
               coalesce(array_agg(distinct origin_id) filter (where origin_id is not null), '{}') edited
          from s group by vehicle_id)
  insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at, edited_origins)
  select vehicle_id, pr, reasons, f, l, now(), edited from g
  on conflict (vehicle_id) do update set
    -- model_fold_signal_tiers_v1: the signal's tier; a pending row keeps the more urgent of the two
    priority = case when w.state in ('done','dead') then excluded.priority else least(w.priority, excluded.priority) end,
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
end $function$;

-- The comment-edit branch of model_fold_rows_signal writes its own signal rows: same tier rule, no make gate.
DO $patch$
DECLARE
  d text;
  a1 text := E'      insert into public.model_fold_signal (vehicle_id, reason, origin_id)\n'
          || E'      select n.vehicle_id, ''auction_comment_edit'', n.id\n'
          || E'        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id\n'
          || E'       where o.comment_text is distinct from n.comment_text\n'
          || E'         and public.model_fold_in_scope(v.make, v.model, v.vin, v.year, v.id);\n';
  a0 text := E'    if not public.model_fold_signals_on() then return null; end if;\n';
  r0 text := E'    -- model_fold_signal_tiers_v1: no early return; model_fold_signal_ids stamps facet folds whether signals are on\n'
          || E'    -- and checks signals_on itself before it inserts.\n';
  r1 text := E'      if public.model_fold_signals_on() then\n'
          || E'      insert into public.model_fold_signal (vehicle_id, reason, origin_id, priority) /* model_fold_signal_tiers_v1 */\n'
          || E'      select n.vehicle_id, ''auction_comment_edit'', n.id, p.pr\n'
          || E'        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id\n'
          || E'        cross join lateral (select public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year,\n'
          || E'          coalesce((public.model_fold_config() ->> ''signal_tiers_max'')::int, 1)) as pr) p\n'
          || E'       where o.comment_text is distinct from n.comment_text\n'
          || E'         and p.pr is not null;\n'
          || E'      end if;\n';
  n int;
BEGIN
  d := pg_get_functiondef('public.model_fold_rows_signal()'::regprocedure);
  IF position('model_fold_signal_tiers_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'model_fold_rows_signal comment-edit anchor drifted: % matches', n; END IF;
  n := (length(d) - length(replace(d, a0, ''))) / length(a0);
  IF n <> 1 THEN RAISE EXCEPTION 'model_fold_rows_signal signals-off return drifted: % matches', n; END IF;
  EXECUTE replace(replace(d, a1, r1), a0, r0);
END $patch$;

-- #3862's vehicle_field_evidence trigger: same tier rule, the excluded id skipped, a fold car with no admitted tier at 9.
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_evidence_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids uuid[]; v_max int;
BEGIN
  IF tg_op = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.vehicle_id) INTO v_ids FROM new_rows n WHERE n.vehicle_id IS NOT NULL;
  ELSIF tg_op = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.vehicle_id) INTO v_ids FROM old_rows o WHERE o.vehicle_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT x) INTO v_ids
      FROM (SELECT o.vehicle_id AS x FROM old_rows o UNION SELECT n.vehicle_id FROM new_rows n) z WHERE x IS NOT NULL;
  END IF;
  IF v_ids IS NULL THEN RETURN NULL; END IF;
  UPDATE public.vehicle_facet_grade_folds SET evidence_changed_at = clock_timestamp() WHERE vehicle_id = ANY (v_ids);
  BEGIN
    IF public.model_fold_signals_on() THEN
      v_max := coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1);
      -- model_fold_signal_tiers_v1: a car with vehicle_field_evidence is in facet scope, so it is always signalled;
      -- its priority is its tier when admitted, else 9.
      INSERT INTO public.model_fold_signal (vehicle_id, reason, priority)
      SELECT v.id, 'vehicle_field_evidence_' || lower(tg_op),
             coalesce(public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year, v_max), 9)
        FROM public.vehicles v WHERE v.id = ANY (v_ids) AND v.id::text NOT LIKE '9cf5b7a4%';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'facet grade refold signal skipped: %', sqlerrm;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.vehicle_facet_grades_evidence_changed() FROM PUBLIC, anon, authenticated;

-- Queue by priority, measured: pending, oldest dirty, and the fold's last 24 h.
CREATE OR REPLACE FUNCTION public.model_fold_queue_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '8s' AS $$
  SELECT jsonb_build_object(
    'signal_tiers_max', coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1),
    'tiers', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'min_keyed_witnesses', min_keyed_witnesses,
                                                   'counted_classes', counted_classes, 'min_photos', min_photos) ORDER BY tier)
                FROM public.model_fold_priority_tiers),
    'queue', (SELECT jsonb_object_agg(q.priority::text, jsonb_build_object('pending', q.pending, 'leased', q.leased, 'dead', q.dead,
                       'done', q.done, 'oldest_pending_dirty_at', q.oldest))
                FROM (SELECT priority, count(*) FILTER (WHERE state = 'pending') pending, count(*) FILTER (WHERE state = 'leased') leased,
                             count(*) FILTER (WHERE state = 'dead') dead, count(*) FILTER (WHERE state = 'done') done,
                             min(dirty_at) FILTER (WHERE state = 'pending') oldest
                        FROM public.model_fold_work GROUP BY priority) q),
    'signals_waiting', (SELECT count(*) FROM public.model_fold_signal),
    'ticks_24h', (SELECT jsonb_build_object('runs', count(*), 'folded', sum(folded), 'signals', sum(signals),
                           'ms_avg', round(avg(ms)), 'skipped', count(*) FILTER (WHERE status = 'skipped'))
                    FROM public.model_fold_ticks WHERE started_at > now() - interval '24 hours'),
    'fold_ms_24h', (SELECT jsonb_build_object('n', count(*), 'avg', round(avg(r.ms)),
                             'p90', percentile_disc(0.9) WITHIN GROUP (ORDER BY r.ms))
                      FROM public.model_fold_tick_runs r JOIN public.model_fold_ticks t ON t.tick_id = r.tick_id
                     WHERE t.started_at > now() - interval '24 hours'),
    'counted_at', now())
$$;
REVOKE ALL ON FUNCTION public.model_fold_signal_priority(uuid, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.model_fold_queue_gauge() TO anon, authenticated, service_role;
