-- auction_comment_day_counts_v1: comment velocity read from a stored fold, not a 13 GB scan at read time.
--
-- WHY. hero_heat's comment_velocity block counted auction_comments posted in the last 7 days at read time. With no
-- posted_at index, that is a parallel seq scan of 13 GB (25M rows), and the reader answers anon 500 after 10 s.
-- Comments land on about 1,300 cars a day (11,997 rows in the 24 h to 2026-11-25 08:30Z), so the fold has to cover
-- every car, not only the model-fold tiers, and it has to decay with time without a signal.
--
-- THE FOLD. auction_comment_day_counts (vehicle_id, posted_day) -> n: comments on that car whose posted_at falls on
-- that UTC day. Its writer is one statement-level trigger function on auction_comments:
--   INSERT  : upsert n = n + count, keys sorted so concurrent batches take row locks in one order;
--   DELETE  : n = n - count (never below 0);
--   UPDATE OF vehicle_id, posted_at : the old key loses, the new key gains.
-- Errors are caught and raised as warnings (as model_fold_rows_signal does), so comment intake never fails on it.
-- A comment on a car missing from vehicles is not counted (the key is a foreign key).
--
-- COMPLETENESS. Buckets from 8 UTC days ago are backfilled here from idx_auction_comments_created_at: a comment is
-- stored after it is posted (0 of 12,009 rows in the 24 h to 2026-11-25 have created_at < posted_at), so every comment
-- posted since then was created since then. Older buckets hold only comments that land from now on and are never read.
-- auction_comment_day_counts_reconcile(p_days) recounts the closed UTC days (yesterday back p_days) and returns one row
-- per bucket it corrected (n_was -> n_now); the nightly job auction-comment-day-counts-reconcile runs it at 04:20 UTC,
-- after refresh-market-views-nightly, so v_job_health shows "N rows" = buckets corrected. Any N > 0 is a finding.
--
-- COST. Added per insert statement, PG17 bench (300k vehicles, median of 5 x 3,000 statements, 2026-11-25):
-- 1 row +0.025 ms, 10 rows +0.016 ms, 100 rows +0.047 ms.
--
-- READER. hero_heat.comment_velocity sums n over posted_day after the UTC date 7 days ago, joined to vehicles with
-- the full visibility test. hero_heat's other blocks are unchanged from 20261125134500.
-- Contract: supabase/sql/test_auction_comment_day_counts.sql.
SET lock_timeout = '2s';  -- fail rather than queue comment writers behind this file's locks
SET statement_timeout = '60s';  -- deploy bound; measured: the 8-day recount 0.9 s, today's count 0.5-0.9 s (2026-11-25)

CREATE TABLE IF NOT EXISTS public.auction_comment_day_counts (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  posted_day date NOT NULL,
  n integer NOT NULL CHECK (n >= 0),
  folded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, posted_day)
);
CREATE INDEX IF NOT EXISTS auction_comment_day_counts_day ON public.auction_comment_day_counts (posted_day);
COMMENT ON TABLE public.auction_comment_day_counts IS
  'Fold of auction_comments: comments per car per UTC posted day. Writer: trigger auction_comment_day_counts_fold; '
  'complete from the 8 UTC days before 2026-11-25 onward; recounted nightly by auction_comment_day_counts_reconcile. '
  'Read by hero_heat.';
ALTER TABLE public.auction_comment_day_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auction_comment_day_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.auction_comment_day_counts TO service_role;

