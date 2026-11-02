-- Revoke the owner-financial views of the journal from every API role: the three legacy views and their fifteen siblings.
--
-- Eighteen views over the journal tables (journal_entries, journal_lines, chart_of_accounts) were applied by hand: no earlier migration, repo file,
-- function body or cron job names them. None has a security_invoker option, so each runs with its owner's rights. The journal tables themselves
-- answer nobody else (row security on, no policy), so these views are the one door, and Supabase's default privileges left SELECT on every one of
-- them for every signed-in account (and write bits for anon and signed-in accounts; none of the eighteen is updatable, so the write bits are inert).
-- A signed-in account is any holder of a token with the authenticated role, which an anonymous sign-in also yields where it is enabled.
--   the three legacy views:  skylar_schedule_c, schedule_c_detail, skylar_income_statement
--   their fifteen siblings:  balance_sheet, cash_flow_summary, daily_ledger, expense_by_category_year, income_statement, income_statement_annual,
--                            income_statement_monthly, ledger_by_vendor, ledger_cumulative, ledger_monthly, ledger_total, platform_burn_rate,
--                            qb_review_queue, trial_balance, viva_income_statement
-- Measured read-only on prod, 2026-10-29, as a random signed-in uid with no relation to the book: every one of the eighteen answered with rows.
-- Pre-launch, so latent, but the books docket is owner-only and these views break "never readable by another user".
--
-- Evidence read-only on prod, 2026-10-29:
--   * the eighteen are every view that reads the journal tables (directly or through another view) and is readable by authenticated without
--     being security_invoker; the same search finds no such view readable by anon;
--   * the relations that depend on one of them are skylar_schedule_c (reads schedule_c_detail) and skylar_income_statement and
--     viva_income_statement (read income_statement_annual); each runs as its owner (postgres) and is unaffected by the revoke of its source;
--   * post_unposted_receipts and post_unposted_work_order_payments mention only the organization slug 'skylar-schedule-c', never a view;
--   * no pg_cron job, policy, function body or other view names them; nothing in this repository names them (the one edge function that once
--     served the journal, platform-financials, is a retired stub that answers 410);
--   * the API edge log (24 hours is the most the log query reaches, read 2026-10-29): two requests name any of the eighteen, both anonymous curl
--     probes that answered 401; no browser, app or function caller.
-- The 30-day API-log check for callers is the owner's gate before this merges (see the pull request); it covers all eighteen names.
--
-- service_role and the owner role (postgres) keep their access. Replay-safe: a database without the views changes nothing, and a view that
-- is not in the list is not touched.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $revoke$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'skylar_schedule_c', 'schedule_c_detail', 'skylar_income_statement',
    'balance_sheet', 'cash_flow_summary', 'daily_ledger', 'expense_by_category_year', 'income_statement', 'income_statement_annual',
    'income_statement_monthly', 'ledger_by_vendor', 'ledger_cumulative', 'ledger_monthly', 'ledger_total', 'platform_burn_rate',
    'qb_review_queue', 'trial_balance', 'viva_income_statement'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v);
    END IF;
  END LOOP;
END
$revoke$;
