-- Per-user daily call caps for edge functions that any signed-in account may call and that spend money per call.
-- Sign-up is open, so "signed in" is anyone; a function in this table checks its row before the paid work and
-- refuses a caller over the cap. The service key is not capped. Owner-delegated spend control (2026-11-25): this
-- limits how a fixed budget is spent, it sets no budget.
--
-- Grain: one row per function. The count lives in rate_limits (rate_limit_increment, a UTC-day fixed window keyed
-- <function>:user:<user id>:<window start>), the existing counter the public functions already use.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.edge_function_caller_caps (
  function_name           text PRIMARY KEY CHECK (function_name ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  calls_per_user_per_day  integer NOT NULL CHECK (calls_per_user_per_day > 0),
  -- What the number rests on: the measured window and what it showed, and what one call can spend.
  basis                   text NOT NULL CHECK (length(basis) > 20),
  measured_from           timestamptz NOT NULL,
  measured_to             timestamptz NOT NULL CHECK (measured_to > measured_from),
  set_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.edge_function_caller_caps IS
  'Per-user daily call cap for an edge function that spends money per call and is open to any signed-in account. '
  'Read by _shared/callerDailyCap.ts before the paid work; counted in rate_limits. A function with a row and no '
  'readable row at run time refuses non-service callers (fails closed).';

ALTER TABLE public.edge_function_caller_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.edge_function_caller_caps FROM anon, authenticated;

INSERT INTO public.edge_function_caller_caps
  (function_name, calls_per_user_per_day, basis, measured_from, measured_to)
VALUES (
  'scrape-vehicle',
  10,
  'Gateway log, seven 24-hour windows: 0 calls of any kind (0 per user per day), so no observed caller is cut. '
  'One call can make two Firecrawl requests (tryFirecrawl, then stealth at 5 credits), so 10 calls bound one '
  'account at about 60 credits a day against the plan''s 100k a month (about 3.3k a day).',
  '2026-11-18 14:00:00+00',
  '2026-11-25 14:00:00+00'
)
ON CONFLICT (function_name) DO NOTHING;
