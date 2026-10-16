-- Balance-vs-ledger assay (owner-lead 2026-10-16). The Firecrawl balance fell 15 credits (05:42 to 06:10Z) with no spend rows and no snapshots, and
-- earlier 15 (00:38-01:44Z) and 8 (01:44-01:55Z). Something outside the metered door spends. Hourly the edge function firecrawl-balance-log
-- reads GET /v1/team/credit-usage (free) and appends to firecrawl_balance_log; v_firecrawl_balance_check sets each step beside the credits
-- firecrawl_spend_log recorded in the same window and flags a drop more than 2 credits beyond the ledger, with its time range.
-- Found while building it: check-vendor-balances (job 257, every 6 h) called /v1/team/credits, which does not exist (404), and on a non-OK answer
-- fell back to a POST /v1/scrape of example.com: a paid call outside the ledger. That function now reads credit-usage and never scrapes.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.firecrawl_balance_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  read_at timestamptz NOT NULL DEFAULT now(),
  remaining_credits numeric NOT NULL,
  plan_credits numeric,
  billing_period_end timestamptz
);
CREATE INDEX IF NOT EXISTS firecrawl_balance_log_read_at_idx ON public.firecrawl_balance_log (read_at);
ALTER TABLE public.firecrawl_balance_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.firecrawl_balance_log IS 'Hourly Firecrawl team credit balance (free credit-usage read) written by the firecrawl-balance-log edge function.';

CREATE OR REPLACE VIEW public.v_firecrawl_balance_check AS
WITH steps AS (
  SELECT read_at, remaining_credits,
         lag(read_at) OVER (ORDER BY read_at) AS prev_at,
         lag(remaining_credits) OVER (ORDER BY read_at) AS prev_remaining
    FROM public.firecrawl_balance_log
), j AS (
  SELECT s.*, s.prev_remaining - s.remaining_credits AS balance_drop,
         coalesce((SELECT sum(l.credits) FROM public.firecrawl_spend_log l
                    WHERE NOT l.historical AND l.spent_at > s.prev_at AND l.spent_at <= s.read_at), 0) AS logged_credits
    FROM steps s WHERE s.prev_at IS NOT NULL
)
SELECT prev_at AS window_start, read_at AS window_end, prev_remaining, remaining_credits,
       balance_drop, logged_credits, balance_drop - logged_credits AS unexplained,
       (balance_drop - logged_credits) > 2 AS flagged,
       (read_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
  FROM j;
GRANT SELECT ON public.v_firecrawl_balance_check TO service_role;
COMMENT ON VIEW public.v_firecrawl_balance_check IS 'Each Firecrawl balance step beside the credits firecrawl_spend_log logged in the same window. flagged = the balance fell more than 2 credits beyond the ledger; window_start..window_end is when it happened. A refill shows as a negative drop and is not flagged.';

-- Hourly at :07 (non-zero offset).
DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'firecrawl-balance-log';
  IF v_id IS NULL THEN
    PERFORM cron.schedule('firecrawl-balance-log', '7 * * * *', $cmd$SELECT net.http_post(
      url := get_service_url() || '/functions/v1/firecrawl-balance-log',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
      body := '{}'::jsonb, timeout_milliseconds := 30000);$cmd$);
  END IF;
END $do$;

-- v_firecrawl_metering_check: one trailing column (credits the balance lost beyond the ledger today) so the same check carries the assay.
CREATE OR REPLACE VIEW public.v_firecrawl_metering_check AS
 WITH d AS (
         SELECT (date_trunc('day'::text, (now() AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text) AS day_start
        ), snap AS (
         SELECT sp.source,
            count(*) AS fetches,
            count(*) FILTER (WHERE (s.fetched_at >= d.day_start)) AS fetches_today
           FROM ((listing_page_snapshots s
             CROSS JOIN d)
             JOIN firecrawl_source_params sp ON ((s.platform = ANY (sp.snapshot_platforms))))
          WHERE ((s.fetch_method = 'firecrawl'::text) AND (s.fetched_at >= (now() - '24:00:00'::interval)))
          GROUP BY sp.source
        ), spent AS (
         SELECT l.source,
            sum(l.credits) FILTER (WHERE (NOT l.historical)) AS credits,
            sum(l.credits) FILTER (WHERE l.historical) AS historical_credits,
            sum(l.credits) FILTER (WHERE ((NOT l.historical) AND (l.spent_at >= d.day_start))) AS credits_today
           FROM (firecrawl_spend_log l
             CROSS JOIN d)
          WHERE (l.spent_at >= (now() - '24:00:00'::interval))
          GROUP BY l.source
        )
 SELECT COALESCE(a.source, b.source) AS source,
    COALESCE(a.fetches, (0)::bigint) AS snapshot_fetches,
    COALESCE(b.credits, (0)::numeric) AS logged_credits,
    COALESCE(b.historical_credits, (0)::numeric) AS historical_credits,
    (COALESCE(b.credits, (0)::numeric) - (COALESCE(a.fetches, (0)::bigint))::numeric) AS difference,
    (abs((COALESCE(b.credits, (0)::numeric) - (COALESCE(a.fetches, (0)::bigint))::numeric)) <= (2)::numeric) AS within_2,
        CASE
            WHEN (COALESCE(a.source, b.source) = '(unmapped)'::text) THEN (0)::numeric
            ELSE firecrawl_allowance(COALESCE(a.source, b.source))
        END AS allowance_today,
    COALESCE(a.fetches_today, (0)::bigint) AS snapshot_fetches_today,
    COALESCE(b.credits_today, (0)::numeric) AS logged_credits_today,
    (((COALESCE(a.fetches_today, (0)::bigint))::numeric - COALESCE(b.credits_today, (0)::numeric)) > (2)::numeric) AS unmetered_today,
    (SELECT COALESCE(sum(x.unexplained) FILTER (WHERE x.flagged), 0) FROM public.v_firecrawl_balance_check x WHERE x.today) AS balance_unexplained_today
   FROM (snap a
     FULL JOIN spent b ON ((b.source = a.source)));
COMMIT;
