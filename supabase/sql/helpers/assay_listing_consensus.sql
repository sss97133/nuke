-- Read-only runtime acceptance after CI deploy. One explicit vehicle only.
-- psql -X -v ON_ERROR_STOP=1 -v vehicle_id=<uuid> -f this-file.sql
-- Values/amounts and source content are intentionally absent from this receipt.
-- An older vehicle needs a scoped call to the existing detect_field_conflicts
-- writer first; this assay does not enqueue/replay or change any production row.
\set ON_ERROR_STOP on
\if :{?vehicle_id}
\else
  \echo 'Provide vehicle_id; unscoped assay refused.'
  \quit 1
\endif
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT c.field_name,c.resolution_method,c.supporting_count,c.conflicting_count,
       c.source_observation_id,c.as_of_at,
       o.observed_at AS source_event_time,o.ingested_at AS source_ingest_time,
       o.extraction_method,
       (o.vehicle_id=c.vehicle_id AND o.kind='listing' AND o.subject_type='vehicle'
        AND o.is_superseded IS NOT TRUE
        AND public.observation_is_public(o.kind,o.structured_data)
        AND o.observed_at<=c.as_of_at AND o.ingested_at<=c.as_of_at
        AND o.structured_data->>c.field_name IS NOT DISTINCT FROM c.consensus_value) AS source_link_valid
FROM public.vehicle_field_consensus c
LEFT JOIN public.vehicle_observations o ON o.id=c.source_observation_id
WHERE c.vehicle_id=:'vehicle_id'::uuid ORDER BY c.field_name;

SELECT s->>'field' AS field,
       s->>'value' IS NULL AS canonical_unknown,
       s->>'reported_value' IS NOT NULL AS has_reported_value,
       s->>'reported_conflict' AS reported_conflict,
       s->>'rooted' AS canonical_has_matching_evidence,
       s->>'source_observation_id' AS source_observation_id,
       s->>'reported_count' AS report_rows,
       s->>'as_of_at' AS fold_as_of
FROM jsonb_array_elements(public.get_vehicle_specs(:'vehicle_id'::uuid)) s;

SELECT vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at,attempts,last_error
FROM public.vehicle_metric_recompute_queue WHERE vehicle_id=:'vehicle_id'::uuid;
-- Job exit alone is not an assay of per-vehicle success: inspect queue failures.
SELECT jobname,active,last_run_at,last_status,failed_24h
FROM public.v_job_health WHERE jobname='drain-vehicle-derived-queues';
SELECT table_name,n_cols,n_cols_described,fk_out,registry_owners,registry_fields
FROM public.v_schema_atlas WHERE table_name='vehicle_field_consensus';
COMMIT;
