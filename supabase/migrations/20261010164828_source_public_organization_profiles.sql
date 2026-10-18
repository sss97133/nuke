-- Owner requested public source-profile drill-through on 2026-10-10 and then
-- explicitly authorized making PCarMarket public and creating/linking Barn Finds.
-- Live atlas: organizations is the entity owner; observation_sources.business_id
-- is its existing FK. Nine platform identities were checked by name + origin;
-- Barn Finds' domain comes from retained source_targets URLs, not a guessed URL.
-- Use the sanctioned deterministic creator, never a blind organization INSERT.
-- No testimony, queue state, source activation, RLS policy or grants change.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $profiles$
DECLARE
  target record;
  barn_id uuid;
  intake jsonb;
BEGIN
  -- Refuse drift rather than attaching a source to a different entity. Collections
  -- that share an auction platform's domain are deliberately absent from this list.
  FOR target IN SELECT * FROM (VALUES
    ('mecum', 'd2f587a0-5993-4d2c-9032-0fb3dd94d995'::uuid, 'Mecum Auctions', 'mecum.com'),
    ('bat', 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'::uuid, 'Bring a Trailer', 'bringatrailer.com'),
    ('bonhams', 'eb426570-c8e7-43c3-a4f1-8807ed9e075c'::uuid, 'Bonhams', 'bonhams.com'),
    ('hemmings', 'fafd3529-5b39-4336-b500-c6720e3895b7'::uuid, 'Hemmings', 'hemmings.com'),
    ('barrett-jackson', '7a3d0d2a-c738-4d8a-a199-1a687aa6cdf4'::uuid, 'Barrett-Jackson', 'barrett-jackson.com'),
    ('pcarmarket', 'f7c80592-6725-448d-9b32-2abf3e011cf8'::uuid, 'PCarMarket', 'pcarmarket.com'),
    ('collecting-cars', '0d435048-f2c5-47ba-bba0-4c18c6d58686'::uuid, 'Collecting Cars', 'collectingcars.com'),
    ('gooding', '29d2afda-96dd-45e3-b649-620556bde874'::uuid, 'Gooding & Company', 'goodingco.com'),
    ('broad-arrow', 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a'::uuid, 'Broad Arrow Auctions', 'broadarrowauctions.com')
  ) AS targets(slug, org_id, observed_name, domain)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = target.org_id
      AND o.business_name = target.observed_name
      AND lower(regexp_replace(rtrim(o.website, '/'), '^https?://(www[.])?', '')) = target.domain)
      OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.slug = target.slug
        AND (s.business_id IS NULL OR s.business_id = target.org_id)) THEN
      RAISE EXCEPTION 'Source profile identity drift: %', target.slug;
    END IF;
    UPDATE public.observation_sources SET business_id = target.org_id
      WHERE slug = target.slug AND business_id IS NULL;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'barnfinds'
    AND (base_url IS NULL OR base_url = 'https://barnfinds.com')) THEN
    RAISE EXCEPTION 'Barn Finds source domain drift';
  END IF;
  IF (SELECT count(*) FROM public.organizations WHERE website IN (
    'https://barnfinds.com', 'https://barnfinds.com/', 'https://www.barnfinds.com',
    'https://www.barnfinds.com/', 'http://barnfinds.com', 'http://barnfinds.com/',
    'http://www.barnfinds.com', 'http://www.barnfinds.com/')) > 1 THEN
    RAISE EXCEPTION 'Ambiguous Barn Finds organization';
  END IF;
  intake := public.create_organization_batch(
    '[{"business_name":"Barn Finds","website":"https://barnfinds.com"}]'::jsonb, 'barnfinds', false);
  IF (intake->>'conflicts')::int <> 0 OR (intake->>'skipped_no_key')::int <> 0 THEN
    RAISE EXCEPTION 'Barn Finds intake refused';
  END IF;
  SELECT id INTO STRICT barn_id FROM public.organizations WHERE website IN (
    'https://barnfinds.com', 'https://barnfinds.com/', 'https://www.barnfinds.com',
    'https://www.barnfinds.com/', 'http://barnfinds.com', 'http://barnfinds.com/',
    'http://www.barnfinds.com', 'http://www.barnfinds.com/');
  IF EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'barnfinds'
    AND business_id IS NOT NULL AND business_id <> barn_id) THEN
    RAISE EXCEPTION 'Barn Finds source organization drift';
  END IF;
  -- The batch creator defaults country to US. No location was supplied here:
  -- keep it unknown on a newly created entity, without changing an existing one.
  IF (intake->>'created')::int = 1 THEN
    UPDATE public.organizations SET country = NULL WHERE id = barn_id;
  END IF;
  UPDATE public.organizations SET is_public = true WHERE id IN (
    barn_id, 'f7c80592-6725-448d-9b32-2abf3e011cf8'::uuid) AND is_public IS DISTINCT FROM true;
  UPDATE public.observation_sources SET business_id = barn_id,
    base_url = coalesce(base_url, 'https://barnfinds.com') WHERE slug = 'barnfinds';
END
$profiles$;

COMMIT;
