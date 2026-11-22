-- Revert of 20261122004200_capture_ledger_buckets_add_up: puts production's earlier body of get_capture_ledger back (day
-- rows and totals without the no_file, non_vehicle and junk keys). Nothing else changes; no rows are written.
-- A body that is neither the earlier one nor the one the migration installed is left alone and the revert refuses.
-- A function that does not exist is created with the earlier body (the contract uses this to install it in an empty
-- database); otherwise CREATE OR REPLACE keeps owner and grants, which the post-check confirms.
-- Run as the function owner, e.g. psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122004200_capture_ledger_buckets_add_up.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)');
  if v_md5 is not null and v_md5 not in ('933b34c957f1014110284ccc2dc88eae', 'b01cd915a4959c256e1e1e4b315b1fb7') then
    raise exception 'public.get_capture_ledger is not the body this migration was written against (md5 %); refusing to replace it', v_md5;
  end if;
  perform set_config('capture_ledger_buckets.attrs', coalesce((
    select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname, p.proconfig::text,
                     pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)')), ''), true);
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
           count(*) FILTER (WHERE state = 'duplicate') AS duplicate
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
           (SELECT count(*) FROM sk) AS skipped
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
  if v_md5 is distinct from '933b34c957f1014110284ccc2dc88eae' then
    raise exception 'public.get_capture_ledger did not become the body this file names (md5 %)', coalesce(v_md5, 'null');
  end if;
  if current_setting('capture_ledger_buckets.attrs', true) <> '' and v_attrs is distinct from current_setting('capture_ledger_buckets.attrs', true) then
    raise exception 'public.get_capture_ledger attributes moved: % became %', current_setting('capture_ledger_buckets.attrs', true), v_attrs;
  end if;
end $do$;

commit;
