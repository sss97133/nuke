-- Revert one backfill run: \set run_id '<uuid>' then \i revert.sql
BEGIN;
DELETE FROM vehicle_identifiers WHERE run_id = :'run_id'::uuid;
UPDATE vehicles v SET
  canonical_body_style = s.row_data->>'canonical_body_style', body_style_quote = s.row_data->>'body_style_quote',
  is_replica = (s.row_data->>'is_replica')::boolean, replica_quote = s.row_data->>'replica_quote',
  numbers_state = s.row_data->>'numbers_state', numbers_quote = s.row_data->>'numbers_quote',
  numbers_documented_by = ARRAY(SELECT jsonb_array_elements_text(coalesce(s.row_data->'numbers_documented_by','[]')))
FROM superseded_rows s WHERE s.source_table = 'vehicles' AND s.row_id = v.id AND s.source->>'run_id' = :'run_id' AND s.restored_at IS NULL;
UPDATE superseded_rows SET restored_at = now() WHERE source->>'run_id' = :'run_id' AND restored_at IS NULL;
COMMIT;
