-- =============================================================================
-- AGENT SAFETY: Column comments on core pipeline tables
-- =============================================================================
-- Purpose: Help agents (and humans) understand:
--   1. Which edge function OWNS each field group (do not write directly)
--   2. What the valid enum values are for undocumented status fields
--   3. What scale/range ambiguous numeric fields use
--   4. What pipeline step a queue record is on
--
-- These comments are queryable:
--   SELECT col_description('vehicles'::regclass, attnum)
--   FROM pg_attribute WHERE attrelid='vehicles'::regclass AND attname='nuke_estimate';
-- =============================================================================


-- =============================================================================
-- TABLE: vehicles (327 columns — documenting the non-obvious ones)
-- =============================================================================

-- STATUS FIELDS
COMMENT ON COLUMN vehicles.status IS
  'Lifecycle status. Values: active (normal), pending (being processed), sold, discovered (scraped, not yet linked), merged (duplicate merged into another), rejected, inactive, archived, deleted, pending_backfill, duplicate. Default: active.';

COMMENT ON COLUMN vehicles.sale_status IS
  'Current sale/market state. Values: available, for_sale, not_for_sale, pending, sold, unsold, not_sold, auction_live, ended, discovered, upcoming, bid_to. Set by extractors and market pipeline. NOTE: sold/unsold/not_sold are overlapping legacy values — use "sold" for new records.';

COMMENT ON COLUMN vehicles.auction_status IS
  'Current auction state. Values: active (live auction), ended (auction closed), sold. Set by: sync-live-auctions, bat-queue-worker. NULL = not an auction vehicle.';

COMMENT ON COLUMN vehicles.reserve_status IS
  'Auction reserve outcome. Values: no_reserve, reserve_met, reserve_not_met. Set by: extractors at import time. NULL = not applicable or unknown.';

COMMENT ON COLUMN vehicles.verification_status IS
  'Data verification level. Values: unverified, contributor_verified, title_verified, multi_verified, disputed. Enforced by CHECK constraint.';

COMMENT ON COLUMN vehicles.auction_outcome IS
  'Final auction result. Values: sold, reserve_not_met, no_sale, pending, ended. Set by: extractors, sync-live-auctions. Enforced by CHECK constraint.';

-- IDENTITY FIELDS (VIN, YMM)
COMMENT ON COLUMN vehicles.vin IS
  'Vehicle Identification Number. 17 chars, uppercase, no I/O/Q. Populated by: decode-vin-and-update (NHTSA VPIC API) or batch-vin-decode. Do NOT write directly unless you have a verified source — use decode-vin-and-update.';

COMMENT ON COLUMN vehicles.vin_source IS
  'Where the VIN came from. Values: nhtsa, user, ocr, listing_text, image_extraction, title_document. Set automatically by the extraction pipeline.';

COMMENT ON COLUMN vehicles.vin_confidence IS
  '0-100 confidence in the VIN value. Set by decode-vin-and-update. 100=verified, 50=extracted, <50=uncertain.';

COMMENT ON COLUMN vehicles.make IS
  'Vehicle make. Normalized via canonical_makes table. Populated by: decode-vin-and-update, batch-ymm-propagate, extractors.';

COMMENT ON COLUMN vehicles.model IS
  'Vehicle model. Normalized via canonical_models table. Populated by: decode-vin-and-update, batch-ymm-propagate, extractors.';

COMMENT ON COLUMN vehicles.year IS
  'Model year (4-digit integer). Populated by: decode-vin-and-update, extractors.';

-- VALUATION FIELDS (DO NOT WRITE DIRECTLY)
COMMENT ON COLUMN vehicles.nuke_estimate IS
  'AI-computed market value estimate in USD. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation. Updated when sufficient comparable data exists.';

COMMENT ON COLUMN vehicles.nuke_estimate_confidence IS
  'Confidence in nuke_estimate as 0-100 integer. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation.';

COMMENT ON COLUMN vehicles.deal_score IS
  'Deal quality score 0-100. High score = listed below market. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation or analyze-market-signals. NULL = insufficient data to score.';

COMMENT ON COLUMN vehicles.heat_score IS
  'Market demand/interest score 0-100. High score = high interest vehicle. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals. NULL = not yet analyzed.';

COMMENT ON COLUMN vehicles.valuation_calculated_at IS
  'Timestamp of last valuation calculation. Updated by: compute-vehicle-valuation.';

-- SIGNAL FIELDS (DO NOT WRITE DIRECTLY)
COMMENT ON COLUMN vehicles.signal_score IS
  'Composite market signal score 0-100. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals. NULL = not yet scored.';