CREATE OR REPLACE FUNCTION public.auction_comment_day_counts_fold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    -- Static SQL per branch: a branch is planned only when it runs, so new_rows/old_rows exist whenever referenced.
    if tg_op = 'INSERT' then
      insert into public.auction_comment_day_counts as c (vehicle_id, posted_day, n, folded_at)
      select d.vehicle_id, d.posted_day, d.dn, clock_timestamp()
        from (select r.vehicle_id, (r.posted_at at time zone 'UTC')::date as posted_day, count(*)::int as dn
                from new_rows r where r.vehicle_id is not null and r.posted_at is not null group by 1, 2) d
       where exists (select 1 from public.vehicles v where v.id = d.vehicle_id)
       order by d.vehicle_id, d.posted_day
      on conflict (vehicle_id, posted_day) do update set n = c.n + excluded.n, folded_at = excluded.folded_at;
    elsif tg_op = 'DELETE' then
      update public.auction_comment_day_counts c set n = greatest(c.n - d.dn, 0), folded_at = clock_timestamp()
        from (select r.vehicle_id, (r.posted_at at time zone 'UTC')::date as posted_day, count(*)::int as dn
                from old_rows r where r.vehicle_id is not null and r.posted_at is not null group by 1, 2) d
       where c.vehicle_id = d.vehicle_id and c.posted_day = d.posted_day;
    else
      -- The old key of every moved comment loses one, the new key gains one.
      update public.auction_comment_day_counts c set n = greatest(c.n - d.dn, 0), folded_at = clock_timestamp()
        from (select o.vehicle_id, (o.posted_at at time zone 'UTC')::date as posted_day, count(*)::int as dn
                from old_rows o join new_rows n on n.id = o.id
               where o.vehicle_id is not null and o.posted_at is not null
                 and (o.vehicle_id is distinct from n.vehicle_id
                      or (o.posted_at at time zone 'UTC')::date is distinct from (n.posted_at at time zone 'UTC')::date)
               group by 1, 2) d
       where c.vehicle_id = d.vehicle_id and c.posted_day = d.posted_day;
      insert into public.auction_comment_day_counts as c (vehicle_id, posted_day, n, folded_at)
      select d.vehicle_id, d.posted_day, d.dn, clock_timestamp()
        from (select n.vehicle_id, (n.posted_at at time zone 'UTC')::date as posted_day, count(*)::int as dn
                from old_rows o join new_rows n on n.id = o.id
               where n.vehicle_id is not null and n.posted_at is not null
                 and (o.vehicle_id is distinct from n.vehicle_id
                      or (o.posted_at at time zone 'UTC')::date is distinct from (n.posted_at at time zone 'UTC')::date)
               group by 1, 2) d
       where exists (select 1 from public.vehicles v where v.id = d.vehicle_id)
       order by d.vehicle_id, d.posted_day
      on conflict (vehicle_id, posted_day) do update set n = c.n + excluded.n, folded_at = excluded.folded_at;
    end if;
  exception when others then
    raise warning 'auction_comment_day_counts skipped (%): %', tg_op, sqlerrm;
  end;
  return null;
end $function$;
REVOKE ALL ON FUNCTION public.auction_comment_day_counts_fold() FROM PUBLIC, anon, authenticated;

