-- The capture ledger's day rows and totals count every state a photo can be in, so a day's counts add up to its photos
-- taken.
--
-- Why. get_capture_ledger counts each photo of the signed-in owner by its state from capture_ledger_states, one count
-- per state, per day and in the totals. The states reader returns twelve states; the ledger counted nine of them
-- (on_vehicle, unverified, waiting, held, pulled, private, unsorted, failed, duplicate). A photo in the other three was
-- inside "taken" and in no count:
--  - no_file: a phone record whose picture never left the phone (reason empty_url_relay);
--  - non_vehicle: a photo reviewed as showing no vehicle;
--  - junk: a placeholder or test address.
-- So a day's counts fell short of its taken, and neither the web page nor the phone could say how many pictures stayed
-- on the phone.
-- Change: day rows and totals each gain three integer keys, no_file, non_vehicle and junk (0 when none), counted with
-- the same count(*) FILTER as the other states, in the same scans (CTEs day_frames, per_day and tot). Every existing key
-- keeps its value; the signature, return type, language, volatility, SECURITY setting, SET clause, day order and limit
-- are unchanged, and CREATE OR REPLACE keeps the owner and grants (checked after the replace).
-- The body below is production's live body of 2026-11-21 (pg_get_functiondef) with those five lines added (and a
-- comma after the two lines they follow). The
-- migration refuses unless the live body is the one it was written from (md5 of prosrc) or already this one, so a body
-- changed in between is never overwritten; a replay replaces the body with itself.
-- Contract: supabase/sql/test_capture_ledger_buckets_add_up.sql
-- Revert: supabase/sql/revert_20261122004200_capture_ledger_buckets_add_up.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)');
  if v_md5 is null then raise exception 'public.get_capture_ledger(text,date,date,integer) is not live'; end if;
  if v_md5 not in ('933b34c957f1014110284ccc2dc88eae', 'b01cd915a4959c256e1e1e4b315b1fb7') then
    raise exception 'public.get_capture_ledger is not the body this migration was written against (md5 %); refusing to replace it', v_md5;
  end if;
  -- what must not move: owner, grants, security setting, volatility, language, SET clauses, arguments, return type
  perform set_config('capture_ledger_buckets.attrs', (
    select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname, p.proconfig::text,
                     pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)')), true);
end $do$;

CREATE OR REPLACE FUNCTION public.get_capture_ledger(p_tz text DEFAULT 'America/Los_Angeles'::text, p_from date DEFAULT (CURRENT_DATE - 365), p_to date DEFAULT NULL::date, p_limit integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH uid AS (SELECT auth.uid() AS id),
  fr AS MATERIALIZED (SELECT f.* FROM uid, LATERAL public.capture_ledger_states(uid.id, p_tz, p_from, p_to) f WHERE uid.id IS NOT NULL),
  sk AS MATERIALIZED (
    SELECT (COALESCE(k.taken_at, k.decided_at) AT TIME ZONE p_tz)::date AS day, k.reason
    FROM public.capture_skips k, uid
    WHERE k.user_id = uid.id AND uid.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.user_id = k.user_id AND (vi.exif_data->>'uuid') = k.asset_id)
      AND COALESCE(k.taken_at, k.decided_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
      AND COALESCE(k.taken_at, k.decided_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
  ),
  day_frames AS (
    SELECT day, count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed,
           count(*) FILTER (WHERE state = 'duplicate') AS duplicate,
           count(*) FILTER (WHERE state = 'no_file') AS no_file, count(*) FILTER (WHERE state = 'non_vehicle') AS non_vehicle,
           count(*) FILTER (WHERE state = 'junk') AS junk
    FROM fr GROUP BY day
  ),
  day_skips AS (
    SELECT day, sum(n)::bigint AS skipped, jsonb_object_agg(reason, n) AS skip_reasons
    FROM (SELECT day, reason, count(*) AS n FROM sk GROUP BY 1, 2) x GROUP BY day
  ),
  day_vehicles AS (
    SELECT x.day, jsonb_agg(jsonb_build_object('vehicle_id', v.id, 'name', trim(concat_ws(' ', v.year::text, v.make, v.model)), 'n', x.n)
                            ORDER BY x.n DESC, v.year, v.make) AS vehicles
    FROM (SELECT day, vehicle_id, count(*) AS n FROM fr WHERE state IN ('on_vehicle', 'unverified') GROUP BY 1, 2) x
    JOIN public.vehicles v ON v.id = x.vehicle_id
    GROUP BY x.day
  ),
  day_held AS (
    SELECT day, jsonb_object_agg(reason, n) AS held_reasons
    FROM (SELECT day, reason, count(*) AS n FROM fr WHERE state = 'held' GROUP BY 1, 2) y GROUP BY day
  ),
  days AS (SELECT day FROM day_frames UNION SELECT day FROM day_skips),
  per_day AS (
    SELECT d.day, COALESCE(f.taken, 0) AS taken, COALESCE(f.on_vehicle, 0) AS on_vehicle, COALESCE(f.unverified, 0) AS unverified,
           COALESCE(f.waiting, 0) AS waiting, COALESCE(f.held, 0) AS held, COALESCE(f.pulled, 0) AS pulled, COALESCE(f.private, 0) AS private,
           COALESCE(f.unsorted, 0) AS unsorted, COALESCE(f.failed, 0) AS failed, COALESCE(f.duplicate, 0) AS duplicate, COALESCE(s.skipped, 0) AS skipped,
           COALESCE(f.no_file, 0) AS no_file, COALESCE(f.non_vehicle, 0) AS non_vehicle, COALESCE(f.junk, 0) AS junk,
           COALESCE(v.vehicles, '[]'::jsonb) AS vehicles, COALESCE(h.held_reasons, '{}'::jsonb) AS held_reasons, COALESCE(s.skip_reasons, '{}'::jsonb) AS skip_reasons
    FROM days d
    LEFT JOIN day_frames f USING (day) LEFT JOIN day_skips s USING (day) LEFT JOIN day_vehicles v USING (day) LEFT JOIN day_held h USING (day)
    ORDER BY d.day DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 180), 2000))
  ),
  tot AS (
    SELECT count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed,
           count(*) FILTER (WHERE state = 'duplicate') AS duplicate,
           (SELECT count(*) FROM sk) AS skipped,
           count(*) FILTER (WHERE state = 'no_file') AS no_file, count(*) FILTER (WHERE state = 'non_vehicle') AS non_vehicle,
           count(*) FILTER (WHERE state = 'junk') AS junk
    FROM fr
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tz', p_tz,
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day DESC) FROM per_day p), '[]'::jsonb),
    'days_total', (SELECT count(*) FROM days),
    'totals', (SELECT to_jsonb(t) FROM tot t),
    'rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                WHERE r.user_id = uid.id AND r.finished_at IS NULL ORDER BY r.requested_at DESC LIMIT 1),
    'last_rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                     WHERE r.user_id = uid.id AND r.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 1)
  )
$function$;

do $do$
declare
  v_md5 text;
  v_attrs text;
begin
  select md5(p.prosrc),
         concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname, p.proconfig::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into v_md5, v_attrs
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)');
  if v_md5 is distinct from 'b01cd915a4959c256e1e1e4b315b1fb7' then
    raise exception 'public.get_capture_ledger did not become the body this file names (md5 %)', coalesce(v_md5, 'null');
  end if;
  if v_attrs is distinct from current_setting('capture_ledger_buckets.attrs', true) then
    raise exception 'public.get_capture_ledger attributes moved: % became %', current_setting('capture_ledger_buckets.attrs', true), v_attrs;
  end if;
end $do$;

commit;
