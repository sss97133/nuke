-- ZIP map paging filters by county/confidence, then advances in UUID order.
-- The measured LA public read took 16.033s for 10,343 observations / 22 pages;
-- EXPLAIN chose the global UUID primary-key scan with a county filter. The
-- existing county-only index cannot directly supply the paging order.
-- Owner approved this index on 2026-10-04. Preserve the reader, testimony and
-- access policies; build concurrently through the existing CI migration lane.
SET statement_timeout = '120s';
SET lock_timeout = '2s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vlo_county_id_page
  ON public.vehicle_location_observations (county_fips, id)
  WHERE county_fips IS NOT NULL AND confidence >= 0.5;

RESET lock_timeout;
RESET statement_timeout;