-- Recounts the closed UTC days from yesterday back p_days (1..14); returns each bucket it corrected.
-- A comment stored while this runs can be overwritten by the absolute count on its closed day; the next run corrects it.
DROP FUNCTION IF EXISTS public.auction_comment_day_counts_reconcile(integer);
CREATE OR REPLACE FUNCTION public.auction_comment_day_counts_reconcile(p_days integer DEFAULT 8)
 RETURNS TABLE (fix_vehicle_id uuid, fix_posted_day date, n_was integer, n_now integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_from date;
begin
  if p_days is null or p_days < 1 or p_days > 14 then
    raise exception 'auction_comment_day_counts_reconcile: p_days must be 1..14';
  end if;
  v_from := v_today - p_days;
  create temp table if not exists acdc_recount (vehicle_id uuid, posted_day date, n int) on commit drop;
  truncate acdc_recount;
  -- A comment is stored after it is posted, so every comment posted since v_from was created since v_from.
  -- Aggregate first, then test the car exists on the grouped rows (a join before grouping hash-scans vehicles).
  insert into acdc_recount
  select g.vehicle_id, g.posted_day, g.n
    from (select ac.vehicle_id, (ac.posted_at at time zone 'UTC')::date as posted_day, count(*)::int as n
            from public.auction_comments ac
           where ac.created_at >= (v_from::timestamp at time zone 'UTC') and ac.vehicle_id is not null
             and ac.posted_at >= (v_from::timestamp at time zone 'UTC') and ac.posted_at < (v_today::timestamp at time zone 'UTC')
           group by 1, 2) g
   where exists (select 1 from public.vehicles v where v.id = g.vehicle_id);
  -- Every bucket in the window whose stored n differs from the recount (a missing recount row means 0).
  create temp table if not exists acdc_fix (vehicle_id uuid, posted_day date, n_was int, n_now int) on commit drop;
  truncate acdc_fix;
  insert into acdc_fix
  select coalesce(r.vehicle_id, c.vehicle_id), coalesce(r.posted_day, c.posted_day), coalesce(c.n, 0), coalesce(r.n, 0)
    from acdc_recount r
    full join (select k.vehicle_id, k.posted_day, k.n from public.auction_comment_day_counts k
                where k.posted_day >= v_from and k.posted_day < v_today) c
      on c.vehicle_id = r.vehicle_id and c.posted_day = r.posted_day
   where coalesce(c.n, 0) <> coalesce(r.n, 0);
  insert into public.auction_comment_day_counts as c (vehicle_id, posted_day, n, folded_at)
  select f.vehicle_id, f.posted_day, f.n_now, clock_timestamp() from acdc_fix f
   order by f.vehicle_id, f.posted_day
  on conflict (vehicle_id, posted_day) do update set n = excluded.n, folded_at = excluded.folded_at;
  return query select f.vehicle_id, f.posted_day, f.n_was, f.n_now from acdc_fix f order by f.vehicle_id, f.posted_day;
end $function$;
REVOKE ALL ON FUNCTION public.auction_comment_day_counts_reconcile(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_comment_day_counts_reconcile(integer) TO service_role;

-- Triggers and today's bucket in one statement (one transaction): CREATE TRIGGER holds its lock on auction_comments
-- until the block commits, so no comment is stored between the trigger appearing and today's count (exact, and the
-- hold is the length of one day's count through idx_auction_comments_created_at). The closed days are then recounted.
DO $install$
BEGIN
  DROP TRIGGER IF EXISTS auction_comment_day_counts_ins ON public.auction_comments;
  DROP TRIGGER IF EXISTS auction_comment_day_counts_del ON public.auction_comments;
  DROP TRIGGER IF EXISTS auction_comment_day_counts_upd ON public.auction_comments;
  CREATE TRIGGER auction_comment_day_counts_ins AFTER INSERT ON public.auction_comments
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.auction_comment_day_counts_fold();
  CREATE TRIGGER auction_comment_day_counts_del AFTER DELETE ON public.auction_comments
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.auction_comment_day_counts_fold();
  CREATE TRIGGER auction_comment_day_counts_upd AFTER UPDATE ON public.auction_comments
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.auction_comment_day_counts_fold();
  -- Today's bucket: a comment posted today was created today.
  INSERT INTO public.auction_comment_day_counts AS c (vehicle_id, posted_day, n, folded_at)
  SELECT g.vehicle_id, g.posted_day, g.n, clock_timestamp()
    FROM (SELECT ac.vehicle_id, (ac.posted_at AT TIME ZONE 'UTC')::date AS posted_day, count(*)::int AS n
            FROM public.auction_comments ac
           WHERE ac.created_at >= ((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC') AND ac.vehicle_id IS NOT NULL
             AND ac.posted_at >= ((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')
           GROUP BY 1, 2) g
   WHERE EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = g.vehicle_id)
   ORDER BY 1, 2
  ON CONFLICT (vehicle_id, posted_day) DO UPDATE SET n = excluded.n, folded_at = excluded.folded_at;
END
$install$;
SELECT count(*) AS backfilled_buckets FROM public.auction_comment_day_counts_reconcile(8);

DO $job$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auction-comment-day-counts-reconcile';
  PERFORM cron.schedule('auction-comment-day-counts-reconcile', '20 4 * * *',
    'SET client_min_messages = error; SET statement_timeout = ''10s''; SET lock_timeout = ''5s''; '
    'SELECT * FROM public.auction_comment_day_counts_reconcile(8);');
END
$job$;

CREATE OR REPLACE FUNCTION public.hero_heat()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  WITH hot_vehicles AS (
    SELECT
      v.id,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.heat_score,
      v.primary_image_url AS thumbnail,
      COALESCE(
        NULLIF(v.sale_price, 0)::numeric,
        NULLIF(v.asking_price, 0::numeric),
        NULLIF(v.current_value, 0::numeric)
      ) AS price
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.heat_score DESC
    LIMIT 30
  ),
  comment_velocity AS (
    -- auction_comment_day_counts_v1: the stored per-car, per-UTC-day fold, not a scan of auction_comments
    SELECT
      c.vehicle_id AS id,
      sum(c.n)::bigint AS comment_count_7d,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.primary_image_url AS thumbnail
    FROM auction_comment_day_counts c
    JOIN vehicles v ON v.id = c.vehicle_id
    WHERE c.posted_day > ((now() AT TIME ZONE 'UTC') - interval '7 days')::date
      AND c.n > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY c.vehicle_id, v.year, v.make, v.model, v.primary_image_url
    ORDER BY sum(c.n) DESC
    LIMIT 20
  ),
  make_heat AS (
    SELECT
      COALESCE(v.make, 'Unknown') AS make,
      SUM(v.heat_score) AS total_heat,
      count(*) AS cnt
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY v.make
    ORDER BY total_heat DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'top_hot', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'heat_score', heat_score, 'thumbnail', thumbnail, 'price', price
    )), '[]'::jsonb) FROM hot_vehicles),
    'comment_velocity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'comment_count_7d', comment_count_7d, 'thumbnail', thumbnail
    )), '[]'::jsonb) FROM comment_velocity),
    'make_heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'total_heat', total_heat, 'count', cnt
    )), '[]'::jsonb) FROM make_heat)
  );
$function$;
