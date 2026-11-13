-- Release ten existing credits into the shared nonreserved period pool.
-- This setting persists until revised. It is not a vehicle-specific grant or
-- an atomic request reservation; existing allowance/meter owners are unchanged.
-- One DO statement owns the locks, guards and single row update atomically.
SET statement_timeout = '10s';
SET lock_timeout = '2s';
DO $release$
DECLARE monthly numeric; period_day numeric; reserve numeric;
BEGIN
  SELECT value INTO STRICT monthly FROM public.firecrawl_params
    WHERE key='monthly_credits' FOR UPDATE;
  SELECT value INTO STRICT period_day FROM public.firecrawl_params
    WHERE key='period_start_day' FOR UPDATE;
  SELECT value INTO STRICT reserve FROM public.firecrawl_params
    WHERE key='reserve_fraction' FOR UPDATE;
  IF monthly IS DISTINCT FROM 1000 OR period_day IS DISTINCT FROM 4
    OR reserve IS NULL OR reserve NOT IN (0.15,0.14) THEN
    RAISE EXCEPTION 'Firecrawl reserve release configuration drift';
  END IF;
  IF reserve=0.14 THEN RETURN; END IF;
  UPDATE public.firecrawl_params SET value=0.14,set_at=now(),
    note=note||' Reserve lowered from 0.15 to 0.14 through the checked release path: ten existing credits enter the shared 1000-credit period pool. This setting persists until revised; it is not a vehicle-specific or atomic reservation.'
  WHERE key='reserve_fraction';
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'Firecrawl reserve release requires existing parameters';
END;
$release$;
