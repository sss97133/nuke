-- Collecting Cars may use provider account capacity for the approved live intake.
-- Keep source pauses first, all other source allocations unchanged, and retain
-- provider billing refusal, invocation caps and the existing per-request meter.
BEGIN;
SET LOCAL statement_timeout = '3s';
SET LOCAL lock_timeout = '2s';

DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.firecrawl_allowance(text)'::regprocedure);
  pause_guard text := 'IF EXISTS (SELECT 1 FROM public.firecrawl_source_params WHERE source = p_source AND paused IS NOT NULL) THEN RETURN 0; END IF;';
  capacity_guard text := $branch$
  -- Account-capacity mode returns permission for one scrape, NOT a credit balance.
  -- Each actual request remains metered; Firecrawl enforces its available credits.
  IF p_source = 'collecting-cars'
     AND public.firecrawl_param('account_capacity_collecting-cars', 0) = 1 THEN
    RETURN 1;
  END IF;$branch$;
BEGIN
  IF definition IS NULL OR strpos(definition, pause_guard) = 0
    OR length(definition) - length(replace(definition, pause_guard, '')) <> length(pause_guard)
    OR strpos(definition, 'account_capacity_collecting-cars') > 0 THEN
    RAISE EXCEPTION 'Firecrawl allowance changed; review before applying source capacity mode';
  END IF;
  INSERT INTO public.firecrawl_params (key, value, note)
  VALUES ('account_capacity_collecting-cars', 1,
    'Approved Collecting Cars intake uses provider account capacity, not the scored source allocation. 1 permits one metered scrape per check; it is not a remaining-credit balance. Set 2026-11-10.')
  ON CONFLICT (key) DO NOTHING;
  IF public.firecrawl_param('account_capacity_collecting-cars', 0) <> 1 THEN
    RAISE EXCEPTION 'Collecting Cars capacity preference changed; preserve the existing setting';
  END IF;
  EXECUTE replace(definition, pause_guard, pause_guard || capacity_guard);
END $migration$;

COMMENT ON FUNCTION public.firecrawl_allowance(text) IS
  'Source scrape allowance. An explicit source pause always returns 0. Collecting Cars with account_capacity_collecting-cars=1 returns single-scrape permission (1), not provider balance; requests remain metered and provider billing limits apply. Other sources and flag=0 retain the existing scored daily allocation.';
COMMIT;
