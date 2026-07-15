-- DRIFT REPAIR (committed 2026-07-15): this matview was apply_migration'd directly
-- to prod on 2026-07-14T13:15:46Z and lived only on the live DB — absent from repo
-- migrations. Recovered from the crashed session transcript (fc88a377) and verified
-- byte-equivalent against the live definition before committing. It is the data
-- source for the vehicle-profile headline→ledger drill (EyeLedgerPopup); without
-- it in migrations, a rebuild-from-migrations would drop the drill's substrate.
--
-- Fast, forever-citable read model over the appraisal observations that land
-- through ingest-observation (source: nuke-vision, layer: observe).
-- NOT a new write path: derived entirely from vehicle_observations (the rail's
-- canonical table). One row per (image x part x canon check) — the queryable
-- unit of the appraisal method. Refresh after each landing batch.
CREATE MATERIALIZED VIEW IF NOT EXISTS appraisal_canon_checks AS
SELECT
  vo.id                                          AS observation_id,
  vo.vehicle_id,
  (vo.structured_data->>'image_id')::uuid        AS image_id,
  vo.structured_data->>'image_url'               AS image_url,
  p.value->>'part'                               AS part,
  c.value->>'canon_ref'                          AS canon_ref,
  c.value->>'verdict'                            AS verdict,
  left(c.value->>'evidence', 500)                AS evidence,
  (NULLIF(p.value->>'confidence',''))::numeric   AS confidence,
  vo.structured_data->>'method'                  AS method,
  vo.observed_at
FROM vehicle_observations vo
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(vo.structured_data->'observation'->'parts', '[]'::jsonb)) p
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(p.value->'canon_checks', '[]'::jsonb)) c
WHERE vo.source_id = (SELECT id FROM observation_sources WHERE slug='nuke-vision')
  AND vo.structured_data->>'layer' = 'observe';

CREATE INDEX IF NOT EXISTS idx_acc_verdict_canon ON appraisal_canon_checks (verdict, canon_ref);
CREATE INDEX IF NOT EXISTS idx_acc_vehicle ON appraisal_canon_checks (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_acc_image ON appraisal_canon_checks (image_id);

COMMENT ON MATERIALIZED VIEW appraisal_canon_checks IS
'Derived read model of the blind-3pass appraisal method (2026-07-14). Source of truth is vehicle_observations via ingest-observation; this exists for fast cohort queries (peer-gap, FAIL distributions). Refresh: REFRESH MATERIALIZED VIEW appraisal_canon_checks;';

-- Anon/authenticated read is granted in 20260715160000_appraisal_canon_checks_grants.sql
-- (kept separate because matview grants survive REFRESH but not DROP+CREATE).
