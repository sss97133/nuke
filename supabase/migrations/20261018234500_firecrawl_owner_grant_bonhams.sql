-- Owner grant for Bonhams lot pages (owner decision 2026-10-18 03:47Z): raise the Bonhams Firecrawl allocation so the lots the
-- search index landed with one photo get their lot page (gallery, notices, assessment) read. Both Bonhams hosts refuse the edge
-- (403), so every page is a Firecrawl rawHtml scrape at 1 credit. The ranked allocation gave Bonhams 425 credits for the period,
-- spread to about 25 a day.
--
-- The account had 4,650 credits left at 03:50Z (GET /v1/team/credit-usage; plan 1,000 a period, period ends 2026-11-04 01:09Z), not
-- the ~36,000 the backlog needs. The grant is what is available less a 20% reserve for the other sources: 3,720 credits, paced at
-- 532 a UTC day (about a week), and it pays nothing once the latest hourly balance (firecrawl_balance_log, read within 3 h) is at or
-- below the 930-credit reserve floor. With no recent balance reading the grant is skipped and the ranked allowance applies.
--
--   firecrawl_source_params.owner_grant  {credits, daily_credits, reserve_floor, from, until, said_at, said_by, reason, balance_at_grant}
--   firecrawl_allowance(source)          while a grant is in force: least(grant credits less spend since `from`, daily_credits less
--                                        today's spend, latest balance less reserve_floor); otherwise unchanged.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.firecrawl_source_params ADD COLUMN IF NOT EXISTS owner_grant jsonb;
COMMENT ON COLUMN public.firecrawl_source_params.owner_grant IS 'An owner grant outside the ranking: {credits, daily_credits, reserve_floor, from, until, said_at, said_by, reason, balance_at_grant}. Between from and until firecrawl_allowance returns least(credits less spend since from, daily_credits less today''s spend, latest firecrawl_balance_log balance less reserve_floor) instead of the ranked allowance; with no balance read in the last 3 h the ranked allowance applies. A paused source still gets 0.';

UPDATE public.firecrawl_source_params SET owner_grant = jsonb_build_object(
  'credits', 3720, 'daily_credits', 532, 'reserve_floor', 930,
  'from', '2026-10-18T04:00:00Z', 'until', '2026-11-04T01:09:23Z',
  'said_at', '2026-10-18T03:47:00Z', 'said_by', 'owner',
  'reason', 'read the lot pages of Bonhams lots with one photo (deep_lots); 80% of the 4,650 credits left, paced over about a week',
  'balance_at_grant', 4650)
 WHERE source = 'bonhams';

CREATE OR REPLACE FUNCTION public.firecrawl_allowance(p_source text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_day int := firecrawl_param('period_start_day', 4)::int;
  v_start date;
  v_end date;
  v_alloc numeric;
  v_spent_before numeric;
  v_spent_today numeric;
  v_days_left int;
  v_grant jsonb;
  v_from timestamptz;
  v_spent_grant numeric;
  v_balance numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.firecrawl_source_params WHERE source = p_source AND paused IS NOT NULL) THEN RETURN 0; END IF;

  SELECT owner_grant INTO v_grant FROM public.firecrawl_source_params WHERE source = p_source;
  IF v_grant IS NOT NULL AND now() >= (v_grant ->> 'from')::timestamptz AND now() < (v_grant ->> 'until')::timestamptz THEN
    SELECT remaining_credits INTO v_balance FROM public.firecrawl_balance_log
     WHERE read_at > now() - interval '3 hours' ORDER BY read_at DESC LIMIT 1;
    IF v_balance IS NOT NULL THEN
      v_from := (v_grant ->> 'from')::timestamptz;
      SELECT coalesce(sum(credits) FILTER (WHERE spent_at >= v_from), 0), coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
        INTO v_spent_grant, v_spent_today
        FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= least(v_from, current_date::timestamptz) AND NOT historical;
      RETURN greatest(0, least((v_grant ->> 'credits')::numeric - v_spent_grant,
                               (v_grant ->> 'daily_credits')::numeric - v_spent_today,
                               v_balance - coalesce((v_grant ->> 'reserve_floor')::numeric, 0)));
    END IF;
  END IF;

  v_start := CASE WHEN extract(day FROM current_date) >= v_day
                  THEN make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day)
                  ELSE (make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day) - interval '1 month')::date END;
  v_end := (v_start + interval '1 month')::date;
  SELECT a.monthly_credits INTO v_alloc
    FROM public.firecrawl_target_allocation a
   WHERE a.source = p_source AND a.vehicle_group = '*'
     AND a.computed_at = (SELECT max(computed_at) FROM public.firecrawl_target_allocation)
   LIMIT 1;
  IF v_alloc IS NULL OR v_alloc <= 0 THEN RETURN 0; END IF;
  SELECT coalesce(sum(credits) FILTER (WHERE spent_at < current_date), 0), coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
    INTO v_spent_before, v_spent_today FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= v_start AND NOT historical;
  v_days_left := greatest(1, v_end - current_date);
  RETURN greatest(0, least(v_alloc - v_spent_before - v_spent_today, ceil((v_alloc - v_spent_before) / v_days_left) - v_spent_today));
END $function$;

REVOKE ALL ON FUNCTION public.firecrawl_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance(text) TO service_role;
COMMENT ON FUNCTION public.firecrawl_allowance(text) IS 'Credits a Firecrawl spender may use today for one source. While firecrawl_source_params.owner_grant is in force (from..until, a balance read in the last 3 h): least(grant credits less spend since from, daily_credits less today''s spend, latest balance less reserve_floor). Otherwise its ranked allocation for the billing period (firecrawl_target_allocation, latest computed_at) less the period''s spend, spread over the days left, less today''s spend. 0 when paused or unallocated. Call before every batch; record the spend with firecrawl_record_spend().';
COMMIT;
