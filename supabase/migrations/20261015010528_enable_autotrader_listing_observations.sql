-- Register only the existing US AutoTrader source's listing capability.
-- No testimony, vehicle resolution, or public access changes.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'autotrader') THEN
    RAISE EXCEPTION 'Expected existing autotrader observation source';
  END IF;
END $$;

UPDATE public.observation_sources
SET supported_observations = array_append(
  COALESCE(supported_observations, ARRAY[]::public.observation_kind[]),
  'listing'::public.observation_kind
)
WHERE slug = 'autotrader'
  AND NOT ('listing'::public.observation_kind = ANY(
    COALESCE(supported_observations, ARRAY[]::public.observation_kind[])
  ));
COMMIT;
