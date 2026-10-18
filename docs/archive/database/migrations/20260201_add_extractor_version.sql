-- Add extractor_version to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS extractor_version text;

-- Add extractor_version to import_queue
ALTER TABLE import_queue ADD COLUMN IF NOT EXISTS extractor_version text;

-- Index for querying by version
CREATE INDEX IF NOT EXISTS idx_vehicles_extractor_version ON vehicles(extractor_version) WHERE extractor_version IS NOT NULL;

COMMENT ON COLUMN vehicles.extractor_version IS 'Versioned extractor name, e.g. bat-extract:2.0.0';
COMMENT ON COLUMN import_queue.extractor_version IS 'Which extractor version processed this item';
