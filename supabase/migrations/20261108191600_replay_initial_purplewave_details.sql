-- The initial native pass retained the first page's HTML/VIN but did not project
-- those details. Revisit that bounded page through the normal reader once.
-- No source requests, evidence edits, cadence, error/backoff or budget changes.
SET statement_timeout='10s';
SET lock_timeout='2s';
UPDATE public.listing_feeds
SET search_criteria=search_criteria || '{"native_page":1,"native_offset":0,"native_detail_version":1}'::jsonb,
    updated_at=now()
WHERE id='2b413532-64b4-4756-9840-7ec8ffd45f6e'
  AND source_slug='purplewave'
  AND search_criteria->>'fetch_strategy'='purplewave_public_json'
  AND search_criteria->>'native_page'='1'
  AND NOT search_criteria ? 'native_detail_version';
