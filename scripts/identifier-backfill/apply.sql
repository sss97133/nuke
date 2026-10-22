-- Apply a dry-run (backfill_dryrun.jsonl from eval_356.ts) reversibly. Usage (service role):
--   \set run_id '<uuid from summary.json>'
--   CREATE TEMP TABLE dry(j jsonb); \copy dry(j) FROM 'backfill_dryrun.jsonl'
--   \i apply.sql
BEGIN;
-- Backup every vehicles row whose labels we may fill (supersession store already used by merges).
INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
SELECT 'vehicles', v.id, jsonb_build_object('canonical_body_style', v.canonical_body_style, 'body_style_quote', v.body_style_quote,
  'is_replica', v.is_replica, 'replica_quote', v.replica_quote, 'numbers_state', v.numbers_state,
  'numbers_documented_by', v.numbers_documented_by, 'numbers_quote', v.numbers_quote),
  'identifier-backfill', jsonb_build_object('run_id', :'run_id'), 'identifier backfill label fill (pre-image)'
FROM vehicles v WHERE v.id IN (SELECT (j->>'vehicle_id')::uuid FROM dry WHERE j ? 'label');

INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, quote, extractor, run_id, confidence, rule_status)
SELECT (j->>'vehicle_id')::uuid, j->>'kind', j->>'value', 'PORSCHE', 'listing_text', left(j->>'quote',400), 'identifier-backfill/eval_356',
  (j->>'run_id')::uuid, (j->>'confidence')::numeric, CASE WHEN j->>'value' IS NULL THEN 'unchecked' ELSE j->>'rule_status' END
FROM dry WHERE j ? 'kind' ON CONFLICT DO NOTHING;
-- Legacy vin column values that are chassis-shaped become typed chassis claims too.
INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, extractor, run_id, confidence, rule_status)
SELECT v.id, 'chassis', btrim(v.vin), 'PORSCHE', 'legacy_vin_column', 'identifier-backfill/eval_356', :'run_id'::uuid, 0.7, 'unchecked'
FROM vehicles v WHERE v.id IN (SELECT (j->>'vehicle_id')::uuid FROM dry WHERE j ? 'label') AND btrim(v.vin) ~ '^[0-9]{4,6}$' ON CONFLICT DO NOTHING;

UPDATE vehicles v SET
  canonical_body_style = coalesce(v.canonical_body_style, CASE WHEN (d.j->>'is_replica')::boolean THEN NULL ELSE d.j->>'body_style' END),
  body_style_quote = coalesce(v.body_style_quote, d.j->>'body_style_quote'),
  is_replica = coalesce(v.is_replica, CASE WHEN (d.j->>'is_replica')::boolean THEN true END),
  replica_quote = coalesce(v.replica_quote, d.j->>'replica_quote'),
  numbers_state = coalesce(v.numbers_state, d.j->>'numbers_state'),
  numbers_quote = coalesce(v.numbers_quote, d.j->>'numbers_quote'),
  numbers_documented_by = coalesce(v.numbers_documented_by, nullif(ARRAY(SELECT jsonb_array_elements_text(d.j->'documented_by')), '{}'))
FROM dry d WHERE d.j ? 'label' AND v.id = (d.j->>'vehicle_id')::uuid;
COMMIT;