COMMENT ON COLUMN vehicles.signal_reasons IS
  'Array of human-readable reasons for signal_score. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals.';

COMMENT ON COLUMN vehicles.last_signal_assessed_at IS
  'Timestamp of last signal_score calculation. Updated by: analyze-market-signals.';

-- PERFORMANCE SCORES (DO NOT WRITE DIRECTLY)
COMMENT ON COLUMN vehicles.perf_power_score IS
  '0-100 performance score for power output. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from horsepower vs reference ceiling of 800hp.';

COMMENT ON COLUMN vehicles.perf_acceleration_score IS
  '0-100 acceleration score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from 0-60 time vs reference range 2.5s–25s.';

COMMENT ON COLUMN vehicles.perf_braking_score IS
  '0-100 braking score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from 60-0 ft vs reference range 90–250ft.';

COMMENT ON COLUMN vehicles.perf_handling_score IS
  '0-100 handling score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from lateral G.';

COMMENT ON COLUMN vehicles.social_positioning_score IS
  '0-100 demographic appeal / social desirability score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores.';

COMMENT ON COLUMN vehicles.investment_quality_score IS
  '0-100 investment quality score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores.';

COMMENT ON COLUMN vehicles.provenance_score IS
  '0-100 provenance/documentation quality score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores.';

COMMENT ON COLUMN vehicles.overall_desirability_score IS
  '0-100 overall desirability composite. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores.';

-- QUALITY & COMPLETENESS
COMMENT ON COLUMN vehicles.data_quality_score IS
  '0-100 data quality score. Higher = more complete/reliable data. Owned by: discover-comment-data, analyze-comments-fast, extractors (at import). Do not overwrite without recalculating.';

COMMENT ON COLUMN vehicles.completion_percentage IS
  '0-100 profile completion percentage. Owned by: calculate-profile-completeness. Do NOT write directly.';

COMMENT ON COLUMN vehicles.quality_grade IS
  'Numeric quality grade (scale defined by calculate-vehicle-scores). Owned by: calculate-vehicle-scores. NULL = not yet assessed.';

COMMENT ON COLUMN vehicles.condition_rating IS
  '1-10 physical condition rating where 10=concours, 1=parts only. User-entered or AI-assessed. Enforced by CHECK(1-10).';

COMMENT ON COLUMN vehicles.data_quality_flags IS
  'JSONB map of specific data quality issues. Example: {"missing_vin": true, "price_outlier": true}. Updated by multiple pipeline steps.';

-- ANALYSIS TIER
COMMENT ON COLUMN vehicles.analysis_tier IS
  'Processing tier for image analysis priority. 0=standard, higher=more thorough analysis. Used by: process-all-images-cron to determine analysis depth. Default: 0.';

-- ENRICHMENT STATE
COMMENT ON COLUMN vehicles.last_enrichment_attempt IS
  'Timestamp of last enrich-vehicle-profile-ai or enrich-bulk run for this vehicle.';

COMMENT ON COLUMN vehicles.enrichment_failures IS
  'Count of consecutive enrichment failures. Reset to 0 on success. Used by enrich-bulk to skip vehicles with repeated failures. Default: 0.';

-- PROVENANCE / IMPORT TRACKING
COMMENT ON COLUMN vehicles.entry_type IS
  'How this vehicle record was created. Values: owner_claim, contributor_data, title_verified, disputed. Enforced by CHECK constraint. Set at record creation.';

COMMENT ON COLUMN vehicles.import_source IS
  'Source platform/system that created this record (e.g., bat, craigslist, facebook, iphoto, api). Set by extractors. Do not change after creation.';

COMMENT ON COLUMN vehicles.import_queue_id IS
  'FK to import_queue.id. Links vehicle back to the queue job that created it. Set by continuous-queue-processor. Do not change.';

COMMENT ON COLUMN vehicles.platform_source IS
  'Original source platform. Set by extractors at creation. Values: bat, cars_and_bids, craigslist, facebook_marketplace, hagerty, rmsothebys, etc.';

COMMENT ON COLUMN vehicles.platform_url IS
  'Original listing URL on source platform. Set at creation by extractor. Archived to listing_page_snapshots automatically via archiveFetch.';

-- DESCRIPTION
COMMENT ON COLUMN vehicles.description IS
  'Vehicle description. Source tracked in description_source. AI-generated descriptions use generate-vehicle-description. Do not overwrite AI-generated content without updating description_source.';

COMMENT ON COLUMN vehicles.description_source IS
  'How description was created. Values: listing, ai_generated, user, imported. Set alongside description field.';

COMMENT ON COLUMN vehicles.description_generated_at IS
  'Timestamp when AI generated the description. Set by generate-vehicle-description.';

