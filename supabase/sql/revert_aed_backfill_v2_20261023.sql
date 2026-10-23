-- Revert auction_end_date backfill run aed_backfill_v2_20261023 (Mecum, vehicles.sale_date single-event tier; 37,968 rows).
-- Registry: evidence_extractor_runs.run_id = 5361813b-e839-474d-81ec-a4c785a84e92
UPDATE auction_events ae SET auction_end_date = l.old_value
  FROM auction_end_date_backfill_log l
 WHERE l.run_id = 'aed_backfill_v2_20261023' AND l.auction_event_id = ae.id AND ae.auction_end_date = l.new_value;
