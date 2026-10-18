-- Publisher email sightings must not depend on the blocked KSL page scraper.
-- No sale-result support: an alert establishes presentation at email time only.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, base_trust_score, supported_observations, notes)
VALUES
  ('ksl', 'KSL Cars', 'marketplace', 'https://cars.ksl.com', 0.40,
   ARRAY['listing']::public.observation_kind[],
   'Publisher listing claims from retained email evidence. One observation per message and listing. '
   'Email Date is observation time, not a proven publication or sale time. '
   'Saved-search matches and recommendations remain distinct. Receipt and ingest clocks are separate. '
   'Reader: scripts/ingest-mail-alerts.py; writer: ingest-observation. '
   'Private raw MIME is retained by hash; recipients and tracking tokens are excluded from public claims.')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