-- MSRP
COMMENT ON COLUMN vehicles.msrp IS
  'Original MSRP in USD. Source tracked in msrp_source. Values: oem (exact match), oem_exact_trim, oem_fuzzy_trim, oem_model_avg, listing_parsed, user, ai_estimated. Owned by: enrich-msrp.';

-- PRICE/SALE
COMMENT ON COLUMN vehicles.sale_price IS
  'Final sale price in USD cents (integer). Set by extractors at import. For auctions = hammer price.';

COMMENT ON COLUMN vehicles.asking_price IS
  'Listed asking price in USD. Set by extractors. May differ from sale_price.';

-- =============================================================================
-- TABLE: vehicle_images (127 columns — documenting the pipeline-critical ones)
-- =============================================================================

COMMENT ON COLUMN vehicle_images.ai_processing_status IS
  'AI analysis pipeline status. Values: pending (not yet processed), processing (currently being analyzed — do not pick up), completed (analysis done), failed (error, may retry). Owned by: photo-pipeline-orchestrator, process-all-images-cron, yono-batch-process. Do NOT set to "processing" without also setting ai_processing_started_at.';

COMMENT ON COLUMN vehicle_images.ai_processing_started_at IS
  'Timestamp when AI processing began. Set alongside ai_processing_status=processing. Used to detect stale locks (>30min = safe to reclaim).';

COMMENT ON COLUMN vehicle_images.ai_processing_completed_at IS
  'Timestamp when AI processing completed. Set alongside ai_processing_status=completed or failed.';

COMMENT ON COLUMN vehicle_images.optimization_status IS
  'Image optimization pipeline status. Values: pending (not optimized), optimized (thumbnails generated), failed. Owned by: image optimization pipeline. Default: pending.';

COMMENT ON COLUMN vehicle_images.organization_status IS
  'Vehicle assignment status. Values: unorganized (not assigned to a vehicle), organized (assigned to vehicle_id), ignored (intentionally skipped). Owned by: photo-sync-orchestrator, clarification-responder, auto-sort-photos. Default: unorganized.';

COMMENT ON COLUMN vehicle_images.angle IS
  'Camera angle/perspective. Values: front, front_3/4, side, rear_3/4, rear, interior, engine_bay, undercarriage, detail, document, unknown. Populated by: yono-classify (YONO local model), backfill-image-angles, AI analysis.';

COMMENT ON COLUMN vehicle_images.angle_source IS
  'How angle was determined. Values: yono (YONO local model), ai (cloud AI), user (manual), extractor (from source listing). Set alongside angle field.';

COMMENT ON COLUMN vehicle_images.angle_confidence IS
  '0-1 confidence in angle classification. Set by yono-classify or AI analysis. <0.5 = low confidence, consider re-analysis.';

COMMENT ON COLUMN vehicle_images.vehicle_vin IS
  'VIN detected in this image via AI/OCR. Populated by: photo-pipeline-orchestrator. Used to link images to vehicles. NULL = no VIN visible in image.';

COMMENT ON COLUMN vehicle_images.vehicle_confidence IS
  '0-1 confidence that this image contains the linked vehicle. Set by: identify-vehicle-from-image, photo-pipeline-orchestrator.';

COMMENT ON COLUMN vehicle_images.source IS
  'Where this image came from. Values: user_upload, extractor (scraped), iphoto (Apple Photos import), bat_image_library, organization_gallery. Set at insert. Default: user_upload.';

COMMENT ON COLUMN vehicle_images.approval_status IS
  'Content moderation status (content_approval_status enum). Values: pending, approved, rejected. Default: pending. DO NOT change to approved without content review for user-uploaded images.';

COMMENT ON COLUMN vehicle_images.verification_status IS
  'Vehicle assignment verification. Values: pending, approved, rejected. Enforced by CHECK constraint.';

COMMENT ON COLUMN vehicle_images.document_category IS
  'If is_document=true, the type of document. Values: receipt, invoice, title, registration, insurance, service_parts_id, vin_plate, window_sticker, build_sheet, manual, other_document. Enforced by CHECK constraint.';

COMMENT ON COLUMN vehicle_images.ai_suggestions IS
  'JSONB of AI-suggested metadata (angle, vehicle, condition). Populated by photo-pipeline-orchestrator. Do not overwrite — this is the raw AI output before human review.';

COMMENT ON COLUMN vehicle_images.analysis_history IS
  'JSONB array of previous AI analysis runs. Append-only. Used for auditing model drift.';

COMMENT ON COLUMN vehicle_images.stale IS
  'True if this image needs re-analysis (e.g., model updated). Set by pipeline when reanalysis is needed. Cleared by photo-pipeline-orchestrator on completion.';


