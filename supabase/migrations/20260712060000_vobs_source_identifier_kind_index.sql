-- Index vehicle_observations(source_identifier, kind) — the ingest dedup path.
--
-- Every extractor checks for an existing observation before insert with:
--   SELECT id FROM vehicle_observations WHERE source_identifier = $1 AND kind = $2
-- The only index containing source_identifier (unique_observation) LEADS with
-- source_id, so this filter could not use it and fell back to a parallel
-- full-table seq scan. Under normal pipeline concurrency (~38 in flight) each scan
-- took ~18s and saturated the database — the live REST API (incl. the Explore map's
-- county_density_all) queued 20–40s behind it.
--
-- Adding this index took the dedup query from cost 133,731 (seq scan) to 2.78
-- (index scan); DB active/slow queries dropped 51/48 → 5/4; the map read went from
-- a 40s timeout to 0.3s. (Applied to prod 2026-07-12 via CREATE INDEX CONCURRENTLY;
-- recorded here non-concurrently with IF NOT EXISTS so it is a no-op on prod and
-- builds normally on a fresh database.)

CREATE INDEX IF NOT EXISTS idx_vobs_source_identifier_kind
  ON public.vehicle_observations (source_identifier, kind);
