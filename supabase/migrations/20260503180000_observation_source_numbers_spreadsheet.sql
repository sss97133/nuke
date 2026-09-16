-- Register Apple Numbers spreadsheet as an observation source.
-- WS-6 ingests rows from Skylar's ~/Library/Mobile Documents/.../*.numbers files
-- via scripts/numbers-files-ingest.py through the canonical ingest-observation
-- single-write-path. Trust score 0.80: owner-authored documentation; not direct
-- physical observation but high-fidelity record of his own work/parts/hours.
--
-- Supported observation kinds are restricted to the enum values that
-- meaningfully map to spreadsheet rows (work logs, parts lists, condition
-- notes, free-form comments, specification rows).

INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES (
  'numbers-spreadsheet',
  'Apple Numbers Spreadsheet',
  'documentation',
  0.80,
  ARRAY['work_record','comment','specification','condition']::observation_kind[]
)
ON CONFLICT (slug) DO NOTHING;
