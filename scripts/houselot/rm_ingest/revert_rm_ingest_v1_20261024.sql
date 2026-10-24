-- Revert rm_ingest_v1_20261024 without deleting: run revert_agg_houselot_v5_20261024.sql first, then retire the ingested rows.
begin; set local statement_timeout='50s'; set local lock_timeout='5s';
update public.vehicle_events set source_suspect = array(select distinct unnest(coalesce(source_suspect,'{}')||'{retracted}')),
  source_suspect_reason='rm_ingest_v1_20261024 retracted', source_suspect_run_id='revert_rm_ingest_v1_20261024', source_suspect_at=now()
 where extraction_run_id='rm_ingest_v1_20261024' and source_platform='rm-sothebys';
update public.vehicles set deleted_at=now() where origin_metadata->>'run_id'='rm_ingest_v1_20261024' and deleted_at is null;
commit;