-- =============================================================================
-- TABLE: import_queue
-- =============================================================================

COMMENT ON COLUMN import_queue.status IS
  'Queue processing status. Values: pending (waiting), processing (claimed by a worker — do not pick up), complete (successfully processed), failed (gave up after max_attempts), skipped (intentionally bypassed), duplicate (URL already exists). Enforced by CHECK constraint.';

COMMENT ON COLUMN import_queue.locked_by IS
  'ID of the worker instance that claimed this record. Format: cqp-{timestamp}-{random}. Set by continuous-queue-processor. If locked_at is >30min ago, lock is stale — use release_stale_locks().';

COMMENT ON COLUMN import_queue.locked_at IS
  'Timestamp when worker claimed this record. Stale threshold: 30 minutes. Use release_stale_locks() to reclaim stuck records.';

COMMENT ON COLUMN import_queue.attempts IS
  'Number of processing attempts. Incremented on each failure. When attempts >= max_attempts, status becomes failed.';

COMMENT ON COLUMN import_queue.vehicle_id IS
  'FK to vehicles.id. Populated when import successfully creates or matches a vehicle record. NULL = not yet processed.';

COMMENT ON COLUMN import_queue.extractor_version IS
  'Version of the extractor that processed this record. Used to re-queue records when extractor is updated.';

COMMENT ON COLUMN import_queue.failure_category IS
  'Categorized reason for failure. Values: rate_limited, not_found, parse_error, network_error, duplicate, validation_error. Set on failure for queue health monitoring.';


-- =============================================================================
-- TABLE: bat_extraction_queue
-- =============================================================================

COMMENT ON COLUMN bat_extraction_queue.status IS
  'Queue processing status. Values: pending, processing (claimed — do not pick up), complete, failed. Enforced by CHECK constraint.';

COMMENT ON COLUMN bat_extraction_queue.locked_by IS
  'Worker instance ID that claimed this record. Stale threshold: 30 minutes.';

COMMENT ON COLUMN bat_extraction_queue.locked_at IS
  'Timestamp when worker claimed this record. Use release_stale_locks() for stale reclamation.';

COMMENT ON COLUMN bat_extraction_queue.priority IS
  'Processing priority. Higher number = higher priority. Default: 100. High-comment listings get priority boost.';


-- =============================================================================
-- TABLE: document_ocr_queue
-- =============================================================================

COMMENT ON COLUMN document_ocr_queue.status IS
  'Pipeline step tracking. Values: pending → classifying (determining doc type) → extracting (running OCR/AI) → linking (connecting to vehicles/deals) → complete. Also: failed, skipped. Enforced by CHECK constraint. This is the model for step-based pipeline tracking.';

COMMENT ON COLUMN document_ocr_queue.locked_by IS
  'Worker instance ID. Stale threshold: 30 minutes. Use release_stale_locks() to reclaim.';

COMMENT ON COLUMN document_ocr_queue.extraction_provider IS
  'Which AI provider ran OCR. Values: openai, anthropic, google_vision, tesseract. Set by document-ocr-worker.';

COMMENT ON COLUMN document_ocr_queue.extraction_data IS
  'JSONB of extracted fields from the document. Schema varies by document_type. Written by document-ocr-worker after extraction completes.';

COMMENT ON COLUMN document_ocr_queue.linked_vehicle_id IS
  'FK to vehicles.id. Set during linking step. NULL = not yet linked or no vehicle match found.';


-- =============================================================================
-- TABLE: vehicle_observations (new unified architecture)
-- =============================================================================

COMMENT ON COLUMN vehicle_observations.kind IS
  'Type of observation (observation_kind enum). All extractors should write through ingest-observation edge function, not directly. Use ingest-observation to ensure proper lineage tracking.';

COMMENT ON COLUMN vehicle_observations.is_processed IS
  'Whether this observation has been analyzed by discover-from-observations. False = queued for analysis. Set to true by discover-from-observations when analysis completes.';

COMMENT ON COLUMN vehicle_observations.is_superseded IS
  'True if a newer observation from the same source supersedes this one. Set by ingest-observation when deduplicating. Superseded records are kept for audit trail.';

COMMENT ON COLUMN vehicle_observations.structured_data IS
  'JSONB of extracted structured fields. Schema varies by kind. DO NOT modify after insert — it is the immutable source record. Create a new observation instead.';

COMMENT ON COLUMN vehicle_observations.confidence IS
  'Confidence level enum (confidence_level). Set by extractor based on source reliability and extraction quality.';

COMMENT ON COLUMN vehicle_observations.source_id IS
  'FK to observation_sources.id. Identifies which source produced this observation. Always required — every observation must have a source.';
