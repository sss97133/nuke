-- Additive: allow agent-labeled blind validations (distinct from blind_human).
ALTER TABLE public.evidence_field_validations DROP CONSTRAINT IF EXISTS evidence_field_validations_method_check;
ALTER TABLE public.evidence_field_validations ADD CONSTRAINT evidence_field_validations_method_check
  CHECK (method = ANY (ARRAY['blind_human','blind_agent','structured_crosscheck','self_audit']));

-- Additive: citation/revert log for auction_end_date backfills.
CREATE TABLE IF NOT EXISTS public.auction_end_date_backfill_log (
  auction_event_id uuid NOT NULL,
  run_id text NOT NULL,
  old_value timestamptz,
  new_value timestamptz NOT NULL,
  source_table text NOT NULL,
  source_column text NOT NULL,
  source_row_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_event_id, run_id)
);
-- Revert a run:
-- UPDATE auction_events ae SET auction_end_date = l.old_value FROM auction_end_date_backfill_log l
--  WHERE l.run_id = '<run>' AND l.auction_event_id = ae.id AND ae.auction_end_date = l.new_value;
