-- Cron accountability, part 4 of 5 — the four market materialized views refresh nightly, in one job,
-- with a budget that lets them finish.
-- Session cb179857 / jobs-rebuild, 2026-09-27. Replaces refresh-market-views (491, every 20 min) and
-- refresh-market-pulse (492, every 30 min), which never completed a refresh since the 09-24 restart
-- (12/0 and 8/0 in the 4 h before the pause; 5/5 and 2/2 on 09-24) — REFRESH … CONCURRENTLY over the
-- marketplace tables does not fit in a 10 s statement_timeout on the current box, and nothing on the
-- site needs a 20-minute cadence.
--
-- The new job is created PAUSED and must stay off until bat-to-db has corrected the BaT sale data
-- (30,470 no-sale lots carry a sale_price): refreshing now would spread prices built on dirty rows.
-- 491 and 492 stay paused as superseded.
--
-- CONCURRENTLY keeps the views readable during the refresh and needs each view's unique index — never
-- DROP a matview to edit it (that takes the index with it).

DO $do$
DECLARE
  v_id bigint;
  v_cmd text := $cmd$SET statement_timeout = '120s';
REFRESH MATERIALIZED VIEW CONCURRENTLY public.marketplace_metro_pulse;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.marketplace_velocity;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_pulse;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_position;$cmd$;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'refresh-market-views-nightly';
  IF v_id IS NULL THEN
    v_id := cron.schedule('refresh-market-views-nightly', '40 3 * * *', v_cmd);
    PERFORM cron.alter_job(job_id := v_id, active := false);   -- off until the sale data is clean
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '40 3 * * *', command := v_cmd);
  END IF;
END
$do$;
