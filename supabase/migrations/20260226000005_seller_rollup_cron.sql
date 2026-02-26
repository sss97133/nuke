-- Seller intel rollup cron
-- Runs seller_intel_rollup() every 4 hours to recompute denormalized
-- fields on pipeline_sellers from seller_sightings.

SELECT cron.unschedule('seller-intel-rollup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'seller-intel-rollup'
);

SELECT cron.schedule(
  'seller-intel-rollup',
  '0 */4 * * *',
  $$
  SELECT seller_intel_rollup();
  $$
);

-- Verify
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'seller-intel-rollup';
