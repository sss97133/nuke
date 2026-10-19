-- landing depth: the readers over landing_depth_measurements, and the nightly run.
--
-- v_landing_depth_latest  the newest run of each source x field.
-- v_landing_depth_drops   the same, ranked: what the raw capture held and the model dropped, and what the model holds
--                         that the vehicles row (the profile) does not. Each row names the writer that owns the drop.
--   layer 'model'    raw_present > model_present: the capture held it and no canonical table does. Owner: the source's
--                    extractor or the writer it calls.
--   layer 'profile'  model_present > profile_present: a canonical table holds it, the vehicles row does not. Owner: the fold
--                    from that table to the row (or the reader, for fields that are never on the row).
--   lots_affected_est is dropped / sample_n x population_n: an estimate over the sampled window, labelled as such.
-- Nightly: measure-landing-depth for each source at 08:10Z onward, 30 lots each (about 15-35 s a source).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW public.v_landing_depth_latest WITH (security_invoker = true) AS
SELECT DISTINCT ON (source, field)
       source, field, measured_at, run_id, sample_n, population_n, raw_present, model_present, profile_present,
       window_start, window_end, detail, examples, probe_version
FROM public.landing_depth_measurements
ORDER BY source, field, measured_at DESC;

CREATE OR REPLACE VIEW public.v_landing_depth_drops WITH (security_invoker = true) AS
WITH w(source, writer) AS (VALUES
  ('bat', 'extract-bat-core'), ('craigslist', 'extract-craigslist'), ('carsandbids', 'extract-cars-and-bids-core'),
  ('mecum', 'extract-mecum'), ('gooding', 'extract-gooding'), ('barnfinds', 'extract-barn-finds-listing'),
  ('classiccars', 'import-classiccars-listing'), ('hagerty', 'extract-hagerty-listing'), ('bonhams', 'extract-bonhams')),
d AS (
  SELECT l.source, l.field, 'model'::text AS layer, l.raw_present - l.model_present AS dropped, l.raw_present AS of_raw,
         COALESCE(w.writer, l.source) AS owner, l.sample_n, l.population_n, l.measured_at, l.examples
  FROM public.v_landing_depth_latest l LEFT JOIN w USING (source)
  WHERE l.raw_present > l.model_present
  UNION ALL
  SELECT l.source, l.field, 'profile', l.model_present - l.profile_present, l.raw_present,
         CASE WHEN l.field IN ('comment_count', 'photo_count') THEN 'reader (held in its own table, never on the vehicles row)'
              ELSE 'fold from canonical tables to the vehicles row' END,
         l.sample_n, l.population_n, l.measured_at, l.examples
  FROM public.v_landing_depth_latest l
  WHERE l.model_present > l.profile_present AND l.field NOT IN ('comment_count', 'photo_count', 'bid_count', 'end_date')
)
SELECT row_number() OVER (ORDER BY d.dropped::numeric / NULLIF(d.sample_n, 0) * COALESCE(d.population_n, d.sample_n) DESC, d.source, d.field) AS rank,
       d.source, d.field, d.layer, d.dropped, d.of_raw AS raw_present, d.sample_n,
       round(d.dropped::numeric / NULLIF(d.of_raw, 0), 3) AS dropped_share_of_raw,
       round(d.dropped::numeric / NULLIF(d.sample_n, 0) * COALESCE(d.population_n, d.sample_n)) AS lots_affected_est,
       d.population_n, d.owner, d.measured_at, d.examples
FROM d
WHERE d.field <> '_linked' OR d.layer = 'model';

COMMENT ON VIEW public.v_landing_depth_latest IS 'Newest landing_depth_measurements row per source x field: sample size, raw-present, model-present and profile-present counts with the measurement date.';
COMMENT ON VIEW public.v_landing_depth_drops IS 'Ranked raw-vs-model drops from the newest run of each source: layer model (captured, not in any canonical table) or profile (in a canonical table, not on the vehicles row), with the owning writer and an estimated lots_affected over the sampled window. Field _linked is the lot-to-vehicle link itself.';

REVOKE ALL ON public.v_landing_depth_latest, public.v_landing_depth_drops FROM anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'landing-depth-%';

SELECT cron.schedule(
  'landing-depth-' || s.source,
  (10 + s.ord * 4)::text || ' 8 * * *',
  format($job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/measure-landing-depth',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"source": "%s", "sample": 30}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$, s.source)
)
FROM (VALUES (0, 'bat'), (1, 'craigslist'), (2, 'carsandbids'), (3, 'mecum'), (4, 'gooding'),
             (5, 'barnfinds'), (6, 'classiccars'), (7, 'hagerty'), (8, 'bonhams')) AS s(ord, source);

-- first reading now (async, one request per source, 20 s apart is unnecessary: each call is its own request)
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/measure-landing-depth',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || COALESCE(
      get_service_role_key_for_cron(),
      current_setting('app.settings.service_role_key', true),
      current_setting('app.service_role_key', true))),
  body := jsonb_build_object('source', s.source, 'sample', 30),
  timeout_milliseconds := 150000)
FROM (VALUES ('bat'), ('craigslist'), ('carsandbids'), ('mecum'), ('gooding'), ('barnfinds'), ('classiccars'), ('hagerty'), ('bonhams')) AS s(source);

COMMIT;
