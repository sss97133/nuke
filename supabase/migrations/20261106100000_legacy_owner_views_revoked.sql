-- Revoke the three legacy owner-financial views from every API role.
--
-- skylar_schedule_c, schedule_c_detail and skylar_income_statement were applied by hand: no earlier migration, repo file, function
-- body or cron job names them. They have no security_invoker option, so they run with their owner's rights, and Supabase's default
-- privileges left SELECT (and write bits) on them for every signed-in account (and write bits for anon). Measured read-only on prod,
-- 2026-10-29, as a random signed-in uid with no relation to the book: 7 rows of the income statement and 95 rows of schedule_c_detail.
-- Pre-launch, so latent, but the books docket is owner-only and these views break "never readable by another user".
--
-- Evidence read-only on prod, 2026-10-29:
--   * the only dependent relation is the view skylar_schedule_c, which reads schedule_c_detail; it runs as its owner (postgres) and is
--     unaffected by this revoke;
--   * post_unposted_receipts and post_unposted_work_order_payments mention only the organization slug 'skylar-schedule-c', never a view;
--   * no pg_cron job names them; nothing in this repository names them;
--   * the API edge log (24 hours is the most the log query reaches, read 2026-10-29): two requests name them, both anonymous curl
--     probes that answered 401; no browser, app or function caller.
-- The 30-day API-log check for callers is the owner's gate before this merges (see the pull request).
--
-- service_role and the owner role (postgres) keep their access. Replay-safe: a database without the views changes nothing.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $revoke$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['skylar_schedule_c', 'schedule_c_detail', 'skylar_income_statement'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v);
    END IF;
  END LOOP;
END
$revoke$;
