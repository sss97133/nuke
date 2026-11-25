-- model_fold_signal_tiers_v1: the model fold hears a change on any car; scope becomes a priority, not a gate.
--
-- WHY. Owner: "Programmatic means i ask for this car but we implement the same goals triggers loops and graphs to make
-- the same happen for all others." Every model_fold_signal writer admitted a car only through model_fold_in_scope
-- (config scopes = [pontiac_f_body], 15,808 cars), so a change on any other car was never re-folded. Measured
-- 2026-11-25 over 24 h: 124 signals; 16,665 folds, every one an F-body car.
--
-- ROWS.
--   model_fold_signal.priority          the queue priority a signal asks for (absorb keeps the lowest number).
--   model_fold_priority_tiers           rule rows: tier 2..9 and the keyed witnesses a car needs for it
--                                        (sum of data_set_member_grades.n_witnesses). Tier 1 = the config scopes.
--   model_fold_config.signal_tiers_max  the widest tier admitted. 1 here = today's behaviour exactly. Widening is this
--                                        config value (2, then 3, then 4), each after the queue gauge shows a day of
--                                        fold ms and queue age at the previous one; never before the grade backfill ends.
-- WRITERS CHANGED. model_fold_signal_ids, model_fold_vehicles_signal and the comment-edit branch of
--   model_fold_rows_signal take the car's tier from model_fold_signal_priority and drop the make gate; the
--   origin-update and image triggers call model_fold_signal_ids, so they follow. model_fold_absorb_signals writes the
--   lowest priority of a car's signals (a pending row keeps the lower of its own and the signal's).
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

CREATE TABLE IF NOT EXISTS public.model_fold_priority_tiers (
  tier smallint PRIMARY KEY CHECK (tier BETWEEN 2 AND 9),
  min_keyed_witnesses integer NOT NULL CHECK (min_keyed_witnesses >= 0),
  note text NOT NULL CHECK (length(btrim(note)) >= 12),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.model_fold_priority_tiers IS
  'model_fold_signal_tiers_v1: a car outside the fold scopes gets the lowest tier whose min_keyed_witnesses it meets (sum of data_set_member_grades.n_witnesses). Admitted when tier <= model_fold_config.signal_tiers_max.';
ALTER TABLE public.model_fold_priority_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_fold_priority_tiers_read ON public.model_fold_priority_tiers;
CREATE POLICY model_fold_priority_tiers_read ON public.model_fold_priority_tiers FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.model_fold_priority_tiers FROM anon, authenticated;
GRANT SELECT ON public.model_fold_priority_tiers TO anon, authenticated;
GRANT ALL ON public.model_fold_priority_tiers TO service_role;
INSERT INTO public.model_fold_priority_tiers (tier, min_keyed_witnesses, note) VALUES
  (2, 20, 'cars with 20+ keyed witnesses: 4,546 of 180,154 graded on 2026-11-25'),
  (3, 5, 'cars with 5+ keyed witnesses: 74,328 of 180,154 graded on 2026-11-25'),
  (4, 0, 'every other car')
ON CONFLICT (tier) DO NOTHING;

UPDATE public.platform_config SET config_value = config_value || '{"signal_tiers_max": 1}'::jsonb, updated_at = now()
 WHERE config_key = 'model_fold' AND NOT (config_value ? 'signal_tiers_max');

-- The tier a change on this car asks for, or NULL when it is not admitted (tier above p_max, or the excluded id).
CREATE OR REPLACE FUNCTION public.model_fold_signal_priority(p_id uuid, p_make text, p_model text, p_vin text, p_year integer,
                                                              p_max integer)
RETURNS smallint LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE w bigint; t smallint;
BEGIN
  IF p_id IS NULL OR p_id::text LIKE '9cf5b7a4%' THEN RETURN NULL; END IF;
  IF public.model_fold_in_scope(p_make, p_model, p_vin, p_year, p_id) THEN RETURN 1; END IF;
  IF coalesce(p_max, 1) < 2 THEN RETURN NULL; END IF;
  SELECT coalesce(sum(g.n_witnesses), 0) INTO w FROM public.data_set_member_grades g WHERE g.vehicle_id = p_id;
  SELECT r.tier INTO t FROM public.model_fold_priority_tiers r WHERE r.min_keyed_witnesses <= w ORDER BY r.tier LIMIT 1;
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
  r1 text := E'      insert into public.model_fold_signal (vehicle_id, reason, origin_id, priority) /* model_fold_signal_tiers_v1 */\n'
          || E'      select n.vehicle_id, ''auction_comment_edit'', n.id, p.pr\n'
          || E'        from old_rows o join new_rows n on n.id = o.id join public.vehicles v on v.id = n.vehicle_id\n'
          || E'        cross join lateral (select public.model_fold_signal_priority(v.id, v.make, v.model, v.vin, v.year,\n'
          || E'          coalesce((public.model_fold_config() ->> ''signal_tiers_max'')::int, 1)) as pr) p\n'
          || E'       where o.comment_text is distinct from n.comment_text\n'
          || E'         and p.pr is not null;\n';
  n int;
BEGIN
  d := pg_get_functiondef('public.model_fold_rows_signal()'::regprocedure);
  IF position('model_fold_signal_tiers_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'model_fold_rows_signal comment-edit anchor drifted: % matches', n; END IF;
  EXECUTE replace(d, a1, r1);
END $patch$;

-- Queue by priority, measured: pending, oldest dirty, and the fold's last 24 h.
CREATE OR REPLACE FUNCTION public.model_fold_queue_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '8s' AS $$
  SELECT jsonb_build_object(
    'signal_tiers_max', coalesce((public.model_fold_config() ->> 'signal_tiers_max')::int, 1),
    'tiers', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'min_keyed_witnesses', min_keyed_witnesses) ORDER BY tier)
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
