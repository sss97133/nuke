-- Collecting Cars may testify to a lot's result (kind sale_result), not only its listing, comments and bids.
--
-- sync-live-auctions records each closed Collecting Cars lot's outcome through ingest-observation: sold (the house's
-- sold index on its Typesense search: price, high bid, reserve, close time) or not sold (absent from that index 12 h
-- after the close; the high bid is the board's last read). ingest-observation refuses a kind its source does not list,
-- so the source row gains sale_result, as pcarmarket's has. Nothing else about the source changes.
-- Before (2026-11-08): {listing,comment,bid}. Revert: array_remove(supported_observations, 'sale_result').
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'collecting-cars') THEN
    RAISE EXCEPTION 'observation_sources has no collecting-cars row';
  END IF;
END $$;

UPDATE public.observation_sources
SET supported_observations = array_append(supported_observations, 'sale_result'::public.observation_kind)
WHERE slug = 'collecting-cars' AND NOT ('sale_result'::public.observation_kind = ANY (supported_observations));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.observation_sources
                 WHERE slug = 'collecting-cars' AND 'sale_result'::public.observation_kind = ANY (supported_observations)
                   AND 'bid'::public.observation_kind = ANY (supported_observations)) THEN
    RAISE EXCEPTION 'collecting-cars does not list sale_result and bid after the update';
  END IF;
END $$;

COMMIT;
