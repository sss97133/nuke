-- =============================================================================
-- PIPELINE REGISTRY: Queryable map of table.column → owning edge function
-- =============================================================================
-- Purpose: An agent can query this table to determine:
--   1. Which edge function owns a field (prevents reimplementation)
--   2. Whether to write a field directly or call a function
--   3. What valid values a field accepts
--   4. What the field means
--
-- Usage:
--   -- Who owns a field?
--   SELECT * FROM pipeline_registry WHERE table_name='vehicles' AND column_name='nuke_estimate';
--
--   -- What does a function write?
--   SELECT table_name, column_name FROM pipeline_registry WHERE owned_by='compute-vehicle-valuation';
--
--   -- Fields I should NEVER write directly
--   SELECT table_name, column_name, owned_by FROM pipeline_registry WHERE do_not_write_directly=true;
--
--   -- All queue tables and their lock columns
--   SELECT * FROM pipeline_registry WHERE table_name LIKE '%queue%' AND column_name='locked_by';
-- =============================================================================

CREATE TABLE IF NOT EXISTS pipeline_registry (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name             text NOT NULL,
  column_name            text,          -- NULL = whole-table entry
  owned_by               text NOT NULL, -- edge function name, 'system', 'user', or 'extractor'
  description            text NOT NULL,
  valid_values           text[],        -- for enum-like columns
  do_not_write_directly  boolean NOT NULL DEFAULT false,
  write_via              text,          -- if do_not_write_directly=true, which function to call instead
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

CREATE INDEX IF NOT EXISTS pipeline_registry_table_idx ON pipeline_registry(table_name);
CREATE INDEX IF NOT EXISTS pipeline_registry_owned_by_idx ON pipeline_registry(owned_by);

COMMENT ON TABLE pipeline_registry IS
  'Canonical map of table.column → owning pipeline function. Query this before writing to any field to check ownership and valid values. See TOOLS.md for usage patterns.';

COMMENT ON COLUMN pipeline_registry.owned_by IS
  'Name of the edge function (or system/user) responsible for populating this field.';

COMMENT ON COLUMN pipeline_registry.do_not_write_directly IS
  'If true, do not write to this field directly. Call write_via instead.';

COMMENT ON COLUMN pipeline_registry.write_via IS
  'The edge function to call when you want to update this field. Used when do_not_write_directly=true.';


-- =============================================================================
-- Populate: vehicles table — computed/AI-written fields
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('vehicles', 'nuke_estimate',             'compute-vehicle-valuation', 'AI-computed market value estimate in USD', NULL, true, 'compute-vehicle-valuation'),
('vehicles', 'nuke_estimate_confidence',  'compute-vehicle-valuation', 'Confidence 0-100 in nuke_estimate', NULL, true, 'compute-vehicle-valuation'),
('vehicles', 'deal_score',                'compute-vehicle-valuation', 'Deal quality 0-100 (high = below market)', NULL, true, 'compute-vehicle-valuation'),
('vehicles', 'heat_score',                'analyze-market-signals',    'Market demand 0-100', NULL, true, 'analyze-market-signals'),
('vehicles', 'signal_score',              'analyze-market-signals',    'Composite market signal 0-100', NULL, true, 'analyze-market-signals'),
('vehicles', 'signal_reasons',            'analyze-market-signals',    'Array of signal_score reasons', NULL, true, 'analyze-market-signals'),
('vehicles', 'last_signal_assessed_at',   'analyze-market-signals',    'Timestamp of last signal scoring', NULL, true, 'analyze-market-signals'),
('vehicles', 'perf_power_score',          'calculate-vehicle-scores',  '0-100 power score (from hp, ref=800hp)', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'perf_acceleration_score',   'calculate-vehicle-scores',  '0-100 acceleration score (from 0-60 time)', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'perf_braking_score',        'calculate-vehicle-scores',  '0-100 braking score (from 60-0 ft)', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'perf_handling_score',       'calculate-vehicle-scores',  '0-100 handling score (from lateral G)', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'perf_comfort_score',        'calculate-vehicle-scores',  '0-100 comfort/GT score', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'social_positioning_score',  'calculate-vehicle-scores',  '0-100 demographic/social appeal', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'investment_quality_score',  'calculate-vehicle-scores',  '0-100 investment quality', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'provenance_score',          'calculate-vehicle-scores',  '0-100 documentation/provenance quality', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'overall_desirability_score','calculate-vehicle-scores',  '0-100 composite desirability', NULL, true, 'calculate-vehicle-scores'),
('vehicles', 'completion_percentage',     'calculate-profile-completeness', '0-100 profile completion', NULL, true, 'calculate-profile-completeness'),
('vehicles', 'quality_grade',             'calculate-vehicle-scores',  'Numeric quality grade', NULL, true, 'calculate-vehicle-scores'),

-- Identity fields: use decode-vin-and-update, not direct writes
('vehicles', 'vin',                       'decode-vin-and-update', '17-char VIN. Uppercase, no I/O/Q.', NULL, false, 'decode-vin-and-update'),
('vehicles', 'make',                      'extractor',             'Vehicle make, normalized via canonical_makes', NULL, false, NULL),
('vehicles', 'model',                     'extractor',             'Vehicle model, normalized via canonical_models', NULL, false, NULL),
('vehicles', 'year',                      'extractor',             '4-digit model year', NULL, false, NULL),

-- Status fields
('vehicles', 'status',                    'system',        'Lifecycle status', ARRAY['active','pending','sold','discovered','merged','rejected','inactive','archived','deleted','pending_backfill','duplicate'], false, NULL),
('vehicles', 'sale_status',               'extractor',     'Sale/market state', ARRAY['available','for_sale','not_for_sale','pending','sold','unsold','not_sold','auction_live','ended','discovered','upcoming','bid_to'], false, NULL),
('vehicles', 'auction_status',            'extractor',     'Auction state', ARRAY['active','ended','sold'], false, NULL),
('vehicles', 'reserve_status',            'extractor',     'Auction reserve outcome', ARRAY['no_reserve','reserve_met','reserve_not_met'], false, NULL),
('vehicles', 'verification_status',       'system',        'Data verification level', ARRAY['unverified','contributor_verified','title_verified','multi_verified','disputed'], false, NULL),

-- Enrichment state
('vehicles', 'last_enrichment_attempt',   'enrich-vehicle-profile-ai', 'Timestamp of last enrichment run', NULL, false, NULL),
('vehicles', 'enrichment_failures',       'enrich-vehicle-profile-ai', 'Consecutive failure count. Reset to 0 on success.', NULL, false, NULL),

-- Description
('vehicles', 'description',              'generate-vehicle-description', 'Vehicle narrative description', NULL, false, 'generate-vehicle-description'),
('vehicles', 'description_source',       'generate-vehicle-description', 'How description was created', ARRAY['listing','ai_generated','user','imported'], false, NULL),

-- MSRP
('vehicles', 'msrp',                     'enrich-msrp', 'Original MSRP in USD', NULL, false, 'enrich-msrp'),
('vehicles', 'msrp_source',              'enrich-msrp', 'How MSRP was obtained', ARRAY['oem','oem_exact_trim','oem_fuzzy_trim','oem_model_avg','listing_parsed','user','ai_estimated'], false, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Populate: vehicle_images table
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('vehicle_images', 'ai_processing_status',      'photo-pipeline-orchestrator', 'AI analysis pipeline state', ARRAY['pending','processing','completed','failed','skipped'], false, 'photo-pipeline-orchestrator'),
('vehicle_images', 'ai_processing_started_at',  'photo-pipeline-orchestrator', 'Set when status→processing', NULL, false, NULL),
('vehicle_images', 'ai_processing_completed_at','photo-pipeline-orchestrator', 'Set when status→completed/failed', NULL, false, NULL),
('vehicle_images', 'optimization_status',       'system', 'Image optimization state', ARRAY['pending','processing','optimized','failed'], false, NULL),
('vehicle_images', 'organization_status',       'photo-sync-orchestrator', 'Vehicle assignment state', ARRAY['unorganized','organized','ignored'], false, NULL),
('vehicle_images', 'angle',                     'yono-classify', 'Camera angle', ARRAY['front','front_3/4','side','rear_3/4','rear','interior','engine_bay','undercarriage','detail','document','unknown'], false, 'yono-classify'),
('vehicle_images', 'angle_source',              'yono-classify', 'How angle was determined', ARRAY['yono','ai','user','extractor'], false, NULL),
('vehicle_images', 'vehicle_vin',               'photo-pipeline-orchestrator', 'VIN detected in image via AI/OCR', NULL, false, NULL),
('vehicle_images', 'ai_suggestions',            'photo-pipeline-orchestrator', 'Raw AI output — do not overwrite', NULL, true, 'photo-pipeline-orchestrator'),
('vehicle_images', 'analysis_history',          'photo-pipeline-orchestrator', 'Append-only AI run history — do not overwrite', NULL, true, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Populate: import_queue table
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('import_queue', 'status',      'continuous-queue-processor', 'Processing state', ARRAY['pending','processing','complete','failed','skipped','duplicate'], false, NULL),
('import_queue', 'locked_by',   'continuous-queue-processor', 'Worker ID that claimed this record. Stale after 30min.', NULL, true, NULL),
('import_queue', 'locked_at',   'continuous-queue-processor', 'When worker claimed record. Stale after 30min.', NULL, true, NULL),
('import_queue', 'vehicle_id',  'continuous-queue-processor', 'Set when import creates/matches a vehicle. NULL=not yet processed.', NULL, true, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Populate: bat_extraction_queue table
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('bat_extraction_queue', 'status',    'process-bat-extraction-queue', 'Processing state', ARRAY['pending','processing','complete','failed'], false, NULL),
('bat_extraction_queue', 'locked_by', 'process-bat-extraction-queue', 'Worker ID. Stale after 30min.', NULL, true, NULL),
('bat_extraction_queue', 'locked_at', 'process-bat-extraction-queue', 'Lock timestamp. Stale after 30min.', NULL, true, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Populate: document_ocr_queue table
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('document_ocr_queue', 'status',           'document-ocr-worker', 'Pipeline step. pending→classifying→extracting→linking→complete.', ARRAY['pending','classifying','extracting','linking','complete','failed','skipped'], false, NULL),
('document_ocr_queue', 'locked_by',        'document-ocr-worker', 'Worker ID. Stale after 30min.', NULL, true, NULL),
('document_ocr_queue', 'locked_at',        'document-ocr-worker', 'Lock timestamp. Stale after 30min.', NULL, true, NULL),
('document_ocr_queue', 'extraction_data',  'document-ocr-worker', 'Extracted fields JSONB. Schema varies by document_type.', NULL, true, 'document-ocr-worker'),
('document_ocr_queue', 'linked_vehicle_id','document-ocr-worker', 'Populated during linking step. NULL=no match found yet.', NULL, true, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Populate: vehicle_observations table (new architecture)
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
('vehicle_observations', 'structured_data', 'ingest-observation', 'Immutable extracted fields JSONB. Never modify after insert.', NULL, true, 'ingest-observation'),
('vehicle_observations', 'is_superseded',   'ingest-observation', 'Set by ingest-observation during dedup. Do not set manually.', NULL, true, 'ingest-observation'),
('vehicle_observations', 'is_processed',    'discover-from-observations', 'Set to true by discover-from-observations after analysis.', NULL, false, NULL)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();


-- =============================================================================
-- Whole-table entries (general pipeline guidance)
-- =============================================================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly) VALUES
('import_queue',          NULL, 'continuous-queue-processor', 'Main intake queue. Insert new URLs here; worker processes them. Do not manually update status/locked_by.', false),
('bat_extraction_queue',  NULL, 'process-bat-extraction-queue', 'BaT-specific extraction queue. Populated by crawl-bat-active. Processed by process-bat-extraction-queue.', false),
('document_ocr_queue',    NULL, 'document-ocr-worker', 'Document OCR queue. Insert storage_path here; document-ocr-worker processes it through classifying→extracting→linking steps.', false),
('vehicle_observations',  NULL, 'ingest-observation', 'New-architecture unified event store. Always write through ingest-observation edge function — never insert directly.', true),
('listing_page_snapshots',NULL, 'archiveFetch', 'Auto-populated by archiveFetch() in _shared/archiveFetch.ts. Never insert manually. Re-extract from this table instead of re-fetching.', true)

ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  updated_at = now();
