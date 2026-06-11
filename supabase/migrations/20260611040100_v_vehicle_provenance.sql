-- ============================================================================
-- Source Data Reorg campaign, step 3: canonical provenance view.
-- docs/plans/2026-06-11_source-data-reorg-campaign.md (step 3)
--
-- The vehicles table carries 5 disagreeing source columns (population
-- measured on prod 2026-06-10, 0.5% TABLESAMPLE n=4,822):
--   source           99.9% set — CURRENT marketplace attribution; RELABELED
--                    during dedup (e.g. conceptcarz-discovered rows relabeled
--                    to mecum/barrett-jackson — the ~267K dead stratum)
--   discovery_source 81.9% set — the extractor/site that FIRST discovered the
--                    row (conceptcarz, bat_core, ecr_collection_text…)
--   platform_source  86.6% set — normalized platform name (bringatrailer,
--                    cars-and-bids…); usually mirrors discovery
--   listing_source   40.9% set — the ingest MECHANISM (bat_simple_extract,
--                    drain-no-ai, mecum-fast-discover) — HOW, not WHERE
--   import_source     0.15% set — vestigial (7 of 4,822 sampled)
--
-- PRECEDENCE (canonical_source): discovery_source > platform_source > source
--   > import_source.
--   Rationale: provenance answers "where did this row originally come from",
--   so the discovery-time signal outranks the dedup-relabeled `source`.
--   platform_source is second because it is set on most rows where
--   discovery_source is NULL (e.g. classic-driver) and is never relabeled.
--   `source` is the fallback for rows with neither. import_source is last
--   (vestigial). listing_source is deliberately EXCLUDED from precedence —
--   it names the pipeline mechanism, not a source; exposed as
--   ingest_mechanism instead.
--
-- `relabeled` flags rows whose current `source` disagrees with their
-- discovery_source — the conceptcarz→mecum dead stratum is auditable as
-- WHERE relabeled AND is_dead GROUP BY canonical_source.
--
-- Read-only analytics view; no row mutation. security_invoker so it
-- inherits the caller's RLS on vehicles rather than the owner's.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_vehicle_provenance
WITH (security_invoker = true) AS
SELECT
  v.id AS vehicle_id,
  COALESCE(v.discovery_source, v.platform_source, v.source, v.import_source::text)
    AS canonical_source,
  CASE
    WHEN v.discovery_source IS NOT NULL THEN 'discovery_source'
    WHEN v.platform_source  IS NOT NULL THEN 'platform_source'
    WHEN v.source           IS NOT NULL THEN 'source'
    WHEN v.import_source    IS NOT NULL THEN 'import_source'
  END AS canonical_source_column,
  v.source,
  v.discovery_source,
  v.platform_source,
  v.import_source,
  v.listing_source AS ingest_mechanism,
  (v.discovery_source IS NOT NULL
   AND v.source IS NOT NULL
   AND v.source <> v.discovery_source) AS relabeled,
  (v.deleted_at IS NOT NULL OR v.merged_into_vehicle_id IS NOT NULL) AS is_dead
FROM public.vehicles v;

COMMENT ON VIEW public.v_vehicle_provenance IS
  'Canonical provenance per vehicle. Precedence: discovery_source > platform_source > source > import_source (discovery-time signal outranks dedup-relabeled source; listing_source excluded — it is the ingest mechanism, not a source). relabeled = source disagrees with discovery_source (the conceptcarz->mecum dead stratum). Source-data-reorg step 3 — analytics only, no mutation.';

GRANT SELECT ON public.v_vehicle_provenance TO authenticated, service_role;
