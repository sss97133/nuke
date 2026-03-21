# Nuke Database Dictionary

Generated: 2026-03-20 21:36 | Schema: public | PostgreSQL 17 on Supabase

Comprehensive reference of every table and column in the Nuke vehicle data platform.
Tables are grouped by domain and sorted by row count within each group.

---

## Table of Contents

**824 tables** | **14,739 columns** | **76,231,187 total rows**

- [Core Vehicle Data](#core-vehicle-data) (22 tables, 36.3M rows)
- [Vehicle Metadata and Provenance](#vehicle-metadata-and-provenance) (15 tables, 3.1M rows)
- [Image Analysis Pipeline](#image-analysis-pipeline) (16 tables, 2.2M rows)
- [Auction and Sales Data](#auction-and-sales-data) (19 tables, 17.6M rows)
- [Extraction and Processing Queues](#extraction-and-processing-queues) (14 tables, 5.4M rows)
- [Market Intelligence](#market-intelligence) (12 tables, 2.3M rows)
- [Organizations and Identity](#organizations-and-identity) (16 tables, 2.6M rows)
- [Ownership and Transfers](#ownership-and-transfers) (4 tables, 1.6M rows)
- [Discovery and Observations](#discovery-and-observations) (6 tables, 166.9K rows)
- [Reference Data](#reference-data) (20 tables, 208.9K rows)
- [Content and Publications](#content-and-publications) (11 tables, 516.0K rows)
- [Marketplace and Scraping](#marketplace-and-scraping) (13 tables, 196.7K rows)
- [Business and Deals](#business-and-deals) (12 tables, 31.9K rows)
- [Pipeline and System](#pipeline-and-system) (16 tables, 1.5M rows)
- [Materialized Views](#materialized-views) (9 tables, 867.4K rows)
- [User and Agent Systems](#user-and-agent-systems) (15 tables, 245.6K rows)
- [Geo and Mapping](#geo-and-mapping) (9 tables, 93.1K rows)
- [Notifications and Communication](#notifications-and-communication) (8 tables, 693 rows)

---

## Core Vehicle Data

### `vehicle_images`

**Rows:** 32,861,635 (32.9M)
**Pipeline:** Vehicle image records with AI analysis pipeline (YONO, photo-pipeline-orchestrator).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `image_url` | text | NO |  |  |
| `image_type` | text | YES | 'general' |  |
| `category` | text | YES | 'general' |  |
| `position` | integer | YES | 0 |  |
| `caption` | text | YES |  |  |
| `is_primary` | boolean | YES | false | Whether this is the primary/lead image for the vehicle |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `exif_data` | jsonb | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `image_context` | text | YES |  |  |
| `file_hash` | text | YES |  | SHA-256 hash of file content for exact duplicate detection |
| `file_name` | text | YES |  |  |
| `file_size` | bigint | YES |  | File size in bytes |
| `taken_at` | timestamp with time zone | YES |  |  |
| `source` | text | YES | 'user_upload' | Where this image came from. Values: user_upload, extractor (scraped), iphoto (Apple Photos import), bat_image_library, organization_gallery. Set at insert. Default: user_upload. |
| `source_url` | text | YES |  | Original URL if image was scraped/downloaded from external source |
| `is_external` | boolean | YES | false | True if image is referenced externally (not stored in our storage) |
| `mime_type` | text | YES |  | MIME type of the image file |
| `is_sensitive` | boolean | NO | false |  |
| `sensitive_type` | text | YES |  |  |
| `storage_path` | text | YES |  | Storage path in Supabase storage bucket |
| `safe_preview_url` | text | YES |  |  |
| `process_stage` | text | YES |  |  |
| `workflow_role` | text | YES |  |  |
| `area` | text | YES |  |  |
| `part` | text | YES |  |  |
| `damage_type` | text | YES |  |  |
| `operation` | text | YES |  |  |
| `materials` | ARRAY | YES |  |  |
| `labels` | ARRAY | YES |  |  |
| `task_id` | uuid | YES |  |  |
| `event_id` | uuid | YES |  |  |
| `angle` | text | YES |  | Camera angle/perspective. Values: front, front_3/4, side, rear_3/4, rear, interior, engine_bay, undercarriage, detail, document, unknown. Populated by: yono-classify (YONO local model), backfill-image-angles, AI analysis. write via: `yono-classify` |
| `perspective` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `thumbnail_url` | text | YES |  | URL for the 150px thumbnail variant. |
| `medium_url` | text | YES |  | URL for the 400px medium variant. |
| `large_url` | text | YES |  | URL for the 800px large variant. |
| `optimization_status` | text | YES | 'pending' | Image optimization pipeline status. Values: pending (not optimized), optimized (thumbnails generated), failed. Owned by: image optimization pipeline. Default: pending. |
| `optimized_at` | timestamp with time zone | YES |  | Timestamp when optimization was completed. |
| `variants` | jsonb | YES | '{}' |  |
| `spatial_tags` | ARRAY | YES | ARRAY[][] | JSONB array storing spatial tags with coordinates, types, verification status, and metadata |
| `ai_scan_metadata` | jsonb | YES | '{}' |  |
| `ai_last_scanned` | timestamp with time zone | YES |  |  |
| `ai_component_count` | integer | YES | 0 |  |
| `ai_avg_confidence` | numeric | YES |  |  |
| `filename` | text | YES |  | Original filename of uploaded image |
| `temp_session_id` | text | YES |  | Temporary session ID for associating scraped images before vehicle is saved |
| `is_approved` | boolean | YES | true |  |
| `approved_by` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `imported_by` | uuid | YES |  | User who ran the import automation - NOT the photographer/contributor |
| `ghost_user_id` | uuid | YES |  | Ghost user (device) that took the photo - mutually exclusive with user_id |
| `verification_status` | text | YES | 'approved' | Vehicle assignment verification. Values: pending, approved, rejected. Enforced by CHECK constraint. Values: `pending`, `approved`, `rejected` |
| `pending_submission_id` | uuid | YES |  |  |
| `image_category` | text | YES |  |  |
| `approval_status` | USER-DEFINED | NO | 'pending'::content_approval_status | Content moderation status (content_approval_status enum). Values: pending, approved, rejected. Default: pending. DO NOT change to approved without content review for user-uploaded images. |
| `submitted_by` | uuid | YES |  |  |
| `redaction_level` | USER-DEFINED | NO | 'none'::content_redaction_level |  |
| `redacted_by` | uuid | YES |  |  |
| `redacted_at` | timestamp with time zone | YES |  |  |
| `redaction_reason` | text | YES |  |  |
| `uploaded_at` | timestamp with time zone | YES | now() |  |
| `analysis_history` | jsonb | YES | '{}' | JSONB array of previous AI analysis runs. Append-only. Used for auditing model drift. |
| `context_score` | integer | YES | 0 |  |
| `processing_models_used` | ARRAY | YES | ARRAY[][] |  |
| `total_processing_cost` | numeric | YES | 0 |  |
| `rotation` | integer | YES | 0 | Display rotation in degrees: 0, 90, 180, 270 |
| `document_classification` | text | YES |  | AI/automated classification of document type |
| `is_document` | boolean | YES | false | True if this image is a document (receipt, title, etc.) rather than a vehicle photo |
| `document_category` | text | YES |  | If is_document=true, the type of document. Values: receipt, invoice, title, registration, insurance, service_parts_id, vin_plate, window_sticker, build_sheet, manual, other_document. Enforced by CHECK constraint. |
| `manual_priority` | integer | YES | 0 |  |
| `display_order` | integer | YES | 0 |  |
| `user_tags` | ARRAY | YES | '{}'[] |  |
| `user_notes` | text | YES |  |  |
| `ai_processing_status` | text | YES | 'pending' | AI analysis pipeline status. Values: pending (not yet processed), processing (currently being analyzed — do not pick up), completed (analysis done), failed (error, may retry). Owned by: photo-pipeline-orchestrator, process-all-images-cron, yono-batch-process. Do NOT set to "processing" without also setting ai_processing_started_at. write via: `photo-pipeline-orchestrator` |
| `ai_processing_started_at` | timestamp with time zone | YES |  | Timestamp when AI processing began. Set alongside ai_processing_status=processing. Used to detect stale locks (>30min = safe to reclaim). |
| `ai_processing_completed_at` | timestamp with time zone | YES |  | Timestamp when AI processing completed. Set alongside ai_processing_status=completed or failed. |
| `ai_suggestions` | jsonb | YES | '{}' | JSONB of AI-suggested metadata (angle, vehicle, condition). Populated by photo-pipeline-orchestrator. Do not overwrite — this is the raw AI output before human review. PROTECTED -- owner: `photo-pipeline-orchestrator` write via: `photo-pipeline-orchestrator` |
| `organization_status` | text | YES | 'unorganized' | Vehicle assignment status. Values: unorganized (not assigned to a vehicle), organized (assigned to vehicle_id), ignored (intentionally skipped). Owned by: photo-sync-orchestrator, clarification-responder, auto-sort-photos. Default: unorganized. |
| `organized_at` | timestamp with time zone | YES |  |  |
| `ai_detected_vehicle` | jsonb | YES |  |  |
| `ai_detected_angle` | text | YES |  |  |
| `ai_detected_angle_confidence` | real | YES |  |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `perceptual_hash` | text | YES |  | DEPRECATED: use phash instead. Will be dropped after migration confirmed stable. |
| `dhash` | text | YES |  | Difference hash for crop/edit detection |
| `duplicate_of` | uuid | YES |  | References the original image if this is a duplicate |
| `is_duplicate` | boolean | YES | false | True if this image is a duplicate of another |
| `documented_by_device` | text | YES |  |  |
| `documented_by_user_id` | uuid | YES |  |  |
| `photographer_attribution` | text | YES |  |  |
| `user_confirmed_vehicle` | boolean | YES | false |  |
| `user_confirmed_vehicle_by` | uuid | YES |  |  |
| `user_confirmed_vehicle_at` | timestamp with time zone | YES |  |  |
| `auto_suggested_vehicle_id` | uuid | YES |  |  |
| `auto_suggestion_confidence` | real | YES |  |  |
| `auto_suggestion_reasons` | ARRAY | YES |  |  |
| `angle_confidence` | numeric | YES |  | 0-1 confidence in angle classification. Set by yono-classify or AI analysis. <0.5 = low confidence, consider re-analysis. |
| `yaw_deg` | numeric | YES |  |  |
| `yaw_confidence` | numeric | YES |  |  |
| `angle_source` | text | YES |  | How angle was determined. Values: yono (YONO local model), ai (cloud AI), user (manual), extractor (from source listing). Set alongside angle field. |
| `bbox` | jsonb | YES |  |  |
| `doc_flag` | boolean | YES |  |  |
| `doc_confidence` | numeric | YES |  |  |
| `components` | jsonb | YES |  |  |
| `vehicle_vin` | text | YES |  | VIN detected in this image via AI/OCR. Populated by: photo-pipeline-orchestrator. Used to link images to vehicles. NULL = no VIN visible in image. |
| `vehicle_vin_confidence` | numeric | YES |  |  |
| `vehicle_make` | text | YES |  |  |
| `vehicle_model` | text | YES |  |  |
| `vehicle_year` | integer | YES |  |  |
| `vehicle_confidence` | numeric | YES |  | 0-1 confidence that this image contains the linked vehicle. Set by: identify-vehicle-from-image, photo-pipeline-orchestrator. |
| `vehicle_source` | text | YES |  |  |
| `stale` | boolean | YES | false | True if this image needs re-analysis (e.g., model updated). Set by pipeline when reanalysis is needed. Cleared by photo-pipeline-orchestrator on completion. |
| `last_rerun_at` | timestamp with time zone | YES |  |  |
| `tags` | jsonb | YES | '[]' |  |
| `ai_extractions` | jsonb | YES | '[]' |  |
| `ai_extraction_consensus` | jsonb | YES | '{}' |  |
| `device_fingerprint` | text | YES |  | MD5 of camera make+model for ownership tracking |
| `location_confidence` | numeric | YES |  |  |
| `phash` | text | YES |  | Perceptual hash for visual similarity matching |
| `condition_score` | smallint | YES |  | PROTECTED -- owner: `yono-analyze` write via: `yono-analyze` |
| `damage_flags` | ARRAY | YES | '{}'[] | PROTECTED -- owner: `yono-analyze` write via: `yono-analyze` |
| `modification_flags` | ARRAY | YES | '{}'[] | PROTECTED -- owner: `yono-analyze` write via: `yono-analyze` |
| `photo_quality_score` | smallint | YES |  | PROTECTED -- owner: `yono-analyze` write via: `yono-analyze` |
| `vision_analyzed_at` | timestamp with time zone | YES |  |  |
| `vision_model_version` | text | YES |  |  |
| `surface_coord_v` | numeric | YES |  |  |
| `surface_coord_u` | numeric | YES |  |  |
| `camera_pose` | jsonb | YES |  |  |
| `vehicle_zone` | text | YES |  |  |
| `zone_confidence` | numeric | YES |  |  |
| `yono_queued_at` | timestamp with time zone | YES |  |  |
| `interior_quality` | smallint | YES |  | Interior condition rating 1-5 (1=poor, 5=excellent). NULL for non-interior photos. Written by yono-vision-worker via Florence-2 VisionHead interior_quality_head. |
| `zone_source` | text | YES |  | How vehicle_zone was determined: zone_classifier_v1 (ZoneClassifierHead 72.8% val_acc), photo_type_heuristic, or manual. |
| `fabrication_stage` | text | YES |  | Fabrication stage: raw/disassembled/stripped/fabricated/primed/blocked/basecoated/clearcoated/assembled/complete. Owned by yono-analyze. PROTECTED -- owner: `yono-analyze` write via: `yono-analyze` |
| `stage_confidence` | real | YES |  | Confidence in fabrication_stage prediction (0-1). Owned by yono-analyze. |
| `duration_seconds` | numeric | YES |  |  |
| `video_codec` | text | YES |  |  |
| `video_resolution` | text | YES |  |  |
| `is_video` | boolean | YES | false |  |
| `image_vehicle_match_status` | text | YES |  | Vehicle match status: null=unchecked, confirmed=matches parent vehicle, mismatch=shows different vehicle, ambiguous=cant determine (interior/detail/doc), unrelated=not a vehicle image. Owned by check-image-vehicle-match. PROTECTED -- owner: `check-image-vehicle-match` write via: `check-image-vehicle-match` Values: `confirmed`, `mismatch`, `ambiguous`, `unrelated` |
| `image_medium` | text | NO | 'photograph' | Image medium type: photograph (real camera), render (3D/CGI), drawing (sketch/illustration), screenshot (screen capture). Default: photograph. Values: `photograph`, `render`, `drawing`, `screenshot` |
| `apple_ml_labels` | ARRAY | YES |  | Apple Photos ML labels from osxphotos (e.g. Automobile, Tire, Wheel). Set by photo-sync.mjs at upload. |
| `vehicle_score` | real | YES |  | Pre-filter vehicle confidence score 0-1 from Apple ML labels. Set by photo-sync.mjs. >= 0.3 passes filter. |

### `vehicle_observations`

**Rows:** 1,539,570 (1.5M)
**Pipeline:** Unified event store. ALWAYS write through ingest-observation edge function.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_match_confidence` | numeric | YES |  |  |
| `vehicle_match_signals` | jsonb | YES |  |  |
| `observed_at` | timestamp with time zone | NO |  |  |
| `ingested_at` | timestamp with time zone | YES | now() |  |
| `source_id` | uuid | YES |  | FK to observation_sources.id. Identifies which source produced this observation. Always required — every observation must have a source. |
| `source_url` | text | YES |  |  |
| `source_identifier` | text | YES |  |  |
| `observer_id` | uuid | YES |  |  |
| `observer_raw` | jsonb | YES |  |  |
| `kind` | USER-DEFINED | NO |  | Type of observation (observation_kind enum). All extractors should write through ingest-observation edge function, not directly. Use ingest-observation to ensure proper lineage tracking. |
| `content_text` | text | YES |  |  |
| `content_hash` | text | YES |  |  |
| `structured_data` | jsonb | NO | '{}' | JSONB of extracted structured fields. Schema varies by kind. DO NOT modify after insert — it is the immutable source record. Create a new observation instead. PROTECTED -- owner: `ingest-observation` write via: `ingest-observation` |
| `confidence` | USER-DEFINED | YES | 'medium'::confidence_level | Confidence level enum (confidence_level). Set by extractor based on source reliability and extraction quality. |
| `confidence_score` | numeric | YES |  |  |
| `confidence_factors` | jsonb | YES | '{}' |  |
| `is_processed` | boolean | YES | false | Whether this observation has been analyzed by discover-from-observations. False = queued for analysis. Set to true by discover-from-observations when analysis completes. |
| `processing_metadata` | jsonb | YES |  |  |
| `extractor_id` | uuid | YES |  |  |
| `extraction_metadata` | jsonb | YES |  |  |
| `is_superseded` | boolean | YES | false | True if a newer observation from the same source supersedes this one. Set by ingest-observation when deduplicating. Superseded records are kept for audit trail. PROTECTED -- owner: `ingest-observation` write via: `ingest-observation` |
| `superseded_by` | uuid | YES |  |  |
| `superseded_at` | timestamp with time zone | YES |  |  |
| `lineage_chain` | ARRAY | YES |  |  |
| `original_source_id` | uuid | YES |  |  |
| `original_source_url` | text | YES |  |  |
| `discovered_via_id` | uuid | YES |  |  |
| `data_freshness_at_discovery` | interval | YES |  |  |
| `submitted_by_user_id` | uuid | YES |  |  |

### `vehicles`

**Rows:** 651,844 (651.8K)
**Pipeline:** Core vehicle records. Many columns are pipeline-computed.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `uploaded_by` | uuid | YES | auth.uid() | User who uploaded/created this vehicle record |
| `make` | text | YES |  | Vehicle make. Normalized via canonical_makes table. Populated by: decode-vin-and-update, batch-ymm-propagate, extractors. |
| `model` | text | YES |  | Vehicle model. Normalized via canonical_models table. Populated by: decode-vin-and-update, batch-ymm-propagate, extractors. |
| `year` | integer | YES |  | Model year (4-digit integer). Populated by: decode-vin-and-update, extractors. |
| `vin` | text | YES |  | Vehicle Identification Number. 17 chars, uppercase, no I/O/Q. Populated by: decode-vin-and-update (NHTSA VPIC API) or batch-vin-decode. Do NOT write directly unless you have a verified source — use decode-vin-and-update. |
| `license_plate` | text | YES |  |  |
| `color` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `engine_size` | text | YES |  |  |
| `horsepower` | integer | YES |  |  |
| `torque` | integer | YES |  |  |
| `drivetrain` | text | YES |  | Drivetrain type (4WD, AWD, FWD, RWD, etc.) - separate from trim level |
| `body_style` | text | YES |  |  |
| `doors` | integer | YES |  |  |
| `seats` | integer | YES |  |  |
| `weight_lbs` | integer | YES |  |  |
| `length_inches` | integer | YES |  |  |
| `width_inches` | integer | YES |  |  |
| `height_inches` | integer | YES |  |  |
| `wheelbase_inches` | integer | YES |  |  |
| `fuel_capacity_gallons` | numeric | YES |  |  |
| `mpg_city` | integer | YES |  |  |
| `mpg_highway` | integer | YES |  |  |
| `mpg_combined` | integer | YES |  |  |
| `msrp` | numeric | YES |  | Original MSRP in USD. Source tracked in msrp_source. Values: oem (exact match), oem_exact_trim, oem_fuzzy_trim, oem_model_avg, listing_parsed, user, ai_estimated. Owned by: enrich-msrp. |
| `current_value` | numeric | YES |  |  |
| `purchase_price` | numeric | YES |  |  |
| `purchase_date` | date | YES |  | Actual date when the vehicle was purchased. Provided manually by user or from bill of sale. May differ from title_transfer_date which is the legal ownership change date. |
| `purchase_location` | text | YES |  |  |
| `previous_owners` | integer | YES | 0 |  |
| `is_modified` | boolean | YES | false |  |
| `modification_details` | text | YES |  |  |
| `condition_rating` | integer | YES |  | 1-10 physical condition rating where 10=concours, 1=parts only. User-entered or AI-assessed. Enforced by CHECK(1-10). |
| `maintenance_notes` | text | YES |  |  |
| `insurance_company` | text | YES |  |  |
| `insurance_policy_number` | text | YES |  |  |
| `registration_state` | text | YES |  |  |
| `registration_expiry` | date | YES |  |  |
| `inspection_expiry` | date | YES |  |  |
| `is_public` | boolean | YES | true |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `sale_price` | integer | YES |  | Final sale price in USD cents (integer). Set by extractors at import. For auctions = hammer price. |
| `auction_end_date` | text | YES |  | When the auction ends/ended |
| `bid_count` | integer | YES |  |  |
| `view_count` | integer | YES |  |  |
| `auction_source` | text | YES |  |  |
| `ownership_verified` | boolean | YES | false |  |
| `ownership_verified_at` | timestamp without time zone | YES |  |  |
| `ownership_verification_id` | uuid | YES |  |  |
| `bat_auction_url` | text | YES |  | Bring a Trailer auction URL if applicable |
| `bat_sold_price` | numeric | YES |  | Final sale price from BAT auction |
| `bat_sale_date` | date | YES |  | Date the BAT auction ended/vehicle was sold |
| `bat_bid_count` | integer | YES |  |  |
| `bat_view_count` | integer | YES |  |  |
| `is_daily_driver` | boolean | YES | false |  |
| `is_weekend_car` | boolean | YES | false |  |
| `is_track_car` | boolean | YES | false |  |
| `is_show_car` | boolean | YES | false |  |
| `is_project_car` | boolean | YES | false |  |
| `is_garage_kept` | boolean | YES | false |  |
| `discovered_by` | uuid | YES |  | User who discovered this vehicle (for non-owned vehicles) |
| `discovery_source` | text | YES |  | Required for automated imports. Examples: dropbox_bulk_import, bat_extension, url_scraper. Used by trigger to infer profile_origin. |
| `discovery_url` | text | YES |  | Original URL where vehicle was discovered |
| `bat_listing_title` | text | YES |  | Original Bring a Trailer listing title |
| `bat_bids` | integer | YES |  | Number of bids from BAT listing |
| `bat_comments` | integer | YES |  | Number of comments from BAT listing |
| `bat_views` | integer | YES |  | Number of views from BAT listing |
| `bat_location` | text | YES |  | Location from BAT listing |
| `bat_seller` | text | YES |  | Seller username from BAT listing |
| `sale_status` | text | YES | 'available' | Current sale/market state. Values: available, for_sale, not_for_sale, pending, sold, unsold, not_sold, auction_live, ended, discovered, upcoming, bid_to. Set by extractors and market pipeline. NOTE: sold/unsold/not_sold are overlapping legacy values — use "sold" for new records. |
| `sale_date` | date | YES |  | Date of sale if sold |
| `status` | text | YES | 'active' | Lifecycle status. Values: active (normal), pending (being processed), sold, discovered (scraped, not yet linked), merged (duplicate merged into another), rejected, inactive, archived, deleted, pending_backfill, duplicate. Default: active. |
| `completion_percentage` | integer | YES | 0 | 0-100 profile completion percentage. Owned by: calculate-profile-completeness. Do NOT write directly. PROTECTED -- owner: `calculate-profile-completeness` write via: `calculate-profile-completeness` |
| `displacement` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `is_for_sale` | boolean | YES | false |  |
| `is_draft` | boolean | YES | false | Indicates if this vehicle record is a draft (not published) |
| `deleted_at` | timestamp with time zone | YES |  |  |
| `entry_type` | text | YES | 'owner_claim' | How this vehicle record was created. Values: owner_claim, contributor_data, title_verified, disputed. Enforced by CHECK constraint. Set at record creation. Values: `owner_claim`, `contributor_data`, `title_verified`, `disputed` |
| `verification_status` | text | YES | 'unverified' | Data verification level. Values: unverified, contributor_verified, title_verified, multi_verified, disputed. Enforced by CHECK constraint. Values: `unverified`, `contributor_verified`, `title_verified`, `multi_verified`, `disputed` |
| `confidence_score` | integer | YES | 50 |  |
| `source` | text | YES |  |  |
| `import_source` | character varying | YES |  | Source platform/system that created this record (e.g., bat, craigslist, facebook, iphoto, api). Set by extractors. Do not change after creation. |
| `import_metadata` | jsonb | YES |  |  |
| `uploaded_at` | timestamp without time zone | YES | now() |  |
| `asking_price` | numeric | YES |  | Listed asking price in USD. Set by extractors. May differ from sale_price. |
| `owner_shop_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  | Primary owner - User who owns this vehicle |
| `acting_on_behalf_of` | text | YES |  | Who the user is acting on behalf of (self, family, business, etc.) |
| `ownership_percentage` | numeric | YES |  | Percentage of ownership (0-100) |
| `owner_name` | text | YES |  | Name of the actual owner if different from user |
| `owner_contact` | text | YES |  | Contact information for the owner |
| `relationship_notes` | text | YES |  | Additional notes about ownership relationship |
| `description` | text | YES |  | Vehicle description. Source tracked in description_source. AI-generated descriptions use generate-vehicle-description. Do not overwrite AI-generated content without updating description_source. |
| `value_score` | numeric | YES | 0 |  |
| `value_breakdown` | jsonb | YES | '{}' |  |
| `owner_id` | uuid | YES |  |  |
| `quality_grade` | numeric | YES |  | Numeric quality grade (scale defined by calculate-vehicle-scores). Owned by: calculate-vehicle-scores. NULL = not yet assessed. PROTECTED -- owner: `calculate-vehicle-scores` write via: `calculate-vehicle-scores` |
| `investment_grade` | text | YES |  |  |
| `investment_confidence` | integer | YES |  |  |
| `quality_last_assessed` | timestamp with time zone | YES |  |  |
| `trim` | text | YES |  |  |
| `color_primary` | text | YES |  |  |
| `color_secondary` | text | YES |  |  |
| `paint_code` | text | YES |  |  |
| `paint_code_secondary` | text | YES |  |  |
| `zip_code` | text | YES |  | ZIP code for location-based filtering |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `country` | text | YES | 'USA' |  |
| `gps_latitude` | numeric | YES |  | GPS latitude (auto-populated from image EXIF) |
| `gps_longitude` | numeric | YES |  | GPS longitude (auto-populated from image EXIF) |
| `imported_by` | uuid | YES |  | User who automated the vehicle creation - NOT the discoverer |
| `title_transfer_date` | date | YES |  | Official date on the title document when ownership legally changed. Extracted from title scan. This may differ from purchase_date which represents the actual transaction date. |
| `primary_image_url` | text | YES |  |  |
| `title` | text | YES |  |  |
| `data_quality_score` | integer | YES | 0 | 0-100 data quality score. Higher = more complete/reliable data. Owned by: discover-comment-data, analyze-comments-fast, extractors (at import). Do not overwrite without recalculating. |
| `quality_issues` | ARRAY | YES | '{}'[] |  |
| `requires_improvement` | boolean | YES | false |  |
| `last_quality_check` | timestamp with time zone | YES |  |  |
| `vin_source` | text | YES |  | Where the VIN came from. Values: nhtsa, user, ocr, listing_text, image_extraction, title_document. Set automatically by the extraction pipeline. |
| `year_source` | text | YES |  |  |
| `make_source` | text | YES |  |  |
| `model_source` | text | YES |  |  |
| `mileage_source` | text | YES |  |  |
| `engine_source` | text | YES |  |  |
| `transmission_source` | text | YES |  |  |
| `color_source` | text | YES |  |  |
| `vin_confidence` | integer | YES | 50 | 0-100 confidence in the VIN value. Set by decode-vin-and-update. 100=verified, 50=extracted, <50=uncertain. |
| `year_confidence` | integer | YES | 50 |  |
| `make_confidence` | integer | YES | 50 |  |
| `model_confidence` | integer | YES | 50 |  |
| `created_by_user_id` | uuid | YES |  | User who invoked the creation (operator/technician) |
| `created_via_role` | text | YES |  | Role context: board_member, owner, admin, contributor |
| `import_method` | text | YES |  | How data was obtained: manual typing vs automation Values: `manual`, `automated`, `api`, `scraper`, `bulk_import` |
| `automation_script` | text | YES |  | Script name if automated: bat-bulk-scraper, vin-decoder, etc. |
| `content_source_type` | text | YES |  | Where content originated: organization listing, user entry, etc. Values: `organization`, `user`, `platform`, `third_party` |
| `content_source_id` | uuid | YES |  | UUID pointing to businesses or profiles table |
| `platform_source` | text | YES |  | Original source platform. Set by extractors at creation. Values: bat, cars_and_bids, craigslist, facebook_marketplace, hagerty, rmsothebys, etc. |
| `platform_url` | text | YES |  | Original listing URL on source platform. Set at creation by extractor. Archived to listing_page_snapshots automatically via archiveFetch. |
| `provenance_metadata` | jsonb | YES | '{}' | Full invocation chain as JSONB for complex cases |
| `bat_buyer` | text | YES |  | BaT username of buyer (for transaction chain: consigned by X, sold to Y) |
| `profile_origin` | text | YES |  | Source of vehicle profile creation: bat_import, dropbox_import, manual_entry, url_scraper, api_import, automated_import_legacy. MUST be set explicitly in application code - do not rely on trigger fallback. |
| `origin_organization_id` | uuid | YES |  | Organization that this vehicle profile originated from (if applicable) |
| `origin_metadata` | jsonb | YES | '{}' | Additional metadata about origin: {bat_seller, dropbox_folder, import_date, etc} |
| `series` | text | YES |  |  |
| `series_source` | text | YES |  |  |
| `series_confidence` | integer | YES |  |  |
| `trim_source` | text | YES |  |  |
| `trim_confidence` | integer | YES |  |  |
| `description_source` | text | YES |  | How description was created. Values: listing, ai_generated, user, imported. Set alongside description field. |
| `description_generated_at` | timestamp with time zone | YES |  | Timestamp when AI generated the description. Set by generate-vehicle-description. |
| `model_series` | text | YES |  |  |
| `cab_config` | text | YES |  |  |
| `trim_level` | text | YES |  |  |
| `engine_displacement` | text | YES |  |  |
| `engine_liters` | numeric | YES |  |  |
| `engine_type` | text | YES |  |  |
| `engine_code` | text | YES |  |  |
| `transmission_model` | text | YES |  |  |
| `transmission_type` | text | YES |  |  |
| `transmission_code` | text | YES |  |  |
| `merged_into_vehicle_id` | uuid | YES |  |  |
| `secondary_color` | text | YES |  | Secondary exterior color for two-tone paint jobs |
| `has_molding` | boolean | YES | false | Vehicle has decorative molding/trim |
| `has_pinstriping` | boolean | YES | false | Vehicle has pinstriping detail |
| `has_body_kit` | boolean | YES | false | Vehicle has aftermarket body kit |
| `has_racing_stripes` | boolean | YES | false | Vehicle has racing stripes |
| `trim_details` | text | YES |  | Additional trim/styling details (JSON or text) |
| `interior_color_secondary` | text | YES |  | Secondary interior color (e.g., door panels, dash) |
| `interior_color_tertiary` | text | YES |  | Tertiary interior color (e.g., carpet, headliner) |
| `seat_type` | text | YES |  | Type of seats: bench, bucket, split_bench, captain_chairs, bench_bucket_combo Values: `bench`, `bucket`, `split_bench`, `captain_chairs`, `bench_bucket_combo` |
| `seat_material_primary` | text | YES |  | Primary seat material (e.g., Leather, Vinyl, Cloth, Velour) |
| `seat_material_secondary` | text | YES |  | Secondary seat material for inserts/trim |
| `interior_material_details` | text | YES |  | Additional interior material details |
| `received_in_trade` | boolean | YES | false | Indicates if this vehicle was received as part of a trade transaction (including partial trades) |
| `import_queue_id` | uuid | YES |  | FK to import_queue.id. Links vehicle back to the queue job that created it. Set by continuous-queue-processor. Do not change. |
| `selling_organization_id` | uuid | YES |  |  |
| `price` | integer | YES |  |  |
| `sold_price` | integer | YES |  |  |
| `normalized_model` | text | YES |  |  |
| `normalized_series` | text | YES |  |  |
| `generation` | text | YES |  |  |
| `auction_outcome` | text | YES |  | Final auction result. Values: sold, reserve_not_met, no_sale, pending, ended. Set by: extractors, sync-live-auctions. Enforced by CHECK constraint. Values: `sold`, `reserve_not_met`, `no_sale`, `pending`, `ended` |
| `high_bid` | integer | YES |  | Highest bid amount (may not have won if reserve not met) |
| `winning_bid` | integer | YES |  | Final winning bid amount (only if sold) |
| `vin_source_image_id` | uuid | YES |  |  |
| `location` | text | YES |  |  |
| `is_streaming` | boolean | YES | false |  |
| `image_url` | text | YES |  |  |
| `search_vector` | tsvector | YES |  | Full-text search vector for fast, ranked searches |
| `listing_url` | text | YES |  |  |
| `listing_source` | text | YES |  |  |
| `listing_posted_at` | timestamp with time zone | YES |  |  |
| `listing_updated_at` | timestamp with time zone | YES |  |  |
| `listing_title` | text | YES |  |  |
| `listing_location` | text | YES |  |  |
| `analysis_tier` | integer | NO | 0 | Processing tier for image analysis priority. 0=standard, higher=more thorough analysis. Used by: process-all-images-cron to determine analysis depth. Default: 0. |
| `signal_score` | numeric | YES |  | Composite market signal score 0-100. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals. NULL = not yet scored. PROTECTED -- owner: `analyze-market-signals` write via: `analyze-market-signals` |
| `signal_reasons` | ARRAY | YES |  | Array of human-readable reasons for signal_score. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals. |
| `last_signal_assessed_at` | timestamp with time zone | YES |  | Timestamp of last signal_score calculation. Updated by: analyze-market-signals. |
| `listing_location_raw` | text | YES |  |  |
| `listing_location_observed_at` | timestamp with time zone | YES |  |  |
| `listing_location_source` | text | YES |  |  |
| `listing_location_confidence` | real | YES |  |  |
| `bat_lot_number` | text | YES |  | BaT lot number (e.g., 225044) |
| `bat_watchers` | integer | YES |  | Number of BaT users watching the listing |
| `reserve_status` | text | YES |  | Auction reserve outcome. Values: no_reserve, reserve_met, reserve_not_met. Set by: extractors at import time. NULL = not applicable or unknown. |
| `canonical_vehicle_type` | text | YES |  |  |
| `canonical_body_style` | text | YES |  |  |
| `listing_kind` | text | NO | 'vehicle' | Values: `vehicle`, `non_vehicle_item` |
| `segment_id` | uuid | YES |  |  |
| `era` | text | YES |  | Computed era bucket from year: antique/prewar/classic/muscle/malaise/90s/2000s/modern Values: `pre-war`, `post-war`, `classic`, `malaise`, `modern-classic`, `modern`, `contemporary` |
| `canonical_make_id` | uuid | YES |  |  |
| `source_listing_category` | text | YES |  |  |
| `dougs_take` | text | YES |  |  |
| `highlights` | text | YES |  |  |
| `equipment` | text | YES |  |  |
| `modifications` | text | YES |  |  |
| `known_flaws` | text | YES |  |  |
| `recent_service_history` | text | YES |  |  |
| `title_status` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `comment_count` | integer | YES |  |  |
| `auction_status` | text | YES |  | Current auction state. Values: active (live auction), ended (auction closed), sold. Set by: sync-live-auctions, bat-queue-worker. NULL = not an auction vehicle. |
| `extractor_version` | text | YES |  | Versioned extractor name, e.g. bat-extract:2.0.0 |
| `rennlist_url` | text | YES |  |  |
| `rennlist_listing_id` | text | YES |  |  |
| `documents_on_hand` | jsonb | YES | '{}' |  |
| `price_is_outlier` | boolean | YES | false |  |
| `price_outlier_reason` | text | YES |  |  |
| `data_gaps` | jsonb | YES | '{}' | WHY fields are null. Keys=field names, values={reason, details}. Reasons: auction_upcoming, not_on_listing, extraction_failed, source_removed, requires_auth |
| `nuke_estimate` | numeric | YES |  | AI-computed market value estimate in USD. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation. Updated when sufficient comparable data exists. PROTECTED -- owner: `compute-vehicle-valuation` write via: `compute-vehicle-valuation` |
| `nuke_estimate_confidence` | integer | YES |  | Confidence in nuke_estimate as 0-100 integer. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation. PROTECTED -- owner: `compute-vehicle-valuation` write via: `compute-vehicle-valuation` |
| `deal_score` | numeric | YES |  | Deal quality score 0-100. High score = listed below market. DO NOT WRITE DIRECTLY. Owned by: compute-vehicle-valuation or analyze-market-signals. NULL = insufficient data to score. PROTECTED -- owner: `compute-vehicle-valuation` write via: `compute-vehicle-valuation` |
| `heat_score` | numeric | YES |  | Market demand/interest score 0-100. High score = high interest vehicle. DO NOT WRITE DIRECTLY. Owned by: analyze-market-signals. NULL = not yet analyzed. PROTECTED -- owner: `analyze-market-signals` write via: `analyze-market-signals` |
| `valuation_calculated_at` | timestamp with time zone | YES |  | Timestamp of last valuation calculation. Updated by: compute-vehicle-valuation. |
| `zero_to_sixty` | numeric | YES |  |  |
| `quarter_mile` | numeric | YES |  |  |
| `quarter_mile_speed` | numeric | YES |  |  |
| `top_speed_mph` | integer | YES |  |  |
| `braking_60_0_ft` | numeric | YES |  |  |
| `lateral_g` | numeric | YES |  |  |
| `redline_rpm` | integer | YES |  |  |
| `power_to_weight` | numeric | YES |  |  |
| `suspension_front` | text | YES |  |  |
| `suspension_rear` | text | YES |  |  |
| `brake_type_front` | text | YES |  |  |
| `brake_type_rear` | text | YES |  |  |
| `wheel_diameter_front` | integer | YES |  |  |
| `wheel_diameter_rear` | integer | YES |  |  |
| `tire_spec_front` | text | YES |  |  |
| `tire_spec_rear` | text | YES |  |  |
| `tire_condition_score` | integer | YES |  |  |
| `brake_condition_score` | integer | YES |  |  |
| `suspension_condition_score` | integer | YES |  |  |
| `perf_power_score` | integer | YES |  | 0-100 performance score for power output. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from horsepower vs reference ceiling of 800hp. |
| `perf_acceleration_score` | integer | YES |  | 0-100 acceleration score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from 0-60 time vs reference range 2.5s–25s. |
| `perf_braking_score` | integer | YES |  | 0-100 braking score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from 60-0 ft vs reference range 90–250ft. |
| `perf_handling_score` | integer | YES |  | 0-100 handling score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. Derived from lateral G. |
| `perf_comfort_score` | integer | YES |  |  |
| `social_positioning_score` | integer | YES |  | 0-100 demographic appeal / social desirability score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. |
| `investment_quality_score` | integer | YES |  | 0-100 investment quality score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. PROTECTED -- owner: `calculate-vehicle-scores` write via: `calculate-vehicle-scores` |
| `provenance_score` | integer | YES |  | 0-100 provenance/documentation quality score. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. PROTECTED -- owner: `calculate-vehicle-scores` write via: `calculate-vehicle-scores` |
| `overall_desirability_score` | integer | YES |  | 0-100 overall desirability composite. DO NOT WRITE DIRECTLY. Owned by: calculate-vehicle-scores. PROTECTED -- owner: `calculate-vehicle-scores` write via: `calculate-vehicle-scores` |
| `perf_scores_updated_at` | timestamp with time zone | YES |  |  |
| `social_positioning_breakdown` | jsonb | YES |  |  |
| `compression_ratio` | numeric | YES |  |  |
| `compression_test_psi` | jsonb | YES |  |  |
| `leakdown_test_pct` | jsonb | YES |  |  |
| `engine_health_score` | integer | YES |  |  |
| `timing_type` | text | YES |  |  |
| `cam_type` | text | YES |  |  |
| `intake_type` | text | YES |  |  |
| `carburetor_type` | text | YES |  |  |
| `fuel_pressure_psi` | numeric | YES |  |  |
| `fuel_octane` | integer | YES |  |  |
| `distributor_type` | text | YES |  |  |
| `headers_type` | text | YES |  |  |
| `exhaust_type` | text | YES |  |  |
| `exhaust_diameter` | text | YES |  |  |
| `manifold_type` | text | YES |  |  |
| `oil_type` | text | YES |  |  |
| `coolant_type` | text | YES |  |  |
| `bore_mm` | numeric | YES |  |  |
| `stroke_mm` | numeric | YES |  |  |
| `rear_axle_ratio` | numeric | YES |  |  |
| `rear_axle_type` | text | YES |  |  |
| `transfer_case` | text | YES |  |  |
| `clutch_type` | text | YES |  |  |
| `driveshaft_type` | text | YES |  |  |
| `transmission_speeds` | integer | YES |  |  |
| `steering_type` | text | YES |  |  |
| `steering_pump` | text | YES |  |  |
| `steering_condition_score` | integer | YES |  |  |
| `frame_type` | text | YES |  |  |
| `brake_booster_type` | text | YES |  |  |
| `brake_master_cylinder` | text | YES |  |  |
| `front_rotor_size` | text | YES |  |  |
| `rear_rotor_size` | text | YES |  |  |
| `abs_equipped` | boolean | YES |  |  |
| `drag_coefficient` | numeric | YES |  |  |
| `frontal_area_sqft` | numeric | YES |  |  |
| `ground_clearance_inches` | numeric | YES |  |  |
| `ride_height_inches` | numeric | YES |  |  |
| `has_spoiler` | boolean | YES |  |  |
| `has_air_dam` | boolean | YES |  |  |
| `lift_inches` | numeric | YES |  |  |
| `last_fuel_receipt` | jsonb | YES |  |  |
| `fuel_system_type` | text | YES |  |  |
| `last_inspection_date` | date | YES |  |  |
| `inspection_type` | text | YES |  |  |
| `inspection_passed` | boolean | YES |  |  |
| `smog_exempt` | boolean | YES |  |  |
| `segment_slug` | text | YES |  |  |
| `last_enrichment_attempt` | timestamp with time zone | YES |  | Timestamp of last enrich-vehicle-profile-ai or enrich-bulk run for this vehicle. |
| `enrichment_failures` | integer | YES | 0 | Count of consecutive enrichment failures. Reset to 0 on success. Used by enrich-bulk to skip vehicles with repeated failures. Default: 0. |
| `msrp_source` | text | YES |  | Source of MSRP value: oem, user, ai_estimated, listing_parsed |
| `msrp_contributed_by` | uuid | YES |  | User who contributed the MSRP value (for user-sourced MSRPs) |
| `color_family` | text | YES |  |  |
| `data_quality_flags` | jsonb | YES | '{}' | JSONB map of specific data quality issues. Example: {"missing_vin": true, "price_outlier": true}. Updated by multiple pipeline steps. |
| `current_transfer_id` | uuid | YES |  | FK to ownership_transfers. Non-null while a transfer is in_progress. Drives the TRANSFER PENDING badge in the vehicle header. Owned by ownership transfer system — do not write directly. |
| `ownership_confirmed_at` | timestamp with time zone | YES |  | Timestamp of most recent completed title transfer (transfer_complete milestone). Represents legal ownership confirmation date. |
| `vehicle_category` | text | YES | 'car' | What this vehicle is: car, truck, suv, motorcycle, boat, rv, commercial, farm, other |
| `display_tier` | text | YES | 'browse' | Display prominence: featured (1955-1991 cool vehicles), browse (everything else), hidden (total junk) |
| `price_confidence` | text | YES |  | Price reliability: fabricated (CZ average, mod100!=0), suspected_average (round but repeated), plausible (round, 2-5x), likely_real (round, unique), verified (cross-referenced) |
| `cz_estimated_value` | numeric | YES |  | ConceptCarz site-wide model average ("Estimated Sale Value"). NOT a real transaction price. Preserved for reference. |
| `image_count` | integer | NO | 0 | Denormalized count of non-duplicate images from vehicle_images. Updated by trigger. |
| `observation_count` | integer | NO | 0 | Denormalized count from vehicle_observations. Updated by trigger. |
| `visual_signature` | jsonb | YES |  | AI-generated visual fingerprint for disambiguation between similar vehicles. Contains: paint_colors[], body_style, modifications[], unique_features[], signature_image_ids[]. Owned by check-image-vehicle-match edge function. |
| `discovery_priority` | smallint | YES |  | Discovery priority score 0-100. Higher = more interesting find. Set by FB scraper at extraction. Factors: collector make/model, age, price, listing quality. |
| `canonical_platform` | text | YES |  | Canonical platform slug. Auto-computed by trg_resolve_canonical_columns. DO NOT WRITE DIRECTLY. PROTECTED -- owner: `trg_resolve_canonical_columns` write via: `Auto-trigger` |
| `canonical_sold_price` | numeric | YES |  | THE price — transaction if sold, asking if for_sale, highest bid otherwise. Auto-computed by trigger. DO NOT WRITE DIRECTLY. PROTECTED -- owner: `trg_resolve_canonical_columns` write via: `Auto-trigger` |
| `canonical_outcome` | text | YES |  | sold/reserve_not_met/active/for_sale/ended/unknown. Auto-computed by trigger. DO NOT WRITE DIRECTLY. PROTECTED -- owner: `trg_resolve_canonical_columns` write via: `Auto-trigger` |

### `vehicle_quality_scores`

**Rows:** 624,841 (624.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `has_vin` | boolean | YES | false |  |
| `has_price` | boolean | YES | false |  |
| `has_images` | boolean | YES | false |  |
| `has_events` | boolean | YES | false |  |
| `has_mileage` | boolean | YES | false |  |
| `image_count` | integer | YES | 0 |  |
| `event_count` | integer | YES | 0 |  |
| `bat_image_count` | integer | YES | 0 |  |
| `dropbox_image_count` | integer | YES | 0 |  |
| `overall_score` | integer | YES | 0 |  |
| `issues` | ARRAY | YES | ARRAY[][] |  |
| `needs_bat_images` | boolean | YES | false |  |
| `needs_price_backfill` | boolean | YES | false |  |
| `needs_vin_lookup` | boolean | YES | false |  |
| `needs_deletion` | boolean | YES | false |  |
| `last_checked_at` | timestamp with time zone | YES | now() |  |
| `last_repaired_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_events`

**Rows:** 313,513 (313.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `source_organization_id` | uuid | YES |  |  |
| `source_platform` | text | NO |  |  |
| `source_url` | text | YES |  |  |
| `source_listing_id` | text | YES |  |  |
| `event_type` | text | NO | 'auction' |  |
| `event_status` | text | NO | 'active' |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `ended_at` | timestamp with time zone | YES |  |  |
| `sold_at` | timestamp with time zone | YES |  |  |
| `starting_price` | numeric | YES |  |  |
| `current_price` | numeric | YES |  |  |
| `final_price` | numeric | YES |  |  |
| `reserve_price` | numeric | YES |  |  |
| `buy_now_price` | numeric | YES |  |  |
| `bid_count` | integer | YES | 0 |  |
| `comment_count` | integer | YES | 0 |  |
| `view_count` | integer | YES | 0 |  |
| `watcher_count` | integer | YES | 0 |  |
| `seller_identifier` | text | YES |  |  |
| `buyer_identifier` | text | YES |  |  |
| `seller_external_identity_id` | uuid | YES |  |  |
| `buyer_external_identity_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `extraction_method` | text | YES |  |  |
| `extraction_source` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_agents`

**Rows:** 231,154 (231.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `agent_name` | text | YES |  |  |
| `personality` | text | YES |  |  |
| `voice_style` | text | YES | 'friendly' |  |
| `memory` | jsonb | YES | '{}' |  |
| `recent_context` | jsonb | YES | '[]' |  |
| `auto_claim_confidence` | double precision | YES | 0.8 |  |
| `notification_prefs` | jsonb | YES | '{"new_photos": true, "work_complete": true}' |  |
| `photos_received` | integer | YES | 0 |  |
| `messages_sent` | integer | YES | 0 |  |
| `last_active_at` | timestamp with time zone | YES |  |  |
| `owner_user_id` | uuid | YES |  |  |
| `owner_org_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_intelligence`

**Rows:** 82,822 (82.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `extraction_version` | text | NO | 'v1.0' |  |
| `extraction_method` | text | NO | 'hybrid' | regex = Tier 1 only, llm = Tier 2 only, hybrid = both |
| `extraction_confidence` | numeric | YES |  |  |
| `acquisition_year` | integer | YES |  |  |
| `acquisition_source` | text | YES |  |  |
| `previous_bat_sale_url` | text | YES |  |  |
| `previous_bat_sale_price` | integer | YES |  |  |
| `owner_count` | integer | YES |  |  |
| `notable_owner` | text | YES |  |  |
| `is_single_family` | boolean | YES |  |  |
| `service_events` | jsonb | YES | '[]' | Array of {date, mileage, description, shop} |
| `last_service_year` | integer | YES |  |  |
| `last_service_mileage` | integer | YES |  |  |
| `has_recent_service` | boolean | YES |  |  |
| `is_modified` | boolean | YES |  |  |
| `modification_level` | text | YES |  |  |
| `modifications` | jsonb | YES | '[]' | Array of {component, description, reversible} |
| `parts_replaced` | jsonb | YES | '[]' |  |
| `has_service_records` | boolean | YES |  |  |
| `service_records_from_year` | integer | YES |  |  |
| `has_window_sticker` | boolean | YES |  |  |
| `has_owners_manual` | boolean | YES |  |  |
| `has_books` | boolean | YES |  |  |
| `has_tools` | boolean | YES |  |  |
| `has_spare_key` | boolean | YES |  |  |
| `documentation_list` | jsonb | YES | '[]' |  |
| `is_running` | boolean | YES |  |  |
| `is_driving` | boolean | YES |  |  |
| `is_project` | boolean | YES |  |  |
| `is_restored` | boolean | YES |  |  |
| `restoration_year` | integer | YES |  |  |
| `known_issues` | jsonb | YES | '[]' |  |
| `seller_condition_notes` | jsonb | YES | '[]' |  |
| `registration_states` | jsonb | YES | '[]' |  |
| `original_delivery_dealer` | text | YES |  |  |
| `original_delivery_location` | text | YES |  |  |
| `climate_history` | text | YES |  |  |
| `rust_belt_exposure` | boolean | YES |  |  |
| `is_rust_free` | boolean | YES |  |  |
| `is_california_car` | boolean | YES |  |  |
| `never_winter_driven` | boolean | YES |  |  |
| `matching_numbers` | boolean | YES |  |  |
| `matching_components` | jsonb | YES | '[]' |  |
| `is_repainted` | boolean | YES |  |  |
| `repaint_color` | text | YES |  |  |
| `repaint_year` | integer | YES |  |  |
| `is_original_color` | boolean | YES |  |  |
| `replacement_components` | jsonb | YES | '[]' |  |
| `authenticity_notes` | jsonb | YES | '[]' |  |
| `awards` | jsonb | YES | '[]' | Array of {name, year, score} |
| `is_concours_quality` | boolean | YES |  |  |
| `is_show_winner` | boolean | YES |  |  |
| `production_number` | integer | YES |  |  |
| `total_production` | integer | YES |  |  |
| `special_edition_name` | text | YES |  |  |
| `is_limited_edition` | boolean | YES |  |  |
| `rarity_notes` | jsonb | YES | '[]' |  |
| `seller_disclosures` | jsonb | YES | '[]' | Facts revealed by seller in comment Q&A |
| `expert_insights` | jsonb | YES | '[]' | Technical knowledge from community comments |
| `comparable_sales` | jsonb | YES | '[]' |  |
| `condition_concerns` | jsonb | YES | '[]' |  |
| `reliability_notes` | jsonb | YES | '[]' |  |
| `raw_tier1_extraction` | jsonb | YES |  |  |
| `raw_tier2_extraction` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `numbers_extracted` | jsonb | YES | '{}' |  |
| `parts_mentioned` | ARRAY | YES | '{}'[] |  |
| `locations_mentioned` | jsonb | YES | '[]' |  |
| `people_mentioned` | jsonb | YES | '[]' |  |
| `key_dates` | jsonb | YES | '[]' |  |
| `notable_claims` | ARRAY | YES | '{}'[] |  |
| `service_shops` | ARRAY | YES | '{}'[] |  |

### `vehicle_grades`

**Rows:** 24,001 (24.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `grade` | numeric | NO |  |  |
| `grade_label` | text | NO |  |  |
| `grade_floor` | numeric | YES |  |  |
| `grade_ceiling` | numeric | YES |  |  |
| `confidence` | text | NO | 'insufficient' |  |
| `is_gradeable` | boolean | NO | false |  |
| `total_evidence` | integer | NO | 0 |  |
| `dimensions` | jsonb | YES |  |  |
| `calculated_at` | timestamp with time zone | NO | now() |  |
| `doc_score` | numeric | YES |  |  |
| `maint_score` | numeric | YES |  |  |
| `prov_score` | numeric | YES |  |  |
| `photo_score` | numeric | YES |  |  |
| `market_score` | numeric | YES |  |  |
| `condition_score` | numeric | YES |  |  |

### `vehicle_views`

**Rows:** 7,543 (7.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `viewed_at` | timestamp with time zone | YES | now() |  |
| `ip_address` | text | YES |  |  |

### `vehicle_contributor_roles`

**Rows:** 554 (554)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `role` | text | NO |  | Role types: consigner, mechanic, appraiser, photographer, transporter, inspector, dealer, historian |
| `shop_id` | uuid | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `approved_by` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `start_date` | date | YES | CURRENT_DATE |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `vehicle_condition_scores`

**Rows:** 373 (373)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `condition_score` | numeric | NO |  |  |
| `condition_tier` | text | NO |  |  |
| `percentile_within_ymm` | numeric | YES |  |  |
| `percentile_global` | numeric | YES |  |  |
| `ymm_key` | text | YES |  |  |
| `ymm_group_size` | integer | YES |  |  |
| `ymm_mean_score` | numeric | YES |  |  |
| `ymm_std_dev` | numeric | YES |  |  |
| `exterior_score` | numeric | YES |  |  |
| `interior_score` | numeric | YES |  |  |
| `mechanical_score` | numeric | YES |  |  |
| `provenance_score` | numeric | YES |  |  |
| `presentation_score` | numeric | YES |  |  |
| `lifecycle_state` | text | YES |  |  |
| `descriptor_summary` | jsonb | YES |  |  |
| `condition_rarity` | numeric | YES |  | 0-1: how unusual is this condition for this Y/M/M. High = rare (barn find 911 or concours K10). Low = common (clean 911). |
| `observation_count` | integer | YES |  |  |
| `zone_coverage` | numeric | YES |  |  |
| `computed_at` | timestamp with time zone | NO | now() |  |
| `computation_version` | text | NO | 'v1' |  |

### `vehicle_validation_issues`

**Rows:** 221 (221)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `rule_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `current_value` | text | YES |  |  |
| `error_level` | text | NO |  |  |
| `error_message` | text | NO |  |  |
| `status` | text | YES | 'open' | Values: `open`, `auto_fixed`, `manually_fixed`, `ignored`, `wont_fix` |
| `fixed_value` | text | YES |  |  |
| `fixed_by` | uuid | YES |  |  |
| `fixed_at` | timestamp with time zone | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_builder_attribution`

**Rows:** 182 (182)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `organization_id` | uuid | NO |  |  |
| `program_id` | uuid | YES |  |  |
| `build_number` | text | YES |  |  |
| `attribution_confidence` | numeric | YES | 0.50 |  |
| `attribution_method` | text | YES | 'title_match' |  |
| `provenance_chain` | jsonb | YES | '[]' |  |
| `source_url` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_condition_assessments`

**Rows:** 155 (155)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `vehicle_id` | uuid | YES |  |  |
| `assessment_date` | timestamp with time zone | YES | now() |  |
| `overall_condition_rating` | integer | YES |  |  |
| `exterior_rating` | integer | YES |  |  |
| `interior_rating` | integer | YES |  |  |
| `mechanical_rating` | integer | YES |  |  |
| `undercarriage_rating` | integer | YES |  |  |
| `condition_value_multiplier` | numeric | YES |  |  |
| `images_assessed` | ARRAY | YES |  |  |
| `assessment_completeness` | integer | YES |  |  |
| `assessed_by_model` | text | YES |  |  |
| `human_verified` | boolean | YES | false |  |
| `verified_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_documents`

**Rows:** 139 (139)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `uploaded_by` | uuid | YES |  |  |
| `document_type` | text | NO |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `file_url` | text | YES |  |  |
| `file_type` | text | YES |  |  |
| `amount` | numeric | YES |  |  |
| `vendor_name` | text | YES |  |  |
| `currency` | text | YES | 'USD' |  |
| `privacy_level` | text | YES | 'private' | Values: `private`, `organization`, `public` |
| `linked_to_tag_id` | uuid | YES |  |  |
| `source_document_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_unverified_owners`

**Rows:** 136 (136)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `contact_id` | uuid | YES |  |  |
| `source_listing_url` | text | YES |  |  |
| `source_post_id` | text | YES |  |  |
| `listing_date` | date | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `relationship_type` | text | YES | 'seller' | Values: `seller`, `owner`, `dealer`, `consigner`, `unknown` |
| `confidence_score` | numeric | YES | 0.5 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  |  |

### `vehicle_user_permissions`

**Rows:** 104 (104)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `role` | text | NO | 'contributor' | Values: `owner`, `co_owner`, `contributor`, `consigned`, `previously_owned` |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `granted_by` | uuid | YES |  |  |
| `permissions` | ARRAY | YES | ARRAY[][] |  |
| `context` | text | YES |  |  |
| `granted_at` | timestamp with time zone | YES | now() |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `revoked_at` | timestamp with time zone | YES |  |  |
| `revoked_by` | uuid | YES |  |  |

### `vehicle_valuations`

**Rows:** 60 (60)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `estimated_value` | numeric | NO |  |  |
| `documented_components` | numeric | YES | 0 |  |
| `confidence_score` | integer | YES |  |  |
| `components` | jsonb | YES |  |  |
| `environmental_context` | jsonb | YES |  |  |
| `value_justification` | text | YES |  |  |
| `methodology` | text | YES | 'expert_agent_v1' |  |
| `valuation_date` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `evidence_score` | integer | NO | 0 |  |
| `required_evidence` | jsonb | NO | '[]' |  |
| `source_run_id` | uuid | YES |  |  |

### `vehicle_segments`

**Rows:** 43 (43)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `parent_segment_id` | uuid | YES |  |  |
| `keywords` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `sort_order` | integer | YES | 0 |  |

### `vehicle_comments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `comment_text` | text | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `image_urls` | ARRAY | YES |  | Array of image URLs attached to comment |
| `is_nsfw` | boolean | YES | false | Mark comment images as NSFW (auto-blur until revealed) |
| `moderator_only` | boolean | YES | false | Only vehicle owner/moderators can see this comment and images |

### `vehicle_options`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `option_code` | text | NO |  |  |
| `option_name` | text | YES |  |  |
| `category` | text | YES |  |  |
| `source` | text | YES | 'manual' |  |
| `verified_by_spid` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_production_data`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year` | integer | NO |  |  |
| `body_style` | text | YES |  |  |
| `trim_level` | text | YES |  |  |
| `engine_option` | text | YES |  |  |
| `total_produced` | integer | YES |  |  |
| `us_production` | integer | YES |  |  |
| `canadian_production` | integer | YES |  |  |
| `mexican_production` | integer | YES |  |  |
| `export_production` | integer | YES |  |  |
| `rarity_level` | text | YES |  | Values: `ULTRA_RARE`, `RARE`, `UNCOMMON`, `COMMON`, `MASS_PRODUCTION` |
| `rarity_reason` | text | YES |  |  |
| `msrp` | numeric | YES |  |  |
| `current_market_value_low` | numeric | YES |  |  |
| `current_market_value_high` | numeric | YES |  |  |
| `collector_demand_score` | integer | YES |  |  |
| `data_source` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `last_updated` | timestamp with time zone | YES | now() |  |
| `verified_by` | text | YES |  |  |
| `verification_date` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

## Vehicle Metadata and Provenance

### `vehicle_status_metadata`

**Rows:** 763,420 (763.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `status` | text | YES |  | Values: `needs_data`, `active_work`, `for_sale`, `verified_profile`, `open_contributions`, `professional_serviced` |
| `data_completeness_score` | integer | YES | 0 |  |
| `missing_fields` | ARRAY | YES |  |  |
| `verification_level` | text | YES |  | Values: `none`, `ai_only`, `human_verified`, `professional_verified` |
| `professional_verifications_count` | integer | YES | 0 |  |
| `contributor_count` | integer | YES | 0 |  |
| `last_activity_at` | timestamp with time zone | YES |  |  |
| `activity_heat_score` | integer | YES | 0 |  |
| `timeline_event_count` | integer | YES | 0 |  |
| `photos_count` | integer | YES | 0 |  |
| `views_this_week` | integer | YES | 0 |  |
| `views_this_month` | integer | YES | 0 |  |
| `views_total` | integer | YES | 0 |  |
| `active_discussions_count` | integer | YES | 0 |  |
| `pending_questions_count` | integer | YES | 0 |  |
| `needs_photos` | boolean | YES | false |  |
| `needs_specifications` | boolean | YES | false |  |
| `needs_history` | boolean | YES | false |  |
| `needs_maintenance_records` | boolean | YES | false |  |
| `needs_professional_inspection` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_field_evidence`

**Rows:** 742,734 (742.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `field_name` | text | NO |  |  |
| `value_text` | text | YES |  |  |
| `value_number` | numeric | YES |  |  |
| `value_date` | date | YES |  |  |
| `value_json` | jsonb | YES |  |  |
| `source_type` | text | NO |  |  |
| `source_id` | uuid | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `extraction_model` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `verified_by_user` | boolean | YES | false |  |
| `flagged_as_incorrect` | boolean | YES | false |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `extraction_method` | text | YES |  |  |
| `snapshot_id` | uuid | YES |  |  |
| `extraction_run_id` | uuid | YES |  |  |

### `vehicle_reference_links`

**Rows:** 385,438 (385.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `library_id` | uuid | NO |  |  |
| `link_type` | text | YES | 'auto' |  |
| `confidence` | integer | YES | 100 |  |
| `match_reason` | text | YES |  |  |
| `linked_at` | timestamp with time zone | YES | now() |  |
| `linked_by` | uuid | YES |  |  |

### `vehicle_valuation_feed`

**Rows:** 329,134 (329.1K)

*No column data loaded.*

### `vehicle_location_observations`

**Rows:** 300,780 (300.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `source_type` | text | NO |  |  |
| `source_platform` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `observed_at` | timestamp with time zone | NO | now() |  |
| `location_text_raw` | text | YES |  |  |
| `location_text_clean` | text | YES |  |  |
| `country_code` | text | YES |  |  |
| `region_code` | text | YES |  |  |
| `city` | text | YES |  |  |
| `postal_code` | text | YES |  |  |
| `latitude` | double precision | YES |  |  |
| `longitude` | double precision | YES |  |  |
| `precision` | text | YES |  |  |
| `confidence` | real | YES |  |  |
| `metadata` | jsonb | NO | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `vehicle_price_history`

**Rows:** 276,674 (276.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `price_type` | text | NO |  | Values: `msrp`, `purchase`, `current`, `asking`, `sale` |
| `value` | numeric | NO |  |  |
| `source` | text | NO | 'vehicles' |  |
| `as_of` | timestamp with time zone | NO | now() |  |
| `confidence` | integer | NO | 80 |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `is_estimate` | boolean | YES | false |  |
| `is_approximate` | boolean | YES | false |  |
| `logged_by` | uuid | YES |  |  |
| `proof_type` | text | YES |  |  |
| `proof_url` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `buyer_name` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `is_outlier` | boolean | NO | false |  |
| `outlier_reason` | text | YES |  |  |

### `vehicle_sentiment`

**Rows:** 126,783 (126.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `analyzed_at` | timestamp with time zone | YES | now() |  |
| `comment_count` | integer | NO |  |  |
| `extraction_version` | text | YES | 'v1.0' |  |
| `overall_sentiment` | text | YES |  |  |
| `sentiment_score` | numeric | YES |  |  |
| `mood_keywords` | ARRAY | YES | '{}'[] |  |
| `emotional_themes` | ARRAY | YES | '{}'[] |  |
| `market_demand` | text | YES |  |  |
| `market_rarity` | text | YES |  |  |
| `price_trend` | text | YES |  |  |
| `price_sentiment` | jsonb | YES |  |  |
| `expert_insights` | jsonb | YES | '[]' |  |
| `seller_disclosures` | jsonb | YES | '[]' |  |
| `community_concerns` | jsonb | YES | '[]' |  |
| `key_quotes` | ARRAY | YES | '{}'[] |  |
| `comparable_sales` | jsonb | YES | '[]' |  |
| `discussion_themes` | ARRAY | YES | '{}'[] |  |
| `notable_discussions` | jsonb | YES | '[]' |  |
| `authenticity_discussion` | jsonb | YES |  |  |
| `raw_extraction` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_form_completions`

**Rows:** 93,685 (93.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `form_type` | text | NO |  |  |
| `form_version` | text | YES |  |  |
| `status` | text | NO |  | Values: `not_started`, `partial`, `complete`, `commissioned`, `in_progress`, `failed` |
| `completeness_pct` | integer | YES |  |  |
| `fields_extracted` | jsonb | YES |  |  |
| `fields_required` | jsonb | YES |  |  |
| `source_id` | uuid | YES |  |  |
| `source_type` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `provider` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES |  |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `commissioned_at` | timestamp with time zone | YES |  |  |
| `commission_price` | numeric | YES |  |  |
| `commission_status` | text | YES |  |  |
| `service_execution_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_live_metrics`

**Rows:** 61,039 (61.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `observation_count` | integer | YES | 0 |  |
| `comment_count` | integer | YES | 0 |  |
| `bid_count` | integer | YES | 0 |  |
| `sentiment_score` | numeric | YES |  |  |
| `sentiment_label` | text | YES |  |  |
| `sentiment_updated_at` | timestamp with time zone | YES |  |  |
| `last_observation_at` | timestamp with time zone | YES |  |  |
| `last_comment_text` | text | YES |  |  |
| `last_bid_amount` | numeric | YES |  |  |
| `unique_commenters` | integer | YES | 0 |  |
| `questions_count` | integer | YES | 0 |  |
| `seller_responses` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_active_auction` | boolean | YES | false |  |
| `auction_ends_at` | timestamp with time zone | YES |  |  |

### `vehicle_field_provenance`

**Rows:** 38,872 (38.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `current_value` | text | YES |  |  |
| `total_confidence` | integer | YES |  |  |
| `confidence_factors` | jsonb | YES | '{}' |  |
| `primary_source` | text | YES |  |  |
| `supporting_sources` | ARRAY | YES |  |  |
| `conflicting_sources` | jsonb | YES | '[]' |  |
| `factory_original_value` | text | YES |  |  |
| `modified_value` | text | YES |  |  |
| `modification_date` | date | YES |  |  |
| `last_verified_at` | timestamp with time zone | YES |  |  |
| `last_verified_by` | text | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_zip_stats`

**Rows:** 13,416 (13.4K)

*No column data loaded.*

### `vehicle_field_sources`

**Rows:** 1,919 (1.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `field_name` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `confidence_score` | integer | YES | 0 |  |
| `metadata` | jsonb | YES | '{}' |  |
| `user_id` | uuid | YES |  |  |
| `is_verified` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `source_url` | text | YES |  |  |
| `source_image_id` | uuid | YES |  |  |
| `extraction_method` | text | YES |  |  |
| `raw_extracted_text` | text | YES |  |  |
| `ai_reasoning` | text | YES |  |  |
| `verification_notes` | text | YES |  |  |
| `evidence_document_id` | uuid | YES |  |  |
| `criteria` | jsonb | YES |  |  |
| `field_value` | text | YES |  |  |

### `vehicle_map_county_data`

**Rows:** 1,806 (1.8K)

*No column data loaded.*

### `vehicle_price_fixes`

**Rows:** 779 (779)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `old_sale_price` | numeric | YES |  |  |
| `new_sale_price` | numeric | YES |  |  |
| `old_bat_sold_price` | numeric | YES |  |  |
| `new_bat_sold_price` | numeric | YES |  |  |
| `old_bat_sale_date` | date | YES |  |  |
| `new_bat_sale_date` | date | YES |  |  |
| `bat_url` | text | YES |  |  |
| `bat_lot_number` | text | YES |  |  |
| `fix_method` | text | YES | 'auto_scrape' |  |
| `confidence_score` | integer | YES | 100 |  |
| `status` | text | YES | 'fixed' |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  |  |

### `vehicle_map_state_data`

**Rows:** 50 (50)

*No column data loaded.*

## Image Analysis Pipeline

### `image_camera_position`

**Rows:** 693,165 (693.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `subject_key` | text | YES | 'vehicle' |  |
| `camera_x_mm` | numeric | YES |  |  |
| `camera_y_mm` | numeric | YES |  |  |
| `camera_z_mm` | numeric | YES |  |  |
| `azimuth_deg` | numeric | YES |  |  |
| `elevation_deg` | numeric | YES |  |  |
| `distance_mm` | numeric | YES |  |  |
| `subject_x_mm` | numeric | YES |  |  |
| `subject_y_mm` | numeric | YES |  |  |
| `subject_z_mm` | numeric | YES |  |  |
| `look_yaw_deg` | numeric | YES |  |  |
| `look_pitch_deg` | numeric | YES |  |  |
| `focal_length_mm` | numeric | YES |  |  |
| `fov_horizontal_deg` | numeric | YES |  |  |
| `confidence` | numeric | YES | 0.5 |  |
| `source` | text | NO | 'ai' |  |
| `source_version` | text | YES |  |  |
| `evidence` | jsonb | YES | '{}' |  |
| `observed_at` | timestamp with time zone | YES | now() |  |

### `ai_scan_sessions`

**Rows:** 631,447 (631.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `session_start` | timestamp with time zone | YES | now() |  |
| `session_end` | timestamp with time zone | YES |  |  |
| `ai_model` | character varying | NO | 'gpt-4o' |  |
| `total_images_processed` | integer | YES | 0 |  |
| `successful_scans` | integer | YES | 0 |  |
| `failed_scans` | integer | YES | 0 |  |
| `total_components_detected` | integer | YES | 0 |  |
| `total_api_cost_usd` | numeric | YES |  |  |
| `avg_processing_time_ms` | integer | YES |  |  |
| `status` | character varying | YES | 'in_progress' |  |
| `error_message` | text | YES |  |  |
| `batch_size` | integer | YES |  |  |
| `user_initiated` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `event_id` | uuid | YES |  |  |
| `image_ids` | ARRAY | YES |  |  |
| `ai_model_version` | text | YES |  |  |
| `ai_model_cost` | numeric | YES | 0 |  |
| `context_available` | jsonb | YES | '{}' |  |
| `total_images_analyzed` | integer | YES |  |  |
| `scan_duration_seconds` | numeric | YES |  |  |
| `total_tokens_used` | integer | YES |  |  |
| `overall_confidence` | numeric | YES |  |  |
| `fields_extracted` | ARRAY | YES |  |  |
| `concerns_flagged` | ARRAY | YES |  |  |
| `scanned_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  |  |

### `surface_observations`

**Rows:** 332,986 (333.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `zone` | text | NO |  |  |
| `u_min_inches` | real | YES |  |  |
| `u_max_inches` | real | YES |  |  |
| `v_min_inches` | real | YES |  |  |
| `v_max_inches` | real | YES |  |  |
| `h_min_inches` | real | YES |  |  |
| `h_max_inches` | real | YES |  |  |
| `resolution_level` | smallint | YES | 0 |  |
| `bbox_x` | real | YES |  |  |
| `bbox_y` | real | YES |  |  |
| `bbox_w` | real | YES |  |  |
| `bbox_h` | real | YES |  |  |
| `observation_type` | text | NO |  |  |
| `label` | text | YES |  |  |
| `confidence` | real | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `model_version` | text | YES |  |  |
| `pass_name` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `severity` | real | YES |  | Continuous 0-1 spectrum. 0=trace, 1=complete. "Slightly oxidized rocker" vs "perforated floor pan" |
| `lifecycle_state` | text | YES |  | fresh/worn/weathered/restored/palimpsest/ghost/archaeological — which era of existence |
| `descriptor_id` | uuid | YES |  | FK to condition_taxonomy — bridges to spectral scoring system |
| `region_detail` | text | YES |  | Finer than zone: rocker_panel_lower, cowl_seam, a_pillar_base |
| `pass_number` | smallint | YES |  | Spectrometer pass: 0=5W metadata, 1=broad vision, 2=contextual (Y/M/M), 3=sequence |
| `evidence` | jsonb | YES |  |  |

### `image_work_extractions`

**Rows:** 200,835 (200.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `detected_work_type` | text | YES |  |  |
| `detected_work_description` | text | YES |  |  |
| `detected_components` | ARRAY | YES |  |  |
| `detected_date` | date | YES |  |  |
| `detected_location_address` | text | YES |  |  |
| `detected_location_lat` | numeric | YES |  |  |
| `detected_location_lng` | numeric | YES |  |  |
| `work_type_confidence` | numeric | YES |  |  |
| `date_confidence` | numeric | YES |  |  |
| `location_confidence` | numeric | YES |  |  |
| `overall_confidence` | numeric | YES |  |  |
| `ai_model` | text | YES | 'gpt-4-vision' |  |
| `ai_analysis` | jsonb | YES |  |  |
| `extraction_method` | text | YES |  |  |
| `status` | text | YES | 'pending' | Values: `pending`, `extracted`, `matched`, `approved`, `rejected` |
| `processed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `image_descriptions`

**Rows:** 146,979 (147.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `session_id` | uuid | YES |  |  |
| `description` | text | NO |  |  |
| `description_type` | text | NO | 'auto' |  |
| `context_ymm_key` | text | YES |  |  |
| `context_session_type` | text | YES |  |  |
| `context_neighbor_ids` | ARRAY | YES |  |  |
| `source` | text | NO |  |  |
| `source_version` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `pass_number` | smallint | YES | 1 |  |
| `evidence` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `image_coordinate_observations`

**Rows:** 85,657 (85.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `x_estimate` | numeric | NO |  |  |
| `y_estimate` | numeric | NO |  |  |
| `z_estimate` | numeric | NO |  |  |
| `distance_estimate_m` | numeric | YES |  |  |
| `confidence` | numeric | NO | 0.5 |  |
| `source` | text | NO |  |  |
| `source_version` | text | YES |  |  |
| `source_model` | text | YES |  |  |
| `evidence` | jsonb | YES | '{}' |  |
| `zone_id` | uuid | YES |  |  |
| `zone_name` | text | YES |  |  |
| `observed_at` | timestamp with time zone | YES | now() |  |
| `subject_id` | uuid | YES |  |  |
| `subject_key` | text | YES |  |  |
| `subject_x` | numeric | YES |  |  |
| `subject_y` | numeric | YES |  |  |
| `subject_z` | numeric | YES |  |  |
| `subject_distance_m` | numeric | YES |  |  |
| `secondary_subjects` | jsonb | YES | '[]' |  |
| `framing_quality` | numeric | YES |  |  |
| `subject_coverage_pct` | numeric | YES |  |  |

### `image_angle_observations`

**Rows:** 28,013 (28.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `angle_id` | uuid | NO |  |  |
| `confidence` | numeric | YES |  |  |
| `source` | text | NO |  |  |
| `source_version` | text | YES |  |  |
| `evidence` | jsonb | YES |  |  |
| `observed_at` | timestamp with time zone | NO | now() |  |

### `image_condition_observations`

**Rows:** 18,923 (18.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `descriptor_id` | uuid | NO |  |  |
| `severity` | numeric | YES |  | 0.0-1.0 severity scale. NULL for binary descriptors. |
| `lifecycle_state` | text | YES |  | Lifecycle state at time of observation: fresh/worn/weathered/restored/palimpsest/ghost/archaeological |
| `zone` | text | YES |  |  |
| `region_detail` | text | YES |  |  |
| `surface_coord_u` | numeric | YES |  |  |
| `surface_coord_v` | numeric | YES |  |  |
| `pass_number` | smallint | NO | 1 | 1=broad vision, 2=contextual (Y/M/M loaded), 3=sequence cross-reference |
| `confidence` | numeric | YES |  |  |
| `source` | text | NO |  | What produced this observation: yono_v1/yono_v2/human/cloud_vision/sequence_inference |
| `source_version` | text | YES |  |  |
| `evidence` | jsonb | YES |  |  |
| `context_ymm_key` | text | YES |  |  |
| `context_sequence_position` | integer | YES |  |  |
| `observed_at` | timestamp with time zone | NO | now() |  |

### `ai_angle_classifications_audit`

**Rows:** 15,506 (15.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `angle_family` | text | NO |  |  |
| `primary_label` | text | NO |  |  |
| `view_axis` | text | YES |  |  |
| `elevation` | text | YES |  |  |
| `distance` | text | YES |  |  |
| `focal_length` | text | YES |  |  |
| `role` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `mapped_to_angle_id` | uuid | YES |  |  |
| `raw_classification` | jsonb | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `needs_review` | boolean | YES | false |  |
| `validation_notes` | text | YES |  |  |

### `image_tags`

**Rows:** 3,263 (3.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | YES |  | Foreign key to vehicle_images (for user-created tags, nullable for AI tags that use image_url instead) |
| `x_position` | double precision | YES |  |  |
| `y_position` | double precision | YES |  |  |
| `tag_type` | character varying | YES |  |  |
| `text` | text | YES |  |  |
| `verification_status` | character varying | YES | 'pending' |  |
| `trust_score` | integer | YES | 10 |  |
| `created_by` | character varying | YES |  |  |
| `verified_by` | character varying | YES |  |  |
| `verified_at` | timestamp without time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `inserted_at` | timestamp without time zone | NO | now() |  |
| `updated_at` | timestamp without time zone | NO | now() |  |
| `product_id` | uuid | YES |  |  |
| `product_relation` | character varying | YES |  |  |
| `service_id` | uuid | YES |  |  |
| `service_status` | character varying | YES |  |  |
| `technician_id` | uuid | YES |  |  |
| `shop_id` | uuid | YES |  |  |
| `service_date` | timestamp without time zone | YES |  |  |
| `service_cost_cents` | integer | YES |  |  |
| `service_warranty_expires` | timestamp without time zone | YES |  |  |
| `source_type` | text | YES | 'manual' | Origin of the tag: manual (human), ai (automated), hybrid (AI+human), expert (professional), community (crowd-sourced) Values: `manual`, `ai`, `hybrid`, `expert`, `community` |
| `exif_data` | jsonb | YES | '{}' |  |
| `gps_coordinates` | jsonb | YES | '{}' |  |
| `automated_confidence` | double precision | YES |  |  |
| `needs_human_verification` | boolean | YES | false |  |
| `condition_before` | character varying | YES |  |  |
| `condition_after` | character varying | YES |  |  |
| `severity_level` | character varying | YES |  |  |
| `estimated_cost_cents` | integer | YES |  |  |
| `insurance_claim_number` | character varying | YES |  |  |
| `work_order_number` | character varying | YES |  |  |
| `work_started_at` | timestamp without time zone | YES |  |  |
| `work_completed_at` | timestamp without time zone | YES |  |  |
| `estimated_completion` | timestamp without time zone | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `tag_name` | text | YES |  |  |
| `width` | numeric | YES |  |  |
| `height` | numeric | YES |  |  |
| `confidence` | integer | YES | 100 |  |
| `ai_detection_data` | jsonb | YES | '{}' | Raw data from AI detection system (Rekognition, etc.) |
| `verified` | boolean | YES | false | Whether tag has been validated by a human |
| `manual_override` | boolean | YES | false | True if a human corrected an AI tag |
| `training_feedback` | jsonb | YES | '{}' | Validation actions and corrections for AI training |
| `parent_tag_id` | uuid | YES |  | References original tag if this is a correction |
| `validation_status` | text | YES | 'pending' | Current validation state in the review workflow Values: `pending`, `approved`, `rejected`, `disputed`, `expert_validated`, `cross_validated` ... (9 total) |
| `validation_stage` | integer | YES | 1 | Progressive validation: 1=initial, 2=cross-validated, 3=context, 4=ocr, 5=receipt |
| `related_image_ids` | ARRAY | YES |  | Array of image URLs that confirm this tag detection |
| `cross_validation_count` | integer | YES | 0 | Number of images where this tag was detected in the same session |
| `reasoning` | ARRAY | YES |  | Human-readable explanation of how confidence was determined |
| `oem_part_number` | text | YES |  |  |
| `aftermarket_part_numbers` | ARRAY | YES |  |  |
| `part_description` | text | YES |  |  |
| `fits_vehicles` | ARRAY | YES |  |  |
| `suppliers` | jsonb | YES | '[]' |  |
| `lowest_price_cents` | integer | YES |  |  |
| `highest_price_cents` | integer | YES |  |  |
| `price_last_updated` | timestamp with time zone | YES |  |  |
| `is_shoppable` | boolean | YES | false |  |
| `affiliate_links` | jsonb | YES | '[]' |  |
| `condition` | text | YES |  |  |
| `warranty_info` | text | YES |  |  |
| `install_difficulty` | text | YES |  |  |
| `estimated_install_time_minutes` | integer | YES |  |  |
| `receipt_line_item_id` | uuid | YES |  | Links tag to receipt proving part purchase/cost |
| `labor_record_id` | uuid | YES |  |  |
| `part_installed_by` | uuid | YES |  | User who installed this part (for labor tracking) |
| `install_shop_id` | uuid | YES |  | Shop where install happened (for rate sourcing) |
| `install_labor_hours` | numeric | YES |  | Actual labor hours for install (user-reported or calculated) |
| `install_labor_rate` | numeric | YES |  | Labor rate used for this install ($/hr) |
| `created_at` | timestamp with time zone | YES | now() |  |
| `part_type` | text | YES |  | Values: `OEM`, `OES`, `NOS`, `Aftermarket`, `Generic` |

### `image_question_answers`

**Rows:** 1,021 (1.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `image_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `question_key` | text | NO |  |  |
| `question_difficulty` | text | YES |  |  |
| `answer` | jsonb | NO |  |  |
| `confidence` | integer | YES |  |  |
| `model_used` | text | NO |  |  |
| `model_cost` | numeric | YES |  |  |
| `answered_at` | timestamp with time zone | YES | now() |  |
| `context_score` | integer | YES |  |  |
| `context_items_used` | jsonb | YES |  |  |
| `validated_by_receipt` | uuid | YES |  |  |
| `validated_by_user` | uuid | YES |  |  |
| `validated_at` | timestamp with time zone | YES |  |  |
| `consensus_with_answer_ids` | ARRAY | YES |  |  |
| `consensus_confidence` | integer | YES |  |  |
| `is_consensus_answer` | boolean | YES | false |  |
| `should_reprocess` | boolean | YES | false |  |
| `reprocessed_from` | uuid | YES |  |  |
| `superseded_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `image_spatial_metadata`

**Rows:** 368 (368)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `spatial_x` | numeric | YES |  |  |
| `spatial_y` | numeric | YES |  |  |
| `spatial_z` | numeric | YES |  |  |
| `part_name` | text | YES |  |  |
| `part_category` | text | YES |  |  |
| `system_area` | text | YES |  |  |
| `is_repair_image` | boolean | YES | false |  |
| `repair_stage` | text | YES |  |  |
| `labor_step_index` | integer | YES |  |  |
| `work_session_id` | uuid | YES |  |  |
| `matches_reference` | boolean | YES | false |  |
| `reference_type` | text | YES |  |  |
| `reference_confidence` | numeric | YES |  |  |
| `ai_metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `image_set_members`

**Rows:** 359 (359)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_set_id` | uuid | NO |  |  |
| `image_id` | uuid | NO |  |  |
| `priority` | integer | YES | 0 |  |
| `display_order` | integer | YES | 0 |  |
| `caption` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `role` | text | YES |  |  |
| `added_by` | uuid | NO |  |  |
| `added_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_image_angles`

**Rows:** 72 (72)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `angle_id` | uuid | NO |  |  |
| `confidence_score` | integer | YES | 50 |  |
| `tagged_by` | text | YES | 'ai' |  |
| `perspective_type` | text | YES |  | Values: `wide_angle`, `standard`, `portrait`, `telephoto`, `super_telephoto` |
| `focal_length_mm` | integer | YES |  |  |
| `sensor_type` | text | YES |  | Values: `full_frame`, `aps_c`, `micro_four_thirds`, `phone`, `medium_format` |
| `equivalent_focal_length` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `image_pose_observations`

**Rows:** 58 (58)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `reference_frame` | text | NO | 'vehicle_frame_v1' |  |
| `cam_x_m` | numeric | YES |  |  |
| `cam_y_m` | numeric | YES |  |  |
| `cam_z_m` | numeric | YES |  |  |
| `q_w` | numeric | YES |  |  |
| `q_x` | numeric | YES |  |  |
| `q_y` | numeric | YES |  |  |
| `q_z` | numeric | YES |  |  |
| `yaw_deg` | numeric | YES |  |  |
| `pitch_deg` | numeric | YES |  |  |
| `roll_deg` | numeric | YES |  |  |
| `pose_confidence` | numeric | YES |  |  |
| `focal_length_mm` | numeric | YES |  |  |
| `sensor_width_mm` | numeric | YES |  |  |
| `sensor_height_mm` | numeric | YES |  |  |
| `fov_x_deg` | numeric | YES |  |  |
| `fov_y_deg` | numeric | YES |  |  |
| `target_anchor` | text | YES |  |  |
| `target_bbox` | jsonb | YES |  |  |
| `source` | text | NO |  |  |
| `source_version` | text | YES |  |  |
| `raw` | jsonb | YES |  |  |
| `observed_at` | timestamp with time zone | NO | now() |  |

### `image_coverage_angles`

**Rows:** 52 (52)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `category` | text | NO |  | Values: `exterior`, `interior`, `undercarriage`, `engine_bay`, `vin_plates`, `details`, `documentation` |
| `angle_name` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `is_essential` | boolean | YES | true |  |
| `priority_order` | integer | YES | 50 |  |
| `description` | text | YES |  |  |
| `example_image_url` | text | YES |  |  |

## Auction and Sales Data

### `auction_comments`

**Rows:** 11,554,762 (11.6M)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `auction_event_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `comment_type` | text | YES |  | Values: `bid`, `sold`, `question`, `answer`, `observation`, `seller_update`, `seller_response`, `expert_opinion` |
| `posted_at` | timestamp with time zone | NO |  |  |
| `sequence_number` | integer | YES |  |  |
| `hours_until_close` | numeric | YES |  |  |
| `author_username` | text | NO |  |  |
| `author_type` | text | YES |  |  |
| `author_total_likes` | integer | YES | 0 |  |
| `is_seller` | boolean | YES | false |  |
| `comment_text` | text | NO |  |  |
| `word_count` | integer | YES |  |  |
| `has_question` | boolean | YES | false |  |
| `has_media` | boolean | YES | false |  |
| `media_urls` | ARRAY | YES |  |  |
| `mentions` | ARRAY | YES |  |  |
| `comment_likes` | integer | YES | 0 |  |
| `reply_count` | integer | YES | 0 |  |
| `is_flagged` | boolean | YES | false |  |
| `bid_amount` | numeric | YES |  |  |
| `is_leading_bid` | boolean | YES |  |  |
| `bid_increment` | numeric | YES |  |  |
| `sentiment` | text | YES |  |  |
| `sentiment_score` | numeric | YES |  |  |
| `toxicity_score` | numeric | YES |  |  |
| `expertise_indicators` | ARRAY | YES |  |  |
| `authenticity_score` | numeric | YES |  |  |
| `expertise_score` | numeric | YES |  |  |
| `influence_score` | numeric | YES |  |  |
| `key_claims` | ARRAY | YES |  |  |
| `raw_html` | text | YES |  |  |
| `analyzed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `platform` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `content_hash` | text | YES |  |  |
| `author_bat_user_id` | uuid | YES |  |  |
| `author_external_identity_id` | uuid | YES |  |  |
| `external_identity_id` | uuid | YES |  |  |

### `bat_bids`

**Rows:** 4,165,430 (4.2M)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `bat_listing_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `bat_user_id` | uuid | YES |  |  |
| `bat_username` | text | NO |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `bid_amount` | numeric | NO |  |  |
| `bid_timestamp` | timestamp with time zone | NO |  |  |
| `is_winning_bid` | boolean | YES | false |  |
| `is_final_bid` | boolean | YES | false |  |
| `source` | text | YES | 'comment' | Values: `comment`, `bid_history`, `manual` |
| `bat_comment_id` | uuid | YES |  |  |
| `auction_event_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `external_identities`

**Rows:** 510,088 (510.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `platform` | text | NO |  |  |
| `handle` | text | NO |  |  |
| `profile_url` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `claimed_by_user_id` | uuid | YES |  | If set, this external identity is claimed by a real N-Zero user. |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `claim_confidence` | integer | YES | 0 |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `user_id` | uuid | YES |  |  |

### `bat_user_profiles`

**Rows:** 508,473 (508.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `username` | text | NO |  |  |
| `total_comments` | integer | YES | 0 |  |
| `total_bids` | integer | YES | 0 |  |
| `total_wins` | integer | YES | 0 |  |
| `total_questions` | integer | YES | 0 |  |
| `total_answers` | integer | YES | 0 |  |
| `avg_bid_amount` | numeric | YES |  |  |
| `max_bid_amount` | numeric | YES |  |  |
| `min_bid_amount` | numeric | YES |  |  |
| `win_rate` | numeric | YES |  |  |
| `expertise_score` | numeric | YES | 0 |  |
| `technical_knowledge` | numeric | YES | 0 |  |
| `market_knowledge` | numeric | YES | 0 |  |
| `avg_comment_quality` | numeric | YES | 0 |  |
| `preferred_categories` | ARRAY | YES |  |  |
| `typical_price_range` | jsonb | YES |  |  |
| `bidding_strategy` | text | YES |  |  |
| `avg_sentiment` | text | YES |  |  |
| `avg_likes_received` | numeric | YES | 0 |  |
| `community_trust_score` | numeric | YES | 0 |  |
| `bot_likelihood` | numeric | YES | 0 |  |
| `shill_flags` | integer | YES | 0 |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `auction_events`

**Rows:** 216,642 (216.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `source` | text | NO |  |  |
| `source_url` | text | YES |  |  |
| `source_listing_id` | text | YES |  |  |
| `lot_number` | text | YES |  |  |
| `auction_start_date` | timestamp with time zone | YES |  |  |
| `auction_end_date` | timestamp with time zone | YES |  |  |
| `auction_duration_hours` | integer | YES |  |  |
| `outcome` | text | NO |  | Values: `sold`, `reserve_not_met`, `no_sale`, `bid_to`, `cancelled`, `relisted`, `pending`, `live` |
| `starting_bid` | numeric | YES |  |  |
| `reserve_price` | numeric | YES |  |  |
| `reserve_disclosed` | boolean | YES | false |  |
| `high_bid` | numeric | YES |  |  |
| `winning_bid` | numeric | YES |  |  |
| `buy_it_now_price` | numeric | YES |  |  |
| `total_bids` | integer | YES |  |  |
| `unique_bidders` | integer | YES |  |  |
| `bid_history` | jsonb | YES |  |  |
| `high_bidder` | text | YES |  |  |
| `winning_bidder` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `seller_type` | text | YES |  |  |
| `seller_location` | text | YES |  |  |
| `estimate_low` | numeric | YES |  |  |
| `estimate_high` | numeric | YES |  |  |
| `page_views` | integer | YES |  |  |
| `watchers` | integer | YES |  |  |
| `comments_count` | integer | YES |  |  |
| `market_insights` | jsonb | YES |  |  |
| `price_vs_estimate_pct` | numeric | YES |  |  |
| `reserve_gap_pct` | numeric | YES |  |  |
| `scraped_at` | timestamp with time zone | YES | now() |  |
| `raw_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `receipt_data` | jsonb | YES |  |  |
| `ai_summary` | text | YES |  |  |
| `sentiment_arc` | jsonb | YES |  |  |
| `key_moments` | jsonb | YES |  |  |
| `top_contributors` | jsonb | YES |  |  |
| `broadcast_video_id` | text | YES |  |  |
| `broadcast_video_url` | text | YES |  |  |
| `broadcast_timestamp_start` | integer | YES |  | Seconds into YouTube video when lot starts |
| `broadcast_timestamp_end` | integer | YES |  | Seconds into YouTube video when hammer falls |
| `broadcast_clip_url` | text | YES |  |  |
| `forensics_data` | jsonb | YES |  | Broadcast forensics analysis: duration, bid velocity, auctioneer metrics, anomaly score |

### `bat_extraction_queue`

**Rows:** 182,717 (182.7K)
**Pipeline:** BaT extraction queue. Populated by crawl-bat-active, processed by process-bat-extraction-queue.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `bat_url` | text | NO |  |  |
| `status` | text | NO | 'pending' | Queue processing status. Values: pending, processing (claimed — do not pick up), complete, failed. Enforced by CHECK constraint. Values: `pending`, `processing`, `complete`, `failed` |
| `priority` | integer | NO | 100 | Processing priority. Higher number = higher priority. Default: 100. High-comment listings get priority boost. |
| `error_message` | text | YES |  |  |
| `attempts` | integer | NO | 0 |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `next_attempt_at` | timestamp with time zone | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  | Timestamp when worker claimed this record. Use release_stale_locks() for stale reclamation. PROTECTED -- owner: `process-bat-extraction-queue` |
| `locked_by` | text | YES |  | Worker instance ID that claimed this record. Stale threshold: 30 minutes. PROTECTED -- owner: `process-bat-extraction-queue` |
| `last_attempt_at` | timestamp with time zone | YES |  |  |

### `bat_listings`

**Rows:** 157,209 (157.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `bat_listing_url` | text | NO |  |  |
| `bat_lot_number` | text | YES |  |  |
| `bat_listing_title` | text | YES |  |  |
| `auction_start_date` | date | YES |  |  |
| `auction_end_date` | date | YES |  |  |
| `sale_date` | date | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `reserve_price` | integer | YES |  |  |
| `starting_bid` | integer | YES |  |  |
| `final_bid` | integer | YES |  |  |
| `seller_username` | text | YES |  |  |
| `buyer_username` | text | YES |  |  |
| `seller_bat_user_id` | uuid | YES |  |  |
| `buyer_bat_user_id` | uuid | YES |  |  |
| `comment_count` | integer | YES | 0 |  |
| `bid_count` | integer | YES | 0 |  |
| `view_count` | integer | YES | 0 |  |
| `listing_status` | text | YES | 'ended' | Values: `active`, `ended`, `sold`, `no_sale`, `cancelled` |
| `scraped_at` | timestamp with time zone | YES | now() |  |
| `last_updated_at` | timestamp with time zone | YES | now() |  |
| `raw_data` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `seller_external_identity_id` | uuid | YES |  |  |
| `buyer_external_identity_id` | uuid | YES |  |  |

### `external_listings`

**Rows:** 139,309 (139.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `organization_id` | uuid | YES |  | Organization that owns/manages this listing. NULL for imported external listings (BaT, etc.) that are not associated with a specific organization. |
| `platform` | text | NO |  | Values: `bat`, `cars_and_bids`, `mecum`, `barrettjackson`, `russoandsteele`, `pcarmarket` ... (23 total) |
| `listing_url` | text | NO |  |  |
| `listing_id` | text | YES |  |  |
| `listing_status` | text | NO |  | Values: `pending`, `active`, `ended`, `sold`, `unsold`, `cancelled`, `reserve_not_met`, `no_sale` |
| `start_date` | timestamp with time zone | YES |  |  |
| `end_date` | timestamp with time zone | YES |  |  |
| `current_bid` | numeric | YES |  |  |
| `reserve_price` | numeric | YES |  |  |
| `buy_now_price` | numeric | YES |  |  |
| `bid_count` | integer | YES | 0 |  |
| `view_count` | integer | YES | 0 |  |
| `watcher_count` | integer | YES | 0 |  |
| `final_price` | numeric | YES |  |  |
| `sold_at` | timestamp with time zone | YES |  |  |
| `commission_rate` | numeric | YES |  |  |
| `affiliate_link` | text | YES |  |  |
| `sync_enabled` | boolean | YES | true |  |
| `last_synced_at` | timestamp with time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `listing_url_key` | text | YES |  |  |

### `bat_price_mapping`

**Rows:** 77,382 (77.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `bat_price` | numeric | NO |  |  |
| `bat_date` | text | YES |  |  |
| `bat_listing_url` | text | YES |  |  |
| `propagated` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `bat_crawl_state`

**Rows:** 76,695 (76.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('bat_crawl_state_id_seq'::regclass) |  |
| `crawl_type` | text | NO |  |  |
| `page_number` | integer | NO |  |  |
| `urls_found` | integer | YES | 0 |  |
| `urls_new` | integer | YES | 0 |  |
| `crawled_at` | timestamp with time zone | YES | now() |  |

### `external_auction_bids`

**Rows:** 26,054 (26.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `external_listing_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `platform` | text | NO |  |  |
| `bid_amount` | integer | NO |  |  |
| `bid_timestamp` | timestamp with time zone | NO |  |  |
| `bidder_username` | text | YES |  |  |
| `bidder_external_identity_id` | uuid | YES |  |  |
| `bid_number` | integer | YES |  |  |
| `is_winning_bid` | boolean | YES | false |  |
| `is_autobid` | boolean | YES | false |  |
| `reserve_met_at_bid` | boolean | YES |  |  |
| `source` | text | NO | 'unknown' |  |
| `source_email_id` | text | YES |  |  |
| `raw_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `bat_quarantine`

**Rows:** 2,991 (3.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `listing_url` | text | NO |  |  |
| `field_name` | text | YES |  |  |
| `existing_value` | text | YES |  |  |
| `proposed_value` | text | YES |  |  |
| `extraction_version` | text | YES |  |  |
| `quality_score` | numeric | YES |  |  |
| `issues` | ARRAY | NO | '{}'[] |  |
| `resolved` | boolean | YES | false |  |
| `resolution` | text | YES |  |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `resolved_by` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `auction_readiness`

**Rows:** 2,142 (2.1K)
**Pipeline:** ARS scores. Do not write directly -- use compute_auction_readiness().

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `composite_score` | smallint | NO | 0 |  |
| `tier` | text | NO | 'DISCOVERY_ONLY' |  |
| `identity_score` | smallint | NO | 0 |  |
| `photo_score` | smallint | NO | 0 |  |
| `doc_score` | smallint | NO | 0 |  |
| `desc_score` | smallint | NO | 0 |  |
| `market_score` | smallint | NO | 0 |  |
| `condition_score` | smallint | NO | 0 |  |
| `top_gaps` | jsonb | NO | '[]' |  |
| `coaching_plan` | jsonb | YES |  |  |
| `photo_zones_present` | ARRAY | YES | '{}'[] |  |
| `photo_zones_missing` | ARRAY | YES | '{}'[] |  |
| `mvps_complete` | boolean | YES | false |  |
| `is_stale` | boolean | YES | false |  |
| `stale_reason` | text | YES |  |  |
| `last_data_event_at` | timestamp with time zone | YES |  |  |
| `rejection_penalties` | jsonb | YES | '[]' |  |
| `computed_at` | timestamp with time zone | YES | now() |  |

### `monitored_auctions`

**Rows:** 1,549 (1.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source_id` | uuid | NO |  |  |
| `external_auction_id` | text | NO |  |  |
| `external_auction_url` | text | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `external_listing_id` | uuid | YES |  |  |
| `auction_start_time` | timestamp with time zone | YES |  |  |
| `auction_end_time` | timestamp with time zone | YES |  |  |
| `is_live` | boolean | YES | true |  |
| `current_bid_cents` | bigint | YES |  |  |
| `bid_count` | integer | YES | 0 |  |
| `high_bidder_username` | text | YES |  |  |
| `reserve_status` | text | YES |  | Values: `met`, `not_met`, `no_reserve`, `unknown` |
| `is_in_soft_close` | boolean | YES | false |  |
| `extension_count` | integer | YES | 0 |  |
| `last_extension_at` | timestamp with time zone | YES |  |  |
| `last_synced_at` | timestamp with time zone | YES |  |  |
| `sync_latency_ms` | integer | YES |  |  |
| `poll_interval_ms` | integer | YES |  |  |
| `next_poll_at` | timestamp with time zone | YES |  |  |
| `last_comment_count` | integer | YES | 0 |  |
| `last_comment_synced_at` | timestamp with time zone | YES |  |  |
| `priority` | integer | YES | 50 |  |
| `notify_on_bid` | boolean | YES | false |  |
| `notify_on_extension` | boolean | YES | false |  |
| `watching_user_ids` | ARRAY | YES |  |  |
| `proxy_bid_user_ids` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bat_users`

**Rows:** 1,207 (1.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `bat_username` | text | NO |  |  |
| `bat_profile_url` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `n_zero_user_id` | uuid | YES |  |  |
| `matched_at` | timestamp with time zone | YES |  |  |
| `match_confidence` | integer | YES | 0 |  |
| `total_comments` | integer | YES | 0 |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bid_events`

**Rows:** 1,143 (1.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `monitored_auction_id` | uuid | NO |  |  |
| `bid_amount_cents` | bigint | NO |  |  |
| `bidder_username` | text | YES |  |  |
| `bidder_external_id` | text | YES |  |  |
| `bid_time` | timestamp with time zone | NO |  |  |
| `was_proxy_bid` | boolean | YES | false |  |
| `caused_extension` | boolean | YES | false |  |
| `new_end_time` | timestamp with time zone | YES |  |  |
| `observed_at` | timestamp with time zone | YES | now() |  |
| `source_latency_ms` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `auction_listing_images`

**Rows:** 622 (622)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `external_listing_id` | uuid | YES |  |  |
| `listing_url` | text | NO |  |  |
| `listing_source` | text | NO |  |  |
| `image_url` | text | NO |  |  |
| `image_position` | integer | NO |  |  |
| `total_images_in_listing` | integer | YES |  |  |
| `position_percentile` | numeric | YES |  |  |
| `classification_status` | text | YES | 'pending' | Values: `pending`, `skipped`, `vehicle_photo`, `document`, `receipt`, `title` ... (9 total) |
| `is_document` | boolean | YES | false |  |
| `document_type` | text | YES |  |  |
| `classification_confidence` | numeric | YES |  |  |
| `extraction_status` | text | YES | 'pending' | Values: `pending`, `not_applicable`, `processing`, `completed`, `failed` |
| `extracted_data` | jsonb | YES | '{}' |  |
| `vehicle_id` | uuid | YES |  |  |
| `receipt_id` | uuid | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `raw_classification` | jsonb | YES |  |  |
| `raw_extraction` | jsonb | YES |  |  |
| `processing_cost_usd` | numeric | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `classified_at` | timestamp with time zone | YES |  |  |
| `extracted_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `learned_insights` | jsonb | YES | '{}' |  |
| `extraction_version` | integer | YES | 1 |  |

### `bat_image_library`

**Rows:** 54 (54)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `url` | text | NO |  |  |
| `normalized_url` | text | YES |  |  |
| `asset_kind` | text | NO | 'unknown' |  |
| `discovered_from_vehicle_id` | uuid | YES |  |  |
| `discovered_from_listing_url` | text | YES |  |  |
| `discovered_at` | timestamp with time zone | NO | now() |  |
| `metadata` | jsonb | NO | '{}' |  |

### `bat_test_results`

**Rows:** 50 (50)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `run_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `listing_url` | text | NO |  |  |
| `bucket` | text | YES |  |  |
| `db_state` | jsonb | YES |  |  |
| `snapshot_extracted` | jsonb | YES |  |  |
| `live_extracted` | jsonb | YES |  |  |
| `field_discrepancies` | jsonb | YES |  |  |
| `accuracy_score` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

## Extraction and Processing Queues

### `field_extraction_log`

**Rows:** 3,592,923 (3.6M)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `extraction_run_id` | uuid | NO |  |  |
| `source` | text | NO |  |  |
| `source_url` | text | YES |  |  |
| `extractor_name` | text | NO |  |  |
| `extractor_version` | text | YES |  |  |
| `field_name` | text | NO |  |  |
| `extraction_status` | text | NO |  | Values: `extracted`, `not_found`, `parse_error`, `validation_fail`, `low_confidence` |
| `extracted_value` | text | YES |  |  |
| `expected_value` | text | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `error_code` | text | YES |  |  |
| `error_details` | jsonb | YES |  |  |
| `extraction_time_ms` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `import_queue_archive`

**Rows:** 747,887 (747.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `source_id` | uuid | YES |  |  |
| `listing_url` | text | YES |  |  |
| `listing_title` | text | YES |  |  |
| `listing_price` | bigint | YES |  |  |
| `listing_year` | integer | YES |  |  |
| `listing_make` | text | YES |  |  |
| `listing_model` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `raw_data` | jsonb | YES |  |  |
| `status` | text | YES |  |  |
| `priority` | integer | YES |  |  |
| `error_message` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `attempts` | integer | YES |  |  |
| `max_attempts` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `next_attempt_at` | timestamp with time zone | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  |  |
| `locked_by` | text | YES |  |  |
| `last_attempt_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `failure_category` | text | YES |  |  |
| `archived_at` | timestamp with time zone | YES | now() |  |

### `snapshot_extraction_queue`

**Rows:** 402,691 (402.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `platform` | text | NO |  |  |
| `snapshot_url` | text | NO |  |  |
| `status` | text | NO | 'pending' |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `fields_filled` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `extraction_metadata`

**Rows:** 253,603 (253.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `field_value` | text | YES |  |  |
| `extraction_method` | text | NO |  |  |
| `scraper_version` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `confidence_score` | numeric | YES | 0.5 | 0.0 = uncertain, 0.5 = medium confidence (e.g., partial name), 1.0 = certain |
| `validation_status` | text | YES | 'unvalidated' | Values: `unvalidated`, `valid`, `invalid`, `conflicting`, `low_confidence` |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `raw_extraction_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `field_evidence`

**Rows:** 160,564 (160.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `proposed_value` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `source_confidence` | integer | YES |  |  |
| `extraction_context` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `supporting_signals` | jsonb | YES | '[]' |  |
| `contradicting_signals` | jsonb | YES | '[]' |  |
| `status` | text | YES | 'pending' | Values: `pending`, `accepted`, `rejected`, `conflicted`, `superseded` |
| `assigned_at` | timestamp with time zone | YES |  |  |
| `assigned_by` | text | YES |  |  |
| `raw_extraction_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `extraction_metrics`

**Rows:** 145,190 (145.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `extractor_name` | text | NO |  |  |
| `source` | text | YES |  |  |
| `run_id` | text | NO |  |  |
| `source_url` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `success` | boolean | NO |  |  |
| `latency_ms` | integer | YES |  |  |
| `error_type` | text | YES |  |  |
| `error_message` | text | YES |  |  |
| `http_status` | smallint | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `import_queue`

**Rows:** 25,971 (26.0K)
**Pipeline:** Main intake queue. Insert URLs here; haiku-extraction-worker processes them.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source_id` | uuid | YES |  |  |
| `listing_url` | text | NO |  |  |
| `listing_title` | text | YES |  |  |
| `listing_price` | bigint | YES |  |  |
| `listing_year` | integer | YES |  |  |
| `listing_make` | text | YES |  |  |
| `listing_model` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `raw_data` | jsonb | YES | '{}' |  |
| `status` | text | YES | 'pending' | Queue processing status. Values: pending (waiting), processing (claimed by a worker — do not pick up), complete (successfully processed), failed (gave up after max_attempts), skipped (intentionally bypassed), duplicate (URL already exists). Enforced by CHECK constraint. Values: `pending`, `processing`, `pending_review`, `pending_strategy`, `complete`, `failed`, `skipped`, `duplicate` |
| `priority` | integer | YES | 0 |  |
| `error_message` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  | FK to vehicles.id. Populated when import successfully creates or matches a vehicle record. NULL = not yet processed. PROTECTED -- owner: `haiku-extraction-worker` |
| `attempts` | integer | YES | 0 | Number of processing attempts. Incremented on each failure. When attempts >= max_attempts, status becomes failed. |
| `max_attempts` | integer | YES | 3 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `next_attempt_at` | timestamp with time zone | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  | Timestamp when worker claimed this record. Stale threshold: 30 minutes. Use release_stale_locks() to reclaim stuck records. PROTECTED -- owner: `haiku-extraction-worker` |
| `locked_by` | text | YES |  | ID of the worker instance that claimed this record. Format: cqp-{timestamp}-{random}. Set by continuous-queue-processor. If locked_at is >30min ago, lock is stale — use release_stale_locks(). PROTECTED -- owner: `haiku-extraction-worker` |
| `last_attempt_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `extractor_version` | text | YES |  | Version of the extractor that processed this record. Used to re-queue records when extractor is updated. |
| `failure_category` | text | YES |  | Categorized reason for failure. Values: rate_limited, not_found, parse_error, network_error, duplicate, validation_error. Set on failure for queue health monitoring. |

### `sentiment_update_queue`

**Rows:** 18,344 (18.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `priority` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `vin_value_lookup_queue`

**Rows:** 8,756 (8.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('vin_value_lookup_queue_id_seq'::regclass) |  |
| `vehicle_id` | uuid | NO |  |  |
| `vin` | text | NO |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `status` | text | YES | 'pending' |  |
| `lookup_source` | text | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `lookup_result` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `extraction_health_log`

**Rows:** 4,421 (4.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('extraction_health_log_id_seq'::regclass) |  |
| `checked_at` | timestamp with time zone | YES | now() |  |
| `completed_1h` | bigint | YES |  |  |
| `completed_24h` | bigint | YES |  |  |
| `pending` | bigint | YES |  |  |
| `processing` | bigint | YES |  |  |
| `failed_1h` | bigint | YES |  |  |
| `items_per_hour` | numeric | YES |  |  |
| `is_stalled` | boolean | YES |  |  |
| `alert_level` | text | YES |  |  |
| `message` | text | YES |  |  |

### `extraction_runs`

**Rows:** 1,456 (1.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source` | text | NO |  |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `vehicles_created` | integer | YES | 0 |  |
| `vehicles_updated` | integer | YES | 0 |  |
| `status` | text | YES | 'running' |  |
| `error_message` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |

### `document_ocr_queue`

**Rows:** 916 (916)
**Pipeline:** Document OCR queue. Insert storage_path; document-ocr-worker processes it.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `deal_document_id` | uuid | YES |  |  |
| `storage_path` | text | NO |  | Supabase Storage path in deal-documents bucket |
| `status` | text | NO | 'pending' | Pipeline step tracking. Values: pending → classifying (determining doc type) → extracting (running OCR/AI) → linking (connecting to vehicles/deals) → complete. Also: failed, skipped. Enforced by CHECK constraint. This is the model for step-based pipeline tracking. Values: `pending`, `classifying`, `extracting`, `linking`, `complete`, `failed`, `skipped` |
| `priority` | integer | NO | 0 |  |
| `attempts` | integer | NO | 0 |  |
| `max_attempts` | integer | NO | 3 |  |
| `document_type` | text | YES |  |  |
| `document_type_confidence` | real | YES |  |  |
| `orientation_degrees` | integer | YES | 0 |  |
| `extraction_provider` | text | YES |  | Which AI provider ran OCR. Values: openai, anthropic, google_vision, tesseract. Set by document-ocr-worker. |
| `extraction_model` | text | YES |  |  |
| `extraction_data` | jsonb | YES |  | JSONB of extracted fields from the document. Schema varies by document_type. Written by document-ocr-worker after extraction completes. PROTECTED -- owner: `document-ocr-worker` write via: `document-ocr-worker` |
| `extraction_cost_usd` | real | YES |  |  |
| `linked_vehicle_id` | uuid | YES |  | FK to vehicles.id. Set during linking step. NULL = not yet linked or no vehicle match found. |
| `linked_deal_id` | uuid | YES |  |  |
| `linked_organization_ids` | ARRAY | YES |  |  |
| `linked_contact_ids` | ARRAY | YES |  |  |
| `observation_ids` | ARRAY | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  | PROTECTED -- owner: `document-ocr-worker` |
| `locked_by` | text | YES |  | Worker instance ID. Stale threshold: 30 minutes. Use release_stale_locks() to reclaim. PROTECTED -- owner: `document-ocr-worker` |
| `next_attempt_at` | timestamp with time zone | YES |  | For failed items: when to retry (exponential backoff) |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `backfill_queue`

**Rows:** 165 (165)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `field_names` | ARRAY | YES | ARRAY[][] |  |
| `reason` | text | NO |  | Values: `scraper_improved`, `low_quality_score`, `user_reported_issue`, `manual_audit`, `scheduled_refresh` |
| `scraper_version_id` | uuid | YES |  |  |
| `triggered_by` | text | YES | 'auto' |  |
| `priority` | integer | YES | 5 |  |
| `quality_score` | integer | YES |  |  |
| `source_url` | text | YES |  |  |
| `status` | text | YES | 'pending' | Values: `pending`, `processing`, `completed`, `failed`, `skipped` |
| `extraction_result` | jsonb | YES |  |  |
| `changes_detected` | jsonb | YES |  |  |
| `fields_updated` | ARRAY | YES | ARRAY[][] |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `extraction_comparisons`

**Rows:** 54 (54)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `url` | text | NO |  |  |
| `domain` | text | NO |  |  |
| `timestamp` | timestamp with time zone | NO |  |  |
| `free_success` | boolean | YES | false |  |
| `free_quality` | numeric | YES |  |  |
| `free_fields` | ARRAY | YES |  |  |
| `free_time_ms` | integer | YES |  |  |
| `free_methods_attempted` | ARRAY | YES |  |  |
| `paid_success` | boolean | YES | false |  |
| `paid_quality` | numeric | YES |  |  |
| `paid_fields` | ARRAY | YES |  |  |
| `paid_cost` | numeric | YES | 0 |  |
| `paid_time_ms` | integer | YES |  |  |
| `paid_methods_attempted` | ARRAY | YES |  |  |
| `quality_delta` | numeric | YES |  |  |
| `best_method` | text | YES |  |  |
| `best_quality` | numeric | YES |  |  |
| `difficulty` | text | YES |  |  |
| `full_result` | jsonb | YES |  |  |

## Market Intelligence

### `backtest_run_details`

**Rows:** 1,141,106 (1.1M)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `run_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `actual_hammer` | numeric | NO |  |  |
| `close_time` | timestamp with time zone | YES |  |  |
| `time_window` | text | NO |  |  |
| `bid_at_window` | numeric | YES |  |  |
| `price_tier` | text | YES |  |  |
| `predicted_hammer` | numeric | YES |  |  |
| `multiplier_used` | numeric | YES |  |  |
| `sniper_pct_used` | numeric | YES |  |  |
| `error_pct` | numeric | YES |  |  |
| `abs_error_pct` | numeric | YES |  |  |
| `optimal_multiplier` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `comp_median` | numeric | YES |  |  |
| `comp_count` | integer | YES |  |  |

### `nuke_estimates`

**Rows:** 570,180 (570.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `estimated_value` | numeric | NO |  |  |
| `value_low` | numeric | NO |  |  |
| `value_high` | numeric | NO |  |  |
| `confidence_score` | integer | NO |  |  |
| `price_tier` | text | NO |  | Values: `budget`, `mainstream`, `enthusiast`, `collector`, `trophy` |
| `confidence_interval_pct` | numeric | YES |  |  |
| `signal_weights` | jsonb | NO | '{}' | JSON map of signal name → {weight, multiplier, source_count} |
| `deal_score` | numeric | YES |  | ((estimated - asking) / estimated) * 100 * freshness_decay |
| `deal_score_label` | text | YES |  |  |
| `heat_score` | numeric | YES |  | 0-100 composite excitement metric |
| `heat_score_label` | text | YES |  |  |
| `model_version` | text | NO | 'v1' |  |
| `input_count` | integer | YES |  |  |
| `calculated_at` | timestamp with time zone | NO | now() |  |
| `is_stale` | boolean | YES | false |  |

### `projection_outcomes`

**Rows:** 314,598 (314.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `projection_type` | text | NO |  |  |
| `projected_value` | numeric | NO |  |  |
| `projected_at` | timestamp with time zone | NO |  |  |
| `projection_horizon` | text | YES |  |  |
| `actual_value` | numeric | YES |  |  |
| `actual_at` | timestamp with time zone | YES |  |  |
| `accuracy_score` | numeric | YES |  | Calculated: 1 - abs(projected - actual) / actual. Higher is better. |
| `error_pct` | numeric | YES |  |  |
| `model_version` | text | YES |  |  |
| `model_metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `clean_vehicle_prices`

**Rows:** 290,559 (290.6K)

*No column data loaded.*

### `market_trends`

**Rows:** 8,046 (8.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | YES |  |  |
| `year_start` | integer | YES |  |  |
| `year_end` | integer | YES |  |  |
| `platform` | text | NO | 'all' |  |
| `vehicle_count` | integer | NO | 0 |  |
| `analysis_count` | integer | NO | 0 |  |
| `demand_high_pct` | numeric | YES |  |  |
| `demand_moderate_pct` | numeric | YES |  |  |
| `demand_low_pct` | numeric | YES |  |  |
| `price_rising_pct` | numeric | YES |  |  |
| `price_stable_pct` | numeric | YES |  |  |
| `price_declining_pct` | numeric | YES |  |  |
| `avg_sentiment_score` | numeric | YES |  |  |
| `sentiment_samples` | integer | YES |  |  |
| `rarity_rare_pct` | numeric | YES |  |  |
| `rarity_moderate_pct` | numeric | YES |  |  |
| `rarity_common_pct` | numeric | YES |  |  |
| `avg_sale_price` | numeric | YES |  |  |
| `min_sale_price` | numeric | YES |  |  |
| `max_sale_price` | numeric | YES |  |  |
| `median_sale_price` | numeric | YES |  |  |
| `top_discussion_themes` | jsonb | YES |  |  |
| `top_community_concerns` | jsonb | YES |  |  |
| `period_start` | timestamp with time zone | YES |  |  |
| `period_end` | timestamp with time zone | YES |  |  |
| `calculated_at` | timestamp with time zone | YES | now() |  |

### `hammer_predictions`

**Rows:** 4,826 (4.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `external_listing_id` | uuid | YES |  |  |
| `current_bid` | numeric | NO |  |  |
| `bid_count` | integer | YES |  |  |
| `view_count` | integer | YES |  |  |
| `watcher_count` | integer | YES |  |  |
| `unique_bidders` | integer | YES |  |  |
| `hours_remaining` | numeric | YES |  |  |
| `time_window` | text | YES |  |  |
| `price_tier` | text | YES |  |  |
| `model_version` | integer | NO | 1 |  |
| `bid_velocity` | numeric | YES |  |  |
| `bid_to_watcher_ratio` | numeric | YES |  |  |
| `watcher_to_view_ratio` | numeric | YES |  |  |
| `comp_median` | numeric | YES |  |  |
| `comp_count` | integer | YES |  |  |
| `predicted_hammer` | numeric | NO |  |  |
| `predicted_low` | numeric | YES |  |  |
| `predicted_high` | numeric | YES |  |  |
| `multiplier_used` | numeric | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `predicted_margin` | numeric | YES |  |  |
| `predicted_flip_margin` | numeric | YES |  |  |
| `buy_recommendation` | text | YES |  |  |
| `actual_hammer` | numeric | YES |  |  |
| `prediction_error_pct` | numeric | YES |  |  |
| `prediction_error_usd` | numeric | YES |  |  |
| `scored_at` | timestamp with time zone | YES |  |  |
| `predicted_at` | timestamp with time zone | NO | now() |  |
| `notes` | text | YES |  |  |

### `market_proof_reports`

**Rows:** 1,563 (1.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `pipeline_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `comp_vehicle_ids` | ARRAY | YES |  |  |
| `comp_count` | integer | YES |  |  |
| `comp_prices` | ARRAY | YES |  |  |
| `comp_median` | numeric | YES |  |  |
| `comp_avg` | numeric | YES |  |  |
| `comp_min` | numeric | YES |  |  |
| `comp_max` | numeric | YES |  |  |
| `segment_analysis` | jsonb | YES |  |  |
| `total_bids_analyzed` | integer | YES |  |  |
| `avg_bid_velocity` | numeric | YES |  |  |
| `snipe_ratio_avg` | numeric | YES |  |  |
| `whale_bidder_count` | integer | YES |  |  |
| `total_comments_analyzed` | integer | YES |  |  |
| `sentiment_distribution` | jsonb | YES |  |  |
| `expert_comment_count` | integer | YES |  |  |
| `key_technical_concerns` | ARRAY | YES |  |  |
| `market_sentiment_keywords` | jsonb | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `estimated_value_low` | numeric | YES |  |  |
| `estimated_value_high` | numeric | YES |  |  |
| `hagerty_value` | numeric | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `discount_to_market` | numeric | YES |  |  |
| `recommendation` | text | YES |  |  |
| `risk_factors` | ARRAY | YES |  |  |
| `verification_checklist` | ARRAY | YES |  |  |
| `report_generated_at` | timestamp with time zone | NO | now() |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `prediction_model_coefficients`

**Rows:** 1,350 (1.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `model_version` | integer | NO | 1 |  |
| `price_tier` | text | NO |  |  |
| `time_window` | text | NO |  |  |
| `median_multiplier` | numeric | NO |  |  |
| `p25_multiplier` | numeric | YES |  |  |
| `p75_multiplier` | numeric | YES |  |  |
| `sample_size` | integer | NO | 0 |  |
| `trained_at` | timestamp with time zone | NO | now() |  |

### `record_prices`

**Rows:** 507 (507)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | NO |  |  |
| `record_price` | numeric | NO |  |  |
| `record_vehicle_id` | uuid | YES |  |  |
| `record_sale_date` | timestamp with time zone | YES |  |  |
| `record_platform` | text | YES |  |  |
| `record_url` | text | YES |  |  |
| `previous_record_price` | numeric | YES |  |  |
| `previous_record_date` | timestamp with time zone | YES |  |  |
| `times_record_broken` | integer | YES | 1 |  |
| `avg_time_between_records_days` | integer | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `backtest_runs`

**Rows:** 457 (457)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `mode` | text | NO |  |  |
| `model_version` | integer | NO | 1 |  |
| `compare_model_version` | integer | YES |  |  |
| `lookback_days` | integer | YES |  |  |
| `auction_count` | integer | NO | 0 |  |
| `limit_requested` | integer | YES |  |  |
| `mape` | numeric | YES |  |  |
| `median_ape` | numeric | YES |  |  |
| `bias_pct` | numeric | YES |  |  |
| `within_5pct_rate` | numeric | YES |  |  |
| `within_10pct_rate` | numeric | YES |  |  |
| `within_20pct_rate` | numeric | YES |  |  |
| `tier_window_matrix` | jsonb | YES |  |  |
| `suggested_coefficients` | jsonb | YES |  |  |
| `sniper_tuning_results` | jsonb | YES |  |  |
| `comparison_diff` | jsonb | YES |  |  |
| `status` | text | NO | 'running' |  |
| `error_message` | text | YES |  |  |
| `duration_ms` | integer | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |

### `prediction_model_make_corrections`

**Rows:** 134 (134)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('prediction_model_make_corrections_id_s... |  |
| `model_version` | integer | NO |  |  |
| `make` | text | NO |  |  |
| `correction_factor` | numeric | NO | 1.0 |  |
| `sample_size` | integer | YES |  |  |
| `bias_pct` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `market_index_values`

**Rows:** 70 (70)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `index_id` | uuid | NO |  |  |
| `value_date` | date | NO |  |  |
| `open_value` | numeric | YES |  |  |
| `close_value` | numeric | YES |  |  |
| `high_value` | numeric | YES |  |  |
| `low_value` | numeric | YES |  |  |
| `volume` | integer | YES | 0 |  |
| `components_snapshot` | jsonb | YES | '{}' | Snapshot of what vehicles/segments were in the index on this date |
| `calculation_metadata` | jsonb | YES | '{}' | How the value was calculated: {"avg_price": 45000, "count": 50, "method": "..."} |
| `created_at` | timestamp with time zone | NO | now() |  |

## Organizations and Identity

### `user_profile_queue`

**Rows:** 1,008,748 (1.0M)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `profile_url` | text | NO |  |  |
| `platform` | text | NO | 'bat' | Values: `bat`, `cars_and_bids`, `mecum`, `barrettjackson`, `russoandsteele`, `pcarmarket` ... (21 total) |
| `username` | text | YES |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `status` | text | NO | 'pending' | Values: `pending`, `processing`, `complete`, `failed` |
| `priority` | integer | NO | 50 |  |
| `error_message` | text | YES |  |  |
| `attempts` | integer | NO | 0 |  |
| `max_attempts` | integer | NO | 3 |  |
| `discovered_via` | text | YES |  |  |
| `source_vehicle_id` | uuid | YES |  |  |
| `source_comment_id` | uuid | YES |  |  |
| `source_listing_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `last_processed_at` | timestamp with time zone | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  |  |
| `locked_by` | text | YES |  |  |

### `bat_user_profiles`

**Rows:** 508,473 (508.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `username` | text | NO |  |  |
| `total_comments` | integer | YES | 0 |  |
| `total_bids` | integer | YES | 0 |  |
| `total_wins` | integer | YES | 0 |  |
| `total_questions` | integer | YES | 0 |  |
| `total_answers` | integer | YES | 0 |  |
| `avg_bid_amount` | numeric | YES |  |  |
| `max_bid_amount` | numeric | YES |  |  |
| `min_bid_amount` | numeric | YES |  |  |
| `win_rate` | numeric | YES |  |  |
| `expertise_score` | numeric | YES | 0 |  |
| `technical_knowledge` | numeric | YES | 0 |  |
| `market_knowledge` | numeric | YES | 0 |  |
| `avg_comment_quality` | numeric | YES | 0 |  |
| `preferred_categories` | ARRAY | YES |  |  |
| `typical_price_range` | jsonb | YES |  |  |
| `bidding_strategy` | text | YES |  |  |
| `avg_sentiment` | text | YES |  |  |
| `avg_likes_received` | numeric | YES | 0 |  |
| `community_trust_score` | numeric | YES | 0 |  |
| `bot_likelihood` | numeric | YES | 0 |  |
| `shill_flags` | integer | YES | 0 |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `identity_engagement_stats`

**Rows:** 504,886 (504.9K)

*No column data loaded.*

### `mv_bidder_profiles`

**Rows:** 337,348 (337.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `bat_username` | text | NO |  |  |
| `total_bids` | bigint | YES |  |  |
| `auctions_entered` | bigint | YES |  |  |
| `wins` | bigint | YES |  |  |
| `win_rate` | numeric | YES |  |  |
| `avg_bid` | numeric | YES |  |  |
| `max_bid` | numeric | YES |  |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |

### `organization_vehicles`

**Rows:** 139,778 (139.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `relationship_type` | text | NO |  | Role of this org for this vehicle: owner, consigner, sold_by, auction_platform (ran the sale), buyer, service_provider, work_location, storage Values: `owner`, `consigner`, `service_provider`, `work_location`, `sold_by`, `storage`, `auction_platform`, `buyer` |
| `status` | text | YES | 'active' | Values: `active`, `past`, `pending`, `sold`, `archived` |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `linked_by_user_id` | uuid | YES |  |  |
| `auto_tagged` | boolean | YES | false | True if linked automatically via GPS/receipt matching |
| `gps_match_confidence` | numeric | YES |  |  |
| `receipt_match_count` | integer | YES | 0 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `listing_status` | text | YES | 'for_sale' | Current status: for_sale, sold, new_arrival, in_build, auction_soon, etc. Values: `for_sale`, `sold`, `pending`, `new_arrival`, `in_build`, `auction_soon` ... (10 total) |
| `asking_price` | numeric | YES |  | Listed asking price (public) |
| `cost_basis` | numeric | YES |  | What dealer paid (internal only) |
| `days_on_lot` | integer | YES | 0 | Days since arrival, auto-calculated |
| `featured` | boolean | YES | false |  |
| `sale_date` | date | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `internal_notes` | text | YES |  |  |
| `location_on_lot` | text | YES |  |  |
| `quality_flag` | text | YES |  | Issue flags: duplicate, needs_verification, incomplete_data, wrong_org, spam |
| `quality_notes` | text | YES |  |  |
| `flagged_by_user_id` | uuid | YES |  |  |
| `flagged_at` | timestamp with time zone | YES |  |  |
| `hidden_from_public` | boolean | YES | false | Hide this vehicle from public listings until issues are resolved |
| `service_status` | text | YES |  | Service workflow status: currently_in_service (active work), service_archive (completed), or NULL (not in service) Values: `currently_in_service`, `service_archive` |
| `auto_matched_confidence` | real | YES |  |  |
| `auto_matched_reasons` | ARRAY | YES |  |  |
| `auto_matched_at` | timestamp with time zone | YES |  |  |
| `user_confirmed` | boolean | YES | false |  |
| `user_confirmed_by` | uuid | YES |  |  |
| `user_confirmed_at` | timestamp with time zone | YES |  |  |
| `user_rejected` | boolean | YES | false |  |
| `user_rejected_by` | uuid | YES |  |  |
| `user_rejected_at` | timestamp with time zone | YES |  |  |
| `override_notes` | text | YES |  |  |
| `location_id` | uuid | YES |  | Optional FK to specific org location where this vehicle relationship applies. NULL = org-level (no specific location). |

### `organization_behavior_signals`

**Rows:** 58,449 (58.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `signal_type` | text | NO |  |  |
| `signal_category` | text | NO |  |  |
| `signal_data` | jsonb | NO | '{}' |  |
| `confidence` | numeric | YES | 0.80 |  |
| `source_type` | text | NO |  |  |
| `source_id` | uuid | YES |  |  |
| `source_url` | text | YES |  |  |
| `impacts_roles` | ARRAY | YES | ARRAY[][] |  |
| `impacts_specializations` | ARRAY | YES | ARRAY[][] |  |
| `observed_at` | timestamp with time zone | NO | now() |  |
| `signal_date` | date | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `visibility` | USER-DEFINED | NO | 'org'::intel_visibility |  |
| `deal_jacket_id` | uuid | YES |  |  |
| `reported_by` | uuid | YES |  |  |

### `organizations`

**Rows:** 4,975 (5.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `business_name` | text | NO |  |  |
| `legal_name` | text | YES |  |  |
| `business_type` | text | YES |  | Values: `sole_proprietorship`, `partnership`, `llc`, `corporation`, `garage`, `dealership` ... (30 total) |
| `industry_focus` | ARRAY | YES | ARRAY[][] |  |
| `email` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `website` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip_code` | text | YES |  |  |
| `country` | text | YES | 'US' | ISO 3166-1 alpha-2 country code |
| `description` | text | YES |  |  |
| `specializations` | ARRAY | YES | ARRAY[][] |  |
| `services_offered` | ARRAY | YES | ARRAY[][] |  |
| `years_in_business` | integer | YES |  |  |
| `employee_count` | integer | YES |  |  |
| `accepts_dropoff` | boolean | YES | false |  |
| `offers_mobile_service` | boolean | YES | false |  |
| `has_lift` | boolean | YES | false |  |
| `has_paint_booth` | boolean | YES | false |  |
| `has_dyno` | boolean | YES | false |  |
| `has_alignment_rack` | boolean | YES | false |  |
| `hourly_rate_min` | numeric | YES |  |  |
| `hourly_rate_max` | numeric | YES |  |  |
| `service_radius_miles` | integer | YES |  |  |
| `total_projects_completed` | integer | YES | 0 |  |
| `total_vehicles_worked` | integer | YES | 0 |  |
| `average_project_rating` | numeric | YES | 0 |  |
| `total_reviews` | integer | YES | 0 |  |
| `repeat_customer_rate` | numeric | YES | 0 |  |
| `on_time_completion_rate` | numeric | YES | 0 |  |
| `is_verified` | boolean | YES | false |  |
| `verification_date` | timestamp with time zone | YES |  |  |
| `verification_level` | text | YES | 'unverified' | Values: `unverified`, `basic`, `premium`, `elite` |
| `status` | text | YES | 'active' | Values: `active`, `inactive`, `suspended`, `for_sale`, `sold` |
| `is_public` | boolean | YES | true |  |
| `estimated_value` | numeric | YES |  |  |
| `is_for_sale` | boolean | YES | false |  |
| `asking_price` | numeric | YES |  |  |
| `business_license` | text | YES |  |  |
| `tax_id` | text | YES |  |  |
| `registration_state` | text | YES |  |  |
| `registration_date` | date | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `latitude` | numeric | YES |  | Primary location latitude for GPS-based image tagging |
| `longitude` | numeric | YES |  | Primary location longitude for GPS-based image tagging |
| `discovered_by` | uuid | YES |  | User who discovered/created this org profile (like vehicles) |
| `logo_url` | text | YES |  |  |
| `banner_url` | text | YES |  |  |
| `total_vehicles` | integer | YES | 0 |  |
| `total_images` | integer | YES | 0 |  |
| `total_events` | integer | YES | 0 |  |
| `current_value` | numeric | YES |  |  |
| `is_tradable` | boolean | YES | false | Whether org stocks can be traded on platform |
| `stock_symbol` | text | YES |  | Trading symbol (e.g. VIVA, RESTOMOD) |
| `uploaded_by` | uuid | YES |  | Alias for discovered_by for consistency with vehicles table |
| `labor_rate` | numeric | YES |  | Standard hourly labor rate for the organization ($/hour) |
| `currency` | text | YES | 'USD' | ISO 4217 currency code (USD, EUR, GBP, etc.) |
| `tax_rate` | numeric | YES |  | Tax rate as percentage (e.g., 8.25 for 8.25%) |
| `search_keywords` | ARRAY | YES | ARRAY[][] | Auto-generated array of searchable keywords |
| `search_vector` | tsvector | YES |  | Full-text search vector for organization searches |
| `data_signals` | jsonb | YES | '{}' | Auto-analyzed data patterns (vehicles, receipts, timeline events) |
| `ui_config` | jsonb | YES | '{}' | Explicit UI preferences set by org (overrides everything if set) |
| `intelligence_last_updated` | timestamp with time zone | YES |  | When data_signals were last calculated |
| `has_team_data` | boolean | YES | false | Indicates if team/employee data has been scraped for this business (but data is private in business_team_data table). |
| `dealer_license` | text | YES |  | Dealer license number - key identifier for matching organizations |
| `geographic_key` | text | YES |  | Composite key: name-city-state for geographic matching (prevents mixing inventories) |
| `discovered_via` | text | YES |  | Method used to discover organization (e.g., classic_com_indexing, scraper, manual) |
| `metadata` | jsonb | YES | '{}' | JSONB field for storing additional business data (inventory URLs, slugs, image sources, etc.) |
| `source_url` | text | YES |  | URL where this organization was discovered (e.g., Classic.com profile) |
| `member_since` | timestamp with time zone | YES |  |  |
| `total_listings` | integer | YES | 0 |  |
| `total_bids` | integer | YES | 0 |  |
| `total_comments` | integer | YES | 0 |  |
| `total_auction_wins` | integer | YES | 0 |  |
| `total_success_stories` | integer | YES | 0 |  |
| `primary_focus` | text | YES |  | Primary business focus: service, inventory, or mixed |
| `total_sold` | integer | YES | 0 | Total number of vehicles/items sold |
| `gross_margin_pct` | numeric | YES |  | Gross profit margin percentage |
| `inventory_turnover` | numeric | YES |  | Annual inventory turnover ratio |
| `avg_days_to_sell` | numeric | YES |  | Average number of days to sell inventory |
| `project_completion_rate` | numeric | YES |  | Percentage of projects completed on time |
| `repeat_customer_count` | integer | YES | 0 | Number of repeat customers |
| `gmv` | numeric | YES | 0 | Gross Merchandise Value - total value of all transactions |
| `receipt_count` | integer | YES | 0 | Total number of receipts/transactions processed |
| `listing_count` | integer | YES | 0 | Total number of listings (may be redundant with total_listings) |
| `total_projects` | integer | YES | 0 | Total number of projects completed |
| `incorporation_jurisdiction` | text | YES |  | State/country of incorporation (e.g., Delaware, Nevada, Cayman Islands) |
| `year_incorporated` | integer | YES |  | Year of incorporation/formation |
| `naics_code` | text | YES |  | North American Industry Classification System code (6 digits) |
| `revenue_declaration_date` | date | YES |  | When revenue range was last updated |
| `is_sec_filer` | boolean | YES | false | Has filed Form D, Form C, or other SEC disclosures |
| `cik_number` | text | YES |  | SEC Central Index Key (if registered) |
| `latest_form_d_date` | date | YES |  | Most recent Form D filing date |
| `latest_form_c_date` | date | YES |  | Most recent Form C filing date |
| `risk_factors` | text | YES |  | Investment risk disclosures (required for Form C) |
| `intellectual_property` | jsonb | YES | '{}' | Patents, trademarks, copyrights - structured as JSONB |
| `target_market_description` | text | YES |  | Description of target customer base/market |
| `slug` | text | YES |  | URL-friendly identifier (migrated from organizations) |
| `social_links` | jsonb | YES | '{}' |  |
| `inventory_url` | text | YES |  |  |
| `total_inventory` | integer | YES | 0 |  |
| `last_inventory_sync` | timestamp with time zone | YES |  |  |
| `scrape_source_id` | uuid | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `legacy_org_id` | uuid | YES |  | Original organizations.id for audit trail |
| `hours_of_operation` | jsonb | YES | '{}' |  |
| `service_type` | USER-DEFINED | YES |  | What service or tool does this organization provide? All automotive orgs offer a service. |
| `service_description` | text | YES |  |  |
| `powers_other_orgs` | boolean | YES | false | True if this org provides services TO other orgs (e.g., Speed Digital builds dealer websites) |
| `powered_by_org_id` | uuid | YES |  | If this dealer/org uses a platform like Speed Digital or DealerAccelerate |
| `parking_rate_per_day` | numeric | YES |  |  |
| `entity_type` | text | YES |  | Values: `collection`, `museum`, `private_foundation`, `dealer`, `franchise_dealer`, `independent_dealer` ... (53 total) |
| `legal_structure` | text | YES |  |  |
| `entity_attributes` | jsonb | YES | '{}' | Entity-type-specific structured attributes. Schema varies by entity_type. Separate from metadata (operational/provenance data). |
| `enrichment_status` | text | YES | 'stub' |  |
| `last_enriched_at` | timestamp with time zone | YES |  |  |
| `enrichment_sources` | ARRAY | YES |  |  |
| `brands_carried` | ARRAY | YES |  |  |
| `org_type` | text | YES |  | Digital twin classification: shop, dealer, auction_house, parts_supplier, restoration_house, etc. |
| `name` | text | YES |  | Display/trade name (synced from business_name). Used by digital twin views. |
| `specialty_makes` | ARRAY | YES |  | Array of vehicle makes this org specializes in. |
| `specialty_eras` | ARRAY | YES |  | Array of era tags: pre_war, classic, muscle_era, etc. |
| `bay_count` | integer | YES |  | Number of service/work bays. |
| `sq_footage` | integer | YES |  | Total shop square footage. |
| `max_concurrent_projects` | integer | YES |  |  |
| `has_lift_count` | integer | YES | 0 |  |
| `has_machine_shop` | boolean | YES | false | True if org has in-house machining capability. |
| `has_fabrication` | boolean | YES | false | True if org can do metal fabrication. |
| `has_upholstery` | boolean | YES | false |  |
| `has_climate_storage` | boolean | YES | false |  |
| `has_media_blasting` | boolean | YES | false |  |
| `has_rotisserie` | boolean | YES | false |  |
| `has_frame_jig` | boolean | YES | false |  |
| `hourly_rate_cents` | integer | YES |  | Standard shop hourly rate in cents. 15000 = $150/hr. |
| `typical_project_range_low_cents` | integer | YES |  |  |
| `typical_project_range_high_cents` | integer | YES |  |  |
| `trust_score` | integer | YES |  | COMPUTED: Platform trust rating 0-100. Derived from evidence chain quality. Never written directly. |
| `total_documented_jobs` | integer | YES | 0 | COMPUTED: Count of work_orders completed by this org. Never written directly. |
| `founded_year` | integer | YES |  | Year the organization was founded/established. |
| `source` | text | YES |  |  |
| `source_id` | text | YES |  |  |

### `organization_locations`

**Rows:** 4,593 (4.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `label` | text | YES |  | Human-readable name for this location: "Palm Beach Estate", "Main Workshop" |
| `location_type` | text | YES |  | Values: `headquarters`, `showroom`, `warehouse`, `storage`, `workshop`, `office` ... (14 total) |
| `is_primary` | boolean | YES | false | Primary/default location shown on org cards and map pins. Max one per org (enforced by partial unique index). |
| `street_address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip_code` | text | YES |  |  |
| `country` | text | YES | 'US' |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `geocode_source` | text | YES |  | How coordinates were obtained: manual, nominatim (OSM), lookup_table (fb_marketplace_locations), imported (backfill) Values: `manual`, `nominatim`, `lookup_table`, `imported` |
| `geocode_confidence` | numeric | YES |  |  |
| `geocoded_at` | timestamp with time zone | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `source` | text | YES | 'manual' | How this row was created: manual (user), backfill_primary (from org table), backfill_metadata (from org metadata JSONB), enrichment (AI/pipeline) Values: `manual`, `backfill_primary`, `backfill_metadata`, `enrichment` |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_inventory_sync_queue`

**Rows:** 3,853 (3.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `run_mode` | text | NO | 'both' | Values: `current`, `sold`, `both` |
| `status` | text | NO | 'pending' | Values: `pending`, `processing`, `completed`, `failed`, `skipped` |
| `attempts` | integer | NO | 0 |  |
| `last_error` | text | YES |  |  |
| `last_run_at` | timestamp with time zone | YES |  |  |
| `next_run_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `identity_claim_stats`

**Rows:** 3,264 (3.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `identity_id` | uuid | NO |  |  |
| `platform` | text | NO | 'bat' |  |
| `handle` | text | NO |  |  |
| `display_name` | text | YES |  |  |
| `profile_url` | text | YES |  |  |
| `vehicle_count` | integer | NO | 0 |  |
| `total_gmv_cents` | bigint | NO | 0 |  |
| `avg_sale_price` | integer | YES |  |  |
| `top_sale_price` | integer | YES |  |  |
| `comment_count` | integer | NO | 0 |  |
| `bid_count` | integer | NO | 0 |  |
| `total_bid_amount` | bigint | NO | 0 |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `last_sale_at` | timestamp with time zone | YES |  |  |
| `top_makes` | jsonb | YES | '[]' |  |
| `sample_vehicles` | jsonb | YES | '[]' |  |
| `claimed_by_user_id` | uuid | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `computed_at` | timestamp with time zone | NO | now() |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `comment_persona_signals`

**Rows:** 952 (952)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `comment_id` | uuid | YES |  |  |
| `author_username` | text | NO |  |  |
| `author_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `platform` | text | YES | 'bat' |  |
| `comment_text` | text | YES |  |  |
| `comment_length` | integer | YES |  |  |
| `tone_helpful` | numeric | YES |  |  |
| `tone_technical` | numeric | YES |  |  |
| `tone_friendly` | numeric | YES |  |  |
| `tone_confident` | numeric | YES |  |  |
| `tone_snarky` | numeric | YES |  |  |
| `expertise_level` | text | YES |  |  |
| `expertise_areas` | ARRAY | YES |  |  |
| `shows_specific_knowledge` | boolean | YES |  |  |
| `cites_sources` | boolean | YES |  |  |
| `intent` | text | YES |  |  |
| `is_serious_buyer` | boolean | YES |  |  |
| `is_tire_kicker` | boolean | YES |  |  |
| `is_seller_shill` | boolean | YES |  |  |
| `asks_questions` | boolean | YES |  |  |
| `answers_questions` | boolean | YES |  |  |
| `gives_advice` | boolean | YES |  |  |
| `makes_jokes` | boolean | YES |  |  |
| `critiques_others` | boolean | YES |  |  |
| `supports_others` | boolean | YES |  |  |
| `makes_claims` | boolean | YES |  |  |
| `claims_verifiable` | boolean | YES |  |  |
| `admits_uncertainty` | boolean | YES |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `model_used` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |

### `organization_images`

**Rows:** 549 (549)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `image_url` | text | NO |  |  |
| `thumbnail_url` | text | YES |  |  |
| `medium_url` | text | YES |  |  |
| `large_url` | text | YES |  |  |
| `taken_at` | timestamp with time zone | YES |  |  |
| `uploaded_at` | timestamp with time zone | YES | now() |  |
| `caption` | text | YES |  |  |
| `is_primary` | boolean | YES | false |  |
| `category` | text | YES |  | Values: `facility`, `equipment`, `team`, `work`, `event`, `logo`, `general` |
| `exif_data` | jsonb | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `ai_scanned` | boolean | YES | false |  |
| `ai_scan_date` | timestamp with time zone | YES |  |  |
| `ai_description` | text | YES |  |  |
| `ai_confidence` | numeric | YES |  |  |
| `is_sensitive` | boolean | YES | false | Marks image as containing sensitive/private information |
| `sensitivity_type` | text | YES |  | Type of sensitive data: work_order, financial, internal_only, proprietary Values: `work_order`, `financial`, `internal_only`, `proprietary`, `none` |
| `visibility_level` | text | YES | 'public' | Who can see this image: public, internal_only (org members), owner_only, contributor_only Values: `public`, `internal_only`, `owner_only`, `contributor_only` |
| `blur_preview` | boolean | YES | false | Show blurred thumbnail until clicked to reveal |
| `ocr_extracted_data` | jsonb | YES | '{}' | Financial and work order data extracted via OCR |
| `contains_financial_data` | boolean | YES | false | Quick flag for images containing pricing/invoice data |
| `ai_analysis` | jsonb | YES |  |  |
| `ai_tags` | ARRAY | YES |  |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `queued_for_analysis` | boolean | YES | false |  |
| `analysis_attempts` | integer | YES | 0 |  |
| `last_analysis_attempt` | timestamp with time zone | YES |  |  |

### `author_personas`

**Rows:** 363 (363)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `username` | text | NO |  |  |
| `platform` | text | YES | 'bat' |  |
| `author_id` | uuid | YES |  |  |
| `primary_persona` | text | YES |  |  |
| `secondary_personas` | ARRAY | YES |  |  |
| `avg_tone_helpful` | numeric | YES |  |  |
| `avg_tone_technical` | numeric | YES |  |  |
| `avg_tone_friendly` | numeric | YES |  |  |
| `avg_tone_confident` | numeric | YES |  |  |
| `avg_tone_snarky` | numeric | YES |  |  |
| `expertise_level` | text | YES |  |  |
| `expertise_areas` | ARRAY | YES |  |  |
| `top_expertise_area` | text | YES |  |  |
| `total_comments` | integer | YES | 0 |  |
| `comments_with_questions` | integer | YES | 0 |  |
| `comments_with_answers` | integer | YES | 0 |  |
| `comments_with_advice` | integer | YES | 0 |  |
| `comments_supportive` | integer | YES | 0 |  |
| `comments_critical` | integer | YES | 0 |  |
| `avg_comment_length` | integer | YES |  |  |
| `active_hours` | ARRAY | YES |  |  |
| `active_days` | ARRAY | YES |  |  |
| `vehicles_commented_on` | integer | YES | 0 |  |
| `unique_makes` | ARRAY | YES |  |  |
| `trust_score` | numeric | YES |  |  |
| `accuracy_score` | numeric | YES |  |  |
| `influence_score` | numeric | YES |  |  |
| `known_purchases` | integer | YES | 0 |  |
| `known_sales` | integer | YES | 0 |  |
| `avg_purchase_price` | integer | YES |  |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_relationships`

**Rows:** 140 (140)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source_org_id` | uuid | NO |  |  |
| `target_org_id` | uuid | NO |  |  |
| `relationship_type` | text | NO |  | Values: `dealer_for`, `exclusive_dealer_for`, `service_partner`, `distributor_for`, `competes_with`, `shares_brand_with` ... (12 total) |
| `is_exclusive` | boolean | YES | false |  |
| `territory` | text | YES |  |  |
| `since_date` | date | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `confidence_score` | numeric | YES | 0.50 |  |
| `source_url` | text | YES |  |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_investability_scores`

**Rows:** 78 (78)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `overall_score` | integer | YES | 0 |  |
| `investability_tier` | text | YES | 'seed' |  |
| `traction_score` | integer | YES | 0 |  |
| `traction_details` | jsonb | YES | '{}' |  |
| `financial_score` | integer | YES | 0 |  |
| `financial_details` | jsonb | YES | '{}' |  |
| `operational_score` | integer | YES | 0 |  |
| `operational_details` | jsonb | YES | '{}' |  |
| `market_score` | integer | YES | 0 |  |
| `market_details` | jsonb | YES | '{}' |  |
| `data_score` | integer | YES | 0 |  |
| `data_details` | jsonb | YES | '{}' |  |
| `improvement_recommendations` | jsonb | YES | '[]' |  |
| `next_milestones` | jsonb | YES | '[]' |  |
| `computed_at` | timestamp with time zone | YES | now() |  |

### `organization_brands`

**Rows:** 52 (52)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `brand_name` | text | NO |  |  |
| `authorization_level` | text | NO | 'authorized' | Values: `factory_authorized`, `exclusive`, `partner`, `pre_owned`, `service_only`, `aftermarket`, `consignment` |
| `brand_organization_id` | uuid | YES |  |  |
| `operating_name` | text | YES |  |  |
| `territory` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

## Ownership and Transfers

### `vehicle_mailboxes`

**Rows:** 976,159 (976.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `vin` | character varying | YES |  |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |

### `transfer_milestones`

**Rows:** 632,278 (632.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `transfer_id` | uuid | NO |  |  |
| `sequence` | integer | NO |  |  |
| `milestone_type` | USER-DEFINED | NO |  |  |
| `status` | USER-DEFINED | NO | 'pending'::milestone_status |  |
| `required` | boolean | NO | true | false = conditional step (e.g. shipping may not apply to local pickup deals). |
| `deadline_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `completed_by_user_id` | uuid | YES |  |  |
| `evidence_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `ownership_transfers`

**Rows:** 35,127 (35.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `from_user_id` | uuid | YES |  |  |
| `to_user_id` | uuid | YES |  |  |
| `from_identity_id` | uuid | YES |  |  |
| `to_identity_id` | uuid | YES |  |  |
| `trigger_type` | USER-DEFINED | NO |  |  |
| `trigger_id` | uuid | YES |  | FK to auction_events.id or external_listings.id — table identified by trigger_table column. |
| `trigger_table` | text | YES |  |  |
| `agreed_price` | numeric | YES |  |  |
| `currency` | text | NO | 'USD' |  |
| `status` | USER-DEFINED | NO | 'pending'::transfer_status |  |
| `sale_date` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `cancelled_at` | timestamp with time zone | YES |  |  |
| `stalled_at` | timestamp with time zone | YES |  | Set by background job when no milestone activity for 7+ days while status=in_progress. |
| `last_milestone_at` | timestamp with time zone | YES |  |  |
| `public_visibility` | text | NO | 'vague' | Controls what non-party viewers see: vague=status+elapsed only, detailed=full timeline, hidden=nothing. Values: `vague`, `detailed`, `hidden` |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `inbox_email` | text | YES |  |  |
| `buyer_phone` | text | YES |  |  |
| `seller_phone` | text | YES |  |  |
| `buyer_email` | text | YES |  |  |
| `seller_email` | text | YES |  |  |
| `buyer_access_token` | uuid | NO | uuid() |  |
| `seller_access_token` | uuid | NO | uuid() |  |

### `mailbox_access_keys`

**Rows:** 147 (147)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `mailbox_id` | uuid | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `org_id` | uuid | YES |  |  |
| `key_type` | character varying | NO |  |  |
| `permission_level` | character varying | NO |  |  |
| `relationship_type` | character varying | NO |  |  |
| `granted_by` | uuid | YES |  |  |
| `expires_at` | timestamp without time zone | YES |  |  |
| `conditions` | jsonb | YES |  |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |

## Discovery and Observations

### `comment_discoveries`

**Rows:** 132,865 (132.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `model_used` | text | YES | 'claude-3-haiku' |  |
| `prompt_version` | text | YES | 'v1-discovery' |  |
| `raw_extraction` | jsonb | NO |  |  |
| `comment_count` | integer | YES |  |  |
| `total_fields` | integer | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `overall_sentiment` | text | YES |  |  |
| `sentiment_score` | numeric | YES |  |  |
| `reviewed` | boolean | YES | false |  |
| `review_notes` | text | YES |  |  |
| `data_quality_score` | numeric | YES |  |  |
| `missing_data_flags` | ARRAY | YES |  |  |
| `recommended_sources` | ARRAY | YES |  |  |

### `description_discoveries`

**Rows:** 14,425 (14.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `model_used` | text | YES | 'claude-3-haiku' |  |
| `prompt_version` | text | YES | 'v1-discovery' |  |
| `raw_extraction` | jsonb | NO |  |  |
| `keys_found` | integer | YES |  |  |
| `total_fields` | integer | YES |  |  |
| `description_length` | integer | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `reviewed` | boolean | YES | false |  |
| `review_notes` | text | YES |  |  |
| `schema_suggestions` | jsonb | YES |  |  |

### `observation_discoveries`

**Rows:** 10,439 (10.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `observation_ids` | ARRAY | YES |  |  |
| `observation_count` | integer | YES |  |  |
| `source_categories` | ARRAY | YES |  |  |
| `date_range_start` | timestamp with time zone | YES |  |  |
| `date_range_end` | timestamp with time zone | YES |  |  |
| `discovery_type` | text | NO |  |  |
| `raw_extraction` | jsonb | NO |  |  |
| `confidence_score` | numeric | YES |  |  |
| `model_used` | text | YES |  |  |
| `prompt_version` | text | YES |  |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `is_reviewed` | boolean | YES | false |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `review_notes` | text | YES |  |  |

### `comment_library_extractions`

**Rows:** 5,500 (5.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | YES |  |  |
| `year_start` | smallint | YES |  |  |
| `year_end` | smallint | YES |  |  |
| `extraction_type` | text | NO |  | Values: `option_code`, `engine_spec`, `transmission_spec`, `paint_code`, `production_fact`, `known_issue`, `trim_package`, `part_number` |
| `extracted_data` | jsonb | NO |  |  |
| `source_comment_count` | integer | YES |  |  |
| `source_vehicle_count` | integer | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `promoted` | boolean | YES | false |  |
| `promoted_to_table` | text | YES |  |  |
| `promoted_to_id` | uuid | YES |  |  |
| `model_used` | text | YES |  |  |
| `batch_id` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `discovery_jobs`

**Rows:** 3,398 (3.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `job_type` | text | NO |  |  |
| `status` | text | YES | 'pending' |  |
| `progress` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `discovery_leads`

**Rows:** 320 (320)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `discovered_from_type` | text | NO |  | Values: `scrape_source`, `business`, `vehicle`, `user_profile`, `youtube_video`, `instagram_post`, `manual`, `ai_suggestion` |
| `discovered_from_id` | uuid | YES |  |  |
| `discovered_from_url` | text | YES |  |  |
| `lead_type` | text | NO |  | Values: `organization`, `website`, `social_profile`, `youtube_channel`, `vehicle_listing`, `collection` ... (9 total) |
| `lead_url` | text | NO |  |  |
| `lead_name` | text | YES |  |  |
| `lead_description` | text | YES |  |  |
| `suggested_business_type` | text | YES |  |  |
| `suggested_specialties` | ARRAY | YES |  |  |
| `confidence_score` | numeric | YES | 0.5 |  |
| `status` | text | YES | 'pending' | Values: `pending`, `investigating`, `converted`, `duplicate`, `invalid`, `skipped` |
| `converted_to_type` | text | YES |  |  |
| `converted_to_id` | uuid | YES |  |  |
| `discovery_method` | text | YES |  |  |
| `raw_data` | jsonb | YES | '{}' |  |
| `processing_notes` | text | YES |  |  |
| `depth` | integer | YES | 0 |  |
| `root_source_id` | uuid | YES |  |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `investigated_at` | timestamp with time zone | YES |  |  |
| `converted_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

## Reference Data

### `vin_decoded_data`

**Rows:** 115,872 (115.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vin` | text | NO |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `trim` | text | YES |  |  |
| `body_type` | text | YES |  |  |
| `doors` | integer | YES |  |  |
| `engine_size` | text | YES |  |  |
| `engine_cylinders` | integer | YES |  |  |
| `engine_displacement_liters` | text | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `plant_city` | text | YES |  |  |
| `plant_country` | text | YES |  |  |
| `vehicle_type` | text | YES |  |  |
| `provider` | text | NO | 'nhtsa' |  |
| `confidence` | numeric | YES | 100 |  |
| `decoded_at` | timestamp with time zone | YES | now() |  |
| `raw_response` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `reference_libraries`

**Rows:** 33,338 (33.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `year` | integer | NO |  |  |
| `make` | text | NO |  |  |
| `model` | text | YES |  |  |
| `series` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `description` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `vehicle_count` | integer | YES | 0 |  |
| `document_count` | integer | YES | 0 |  |
| `contributor_count` | integer | YES | 0 |  |
| `total_downloads` | integer | YES | 0 |  |
| `total_views` | integer | YES | 0 |  |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_verified` | boolean | YES | false |  |
| `verified_by` | uuid | YES |  |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `oem_spec_id` | uuid | YES |  |  |

### `ymm_knowledge`

**Rows:** 29,504 (29.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `ymm_key` | text | NO |  |  |
| `year` | integer | NO |  |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `vehicle_count` | integer | NO |  |  |
| `profile` | jsonb | NO | '{}' | Structured JSON: factory_specs, market, zone_damage_frequency, expert_quotes, common_mods_mentioned |
| `feature_vector` | ARRAY | YES |  | Pre-computed ~200D float vector for direct model input. Generated by featurizers.py |
| `source_comment_count` | integer | YES | 0 |  |
| `source_observation_count` | integer | YES | 0 |  |
| `source_image_count` | integer | YES | 0 |  |
| `built_at` | timestamp with time zone | YES | now() |  |
| `build_version` | text | YES | 'v1' |  |
| `build_duration_ms` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `gm_rpo_library`

**Rows:** 15,511 (15.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `rpo_code` | text | NO |  | 3-char alphanumeric RPO code (e.g., L05, Z28, G80) |
| `family_code` | text | YES |  | 3-char GM internal family grouping (e.g., ENG, TRN, RAX) |
| `category` | text | NO |  | Human-readable category (engine, transmission, rear_axle, etc.) |
| `noun_name` | text | YES |  |  |
| `description` | text | NO |  |  |
| `first_year` | smallint | YES |  | First model year this code was available (from NastyZ28 enrichment) |
| `last_year` | smallint | YES |  | Last model year this code was available (from NastyZ28 enrichment) |
| `gm_numeric_id` | integer | YES |  | Internal GM VPPS numeric sequence ID |
| `prod_type` | character | YES |  |  |
| `direction` | character | YES |  |  |
| `action_date` | text | YES |  |  |
| `source` | text | NO | 'gm_vpps_nov2002' | Data provenance: gm_vpps_nov2002, nastyz28, manual, spid_extraction |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `paint_codes`

**Rows:** 3,497 (3.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `code` | text | NO |  |  |
| `name` | text | NO |  |  |
| `hex_color` | text | YES |  |  |
| `color_family` | text | YES |  |  |
| `type` | text | YES |  |  |
| `year_start` | integer | YES |  |  |
| `year_end` | integer | YES |  |  |
| `source` | text | YES | 'seed' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' | Cross-reference codes: gm_wa_code, ditzler_ppg, dupont, model. Source-specific metadata. |

### `canonical_models`

**Rows:** 3,454 (3.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `canonical_model` | text | NO |  |  |
| `canonical_series` | text | YES |  |  |
| `year_start` | integer | YES |  |  |
| `year_end` | integer | YES |  |  |
| `body_styles` | ARRAY | YES |  |  |
| `aliases` | ARRAY | NO |  |  |
| `generation` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ecr_models`

**Rows:** 3,319 (3.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `ecr_make_slug` | text | NO |  |  |
| `ecr_model_slug` | text | NO |  |  |
| `model_name` | text | NO |  |  |
| `summary` | text | YES |  |  |
| `variants_count` | integer | YES |  |  |
| `image_url` | text | YES |  |  |
| `model_url` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `condition_knowledge`

**Rows:** 1,258 (1.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `chunk_id` | uuid | YES |  |  |
| `manual_section` | text | YES |  |  |
| `page_range` | text | YES |  |  |
| `system` | text | NO |  |  |
| `component` | text | NO |  |  |
| `sub_component` | text | YES |  |  |
| `condition_type` | text | NO |  | Values: `failure_mode`, `specification`, `inspection_criterion`, `maintenance_interval` |
| `symptom` | text | YES |  |  |
| `possible_causes` | ARRAY | YES |  |  |
| `corrections` | ARRAY | YES |  |  |
| `severity_class` | text | YES |  | Values: `cosmetic`, `functional`, `safety_critical`, `structural` |
| `spec_name` | text | YES |  |  |
| `spec_value` | text | YES |  |  |
| `spec_unit` | text | YES |  |  |
| `spec_min` | numeric | YES |  |  |
| `spec_max` | numeric | YES |  |  |
| `inspection_interval` | text | YES |  |  |
| `inspection_method` | text | YES |  |  |
| `pass_criteria` | text | YES |  |  |
| `fail_indicators` | ARRAY | YES |  |  |
| `condition_domain` | text | NO |  | Values: `exterior`, `interior`, `mechanical`, `structural`, `provenance` |
| `related_zones` | ARRAY | YES |  |  |
| `descriptor_id` | uuid | YES |  |  |
| `applicable_makes` | ARRAY | YES |  |  |
| `applicable_models` | ARRAY | YES |  |  |
| `applicable_years` | int4range | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vintage_rpo_codes`

**Rows:** 901 (901)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `rpo_code` | text | NO |  |  |
| `category` | text | NO |  |  |
| `description` | text | NO |  |  |
| `detail` | text | YES |  |  |
| `displacement_ci` | integer | YES |  |  |
| `displacement_liters` | numeric | YES |  |  |
| `horsepower` | integer | YES |  |  |
| `torque` | integer | YES |  |  |
| `first_year` | smallint | NO |  |  |
| `last_year` | smallint | NO |  |  |
| `makes` | ARRAY | YES |  |  |
| `models` | ARRAY | YES |  |  |
| `rarity` | text | YES |  | Values: `common`, `uncommon`, `rare`, `very-rare`, `ultra-rare` |
| `price_impact` | text | YES |  | Values: `none`, `low`, `moderate`, `high`, `very-high` |
| `mandatory_with` | ARRAY | YES |  |  |
| `incompatible_with` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `manufacturer` | text | YES | 'GM' |  |

### `oem_trim_levels`

**Rows:** 595 (595)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model_family` | text | YES |  |  |
| `trim_name` | text | NO |  |  |
| `trim_level` | text | YES |  |  |
| `marketing_name` | text | YES |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | YES |  |  |
| `trim_code` | text | YES |  |  |
| `standard_features` | ARRAY | YES |  |  |
| `optional_packages` | ARRAY | YES |  |  |
| `base_msrp_usd` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ecr_makes`

**Rows:** 594 (594)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `ecr_make_slug` | text | NO |  |  |
| `make_name` | text | NO |  |  |
| `make_url` | text | NO |  |  |
| `logo_url` | text | YES |  |  |
| `model_count` | integer | YES |  |  |
| `car_count` | integer | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `condition_aliases`

**Rows:** 299 (299)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `alias_key` | text | NO |  |  |
| `descriptor_id` | uuid | NO |  |  |
| `taxonomy_version` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `condition_taxonomy`

**Rows:** 202 (202)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `descriptor_id` | uuid | NO | uuid() |  |
| `canonical_key` | text | NO |  | Dot-notation path: domain.category.specific (e.g. exterior.paint.oxidation) |
| `domain` | text | NO |  | Top-level domain: exterior/interior/mechanical/structural/provenance |
| `descriptor_type` | text | NO |  | Type: adjective/mechanism/state |
| `display_label` | text | NO |  |  |
| `lifecycle_affinity` | ARRAY | YES |  | Which lifecycle states this descriptor is associated with (fresh, worn, weathered, restored, palimpsest, ghost, archaeological) |
| `severity_scale` | text | YES |  | How severity is measured: binary/low_med_high/0_to_1/null |
| `created_at` | timestamp with time zone | NO | now() |  |
| `deprecated_at` | timestamp with time zone | YES |  |  |
| `replaced_by_descriptor_id` | uuid | YES |  |  |
| `taxonomy_version` | text | NO | 'v1_2026_03' |  |

### `canonical_makes`

**Rows:** 152 (152)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `canonical_name` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `short_name` | text | YES |  |  |
| `aliases` | ARRAY | YES | ARRAY[][] |  |
| `country_of_origin` | text | YES |  |  |
| `founded_year` | integer | YES |  |  |
| `parent_company` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `brand_tier` | text | YES |  | Values: `exotic`, `luxury`, `premium`, `mainstream`, `budget` |

### `source_alias_mapping`

**Rows:** 131 (131)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `raw_value` | text | NO |  |  |
| `canonical_slug` | text | NO |  |  |
| `notes` | text | YES |  |  |

### `observation_sources`

**Rows:** 131 (131)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `category` | USER-DEFINED | NO |  |  |
| `base_url` | text | YES |  |  |
| `url_patterns` | ARRAY | YES |  |  |
| `base_trust_score` | numeric | YES | 0.50 |  |
| `trust_factors` | jsonb | YES | '{}' |  |
| `supported_observations` | ARRAY | YES |  |  |
| `requires_auth` | boolean | YES | false |  |
| `rate_limit_per_hour` | integer | YES |  |  |
| `makes_covered` | ARRAY | YES |  |  |
| `years_covered` | int4range | YES |  |  |
| `regions_covered` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `business_id` | uuid | YES |  | Unified org: this source is represented as a business for discovery, metrics, and UI. |

### `source_registry`

**Rows:** 94 (94)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `slug` | text | NO |  | URL-safe unique identifier (e.g., bringatrailer, cars-and-bids) |
| `display_name` | text | NO |  |  |
| `category` | text | NO |  | Source type: auction, marketplace, forum, social, dealer, registry, documentation Values: `auction`, `marketplace`, `forum`, `social`, `dealer`, `registry`, `documentation` |
| `status` | text | YES | 'active' | Health status: active, degraded, blocked, archived, pending, not_started Values: `active`, `degraded`, `blocked`, `archived`, `pending`, `not_started`, `investigating`, `monitoring` |
| `last_successful_at` | timestamp with time zone | YES |  |  |
| `success_rate_24h` | double precision | YES |  |  |
| `success_rate_7d` | double precision | YES |  |  |
| `success_rate_30d` | double precision | YES |  |  |
| `avg_extraction_ms` | integer | YES |  |  |
| `extractor_function` | text | YES |  | Name of the edge function that handles extraction for this source |
| `fallback_method` | text | YES |  |  |
| `requires_auth` | boolean | YES | false |  |
| `cloudflare_protected` | boolean | YES | false |  |
| `data_quality_score` | double precision | YES |  |  |
| `is_ugly_source` | boolean | YES | false | True for high-volume, low-signal sources that need aggressive filtering (eBay, Copart) |
| `quality_filters` | jsonb | YES |  | JSONB config for source-specific quality filtering rules |
| `discovery_url` | text | YES |  |  |
| `discovery_method` | text | YES |  | How to find new listings: sitemap, api, crawl, rss, manual |
| `discovery_frequency` | interval | YES | '01:00:00'::interval |  |
| `total_extracted` | integer | YES | 0 |  |
| `total_vehicles_created` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `onboard_phases_complete` | ARRAY | YES | '{}'[] |  |
| `estimated_extraction_hours` | numeric | YES |  |  |
| `monitoring_strategy` | text | YES |  |  |
| `monitoring_frequency_hours` | integer | YES | 24 |  |
| `observation_source_id` | uuid | YES |  |  |
| `listing_url_pattern` | text | YES |  |  |

### `survival_rate_estimates`

**Rows:** 51 (51)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | NO |  |  |
| `total_produced` | integer | YES |  |  |
| `estimated_surviving` | integer | YES |  |  |
| `survival_rate` | numeric | YES |  |  |
| `estimation_method` | text | NO |  | Values: `registry_data`, `listing_frequency`, `decay_model` |
| `proxy_signals` | jsonb | YES | '{}' | {"unique_vins_seen": N, "listing_frequency_annual": N, "sources_seen": [...]} |
| `confidence_score` | integer | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `oem_vehicle_specs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | YES |  |  |
| `trim_level` | text | YES |  |  |
| `series` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `wheelbase_inches` | numeric | YES |  |  |
| `length_inches` | numeric | YES |  |  |
| `width_inches` | numeric | YES |  |  |
| `height_inches` | numeric | YES |  |  |
| `ground_clearance_inches` | numeric | YES |  |  |
| `bed_length_inches` | numeric | YES |  |  |
| `curb_weight_lbs` | integer | YES |  |  |
| `gross_vehicle_weight_lbs` | integer | YES |  |  |
| `payload_capacity_lbs` | integer | YES |  |  |
| `towing_capacity_lbs` | integer | YES |  |  |
| `engine_size` | text | YES |  |  |
| `engine_displacement_liters` | numeric | YES |  |  |
| `engine_displacement_cid` | integer | YES |  |  |
| `engine_config` | text | YES |  |  |
| `horsepower` | integer | YES |  |  |
| `torque_ft_lbs` | integer | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `drive_type` | text | YES |  |  |
| `mpg_city` | numeric | YES |  |  |
| `mpg_highway` | numeric | YES |  |  |
| `mpg_combined` | numeric | YES |  |  |
| `fuel_tank_gallons` | numeric | YES |  |  |
| `doors` | integer | YES |  |  |
| `seats` | integer | YES |  |  |
| `cab_style` | text | YES |  |  |
| `available_paint_codes` | ARRAY | YES |  |  |
| `source` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `source_library_id` | uuid | YES |  |  |
| `source_documents` | ARRAY | YES |  |  |
| `verification_status` | text | YES | 'unverified' |  |
| `confidence_score` | integer | YES | 50 |  |

### `condition_component_definitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `component_name` | text | NO |  |  |
| `component_category` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `mint_criteria` | ARRAY | YES |  |  |
| `common_issues` | ARRAY | YES |  |  |
| `value_weight` | numeric | YES | 1.0 |  |
| `safety_critical` | boolean | YES | false |  |
| `typical_repair_cost_range` | numrange | YES |  |  |
| `typical_replacement_cost_range` | numrange | YES |  |  |
| `applicable_body_styles` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

## Content and Publications

### `listing_page_snapshots`

**Rows:** 394,799 (394.8K)
**Pipeline:** Auto-populated by archiveFetch(). Never insert manually.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `platform` | text | NO |  |  |
| `listing_url` | text | NO |  |  |
| `fetched_at` | timestamp with time zone | NO | now() |  |
| `fetch_method` | text | YES |  |  |
| `http_status` | integer | YES |  |  |
| `success` | boolean | NO | false |  |
| `error_message` | text | YES |  |  |
| `html` | text | YES |  |  |
| `html_sha256` | text | YES |  |  |
| `content_length` | integer | YES |  |  |
| `metadata` | jsonb | NO | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `markdown` | text | YES |  |  |
| `html_storage_path` | text | YES |  | Storage path for migrated HTML content |
| `markdown_storage_path` | text | YES |  | Storage path for migrated markdown content |

### `build_posts`

**Rows:** 58,033 (58.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `build_thread_id` | uuid | NO |  |  |
| `post_number` | integer | NO |  | 1-indexed post position in thread (1 = original post). |
| `post_id_external` | text | YES |  |  |
| `post_url` | text | YES |  |  |
| `author_handle` | text | YES |  |  |
| `author_profile_url` | text | YES |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `posted_at` | timestamp with time zone | YES |  |  |
| `content_text` | text | YES |  |  |
| `content_html` | text | YES |  |  |
| `images` | ARRAY | YES |  |  |
| `image_count` | integer | YES | 0 |  |
| `has_video` | boolean | YES | false |  |
| `video_urls` | ARRAY | YES |  |  |
| `quoted_handles` | ARRAY | YES |  |  |
| `quoted_post_ids` | ARRAY | YES |  |  |
| `external_links` | ARRAY | YES |  |  |
| `post_type` | text | YES | 'update' | Values: `original`, `update`, `question`, `answer`, `media_only`, `milestone`, `completion`, `sale` |
| `observation_id` | uuid | YES |  | Link to vehicle_observations for unified data model. |
| `like_count` | integer | YES | 0 |  |
| `reply_count` | integer | YES | 0 |  |
| `word_count` | integer | YES | 0 |  |
| `content_hash` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `org_mentions` | ARRAY | YES |  |  |

### `publication_pages`

**Rows:** 41,592 (41.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `publication_id` | uuid | YES |  |  |
| `page_number` | integer | NO |  |  |
| `page_type` | text | YES |  |  |
| `image_url` | text | YES |  |  |
| `storage_image_path` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `extracted_text` | text | YES |  |  |
| `extraction_confidence` | double precision | YES |  |  |
| `ai_scan_metadata` | jsonb | YES | '{}' |  |
| `ai_last_scanned` | timestamp with time zone | YES |  |  |
| `ai_processing_status` | text | YES | 'pending' | Values: `pending`, `processing`, `completed`, `failed`, `skipped` |
| `analysis_model` | text | YES |  |  |
| `analysis_cost` | numeric | YES |  |  |
| `spatial_tags` | jsonb | YES | '[]' |  |
| `locked_by` | text | YES |  |  |
| `locked_at` | timestamp with time zone | YES |  |  |
| `attempts` | integer | NO | 0 |  |
| `max_attempts` | integer | NO | 3 |  |
| `error_message` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `catalog_parts`

**Rows:** 9,543 (9.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `catalog_id` | uuid | YES |  |  |
| `page_id` | uuid | YES |  |  |
| `diagram_id` | uuid | YES |  |  |
| `part_number` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `price_current` | numeric | YES |  |  |
| `currency` | text | YES | 'USD' |  |
| `application_data` | jsonb | YES |  |  |
| `name_embedding` | USER-DEFINED | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `product_image_url` | text | YES |  | Direct link to product photo |
| `category` | text | YES |  | Main category: Interior, Exterior, Engine, etc. |
| `subcategory` | text | YES |  | Sub-category: Seats, Bumpers, Cooling, etc. |
| `manufacturer` | text | YES | 'LMC' |  |
| `condition` | text | YES |  |  |
| `fits_models` | ARRAY | YES |  | Array of model names: C10, K10, Blazer |
| `year_start` | integer | YES |  | Starting year of compatibility |
| `year_end` | integer | YES |  | Ending year of compatibility |
| `in_stock` | boolean | YES | true |  |
| `supplier_url` | text | YES |  | Direct link to product on supplier website |
| `weight_lbs` | numeric | YES |  |  |
| `dimensions` | jsonb | YES |  |  |
| `installation_difficulty` | text | YES |  |  |
| `related_parts` | ARRAY | YES |  | Part numbers often bought together |

### `forum_page_snapshots`

**Rows:** 5,186 (5.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `forum_source_id` | uuid | YES |  |  |
| `page_url` | text | NO |  |  |
| `page_type` | text | NO |  | Values: `thread`, `thread_list`, `profile`, `section`, `homepage` |
| `fetch_method` | text | NO |  |  |
| `http_status` | integer | YES |  |  |
| `success` | boolean | NO |  |  |
| `error_message` | text | YES |  |  |
| `html` | text | YES |  |  |
| `html_sha256` | text | YES |  |  |
| `content_length` | integer | YES |  |  |
| `build_thread_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `fetched_at` | timestamp with time zone | YES | now() |  |

### `service_manual_chunks`

**Rows:** 3,356 (3.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `document_id` | uuid | NO |  |  |
| `page_number` | integer | NO |  |  |
| `section_name` | text | YES |  |  |
| `section_heading` | text | YES |  |  |
| `content` | text | NO |  |  |
| `content_type` | text | YES |  | Values: `procedure`, `specification`, `chart`, `diagram`, `reference` |
| `key_topics` | ARRAY | YES |  | Array of topics covered in this chunk for semantic search |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `build_threads`

**Rows:** 2,247 (2.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `forum_source_id` | uuid | NO |  |  |
| `thread_url` | text | NO |  |  |
| `thread_url_normalized` | text | YES |  |  |
| `thread_id_external` | text | YES |  |  |
| `thread_title` | text | YES |  |  |
| `author_handle` | text | YES |  |  |
| `author_profile_url` | text | YES |  |  |
| `author_external_identity_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_hints` | jsonb | YES |  | Extracted hints about the vehicle before full resolution. |
| `vehicle_match_confidence` | numeric | YES |  |  |
| `post_count` | integer | YES |  |  |
| `image_count_estimate` | integer | YES |  |  |
| `view_count` | integer | YES |  |  |
| `reply_count` | integer | YES |  |  |
| `first_post_date` | timestamp with time zone | YES |  |  |
| `last_post_date` | timestamp with time zone | YES |  |  |
| `last_activity_date` | timestamp with time zone | YES |  |  |
| `extraction_status` | text | YES | 'discovered' | Values: `discovered`, `queued`, `extracting`, `complete`, `failed`, `stale` |
| `posts_extracted` | integer | YES | 0 |  |
| `images_extracted` | integer | YES | 0 |  |
| `last_extracted_at` | timestamp with time zone | YES |  |  |
| `extraction_cursor` | text | YES |  | Bookmark for resuming extraction (page number, post ID, etc). |
| `is_featured` | boolean | YES | false |  |
| `is_complete` | boolean | YES | false |  |
| `has_sale_mention` | boolean | YES | false |  |
| `content_hash` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `publications`

**Rows:** 1,006 (1.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `organization_id` | uuid | YES |  |  |
| `publisher_slug` | text | NO |  |  |
| `title` | text | NO |  |  |
| `slug` | text | NO |  |  |
| `platform` | text | NO | 'issuu' |  |
| `platform_id` | text | YES |  |  |
| `platform_url` | text | NO |  |  |
| `cdn_hash` | text | YES |  |  |
| `publication_date` | date | YES |  |  |
| `issue_number` | text | YES |  |  |
| `page_count` | integer | YES |  |  |
| `language` | text | YES | 'en' |  |
| `publication_type` | text | YES |  |  |
| `cover_image_url` | text | YES |  |  |
| `storage_cover_path` | text | YES |  |  |
| `extraction_status` | text | YES | 'pending' | Values: `pending`, `pending_hash`, `hash_extracted`, `pages_indexed`, `analyzing`, `complete`, `failed` |
| `extraction_metadata` | jsonb | YES | '{}' |  |
| `source` | text | YES | 'issuu_import' |  |
| `data_quality_score` | integer | YES | 0 |  |
| `search_vector` | tsvector | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `forum_sources`

**Rows:** 179 (179)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `base_url` | text | NO |  |  |
| `platform_type` | text | YES |  |  |
| `platform_version` | text | YES |  |  |
| `vehicle_categories` | ARRAY | YES |  |  |
| `vehicle_makes` | ARRAY | YES |  |  |
| `year_range` | int4range | YES |  |  |
| `build_thread_patterns` | ARRAY | YES |  |  |
| `build_section_urls` | ARRAY | YES |  |  |
| `inspection_status` | text | YES | 'pending' | pending=not crawled, inspected=DOM analyzed, mapped=ready for extraction, active=extracting, failed=errors, paused=manual stop Values: `pending`, `inspected`, `mapped`, `active`, `failed`, `paused` |
| `dom_map` | jsonb | YES |  | JSON structure mapping forum HTML selectors for extraction. |
| `extraction_config` | jsonb | YES |  |  |
| `estimated_build_count` | integer | YES |  |  |
| `estimated_post_count` | integer | YES |  |  |
| `estimated_image_count` | integer | YES |  |  |
| `requires_login` | boolean | YES | false |  |
| `login_wall_indicator` | text | YES |  |  |
| `last_inspected_at` | timestamp with time zone | YES |  |  |
| `last_crawled_at` | timestamp with time zone | YES |  |  |
| `last_error` | text | YES |  |  |
| `consecutive_failures` | integer | YES | 0 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `catalog_text_chunks`

**Rows:** 56 (56)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `catalog_id` | uuid | YES |  |  |
| `chunk_index` | integer | YES |  |  |
| `text_content` | text | YES |  |  |
| `status` | text | YES | 'pending' | Values: `pending`, `processing`, `completed`, `failed` |
| `parts_extracted` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `library_documents`

**Rows:** 49 (49)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `library_id` | uuid | NO |  |  |
| `document_type` | text | NO |  |  |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `file_url` | text | NO |  |  |
| `thumbnail_url` | text | YES |  |  |
| `file_size_bytes` | bigint | YES |  |  |
| `page_count` | integer | YES |  |  |
| `mime_type` | text | YES |  |  |
| `year_published` | integer | YES |  |  |
| `year_range_start` | integer | YES |  |  |
| `year_range_end` | integer | YES |  |  |
| `publisher` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `language` | text | YES | 'en' |  |
| `edition` | text | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `is_factory_original` | boolean | YES | false |  |
| `is_verified` | boolean | YES | false |  |
| `quality_rating` | integer | YES |  |  |
| `view_count` | integer | YES | 0 |  |
| `download_count` | integer | YES | 0 |  |
| `bookmark_count` | integer | YES | 0 |  |
| `uploaded_by` | uuid | NO |  |  |
| `uploaded_at` | timestamp with time zone | YES | now() |  |
| `verified_by` | uuid | YES |  |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `uploader_type` | text | YES | 'user' |  |
| `uploader_org_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |

## Marketplace and Scraping

### `scraping_health`

**Rows:** 164,902 (164.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source` | text | NO |  | Values: `craigslist`, `bat`, `bringatrailer`, `ksl`, `facebook_marketplace`, `classiccars` ... (26 total) |
| `region` | text | YES |  |  |
| `search_term` | text | YES |  |  |
| `url` | text | YES |  |  |
| `success` | boolean | NO |  | Whether the scrape attempt succeeded |
| `status_code` | integer | YES |  |  |
| `error_message` | text | YES |  |  |
| `error_type` | text | YES |  | Category of error: timeout, bot_protection, not_found, network, parse_error |
| `response_time_ms` | integer | YES |  | How long the request took in milliseconds |
| `data_extracted` | jsonb | YES |  |  |
| `images_found` | integer | YES | 0 |  |
| `has_price` | boolean | YES | false |  |
| `has_location` | boolean | YES | false |  |
| `has_contact` | boolean | YES | false |  |
| `function_name` | text | YES |  |  |
| `attempt_number` | integer | YES | 1 |  |
| `retry_after_seconds` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `marketplace_listings`

**Rows:** 22,611 (22.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `facebook_id` | text | NO |  |  |
| `title` | text | YES |  |  |
| `price` | integer | YES |  |  |
| `location` | text | YES |  |  |
| `url` | text | NO |  |  |
| `image_url` | text | YES |  |  |
| `description` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `search_query` | text | YES |  |  |
| `scraped_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `vehicle_id` | uuid | YES |  |  |
| `reviewed` | boolean | YES | false |  |
| `review_notes` | text | YES |  |  |
| `messaged_at` | timestamp with time zone | YES |  |  |
| `parsed_year` | integer | YES |  |  |
| `parsed_make` | text | YES |  |  |
| `parsed_model` | text | YES |  |  |
| `all_images` | ARRAY | YES |  |  |
| `mileage` | integer | YES |  |  |
| `transmission` | text | YES |  |  |
| `exterior_color` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `listed_days_ago` | integer | YES |  |  |
| `priority` | text | YES | 'normal' | classic = pre-1992 (high priority), modern = 1992+ (lower priority), unknown = no year parsed |
| `contact_info` | jsonb | YES |  |  |
| `seller_profile_url` | text | YES |  |  |
| `comments` | jsonb | YES |  |  |
| `platform` | text | YES | 'facebook_marketplace' |  |
| `status` | text | YES | 'active' |  |
| `current_price` | numeric | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `extracted_year` | integer | YES |  |  |
| `removed_at` | timestamp with time zone | YES |  |  |
| `removal_reason` | text | YES |  |  |
| `sold_price_source` | text | YES |  |  |
| `fb_seller_id` | uuid | YES |  |  |
| `submission_count` | integer | YES | 1 |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `year_tier` | text | YES |  |  |
| `refined_at` | timestamp with time zone | YES |  |  |
| `raw_scrape_data` | jsonb | YES |  |  |

### `dealer_inventory`

**Rows:** 3,092 (3.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `dealer_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `status` | text | NO |  | Values: `in_stock`, `consignment`, `sold`, `pending_sale`, `maintenance`, `trade_in`, `wholesale`, `reserved` |
| `acquisition_type` | text | YES |  | Values: `purchase`, `consignment`, `trade_in`, `wholesale` |
| `acquisition_date` | date | YES |  |  |
| `acquisition_cost` | numeric | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `sale_date` | date | YES |  |  |
| `consignment_percentage` | numeric | YES |  |  |
| `days_in_inventory` | integer | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `fb_listing_disappearances`

**Rows:** 2,262 (2.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `listing_id` | uuid | NO |  |  |
| `first_missed_sweep_id` | uuid | YES |  |  |
| `last_missed_sweep_id` | uuid | YES |  |  |
| `consecutive_misses` | integer | YES | 1 |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_price` | numeric | YES |  |  |
| `last_seen_location_id` | uuid | YES |  |  |
| `status` | text | YES | 'missing' | Values: `missing`, `confirmed_sold`, `inferred_sold`, `relisted`, `expired`, `false_positive` |
| `reappeared_at` | timestamp with time zone | YES |  |  |
| `reappeared_price` | numeric | YES |  |  |
| `reappeared_sweep_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `dealer_inventory_seen`

**Rows:** 1,409 (1.4K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `dealer_id` | uuid | NO |  |  |
| `listing_url` | text | NO |  |  |
| `first_seen_at` | timestamp with time zone | NO | now() |  |
| `last_seen_at` | timestamp with time zone | NO | now() |  |
| `last_seen_status` | text | NO | 'in_stock' | Values: `in_stock`, `sold`, `unknown` |
| `seen_count` | integer | NO | 1 |  |
| `last_seen_source_url` | text | YES |  |  |

### `listing_feeds`

**Rows:** 719 (719)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source_slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `feed_url` | text | NO |  |  |
| `feed_type` | text | NO | 'rss' |  |
| `search_criteria` | jsonb | YES | '{}' |  |
| `enabled` | boolean | NO | true |  |
| `poll_interval_minutes` | integer | NO | 15 |  |
| `last_polled_at` | timestamp with time zone | YES |  |  |
| `last_poll_count` | integer | YES | 0 |  |
| `total_items_found` | integer | YES | 0 |  |
| `error_count` | integer | YES | 0 |  |
| `last_error` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `fb_marketplace_locations`

**Rows:** 582 (582)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `name` | text | NO |  |  |
| `state_code` | text | NO |  |  |
| `latitude` | numeric | NO |  |  |
| `longitude` | numeric | NO |  |  |
| `radius_miles` | integer | YES | 40 |  |
| `population` | integer | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `last_sweep_at` | timestamp with time zone | YES |  |  |
| `last_sweep_listings` | integer | YES | 0 |  |
| `total_listings_found` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `scrape_sources`

**Rows:** 554 (554)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `name` | text | NO |  |  |
| `url` | text | NO |  |  |
| `source_type` | text | NO |  | Values: `dealer`, `auction`, `marketplace`, `classifieds` |
| `parent_aggregator` | text | YES |  |  |
| `scrape_config` | jsonb | YES | '{}' |  |
| `listing_url_pattern` | text | YES |  |  |
| `inventory_url` | text | YES |  |  |
| `search_url_template` | text | YES |  |  |
| `contact_info` | jsonb | YES | '{}' |  |
| `location` | jsonb | YES | '{}' |  |
| `last_scraped_at` | timestamp with time zone | YES |  |  |
| `last_successful_scrape` | timestamp with time zone | YES |  |  |
| `total_listings_found` | integer | YES | 0 |  |
| `squarebody_count` | integer | YES | 0 |  |
| `scrape_frequency_hours` | integer | YES | 24 |  |
| `is_active` | boolean | YES | true |  |
| `requires_firecrawl` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `business_id` | uuid | YES |  | Links this source to a business/organization |
| `validation_status` | text | YES |  |  |
| `validation_error` | text | YES |  |  |
| `validated_at` | timestamp with time zone | YES |  |  |
| `sample_vehicle_id` | uuid | YES |  |  |
| `intelligence_id` | uuid | YES |  |  |

### `craigslist_listing_queue`

**Rows:** 288 (288)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `listing_url` | text | NO |  |  |
| `status` | text | YES | 'pending' | Values: `pending`, `processing`, `completed`, `failed` |
| `vehicle_id` | uuid | YES |  |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `region` | text | YES |  |  |
| `search_term` | text | YES |  |  |
| `scraped_at` | timestamp with time zone | YES |  |  |
| `error_message` | text | YES |  |  |
| `retry_count` | integer | YES | 0 |  |
| `max_retries` | integer | YES | 3 |  |
| `metadata` | jsonb | YES | '{}' |  |

### `fb_marketplace_sellers`

**Rows:** 127 (127)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `fb_user_id` | text | YES |  |  |
| `fb_profile_url` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `seller_type` | text | YES | 'individual' |  |
| `total_listings_seen` | integer | YES | 0 |  |
| `active_listings` | integer | YES | 0 |  |
| `sold_listings` | integer | YES | 0 |  |
| `avg_listing_price` | numeric | YES |  |  |
| `avg_days_to_sell` | numeric | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `location_pattern` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `classic_seller_queue`

**Rows:** 110 (110)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `profile_url` | text | NO |  |  |
| `seller_name` | text | YES |  |  |
| `seller_type` | text | YES |  | Values: `dealer`, `auction_house` |
| `status` | text | NO | 'pending' | Values: `pending`, `processing`, `completed`, `failed`, `skipped` |
| `attempts` | integer | NO | 0 |  |
| `last_error` | text | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `discovered_at` | timestamp with time zone | NO | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `fb_sweep_jobs`

**Rows:** 79 (79)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `started_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `status` | text | NO | 'pending' | Values: `pending`, `running`, `completed`, `failed`, `cancelled` |
| `locations_total` | integer | NO | 0 |  |
| `locations_processed` | integer | NO | 0 |  |
| `listings_found` | integer | NO | 0 |  |
| `new_listings` | integer | NO | 0 |  |
| `price_changes` | integer | NO | 0 |  |
| `disappeared_detected` | integer | NO | 0 |  |
| `errors` | integer | NO | 0 |  |
| `error_details` | jsonb | YES | '[]' |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `listing_extraction_health`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `platform` | text | NO |  |  |
| `listing_url` | text | NO |  |  |
| `snapshot_id` | uuid | YES |  |  |
| `extractor_name` | text | NO |  |  |
| `extractor_version` | text | NO |  |  |
| `extracted_at` | timestamp with time zone | NO | now() |  |
| `health` | jsonb | NO | '{}' |  |
| `overall_score` | integer | YES |  |  |
| `ok` | boolean | NO | false |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

## Business and Deals

### `business_vehicle_fleet`

**Rows:** 25,221 (25.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `business_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `fleet_role` | text | YES |  | Values: `inventory`, `project_car`, `customer_vehicle`, `company_vehicle`, `demo_vehicle`, `parts_car`, `completed_project`, `for_sale` |
| `relationship_type` | text | YES |  | Values: `owned`, `consignment`, `customer_dropoff`, `lease`, `rental` |
| `assigned_to` | uuid | YES |  |  |
| `project_name` | text | YES |  |  |
| `project_status` | text | YES |  | Values: `planning`, `in_progress`, `on_hold`, `completed`, `delivered` |
| `estimated_completion` | date | YES |  |  |
| `project_budget` | numeric | YES |  |  |
| `acquisition_cost` | numeric | YES |  |  |
| `acquisition_date` | date | YES |  |  |
| `target_sale_price` | numeric | YES |  |  |
| `customer_id` | uuid | YES |  |  |
| `status` | text | YES | 'active' | Values: `active`, `completed`, `sold`, `returned` |
| `added_to_fleet` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `acquisition_stage_log`

**Rows:** 2,308 (2.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `pipeline_id` | uuid | NO |  |  |
| `from_stage` | USER-DEFINED | YES |  |  |
| `to_stage` | USER-DEFINED | NO |  |  |
| `changed_by` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `business_timeline_events`

**Rows:** 1,270 (1.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `business_id` | uuid | NO |  |  |
| `created_by` | uuid | YES |  |  |
| `event_type` | text | NO |  | Values: `founded`, `incorporated`, `license_acquired`, `facility_move`, `equipment_purchase`, `employee_hired` ... (20 total) |
| `event_category` | text | NO |  | Values: `legal`, `operational`, `personnel`, `financial`, `recognition`, `growth`, `other` |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `event_date` | date | NO |  |  |
| `location` | text | YES |  |  |
| `documentation_urls` | ARRAY | YES | ARRAY[][] |  |
| `cost_amount` | numeric | YES |  |  |
| `cost_currency` | text | YES | 'USD' |  |
| `affects_valuation` | boolean | YES | false |  |
| `affects_capacity` | boolean | YES | false |  |
| `affects_reputation` | boolean | YES | false |  |
| `verification_status` | text | YES | 'unverified' | Values: `unverified`, `user_verified`, `document_verified`, `third_party_verified` |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `image_urls` | ARRAY | YES | ARRAY[][] | Photo evidence for this event (like timeline_events.image_urls) |
| `labor_hours` | numeric | YES |  |  |
| `confidence_score` | integer | YES | 50 |  |

### `deal_documents`

**Rows:** 931 (931)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `deal_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `document_type` | text | YES |  |  |
| `issuer` | text | YES |  |  |
| `issue_date` | date | YES |  |  |
| `photo_path` | text | YES |  |  |
| `ocr_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `storage_path` | text | YES |  |  |

### `acquisition_pipeline`

**Rows:** 864 (864)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `discovery_source` | text | NO | 'craigslist' |  |
| `discovery_url` | text | YES |  |  |
| `discovery_date` | timestamp with time zone | NO | now() |  |
| `discovered_by` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `location_city` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `seller_contact` | text | YES |  |  |
| `stage` | USER-DEFINED | NO | 'discovered'::acquisition_stage |  |
| `priority` | USER-DEFINED | NO | 'primary'::acquisition_priority |  |
| `stage_updated_at` | timestamp with time zone | NO | now() |  |
| `deal_score` | integer | YES |  |  |
| `market_proof_data` | jsonb | YES |  |  |
| `comp_count` | integer | YES |  |  |
| `comp_median` | numeric | YES |  |  |
| `comp_avg` | numeric | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `estimated_profit` | numeric | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `offer_amount` | numeric | YES |  |  |
| `offer_date` | timestamp with time zone | YES |  |  |
| `purchase_price` | numeric | YES |  |  |
| `purchase_date` | timestamp with time zone | YES |  |  |
| `title_status` | text | YES |  |  |
| `partner_shop_id` | uuid | YES |  |  |
| `shop_arrival_date` | timestamp with time zone | YES |  |  |
| `inspection_report` | jsonb | YES |  |  |
| `repair_estimate` | numeric | YES |  |  |
| `authentication_result` | jsonb | YES |  |  |
| `numbers_matching_verified` | boolean | YES |  |  |
| `reconditioning_cost` | numeric | YES |  |  |
| `reconditioning_items` | jsonb | YES |  |  |
| `listing_platform` | text | YES |  |  |
| `listing_url_resale` | text | YES |  |  |
| `listing_date` | timestamp with time zone | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `sale_date` | timestamp with time zone | YES |  |  |
| `buyer_info` | jsonb | YES |  |  |
| `total_investment` | numeric | YES |  |  |
| `gross_profit` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `seller_id` | uuid | YES |  |  |
| `cross_post_id` | uuid | YES |  |  |

### `line_items`

**Rows:** 680 (680)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `receipt_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `part_number` | text | YES |  |  |
| `description` | text | NO |  |  |
| `quantity` | numeric | YES | 1 |  |
| `unit_price` | numeric | YES |  |  |
| `total_price` | numeric | YES |  |  |
| `discount` | numeric | YES |  |  |
| `brand` | text | YES |  |  |
| `category` | text | YES |  |  |
| `serial_number` | text | YES |  |  |
| `warranty_info` | text | YES |  |  |
| `transaction_date` | date | YES |  |  |
| `transaction_number` | text | YES |  |  |
| `line_type` | text | YES | 'sale' |  |
| `additional_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `part_pattern_id` | uuid | YES |  |  |
| `service_pattern_id` | uuid | YES |  |  |
| `learned_insights` | jsonb | YES | '{}' |  |

### `receipts`

**Rows:** 242 (242)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `user_id` | uuid | NO |  |  |
| `file_url` | text | NO |  |  |
| `file_name` | text | YES |  |  |
| `file_type` | text | YES |  |  |
| `upload_date` | timestamp with time zone | YES | now() |  |
| `processing_status` | text | YES | 'pending' |  |
| `vendor_name` | text | YES |  |  |
| `vendor_address` | text | YES |  |  |
| `transaction_date` | date | YES |  |  |
| `transaction_number` | text | YES |  |  |
| `total_amount` | numeric | YES |  |  |
| `subtotal` | numeric | YES |  |  |
| `tax_amount` | numeric | YES |  |  |
| `raw_extraction` | jsonb | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `extraction_errors` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_active` | boolean | YES | true |  |
| `scope_type` | text | YES | 'user' |  |
| `scope_id` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `purchase_date` | date | YES |  |  |
| `source_document_table` | text | YES |  |  |
| `source_document_id` | uuid | YES |  |  |
| `receipt_date` | date | YES |  |  |
| `currency` | text | YES |  |  |
| `tax` | numeric | YES |  |  |
| `total` | numeric | YES |  |  |
| `payment_method` | text | YES |  |  |
| `card_last4` | text | YES |  |  |
| `card_holder` | text | YES |  |  |
| `invoice_number` | text | YES |  |  |
| `purchase_order` | text | YES |  |  |
| `raw_json` | jsonb | YES |  |  |
| `status` | text | YES | 'processed' |  |
| `processed_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `part_number` | text | YES |  |  |
| `learned_insights` | jsonb | YES | '{}' |  |
| `vendor_pattern_id` | uuid | YES |  |  |

### `service_records`

**Rows:** 242 (242)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `service_date` | date | YES |  |  |
| `mileage` | integer | YES |  |  |
| `shop_name` | text | YES |  |  |
| `shop_location` | text | YES |  |  |
| `work_performed` | text | YES |  |  |
| `cost` | numeric | YES |  |  |
| `parts_replaced` | ARRAY | YES |  |  |
| `service_type` | text | YES |  |  |
| `documentation_available` | boolean | YES | false |  |
| `source` | text | YES |  |  |
| `confidence_score` | numeric | YES | 0.5 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `deal_contacts`

**Rows:** 65 (65)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `full_name` | text | NO |  |  |
| `first_name` | text | YES |  |  |
| `last_name` | text | YES |  |  |
| `company` | text | YES |  |  |
| `role` | ARRAY | YES | '{}'[] |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `country` | text | YES | 'US' |  |
| `phone_home` | text | YES |  |  |
| `phone_mobile` | text | YES |  |  |
| `phone_work` | text | YES |  |  |
| `phone_fax` | text | YES |  |  |
| `email` | text | YES |  |  |
| `ebay_username` | text | YES |  |  |
| `profile_image_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `organization_id` | uuid | YES |  |  |

### `deal_reconditioning`

**Rows:** 52 (52)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `deal_id` | uuid | YES |  |  |
| `vendor_name` | text | YES |  |  |
| `vendor_id` | uuid | YES |  |  |
| `description` | text | YES |  |  |
| `amount` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `secure_documents`

**Rows:** 43 (43)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | YES |  |  |
| `document_type` | text | NO |  |  |
| `file_hash` | text | NO |  |  |
| `file_size` | integer | NO |  |  |
| `mime_type` | text | NO |  |  |
| `encryption_key_id` | uuid | YES |  |  |
| `storage_path` | text | NO |  |  |
| `upload_metadata` | jsonb | YES | '{}' |  |
| `verification_status` | text | YES | 'pending' |  |
| `verified_by` | uuid | YES |  |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `retention_until` | timestamp with time zone | YES | (now() + '7 years'::interval) |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_primary` | boolean | NO | false |  |

### `contract_assets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `contract_id` | uuid | NO |  |  |
| `asset_type` | text | NO |  | Values: `vehicle`, `organization`, `project`, `user`, `bond`, `stake` ... (11 total) |
| `asset_id` | uuid | NO |  |  |
| `allocation_pct` | numeric | YES |  |  |
| `allocation_cents` | bigint | YES |  |  |
| `shares_held` | bigint | YES |  |  |
| `weight` | numeric | YES |  |  |
| `entry_date` | timestamp with time zone | YES | now() |  |
| `entry_price_cents` | bigint | YES |  |  |
| `entry_nav_cents` | bigint | YES |  |  |
| `current_value_cents` | bigint | YES |  |  |
| `current_nav_cents` | bigint | YES |  |  |
| `unrealized_gain_loss_cents` | bigint | YES |  |  |
| `unrealized_gain_loss_pct` | numeric | YES |  |  |
| `is_locked` | boolean | YES | false |  |
| `lock_reason` | text | YES |  |  |
| `min_hold_period_days` | integer | YES |  |  |
| `curator_notes` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

## Pipeline and System

### `source_targets`

**Rows:** 785,126 (785.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO |  |  |
| `source_slug` | text | NO |  |  |
| `listing_url` | text | NO |  |  |
| `sitemap_file` | text | YES |  |  |
| `first_discovered_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |

### `service_executions`

**Rows:** 428,504 (428.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `service_key` | text | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `status` | text | NO | 'queued' | Values: `queued`, `executing`, `completed`, `failed`, `cancelled`, `pending_payment` |
| `trigger_type` | text | YES |  | Values: `auto`, `manual`, `scheduled` |
| `request_data` | jsonb | YES |  |  |
| `response_data` | jsonb | YES |  |  |
| `error_message` | text | YES |  |  |
| `retry_count` | integer | YES | 0 |  |
| `queued_at` | timestamp with time zone | YES | now() |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `fields_populated` | jsonb | YES |  |  |
| `documents_created` | ARRAY | YES |  |  |
| `form_completion_id` | uuid | YES |  |  |
| `price_paid` | numeric | YES |  |  |
| `payment_id` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `debug_runtime_logs`

**Rows:** 140,015 (140.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `source` | text | YES |  |  |
| `run_id` | text | YES |  |  |
| `hypothesis_id` | text | YES |  |  |
| `location` | text | YES |  |  |
| `message` | text | YES |  |  |
| `data` | jsonb | YES |  |  |

### `system_logs`

**Rows:** 131,298 (131.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('system_logs_id_seq'::regclass) |  |
| `log_type` | character varying | YES |  |  |
| `message` | text | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `enrichment_log`

**Rows:** 14,600 (14.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `source` | text | NO |  |  |
| `fields_applied` | integer | YES | 0 |  |
| `applied_at` | timestamp with time zone | YES | now() |  |

### `watchdog_runs`

**Rows:** 12,864 (12.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `health` | jsonb | YES |  |  |
| `issues` | ARRAY | YES |  |  |
| `actions_taken` | ARRAY | YES |  |  |
| `alerts_sent` | boolean | YES | false |  |

### `data_validations`

**Rows:** 7,672 (7.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `entity_type` | text | NO |  | Values: `vehicle`, `organization`, `user`, `image` |
| `entity_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `field_value` | text | NO |  |  |
| `validation_source` | text | NO |  | Values: `user_input`, `bat_listing`, `deal_jacket`, `title_document`, `vin_decoder`, `expert_appraisal` ... (11 total) |
| `validated_by` | uuid | YES |  |  |
| `confidence_score` | integer | YES | 50 |  |
| `source_url` | text | YES |  |  |
| `source_document_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `sentinel_alerts`

**Rows:** 7,063 (7.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `severity` | text | YES |  | Values: `critical`, `warning`, `info` |
| `type` | text | YES |  |  |
| `message` | text | YES |  |  |
| `data` | jsonb | YES |  |  |
| `acknowledged` | boolean | YES | false |  |

### `source_quality_snapshots`

**Rows:** 1,121 (1.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `snapshot_at` | timestamp with time zone | NO | now() |  |
| `source_name` | text | NO |  |  |
| `total_vehicles` | integer | NO |  |  |
| `ymm_coverage_pct` | numeric | YES |  |  |
| `vin_valid_pct` | numeric | YES |  |  |
| `price_valid_pct` | numeric | YES |  |  |
| `avg_quality_score` | numeric | YES |  |  |
| `null_year_count` | integer | YES |  |  |
| `null_make_count` | integer | YES |  |  |
| `null_model_count` | integer | YES |  |  |
| `model_polluted_count` | integer | YES |  |  |
| `junk_price_count` | integer | YES |  |  |
| `bad_vin_count` | integer | YES |  |  |
| `quality_grade` | character | YES |  |  |
| `alerts` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `data_quality_snapshots`

**Rows:** 1,008 (1.0K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO | nextval('data_quality_snapshots_id_seq'::regclass) |  |
| `captured_at` | timestamp with time zone | YES | now() |  |
| `sample_size` | integer | YES |  |  |
| `total_vehicles` | integer | YES |  |  |
| `field_stats` | jsonb | YES |  | JSONB map of field_name -> completion_pct (0.0-100.0). Computed from TABLESAMPLE SYSTEM(3) of non-deleted vehicles. |
| `pipeline_stats` | jsonb | YES |  | JSONB with active_cron_jobs array and per-function last_run/velocity info from cron.job_run_details. |
| `workforce_status` | jsonb | YES |  | JSONB summary of which enrichment workers are active, their rates, and ETAs to 95% completion. |

### `source_intelligence`

**Rows:** 377 (377)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `source_id` | uuid | YES |  |  |
| `source_purpose` | text | YES |  |  |
| `data_quality_tier` | text | YES |  |  |
| `extraction_priority` | integer | YES | 50 |  |
| `strengths` | ARRAY | YES |  |  |
| `weaknesses` | ARRAY | YES |  |  |
| `best_used_for` | text | YES |  |  |
| `requires_js_rendering` | boolean | YES | false |  |
| `requires_auth` | boolean | YES | false |  |
| `has_api` | boolean | YES | false |  |
| `api_docs_url` | text | YES |  |  |
| `rate_limit_notes` | text | YES |  |  |
| `recommended_extraction_method` | text | YES |  |  |
| `query_template` | text | YES |  |  |
| `supported_filters` | jsonb | YES | '{}' |  |
| `example_queries` | jsonb | YES | '[]' |  |
| `vehicle_specialties` | ARRAY | YES |  |  |
| `year_range_focus` | int4range | YES |  |  |
| `makes_focus` | ARRAY | YES |  |  |
| `inspection_notes` | text | YES |  |  |
| `page_structure_notes` | text | YES |  |  |
| `selector_hints` | jsonb | YES |  |  |
| `last_inspected_at` | timestamp with time zone | YES |  |  |
| `inspected_by` | text | YES |  |  |
| `vehicles_extracted` | integer | YES | 0 |  |
| `extraction_success_rate` | numeric | YES |  |  |
| `avg_data_completeness` | numeric | YES |  |  |
| `last_extraction_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bot_findings`

**Rows:** 362 (362)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `test_run_id` | uuid | YES |  |  |
| `persona_id` | uuid | YES |  |  |
| `finding_type` | text | NO |  | Values: `bug`, `ux_friction`, `performance`, `broken_link`, `missing_element`, `console_error` ... (10 total) |
| `severity` | text | NO |  | Values: `critical`, `high`, `medium`, `low`, `info` |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `page_url` | text | YES |  |  |
| `component` | text | YES |  |  |
| `screenshot_url` | text | YES |  |  |
| `console_logs` | jsonb | YES |  |  |
| `network_logs` | jsonb | YES |  |  |
| `reproduction_steps` | jsonb | YES | '[]' |  |
| `status` | text | YES | 'new' | Values: `new`, `triaged`, `confirmed`, `fixed`, `wont_fix`, `duplicate` |
| `assigned_to` | uuid | YES |  |  |
| `admin_notes` | text | YES |  |  |
| `admin_notification_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `investigation_id` | uuid | YES |  |  |
| `fix_attempt_id` | uuid | YES |  |  |
| `assigned_agent_id` | uuid | YES |  |  |
| `last_agent_activity` | timestamp with time zone | YES |  |  |

### `pii_audit_log`

**Rows:** 359 (359)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | YES |  |  |
| `accessed_by` | uuid | YES |  |  |
| `action` | text | NO |  |  |
| `resource_type` | text | NO |  |  |
| `resource_id` | uuid | YES |  |  |
| `ip_address` | inet | YES |  |  |
| `user_agent` | text | YES |  |  |
| `access_reason` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `rate_limits`

**Rows:** 175 (175)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `key` | text | NO |  |  |
| `count` | integer | NO | 1 |  |
| `window_start` | timestamp with time zone | NO |  |  |
| `expires_at` | timestamp with time zone | NO |  |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `usage_metrics`

**Rows:** 172 (172)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | YES |  |  |
| `session_id` | text | YES |  |  |
| `metric_type` | text | NO |  |  |
| `entity_type` | text | YES |  |  |
| `entity_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `ip_address` | inet | YES |  |  |
| `user_agent` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `pipeline_registry`

**Rows:** 107 (107)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `table_name` | text | NO |  |  |
| `column_name` | text | YES |  |  |
| `owned_by` | text | NO |  | Name of the edge function (or system/user) responsible for populating this field. |
| `description` | text | NO |  |  |
| `valid_values` | ARRAY | YES |  |  |
| `do_not_write_directly` | boolean | NO | false | If true, do not write to this field directly. Call write_via instead. |
| `write_via` | text | YES |  | The edge function to call when you want to update this field. Used when do_not_write_directly=true. |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

## Materialized Views

### `mv_bidder_profiles`

**Rows:** 337,348 (337.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `bat_username` | text | NO |  |  |
| `total_bids` | bigint | YES |  |  |
| `auctions_entered` | bigint | YES |  |  |
| `wins` | bigint | YES |  |  |
| `win_rate` | numeric | YES |  |  |
| `avg_bid` | numeric | YES |  |  |
| `max_bid` | numeric | YES |  |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |

### `mv_treemap_years`

**Rows:** 212,094 (212.1K)

*No column data loaded.*

### `mv_treemap_models_by_brand`

**Rows:** 130,230 (130.2K)

*No column data loaded.*

### `mv_bid_vehicle_summary`

**Rows:** 122,080 (122.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `bid_count` | bigint | YES |  |  |
| `unique_bidders` | bigint | YES |  |  |
| `opening_bid` | numeric | YES |  |  |
| `final_bid` | numeric | YES |  |  |
| `bid_range` | numeric | YES |  |  |
| `appreciation_pct` | numeric | YES |  |  |
| `duration_hours` | double precision | YES |  |  |
| `bids_per_hour` | numeric | YES |  |  |
| `first_bid_at` | timestamp with time zone | YES |  |  |
| `last_bid_at` | timestamp with time zone | YES |  |  |

### `mv_treemap_models_by_source_make`

**Rows:** 57,918 (57.9K)

*No column data loaded.*

### `mv_treemap_makes_by_source`

**Rows:** 5,261 (5.3K)

*No column data loaded.*

### `mv_treemap_makes_by_segment`

**Rows:** 1,853 (1.9K)

*No column data loaded.*

### `mv_treemap_by_brand`

**Rows:** 535 (535)

*No column data loaded.*

### `mv_vehicle_census`

**Rows:** 59 (59)

*No column data loaded.*

## User and Agent Systems

### `vehicle_agents`

**Rows:** 231,154 (231.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `agent_name` | text | YES |  |  |
| `personality` | text | YES |  |  |
| `voice_style` | text | YES | 'friendly' |  |
| `memory` | jsonb | YES | '{}' |  |
| `recent_context` | jsonb | YES | '[]' |  |
| `auto_claim_confidence` | double precision | YES | 0.8 |  |
| `notification_prefs` | jsonb | YES | '{"new_photos": true, "work_complete": true}' |  |
| `photos_received` | integer | YES | 0 |  |
| `messages_sent` | integer | YES | 0 |  |
| `last_active_at` | timestamp with time zone | YES |  |  |
| `owner_user_id` | uuid | YES |  |  |
| `owner_org_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_presence`

**Rows:** 9,534 (9.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO | nextval('user_presence_id_seq'::regclass) |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `last_seen_at` | timestamp with time zone | NO | now() |  |

### `user_gallery_items`

**Rows:** 1,880 (1.9K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | NO |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `image_url` | text | NO |  |  |
| `thumbnail_url` | text | YES |  |  |
| `storage_path` | text | YES |  |  |
| `content_type` | text | NO | 'artwork' |  |
| `medium` | text | YES |  |  |
| `dimensions` | text | YES |  |  |
| `artist_name` | text | YES |  |  |
| `exhibition` | text | YES |  |  |
| `venue` | text | YES |  |  |
| `year_created` | integer | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `display_order` | integer | YES | 0 |  |
| `is_public` | boolean | YES | true |  |
| `file_size` | bigint | YES |  |  |
| `mime_type` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_interactions`

**Rows:** 1,849 (1.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | NO |  |  |
| `interaction_type` | text | NO |  | Values: `like`, `dislike`, `save`, `skip`, `share`, `view` ... (11 total) |
| `target_type` | text | NO |  | Values: `image`, `vehicle`, `tag`, `event`, `user`, `shop`, `receipt` |
| `target_id` | text | NO |  |  |
| `context` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `claude_approval_requests`

**Rows:** 361 (361)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `session_id` | text | NO |  |  |
| `request_id` | text | NO |  |  |
| `tool_name` | text | NO |  |  |
| `tool_input` | jsonb | NO | '{}' |  |
| `description` | text | YES |  |  |
| `context` | jsonb | YES | '{}' |  |
| `telegram_message_id` | bigint | YES |  |  |
| `telegram_chat_id` | bigint | YES |  |  |
| `status` | text | NO | 'pending' | Values: `pending`, `approved`, `denied`, `expired`, `error` |
| `response_text` | text | YES |  |  |
| `response_data` | jsonb | YES | '{}' |  |
| `responded_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `expires_at` | timestamp with time zone | NO | (now() + '00:05:00'::interval) |  |

### `agent_tasks`

**Rows:** 215 (215)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `agent_type` | text | YES |  |  |
| `status` | text | YES | 'pending' | Values: `pending`, `claimed`, `in_progress`, `completed`, `failed`, `blocked` |
| `priority` | integer | YES | 50 |  |
| `claimed_by` | text | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `result` | jsonb | YES |  |  |
| `error` | text | YES |  |  |
| `depends_on` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_tools`

**Rows:** 130 (130)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `user_id` | uuid | NO |  |  |
| `part_number` | text | YES |  |  |
| `description` | text | NO |  |  |
| `brand` | text | YES |  |  |
| `category` | text | YES |  |  |
| `total_quantity` | integer | YES | 1 |  |
| `first_purchase_date` | date | YES |  |  |
| `last_purchase_date` | date | YES |  |  |
| `total_spent` | numeric | YES |  |  |
| `receipt_ids` | ARRAY | YES |  |  |
| `serial_numbers` | ARRAY | YES |  |  |
| `image_url` | text | YES |  |  |
| `condition` | text | YES | 'good' |  |
| `location` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `catalog_id` | uuid | YES |  |  |
| `discount_amount` | numeric | YES |  |  |
| `franchise_operator_id` | uuid | YES |  |  |
| `transaction_number` | text | YES |  |  |
| `transaction_date` | date | YES |  |  |
| `purchase_price` | numeric | YES |  |  |
| `serial_number` | text | YES |  |  |
| `verified_by_operator` | boolean | YES | false |  |

### `tool_catalog`

**Rows:** 126 (126)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `brand_id` | uuid | YES |  |  |
| `part_number` | text | NO |  |  |
| `model_number` | text | YES |  |  |
| `upc_code` | text | YES |  |  |
| `sku` | text | YES |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `long_description` | text | YES |  |  |
| `category_id` | uuid | YES |  |  |
| `specifications` | jsonb | YES |  |  |
| `msrp` | numeric | YES |  |  |
| `map_price` | numeric | YES |  |  |
| `dealer_cost` | numeric | YES |  |  |
| `product_url` | text | YES |  |  |
| `manual_url` | text | YES |  |  |
| `spec_sheet_url` | text | YES |  |  |
| `video_url` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `is_discontinued` | boolean | YES | false |  |
| `replacement_part_number` | text | YES |  |  |
| `release_date` | date | YES |  |  |
| `discontinue_date` | date | YES |  |  |
| `country_of_origin` | text | YES |  |  |
| `warranty_months` | integer | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `subcategory` | text | YES |  |  |
| `brochure_image_url` | text | YES |  |  |
| `discontinued` | boolean | YES | false |  |

### `tool_catalog_images`

**Rows:** 126 (126)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `catalog_id` | uuid | YES |  |  |
| `image_url` | text | NO |  |  |
| `image_type` | text | YES |  | Values: `primary`, `gallery`, `lifestyle`, `dimension`, `packaging` |
| `caption` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `agent_messages`

**Rows:** 97 (97)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `thread_id` | uuid | YES | uuid() |  |
| `reply_to_id` | uuid | YES |  |  |
| `from_role` | text | NO |  |  |
| `to_role` | text | NO |  |  |
| `from_email` | text | YES |  |  |
| `to_email` | text | YES |  |  |
| `subject` | text | NO |  |  |
| `body` | text | NO |  |  |
| `sent_via` | text | YES | 'internal' |  |
| `resend_id` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `read_at` | timestamp with time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |

### `tool_usage_stats`

**Rows:** 86 (86)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_tool_id` | uuid | YES |  |  |
| `part_number` | text | YES |  |  |
| `brand` | text | YES |  |  |
| `tool_description` | text | YES |  |  |
| `total_uses` | integer | YES | 0 |  |
| `last_used_at` | timestamp with time zone | YES |  |  |
| `vehicles_used_on` | ARRAY | YES | '{}'[] |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `agent_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | text | NO |  |  |
| `name` | text | NO |  |  |
| `focus` | text | NO |  |  |
| `capabilities` | ARRAY | NO |  |  |
| `prompt_template` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `platform` | text | YES |  |  |
| `is_external` | boolean | YES | false |  |
| `status` | text | YES | 'active' |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `owner_user_id` | uuid | YES |  |  |
| `trust_level` | text | YES | 'unverified' |  |
| `model_identifier` | text | YES |  |  |
| `version` | text | YES |  |  |

### `user_notifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `user_id` | uuid | NO |  |  |
| `type` | text | NO |  |  |
| `title` | text | NO |  |  |
| `message` | text | NO |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `is_read` | boolean | NO | false |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `organization_id` | uuid | YES |  |  |
| `notification_type` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `from_user_id` | uuid | YES |  |  |
| `action_url` | text | YES |  |  |
| `read_at` | timestamp with time zone | YES |  |  |

### `tool_usage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `tool_id` | uuid | NO |  |  |
| `work_session_id` | uuid | NO |  |  |
| `used_at` | timestamp with time zone | YES | now() |  |
| `duration_minutes` | integer | YES |  |  |
| `use_count` | integer | YES | 1 |  |
| `depreciation_amount` | numeric | NO | 0 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tool_inventory`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `owner_id` | uuid | YES |  |  |
| `name` | text | NO |  |  |
| `brand` | text | YES |  |  |
| `model` | text | YES |  |  |
| `serial_number` | text | YES |  |  |
| `category` | text | YES |  | Values: `diagnostic`, `hand_tool`, `power_tool`, `specialty`, `consumable`, `infrastructure` ... (9 total) |
| `purchase_date` | date | YES |  |  |
| `purchase_price` | numeric | NO |  |  |
| `purchase_location` | text | YES |  |  |
| `receipt_image_id` | uuid | YES |  |  |
| `depreciation_method` | text | YES | 'per_use' | Values: `per_use`, `per_year`, `per_hour` |
| `expected_lifespan_uses` | integer | YES |  |  |
| `expected_lifespan_years` | numeric | YES |  |  |
| `expected_lifespan_hours` | integer | YES |  |  |
| `salvage_value` | numeric | YES | 0 |  |
| `current_value` | numeric | YES |  |  |
| `total_uses` | integer | YES | 0 |  |
| `total_hours_used` | numeric | YES | 0 |  |
| `total_depreciation` | numeric | YES | 0 |  |
| `depreciation_per_use` | numeric | YES |  |  |
| `status` | text | YES | 'active' | Values: `active`, `needs_repair`, `retired`, `sold`, `lost` |
| `notes` | text | YES |  |  |
| `last_used_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

## Geo and Mapping

### `zip_to_fips`

**Rows:** 41,173 (41.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `zip` | text | NO |  |  |
| `fips` | text | NO |  |  |

### `geocoding_cache`

**Rows:** 27,660 (27.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `location_string` | text | NO |  |  |
| `latitude` | double precision | NO |  |  |
| `longitude` | double precision | NO |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `country` | text | YES |  |  |
| `source` | text | YES | 'vehicle_data' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `property_images`

**Rows:** 10,810 (10.8K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `property_id` | uuid | NO |  |  |
| `url` | text | NO |  |  |
| `thumbnail_url` | text | YES |  |  |
| `caption` | text | YES |  |  |
| `category` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |
| `is_primary` | boolean | YES | false |  |
| `width` | integer | YES |  |  |
| `height` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `spatial_ref_sys`

**Rows:** 8,600 (8.6K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `srid` | integer | NO |  |  |
| `auth_name` | character varying | YES |  |  |
| `auth_srid` | integer | YES |  |  |
| `srtext` | character varying | YES |  |  |
| `proj4text` | character varying | YES |  |  |

### `properties`

**Rows:** 4,738 (4.7K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `name` | text | NO |  |  |
| `slug` | text | YES |  |  |
| `description` | text | YES |  |  |
| `tagline` | text | YES |  |  |
| `property_type_id` | uuid | YES |  |  |
| `property_type` | text | YES |  |  |
| `owner_org_id` | uuid | YES |  |  |
| `owner_user_id` | uuid | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `region` | text | YES |  |  |
| `country` | text | YES | 'BL' |  |
| `postal_code` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `specs` | jsonb | YES | '{}' |  |
| `base_price` | numeric | YES |  |  |
| `price_currency` | text | YES | 'USD' |  |
| `price_period` | text | YES | 'week' |  |
| `min_booking_period` | integer | YES |  |  |
| `status` | text | YES | 'active' |  |
| `listing_type` | text | YES | 'rental' |  |
| `is_public` | boolean | YES | true |  |
| `is_featured` | boolean | YES | false |  |
| `sale_price` | numeric | YES |  |  |
| `sale_price_currency` | text | YES | 'USD' |  |
| `external_id` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `discovered_via` | text | YES |  |  |
| `search_keywords` | ARRAY | YES | ARRAY[][] |  |
| `search_vector` | tsvector | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `angle_label_coordinates`

**Rows:** 80 (80)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `label` | text | NO |  |  |
| `x_default` | numeric | NO |  |  |
| `y_default` | numeric | NO |  |  |
| `z_default` | numeric | NO |  |  |
| `default_confidence` | numeric | YES | 0.5 |  |
| `needs_refinement` | boolean | YES | false |  |
| `refinement_reason` | text | YES |  |  |
| `zone_name` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `angle_taxonomy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `angle_id` | uuid | NO | uuid() |  |
| `canonical_key` | text | NO |  |  |
| `domain` | text | NO |  |  |
| `display_label` | text | NO |  |  |
| `side_applicability` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `deprecated_at` | timestamp with time zone | YES |  |  |
| `replaced_by_angle_id` | uuid | YES |  |  |

### `angle_aliases`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `alias_key` | text | NO |  |  |
| `angle_id` | uuid | NO |  |  |
| `taxonomy_version` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `angle_to_subject_mapping`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `original_label` | text | NO |  |  |
| `subject_key` | text | NO |  |  |
| `confidence_boost` | numeric | YES | 0 |  |

## Notifications and Communication

### `url_inbox`

**Rows:** 190 (190)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `url` | text | NO |  |  |
| `source` | text | NO | 'unknown' |  |
| `source_user_id` | text | YES |  |  |
| `note` | text | YES |  |  |
| `status` | text | NO | 'pending' | Values: `pending`, `processing`, `completed`, `failed` |
| `result` | jsonb | YES | '{}' |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `contact_inbox`

**Rows:** 123 (123)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `email_id` | text | NO |  |  |
| `message_id` | text | YES |  |  |
| `from_address` | text | NO |  |  |
| `from_name` | text | YES |  |  |
| `to_address` | text | NO |  |  |
| `cc` | ARRAY | YES |  |  |
| `subject` | text | NO | '(no subject)' |  |
| `body_text` | text | YES |  |  |
| `body_html` | text | YES |  |  |
| `attachments` | jsonb | YES | '[]' |  |
| `in_reply_to` | text | YES |  |  |
| `thread_id` | text | YES |  |  |
| `status` | text | NO | 'unread' | Values: `unread`, `read`, `replied`, `archived`, `spam` |
| `replied_at` | timestamp with time zone | YES |  |  |
| `replied_by` | uuid | YES |  |  |
| `reply_resend_id` | text | YES |  |  |
| `headers` | jsonb | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `received_at` | timestamp with time zone | NO | now() |  |
| `read_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `notification_events`

**Rows:** 121 (121)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `event_type` | text | NO |  | Values: `vehicle_listed`, `vehicle_price_change`, `vehicle_status_change`, `auction_announced`, `auction_ending_soon`, `vehicle_sold`, `new_images_added`, `dealer_inventory_update` |
| `entity_type` | text | NO |  | Values: `vehicle`, `organization` |
| `entity_id` | uuid | NO |  |  |
| `triggered_by` | uuid | YES |  |  |
| `metadata` | jsonb | NO | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |

### `telegram_raw_webhooks`

**Rows:** 84 (84)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `payload` | jsonb | NO |  |  |
| `received_at` | timestamp with time zone | YES | now() |  |
| `processed` | boolean | YES | false |  |
| `error` | text | YES |  |  |

### `telegram_message_log`

**Rows:** 71 (71)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `message_id` | bigint | NO |  |  |
| `chat_id` | bigint | NO |  |  |
| `user_id` | bigint | YES |  |  |
| `username` | text | YES |  |  |
| `message_type` | text | YES | 'text' |  |
| `text` | text | YES |  |  |
| `media_file_id` | text | YES |  |  |
| `callback_data` | text | YES |  |  |
| `direction` | text | NO |  | Values: `inbound`, `outbound` |
| `reply_to_message_id` | bigint | YES |  |  |
| `task_id` | uuid | YES |  |  |
| `approval_id` | uuid | YES |  |  |
| `received_at` | timestamp with time zone | NO | now() |  |
| `raw_payload` | jsonb | YES |  |  |

### `admin_notifications`

**Rows:** 58 (58)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `notification_type` | text | NO |  | Values: `ownership_verification_pending`, `vehicle_verification_pending`, `user_verification_pending`, `fraud_alert`, `system_alert`, `bat_scrape_error`, `bat_scrape_complete` |
| `ownership_verification_id` | uuid | YES |  |  |
| `vehicle_verification_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `title` | text | NO |  |  |
| `message` | text | NO |  |  |
| `priority` | integer | YES | 1 |  |
| `action_required` | text | NO |  | Values: `approve_ownership`, `reject_ownership`, `approve_vehicle`, `reject_vehicle`, `review_fraud`, `system_action` |
| `status` | text | NO | 'pending' | Values: `pending`, `in_review`, `approved`, `rejected`, `dismissed` |
| `reviewed_by_admin_id` | uuid | YES |  |  |
| `admin_notes` | text | YES |  |  |
| `admin_decision` | text | YES |  |  |
| `reviewed_at` | timestamp without time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |
| `expires_at` | timestamp without time zone | YES | (now() + '7 days'::interval) |  |

### `sms_message_templates`

**Rows:** 46 (46)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `template_key` | text | NO |  |  |
| `template_text` | text | NO |  |  |
| `variables` | ARRAY | YES | '{}'[] |  |
| `category` | text | YES |  |  |
| `language` | text | YES | 'en' |  |
| `personality` | text | YES | 'friendly' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `remote_commands`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() |  |
| `machine_id` | text | NO | 'portable-1' |  |
| `command` | text | NO |  |  |
| `status` | text | YES | 'pending' |  |
| `output` | text | YES |  |  |
| `error` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `executed_at` | timestamp with time zone | YES |  |  |

## Other Tables

### `timeline_events`

**Rows:** 911,477 (911.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES | auth.uid() |  |
| `event_type` | text | NO |  |  Values: `purchase`, `sale`, `registration`, `inspection`, `maintenance`, `repair` ... (32 total) |
| `source` | text | NO |  |  |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `event_date` | date | NO |  |  |
| `image_urls` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `mileage_at_event` | integer | YES |  |  |
| `cost_amount` | numeric | YES |  |  |
| `cost_currency` | text | YES | 'USD' |  |
| `duration_hours` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `location_address` | text | YES |  |  |
| `location_coordinates` | point | YES |  |  |
| `service_provider_name` | text | YES |  |  |
| `service_provider_type` | text | YES |  |  Values: `dealer`, `independent_shop`, `mobile_mechanic`, `diy`, `specialty_shop`, `tire_shop` ... (9 total) |
| `invoice_number` | text | YES |  |  |
| `warranty_info` | jsonb | YES |  |  |
| `parts_used` | ARRAY | YES |  |  |
| `verification_documents` | ARRAY | YES |  |  |
| `is_insurance_claim` | boolean | YES | false |  |
| `insurance_claim_number` | text | YES |  |  |
| `next_service_due_date` | date | YES |  |  |
| `next_service_due_mileage` | integer | YES |  |  |
| `data_source` | text | YES | 'user_input' |  |
| `confidence_score` | integer | YES | 50 |  |
| `source_type` | text | NO | 'user_input' |  Values: `user_input`, `service_record`, `government_record`, `insurance_record`, `dealer_record`, `manufacturer_recall` ... (9 total) |
| `event_category` | text | YES |  |  Values: `ownership`, `maintenance`, `legal`, `performance`, `cosmetic`, `safety` |
| `activity_type` | text | YES |  |  |
| `automated_tags` | ARRAY | YES | '{}'[] |  |
| `manual_tags` | ARRAY | YES | '{}'[] |  |
| `photo_analysis` | jsonb | YES | '{}' |  |
| `receipt_data` | jsonb | YES | '{}' |  |
| `parts_mentioned` | ARRAY | YES | '{}'[] |  |
| `tools_mentioned` | ARRAY | YES | '{}'[] |  |
| `labor_hours` | numeric | YES |  |  |
| `cost_estimate` | numeric | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `client_id` | uuid | YES |  |  |
| `is_monetized` | boolean | YES | false |  |
| `work_started` | timestamp with time zone | YES |  |  |
| `work_completed` | timestamp with time zone | YES |  |  |
| `contract_id` | uuid | YES |  |  |
| `applied_labor_rate` | numeric | YES |  |  |
| `applied_shop_rate` | numeric | YES |  |  |
| `rate_source` | text | YES |  |  Values: `contract`, `shop_default`, `user_default`, `custom` |
| `contextual_analysis_status` | text | YES | 'pending' | Status of contextual batch analysis: pending, processing, completed, or failed Values: `pending`, `processing`, `completed`, `failed` |
| `documented_by` | uuid | YES |  | User who documented/photographed the work (may differ from performer) |
| `primary_technician` | uuid | YES |  | Primary technician who performed the work |
| `quality_rating` | integer | YES |  | AI or human quality assessment (1-10 scale) |
| `quality_justification` | text | YES |  |  |
| `value_impact` | numeric | YES |  | Estimated value added to vehicle by this work |
| `ai_confidence_score` | numeric | YES |  | AI confidence in analysis (0.0-1.0) |
| `concerns` | ARRAY | YES |  | Array of flagged concerns or issues |
| `industry_standard_comparison` | jsonb | YES |  | Comparison to Mitchell/Chilton standards |
| `search_vector` | tsvector | YES |  | Full-text search vector for event searches |
| `work_order_id` | uuid | YES |  |  |

### `_zero_rel_candidates`

**Rows:** 729,319 (729.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `status` | text | YES |  |  |

### `duplicate_detection_jobs`

**Rows:** 373,532 (373.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `status` | character varying | YES | 'pending' |  |
| `scheduled_at` | timestamp without time zone | YES | now() |  |
| `started_at` | timestamp without time zone | YES |  |  |
| `completed_at` | timestamp without time zone | YES |  |  |
| `priority` | character varying | YES | 'medium' |  |
| `error_message` | text | YES |  |  |
| `results` | jsonb | YES |  |  |
| `retry_count` | integer | YES | 0 |  |
| `max_retries` | integer | YES | 3 |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |

### `_has_events`

**Rows:** 167,128 (167.1K)

*No column data loaded.*

### `_ghost_vehicle_cleanup`

**Rows:** 40,593 (40.6K)

*No column data loaded.*

### `pending_vehicle_assignments`

**Rows:** 20,349 (20.3K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `organization_id` | uuid | NO |  |  |
| `suggested_relationship_type` | text | NO |  |  Values: `owner`, `consigner`, `service_provider`, `work_location`, `seller`, `buyer` ... (14 total) |
| `overall_confidence` | numeric | NO |  | Overall confidence score 0-100, calculated from multiple evidence sources |
| `confidence_breakdown` | jsonb | YES | '{}' | JSON breakdown of confidence by source: {gps: 85, receipt: 70, user_org: 90} |
| `evidence_sources` | ARRAY | YES | '{}'[] | Array of evidence types that contributed to this suggestion |
| `evidence_count` | integer | YES | 0 |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `auto_approved`, `expired` |
| `auto_approve_threshold` | numeric | YES | 80.0 |  |
| `suggested_by_system` | boolean | YES | true |  |
| `suggested_by_user_id` | uuid | YES |  |  |
| `reviewed_by_user_id` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `review_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `expires_at` | timestamp with time zone | YES | (now() + '30 days'::interval) |  |

### `component_conditions`

**Rows:** 16,187 (16.2K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `component_name` | text | NO |  |  |
| `component_type` | text | YES |  |  |
| `condition_rating` | integer | YES |  |  |
| `damage_types` | ARRAY | YES |  |  |
| `is_original` | boolean | YES |  |  |
| `needs_attention` | boolean | YES |  |  |
| `repair_priority` | text | YES |  |  |
| `estimated_cost` | numeric | YES |  |  |
| `detected_by_model` | text | YES |  |  |
| `confidence` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `org_mention_queue`

**Rows:** 5,522 (5.5K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_post_id` | uuid | YES |  |  |
| `source_thread_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `forum_source_id` | uuid | YES |  |  |
| `mention_text` | text | NO |  |  |
| `mention_context` | text | YES |  |  |
| `mention_type` | text | YES | 'unknown' |  Values: `parts_supplier`, `shop`, `paint`, `machine_shop`, `upholstery`, `restoration` ... (12 total) |
| `matched_org_id` | uuid | YES |  |  |
| `match_confidence` | numeric | YES |  |  |
| `match_method` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `matched`, `created`, `ignored`, `review` |
| `extracted_url` | text | YES |  |  |
| `extracted_phone` | text | YES |  |  |
| `extracted_location` | text | YES |  |  |
| `extracted_services` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `reviewed_by` | uuid | YES |  |  |
| `notes` | text | YES |  |  |

### `feed_items_view`

**Rows:** 4,548 (4.5K)

*No column data loaded.*

### `paint_quality_assessments`

**Rows:** 2,121 (2.1K)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `panel_name` | text | YES |  |  |
| `appears_original` | boolean | YES |  |  |
| `repaint_quality` | text | YES |  |  |
| `orange_peel_level` | text | YES |  |  |
| `defects` | ARRAY | YES |  |  |
| `paint_quality_score` | integer | YES |  |  |
| `assessed_by_model` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `profile_activity`

**Rows:** 744 (744)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `activity_type` | text | NO |  |  Values: `vehicle_added`, `profile_updated`, `image_uploaded`, `achievement_earned`, `contribution_made`, `verification_completed`, `timeline_event_added` |
| `activity_title` | text | NO |  |  |
| `activity_description` | text | YES |  |  |
| `related_vehicle_id` | uuid | YES |  |  |
| `related_achievement_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp without time zone | YES | now() |  |

### `betting_markets`

**Rows:** 402 (402)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `market_type` | text | NO |  |  |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `line_value` | numeric | YES |  |  |
| `line_description` | text | YES |  |  |
| `status` | text | YES | 'open' |  |
| `opens_at` | timestamp with time zone | YES | now() |  |
| `locks_at` | timestamp with time zone | NO |  |  |
| `settles_at` | timestamp with time zone | YES |  |  |
| `outcome` | text | YES |  |  |
| `resolution_value` | numeric | YES |  |  |
| `resolution_source` | text | YES |  |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `resolved_by` | uuid | YES |  |  |
| `total_yes_amount` | numeric | YES | 0 |  |
| `total_no_amount` | numeric | YES | 0 |  |
| `total_bettors` | integer | YES | 0 |  |
| `rake_percent` | numeric | YES | 5.0 |  |
| `min_bet` | numeric | YES | 100 |  |
| `max_bet` | numeric | YES | 10000 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `garbage_bid_values`

**Rows:** 329 (329)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `bad_value` | integer | YES |  |  |
| `occurrences` | bigint | YES |  |  |

### `missing_context_reports`

**Rows:** 322 (322)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `missing_items` | jsonb | NO |  |  |
| `current_completeness` | numeric | YES |  |  |
| `potential_completeness` | numeric | YES |  |  |
| `estimated_cost_savings` | numeric | YES |  |  |
| `identified_by_model` | text | YES |  |  |
| `identified_at` | timestamp with time zone | YES | now() |  |
| `items_added` | integer | YES | 0 |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `improvement_achieved` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `collection_intelligence`

**Rows:** 291 (291)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `estimated_capacity` | integer | YES |  |  |
| `current_inventory` | integer | YES |  |  |
| `capacity_utilization` | numeric | YES |  |  |
| `capacity_method` | text | YES |  |  |
| `metro_area` | text | YES |  |  |
| `metro_population` | integer | YES |  |  |
| `metro_gdp_per_capita` | numeric | YES |  |  |
| `zip_median_income` | numeric | YES |  |  |
| `zip_population` | integer | YES |  |  |
| `demand_score` | numeric | YES |  |  |
| `demand_signals` | jsonb | YES | '{}' |  |
| `vehicles_within_25mi` | integer | YES |  |  |
| `vehicles_within_50mi` | integer | YES |  |  |
| `avg_vehicle_value_25mi` | numeric | YES |  |  |
| `competing_collections_25mi` | integer | YES |  |  |
| `competing_dealers_25mi` | integer | YES |  |  |
| `key_users_nearby` | jsonb | YES | '[]' |  |
| `make_distribution` | jsonb | YES | '{}' |  |
| `era_distribution` | jsonb | YES | '{}' |  |
| `value_distribution` | jsonb | YES | '{}' |  |
| `opportunity_summary` | text | YES |  |  |
| `opportunity_score` | numeric | YES |  |  |
| `calculated_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `device_attributions`

**Rows:** 221 (221)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `device_fingerprint` | text | NO |  |  |
| `ghost_user_id` | uuid | YES |  |  |
| `actual_contributor_id` | uuid | YES |  |  |
| `uploaded_by_user_id` | uuid | YES |  |  |
| `attribution_source` | text | YES | 'exif_device' |  |
| `confidence_score` | integer | YES | 100 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `camera_make` | text | YES |  |  |
| `camera_model` | text | YES |  |  |
| `camera_serial` | text | YES |  |  |
| `software` | text | YES |  |  |
| `latitude` | double precision | YES |  |  |
| `longitude` | double precision | YES |  |  |
| `altitude` | double precision | YES |  |  |
| `gps_timestamp` | timestamp with time zone | YES |  |  |
| `datetime_original` | timestamp with time zone | YES |  |  |
| `datetime_digitized` | timestamp with time zone | YES |  |  |
| `extraction_method` | text | YES | 'exif' |  |
| `raw_exif` | jsonb | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ghost_users`

**Rows:** 156 (156)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `device_fingerprint` | text | NO |  |  |
| `camera_make` | text | YES |  |  |
| `camera_model` | text | YES |  |  |
| `lens_model` | text | YES |  |  |
| `software_version` | text | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES | now() |  |
| `last_seen_at` | timestamp with time zone | YES | now() |  |
| `total_contributions` | integer | YES | 0 |  |
| `claimed_by_user_id` | uuid | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `display_name` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `profile_buildable` | boolean | YES | false | True if enough data to build a claimable profile |
| `profile_build_score` | integer | YES | 0 |  |
| `profile_data` | jsonb | YES | '{}' |  |
| `ghost_user_subclass` | text | YES |  | Type of ghost user for better classification Values: `exif_device`, `scraped_profile`, `unknown_photographer`, `automated_import` |

### `build_activity_patterns`

**Rows:** 142 (142)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `total_events` | integer | YES | 0 |  |
| `events_last_7_days` | integer | YES | 0 |  |
| `events_last_30_days` | integer | YES | 0 |  |
| `events_last_90_days` | integer | YES | 0 |  |
| `photos_uploaded` | integer | YES | 0 |  |
| `receipts_uploaded` | integer | YES | 0 |  |
| `parts_documented` | integer | YES | 0 |  |
| `tools_documented` | integer | YES | 0 |  |
| `labor_hours_logged` | numeric | YES | 0 |  |
| `money_spent_documented` | numeric | YES | 0 |  |
| `current_build_stage` | text | YES | 'planning' |  |
| `progress_confidence` | numeric | YES | 0.0 |  |
| `stagnation_risk` | numeric | YES | 0.0 |  |
| `completion_estimate` | numeric | YES | 0.0 |  |
| `activity_classification` | text | YES | 'unknown' |  |
| `last_meaningful_activity` | timestamp with time zone | YES |  |  |
| `average_days_between_activities` | numeric | YES |  |  |
| `activity_trend` | text | YES | 'stable' |  |
| `documentation_quality_score` | integer | YES | 0 |  |
| `photo_quality_score` | integer | YES | 0 |  |
| `data_completeness_score` | integer | YES | 0 |  |
| `detected_issues` | ARRAY | YES | '{}'[] |  |
| `recommended_actions` | ARRAY | YES | '{}'[] |  |
| `build_health_score` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `unverified_contacts`

**Rows:** 129 (129)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `phone_number` | text | NO |  |  |
| `phone_raw` | text | YES |  |  |
| `phone_hash` | text | YES |  |  |
| `location` | text | YES |  |  |
| `verification_status` | text | YES | 'unverified' |  Values: `unverified`, `verified`, `invalid`, `disconnected`, `opted_out` |
| `outreach_status` | text | YES | 'pending' |  Values: `pending`, `contacted`, `responded`, `no_response`, `do_not_contact` |
| `outreach_attempts` | integer | YES | 0 |  |
| `last_outreach_at` | timestamp with time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `timeline_event_conflicts`

**Rows:** 126 (126)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `primary_event_id` | uuid | YES |  |  |
| `conflicting_event_id` | uuid | YES |  |  |
| `conflict_type` | text | NO |  |  Values: `date_mismatch`, `mileage_inconsistency`, `duplicate_event`, `contradictory_info` |
| `conflict_description` | text | NO |  |  |
| `resolution_status` | text | YES | 'unresolved' |  Values: `unresolved`, `resolved`, `accepted_discrepancy`, `merged_events` |
| `resolution_notes` | text | YES |  |  |
| `resolved_by` | uuid | YES |  |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `subject_taxonomy`

**Rows:** 106 (106)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `subject_id` | uuid | NO | gen_random_uuid() |  |
| `subject_key` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `domain` | text | NO |  |  |
| `category` | text | NO |  |  |
| `position_type` | text | NO | 'fixed' |  |
| `side` | text | YES |  |  |
| `vertical_position` | text | YES |  |  |
| `longitudinal_position` | text | YES |  |  |
| `typical_width_mm` | numeric | YES |  |  |
| `typical_height_mm` | numeric | YES |  |  |
| `typical_depth_mm` | numeric | YES |  |  |
| `parent_subject_id` | uuid | YES |  |  |
| `canonical_angles` | jsonb | YES | '[]' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `is_active` | boolean | YES | true |  |

### `motec_pin_maps`

**Rows:** 104 (104)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `device` | text | NO |  |  |
| `connector` | text | NO |  |  |
| `pin_number` | text | NO |  |  |
| `pin_function` | text | NO |  |  |
| `signal_type` | text | YES |  |  |
| `max_current` | numeric | YES |  |  |
| `default_wire_color` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_surface_templates`

**Rows:** 102 (102)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `year_start` | smallint | NO |  |  |
| `year_end` | smallint | NO |  |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `body_style` | text | YES |  |  |
| `length_inches` | smallint | NO |  |  |
| `width_inches` | smallint | NO |  |  |
| `height_inches` | smallint | NO |  |  |
| `wheelbase_inches` | smallint | YES |  |  |
| `zone_bounds` | jsonb | NO | '{}' |  |
| `source` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `harness_endpoints`

**Rows:** 99 (99)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `design_id` | uuid | NO |  |  |
| `section_id` | uuid | YES |  |  |
| `name` | text | NO |  |  |
| `endpoint_type` | text | NO |  |  Values: `power_source`, `power_distribution`, `ecu`, `sensor`, `actuator`, `switch` ... (13 total) |
| `system_category` | text | YES |  |  |
| `amperage_draw` | numeric | YES |  |  |
| `peak_amperage` | numeric | YES |  |  |
| `voltage` | numeric | YES | 12 |  |
| `wattage` | numeric | YES |  |  |
| `is_switched` | boolean | YES | true |  |
| `duty_cycle` | numeric | YES |  |  |
| `connector_type` | text | YES |  |  |
| `pin_count` | integer | YES |  |  |
| `estimated_length_ft` | numeric | YES |  |  |
| `location_zone` | text | YES |  |  |
| `canvas_x` | numeric | NO | 0 |  |
| `canvas_y` | numeric | NO | 0 |  |
| `catalog_part_id` | uuid | YES |  |  |
| `part_number` | text | YES |  |  |
| `is_required` | boolean | YES | true |  |
| `is_ai_suggested` | boolean | YES | false |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ebay_parts_catalog`

**Rows:** 89 (89)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_type` | text | NO |  |  |
| `part_name` | text | NO |  |  |
| `ebay_category_id` | text | YES |  |  |
| `ebay_search_terms` | ARRAY | YES | '{}'[] |  |
| `compatible_years` | int4range | YES |  | PostgreSQL int4range for year compatibility, e.g., [2010,2020) |
| `compatible_makes` | ARRAY | YES | '{}'[] |  |
| `compatible_models` | ARRAY | YES | '{}'[] |  |
| `avg_price_low` | numeric | YES |  |  |
| `avg_price_high` | numeric | YES |  |  |
| `price_currency` | text | YES | 'USD' |  |
| `oem_available` | boolean | YES | false |  |
| `aftermarket_available` | boolean | YES | true |  |
| `discovered_sellers` | ARRAY | YES | '{}'[] |  |
| `top_seller_username` | text | YES |  |  |
| `sample_listings` | jsonb | YES | '[]' |  |
| `discovery_metadata` | jsonb | YES | '{}' |  |
| `last_discovered_at` | timestamp with time zone | YES | now() |  |
| `discovery_count` | integer | YES | 1 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `subject_position_templates`

**Rows:** 79 (79)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `template_id` | uuid | NO | gen_random_uuid() |  |
| `subject_id` | uuid | NO |  |  |
| `vehicle_type` | text | NO | 'default' |  |
| `x_pct` | numeric | NO | 0 |  |
| `y_pct` | numeric | NO | 0 |  |
| `z_pct` | numeric | NO | 0 |  |
| `x_offset_mm` | numeric | YES | 0 |  |
| `y_offset_mm` | numeric | YES | 0 |  |
| `z_offset_mm` | numeric | YES | 0 |  |
| `subject_yaw_deg` | numeric | YES | 0 |  |
| `confidence` | numeric | YES | 0.8 |  |
| `source` | text | YES | 'template' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `assembly_callouts`

**Rows:** 70 (70)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `assembly_id` | uuid | YES |  |  |
| `part_id` | uuid | YES |  |  |
| `callout_number` | integer | NO |  | The number shown on the assembly diagram |
| `quantity` | integer | YES | 1 |  |
| `role` | text | YES |  | primary = main component, hardware = bolts/screws, etc. Values: `primary`, `hardware`, `fastener`, `gasket`, `optional` |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `album_sync_map`

**Rows:** 65 (65)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `apple_album_id` | text | NO |  |  |
| `apple_album_name` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_set_id` | uuid | YES |  |  |
| `last_synced_at` | timestamp with time zone | YES |  |  |
| `photo_count_apple` | integer | YES | 0 |  |
| `photo_count_nuke` | integer | YES | 0 |  |
| `sync_direction` | text | YES | 'bidirectional' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `code_validation_rules`

**Rows:** 63 (63)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `rule_type` | text | NO |  |  Values: `mandatory_pair`, `incompatible`, `vin_engine_map`, `clone_pattern`, `year_gate`, `hp_range`, `displacement_check`, `trim_requirement` |
| `manufacturer` | text | NO |  |  |
| `code_a` | text | NO |  |  |
| `code_b` | text | YES |  |  |
| `year_start` | smallint | YES |  |  |
| `year_end` | smallint | YES |  |  |
| `makes` | ARRAY | YES |  |  |
| `models` | ARRAY | YES |  |  |
| `description` | text | NO |  |  |
| `severity` | text | NO |  |  Values: `info`, `warning`, `error`, `fraud_risk` |
| `action` | text | NO |  |  Values: `flag`, `downgrade_confidence`, `reject`, `investigate` |
| `detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `photo_sync_items`

**Rows:** 62 (62)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `photos_uuid` | text | NO |  |  |
| `photos_filename` | text | YES |  |  |
| `photos_date_added` | timestamp with time zone | YES |  |  |
| `photos_date_taken` | timestamp with time zone | YES |  |  |
| `photos_album_names` | ARRAY | YES |  |  |
| `file_hash_sha256` | text | YES |  |  |
| `perceptual_hash` | text | YES |  |  |
| `difference_hash` | text | YES |  |  |
| `sync_status` | text | YES | 'detected' |  Values: `detected`, `exporting`, `exported`, `uploading`, `uploaded`, `classifying` ... (14 total) |
| `is_automotive` | boolean | YES |  |  |
| `classification_category` | text | YES |  |  |
| `classification_confidence` | real | YES |  |  |
| `vehicle_hints` | jsonb | YES |  |  |
| `matched_vehicle_id` | uuid | YES |  |  |
| `match_confidence` | real | YES |  |  |
| `match_method` | text | YES |  |  |
| `vehicle_image_id` | uuid | YES |  |  |
| `storage_url` | text | YES |  |  |
| `error_message` | text | YES |  |  |
| `retry_count` | integer | YES | 0 |  |
| `last_retry_at` | timestamp with time zone | YES |  |  |
| `detected_at` | timestamp with time zone | YES | now() |  |
| `exported_at` | timestamp with time zone | YES |  |  |
| `uploaded_at` | timestamp with time zone | YES |  |  |
| `classified_at` | timestamp with time zone | YES |  |  |
| `matched_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |

### `work_order_parts`

**Rows:** 57 (57)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `timeline_event_id` | uuid | YES |  | References timeline_events (vehicle timeline) not business_timeline_events |
| `part_name` | text | NO |  |  |
| `part_number` | text | YES |  |  |
| `brand` | text | YES |  |  |
| `category` | text | YES |  |  |
| `quantity` | integer | YES | 1 |  |
| `unit_price` | numeric | YES |  |  |
| `total_price` | numeric | YES |  |  |
| `supplier` | text | YES |  |  |
| `buy_url` | text | YES |  |  |
| `image_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `ai_extracted` | boolean | YES | false |  |
| `user_verified` | boolean | YES | false |  |
| `added_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `priority` | text | YES | 'normal' |  |
| `status` | text | YES | 'quoted' |  |
| `saved_for_later` | boolean | YES | false |  |
| `work_order_id` | uuid | YES |  |  |
| `job_op_code` | text | YES |  |  |
| `is_comped` | boolean | YES | false |  |
| `comp_reason` | text | YES |  |  |
| `comp_retail_value` | numeric | YES |  |  |
| `is_taxable` | boolean | YES | true |  |

### `analysis_signal_history`

**Rows:** 51 (51)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `signal_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `widget_slug` | text | NO |  |  |
| `score` | numeric | YES |  |  |
| `severity` | text | YES |  |  |
| `label` | text | YES |  |  |
| `reasons` | ARRAY | YES |  |  |
| `computed_at` | timestamp with time zone | NO |  |  |
| `model_version` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `labor_operations`

**Rows:** 51 (51)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `code` | text | NO |  |  |
| `name` | text | NO |  |  |
| `base_hours` | numeric | NO |  |  |
| `system` | text | YES |  |  |
| `model_year_min` | integer | YES |  |  |
| `model_year_max` | integer | YES |  |  |
| `notes` | text | YES |  |  |

### `stream_actions`

**Rows:** 48 (48)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `pack_id` | uuid | NO |  |  |
| `slug` | text | NO |  |  |
| `title` | text | NO |  |  |
| `kind` | text | NO | 'text_popup' |  Values: `text_popup`, `image_popup`, `sound_only`, `combo` |
| `render_text` | text | YES |  |  |
| `image_url` | text | YES |  |  |
| `sound_key` | text | YES |  |  |
| `duration_ms` | integer | NO | 1800 |  |
| `cooldown_ms` | integer | NO | 2500 |  |
| `is_active` | boolean | NO | true |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `use_count` | bigint | NO | 0 |  |
| `source_url` | text | YES |  |  |
| `attribution` | text | YES |  |  |
| `license` | text | YES |  |  |
| `tags` | ARRAY | NO | '{}'[] |  |
| `metadata` | jsonb | NO | '{}' |  |
| `use_price_cents` | bigint | NO | 1 |  |

### `pipeline_cross_posts`

**Rows:** 47 (47)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `match_method` | text | NO |  |  Values: `vehicle_fingerprint`, `vin`, `phone`, `email` |
| `vehicle_fingerprint` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `seller_id` | uuid | YES |  |  |
| `primary_pipeline_id` | uuid | YES |  |  |
| `pipeline_ids` | ARRAY | NO |  |  |
| `regions_seen` | ARRAY | NO |  |  |
| `url_variants` | ARRAY | YES | '{}'[] |  |
| `price_variants` | ARRAY | YES | '{}'[] |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tag_vocabulary`

**Rows:** 47 (47)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `tag_name` | text | NO |  |  |
| `tag_type` | USER-DEFINED | NO |  |  |
| `category` | text | YES |  |  |
| `usage_count` | integer | YES | 0 |  |
| `created_by` | uuid | YES |  |  |
| `aliases` | ARRAY | YES | '{}'[] |  |
| `related_tags` | ARRAY | YES | '{}'[] |  |
| `approved` | boolean | YES | false |  |
| `approved_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `electrical_system_catalog`

**Rows:** 46 (46)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `system_name` | text | NO |  |  |
| `system_category` | text | NO |  |  |
| `is_required` | boolean | YES | true |  |
| `is_required_for` | ARRAY | YES | '{}'[] |  |
| `typical_amperage` | numeric | YES |  |  |
| `typical_peak_amperage` | numeric | YES |  |  |
| `typical_wire_gauge` | text | YES |  |  |
| `typical_connector` | text | YES |  |  |
| `default_wire_color` | text | YES |  |  |
| `default_endpoint_type` | text | YES | 'actuator' |  |
| `default_location_zone` | text | YES |  |  |
| `description` | text | YES |  |  |
| `applies_to_vehicle_types` | ARRAY | YES | '{car,truck,hot_rod}'[] |  |
| `sort_order` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `brands`

**Rows:** 43 (43)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `slug` | text | NO |  |  |
| `industry` | text | NO |  |  |
| `category` | text | YES |  |  |
| `description` | text | YES |  |  |
| `logo_url` | text | YES |  |  |
| `website_url` | text | YES |  |  |
| `verification_status` | text | YES | 'pending' |  Values: `pending`, `verified`, `disputed` |
| `verification_contact` | text | YES |  |  |
| `verification_documents` | ARRAY | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `claimed_by` | uuid | YES |  |  |
| `claim_notes` | text | YES |  |  |
| `total_tags` | integer | YES | 0 |  |
| `total_verified_tags` | integer | YES | 0 |  |
| `first_tagged_at` | timestamp with time zone | YES |  |  |
| `last_tagged_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `analysis_signals`

**Rows:** 42 (42)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `widget_slug` | text | NO |  |  |
| `score` | numeric | YES |  |  |
| `label` | text | YES |  |  |
| `severity` | text | YES |  |  Values: `info`, `ok`, `warning`, `critical` |
| `value_json` | jsonb | NO | '{}' |  |
| `reasons` | ARRAY | YES | '{}'[] |  |
| `evidence` | jsonb | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `recommendations` | jsonb | YES | '[]' |  |
| `input_hash` | text | YES |  |  |
| `input_summary` | jsonb | YES |  |  |
| `previous_score` | numeric | YES |  |  |
| `previous_severity` | text | YES |  |  |
| `changed_at` | timestamp with time zone | YES |  |  |
| `change_direction` | text | YES |  |  Values: `improved`, `degraded`, `unchanged`, `new` |
| `computed_at` | timestamp with time zone | NO | now() |  |
| `stale_at` | timestamp with time zone | YES |  |  |
| `compute_time_ms` | integer | YES |  |  |
| `model_version` | text | YES | 'v1' |  |
| `acknowledged_by` | uuid | YES |  |  |
| `acknowledged_at` | timestamp with time zone | YES |  |  |
| `dismissed_until` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `account_link_claims`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `platform` | text | NO |  |  |
| `handle` | text | NO |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `pending_review`, `verified`, `rejected`, `expired` |
| `verification_method` | text | YES |  |  |
| `proof_url` | text | YES |  |  |
| `proof_data` | jsonb | YES |  |  |
| `claim_confidence` | integer | YES |  |  |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `acquisition_pipeline_active`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `discovery_source` | text | YES |  |  |
| `discovery_url` | text | YES |  |  |
| `discovery_date` | timestamp with time zone | YES |  |  |
| `discovered_by` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `location_city` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `seller_contact` | text | YES |  |  |
| `stage` | USER-DEFINED | YES |  |  |
| `priority` | USER-DEFINED | YES |  |  |
| `stage_updated_at` | timestamp with time zone | YES |  |  |
| `deal_score` | integer | YES |  |  |
| `market_proof_data` | jsonb | YES |  |  |
| `comp_count` | integer | YES |  |  |
| `comp_median` | numeric | YES |  |  |
| `comp_avg` | numeric | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `estimated_profit` | numeric | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `offer_amount` | numeric | YES |  |  |
| `offer_date` | timestamp with time zone | YES |  |  |
| `purchase_price` | numeric | YES |  |  |
| `purchase_date` | timestamp with time zone | YES |  |  |
| `title_status` | text | YES |  |  |
| `partner_shop_id` | uuid | YES |  |  |
| `shop_arrival_date` | timestamp with time zone | YES |  |  |
| `inspection_report` | jsonb | YES |  |  |
| `repair_estimate` | numeric | YES |  |  |
| `authentication_result` | jsonb | YES |  |  |
| `numbers_matching_verified` | boolean | YES |  |  |
| `reconditioning_cost` | numeric | YES |  |  |
| `reconditioning_items` | jsonb | YES |  |  |
| `listing_platform` | text | YES |  |  |
| `listing_url_resale` | text | YES |  |  |
| `listing_date` | timestamp with time zone | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `sale_date` | timestamp with time zone | YES |  |  |
| `buyer_info` | jsonb | YES |  |  |
| `total_investment` | numeric | YES |  |  |
| `gross_profit` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `vehicle_title` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `original_listing_url` | text | YES |  |  |

### `acquisition_pipeline_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `stage` | USER-DEFINED | YES |  |  |
| `priority` | USER-DEFINED | YES |  |  |
| `count` | bigint | YES |  |  |
| `avg_deal_score` | numeric | YES |  |  |
| `avg_asking` | numeric | YES |  |  |
| `avg_estimated_value` | numeric | YES |  |  |
| `avg_estimated_profit` | numeric | YES |  |  |
| `total_realized_profit` | numeric | YES |  |  |

### `actor_capabilities`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `actor_id` | uuid | NO |  |  |
| `capability_type` | text | NO |  | The specific capability proven. Values: `engine_machining`, `engine_assembly`, `engine_tuning`, `engine_diagnostics`, `transmission_rebuild`, `differential_rebuild` ... (64 total) |
| `complexity_tier` | text | NO | 'basic' | Demonstrated complexity: basic, intermediate, advanced, expert, master. Values: `basic`, `intermediate`, `advanced`, `expert`, `master` |
| `evidence_count` | integer | NO | 0 | Number of component_events documenting this capability at this tier. |
| `first_demonstrated` | date | YES |  |  |
| `last_demonstrated` | date | YES |  |  |
| `best_outcome_vehicle_id` | uuid | YES |  |  |
| `best_outcome_description` | text | YES |  |  |
| `avg_spec_compliance` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `actor_profiles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `actor_id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `actor_type` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `specialties` | ARRAY | YES |  |  |
| `specialty_makes` | ARRAY | YES |  |  |
| `trust_score` | integer | YES |  |  |
| `total_documented_jobs` | integer | YES |  |  |
| `years_experience` | integer | YES |  |  |
| `current_org_id` | uuid | YES |  |  |
| `current_org_name` | text | YES |  |  |
| `current_role` | text | YES |  |  |
| `top_capabilities` | jsonb | YES |  |  |

### `actor_tools`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `actor_id` | uuid | YES |  |  |
| `org_id` | uuid | YES |  |  |
| `tool_name` | text | NO |  |  |
| `tool_category` | text | NO |  |  Values: `machining`, `measuring`, `welding`, `painting`, `lifting`, `diagnostics` ... (28 total) |
| `manufacturer` | text | YES |  |  |
| `model` | text | YES |  |  |
| `serial_number` | text | YES |  |  |
| `precision_rating` | text | YES |  |  |
| `max_capacity` | text | YES |  |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `is_owned` | boolean | YES | true |  |
| `acquisition_year` | integer | YES |  |  |
| `last_calibrated` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `actors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `actor_type` | text | NO |  | Category: individual, shop, dealer, factory, inspector, auction_house, parts_supplier, machine_shop, owner. Values: `individual`, `shop`, `dealer`, `factory`, `inspector`, `auction_house` ... (24 total) |
| `name` | text | NO |  | Display name of the actor (person or business). |
| `organization_name` | text | YES |  | Legal or trade name of the organization, if different from name. |
| `parent_actor_id` | uuid | YES |  | Self-referencing FK for employee-of or franchise-of relationships. |
| `location` | text | YES |  | Freeform location string (address or description). |
| `city` | text | YES |  | City for structured location queries. |
| `state` | text | YES |  | State/province for structured location queries. |
| `country` | text | YES | 'US' | ISO country code, defaults to US. |
| `specialties` | ARRAY | YES |  | Array of specialization tags, e.g. {small_block_chevy, concours_restoration}. |
| `certifications` | ARRAY | YES |  | Array of certifications, e.g. {ase_master, ncrs_judge}. |
| `trust_score` | integer | YES |  | Platform trust rating 0-100. NULL means unrated. |
| `website` | text | YES |  | Actor website URL. |
| `phone` | text | YES |  | Contact phone number. |
| `email` | text | YES |  | Contact email address. |
| `notes` | text | YES |  | Freeform notes about this actor. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |
| `bio` | text | YES |  | Short biography or description of the actor. |
| `profile_image_url` | text | YES |  | URL to a profile photo or logo in the vehicle-photos bucket. |
| `licenses` | ARRAY | YES |  | Array of professional licenses. NOT self-reported — verified from evidence. |
| `training` | ARRAY | YES |  | Array of training programs completed. Verified from evidence. |
| `years_experience` | integer | YES |  | Total years of experience. Computed from first_demonstrated in actor_capabilities when possible. |
| `specialty_makes` | ARRAY | YES |  | Array of vehicle makes this actor specializes in. Derived from component_events distribution. |
| `specialty_eras` | ARRAY | YES |  | Array of era tags: pre_war, brass_era, classic, post_war, muscle_era, malaise_era, etc. |
| `current_workload` | integer | YES | 0 | Number of active projects this actor is currently working on. |
| `max_concurrent_projects` | integer | YES |  | Maximum projects this actor can handle simultaneously. |
| `typical_turnaround_days` | integer | YES |  | Typical project duration in days. Computed from work_order completion times. |
| `total_documented_jobs` | integer | YES | 0 | COMPUTED: Count of component_events where this actor is referenced. Never written directly. |
| `total_components_touched` | integer | YES | 0 | COMPUTED: Count of distinct component_id values in component_events for this actor. Never written directly. |

### `admin_pending_vehicles_analysis`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `color` | text | YES |  |  |
| `description` | text | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `current_value` | numeric | YES |  |  |
| `discovery_url` | text | YES |  |  |
| `origin_metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `image_count` | bigint | YES |  |  |
| `primary_need` | text | YES |  |  |
| `missing_fields` | ARRAY | YES |  |  |

### `admin_users`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `admin_level` | text | NO | 'admin' |  Values: `admin`, `super_admin`, `moderator` |
| `permissions` | ARRAY | YES | ARRAY['approve_ownership', 'approve_vehicle', '... |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |

### `agent_audit_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `agent_id` | text | NO |  |  |
| `action` | text | NO |  |  |
| `detail` | jsonb | YES | '{}' |  |
| `endpoint` | text | YES |  |  |
| `ip_address` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `agent_configs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `agent_name` | text | NO |  |  |
| `agent_type` | text | NO |  |  |
| `is_active` | boolean | YES | true |  |
| `schedule_cron` | text | NO |  |  |
| `config_json` | jsonb | YES | '{}' |  |
| `last_run_at` | timestamp with time zone | YES |  |  |
| `next_run_at` | timestamp with time zone | YES |  |  |
| `success_count` | integer | YES | 0 |  |
| `failure_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `agent_quality_metrics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `agent_id` | text | NO |  |  |
| `total_submitted` | integer | NO | 0 |  |
| `total_accepted` | integer | NO | 0 |  |
| `total_rejected` | integer | NO | 0 |  |
| `total_duplicates` | integer | NO | 0 |  |
| `total_errors` | integer | NO | 0 |  |
| `rolling_window` | jsonb | NO | '[]' |  |
| `recent_error_rate` | numeric | NO | 0 |  |
| `circuit_breaker_state` | text | NO | 'closed' |  Values: `closed`, `open`, `half_open` |
| `circuit_breaker_opened_at` | timestamp with time zone | YES |  |  |
| `circuit_breaker_trips` | integer | NO | 0 |  |
| `submissions_by_kind` | jsonb | NO | '{}' |  |
| `first_submission_at` | timestamp with time zone | YES |  |  |
| `last_submission_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `agent_registrations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `platform` | text | YES |  |  |
| `model_identifier` | text | YES |  |  |
| `version` | text | YES |  |  |
| `capabilities` | ARRAY | NO | '{}'[] |  |
| `makes_covered` | ARRAY | YES |  |  |
| `regions_covered` | ARRAY | YES |  |  |
| `contact_url` | text | YES |  |  |
| `webhook_url` | text | YES |  |  |
| `trust_tier` | integer | NO | 1 |  |
| `status` | text | NO | 'active' |  Values: `active`, `suspended`, `disabled`, `pending_review` |
| `observation_source_id` | uuid | YES |  |  |
| `api_key_id` | uuid | YES |  |  |
| `registered_from_ip` | text | YES |  |  |
| `registered_at` | timestamp with time zone | NO | now() |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `agent_submissions_staging`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_hints` | jsonb | YES | '{}' |  |
| `source_id` | uuid | YES |  |  |
| `kind` | text | NO |  |  |
| `observed_at` | timestamp with time zone | NO | now() |  |
| `content_text` | text | YES |  |  |
| `content_hash` | text | YES |  |  |
| `structured_data` | jsonb | NO | '{}' |  |
| `confidence_score` | numeric | YES |  |  |
| `extraction_metadata` | jsonb | YES |  |  |
| `source_url` | text | YES |  |  |
| `source_identifier` | text | YES |  |  |
| `agent_id` | text | NO |  |  |
| `review_status` | text | NO | 'pending' |  Values: `pending`, `accepted`, `rejected`, `expired` |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `reviewed_by` | text | YES |  |  |
| `review_reason` | text | YES |  |  |
| `promoted_observation_id` | uuid | YES |  |  |
| `submitted_at` | timestamp with time zone | NO | now() |  |
| `expires_at` | timestamp with time zone | NO | (now() + '30 days'::interval) |  |

### `ai_component_categories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `category_name` | character varying | NO |  |  |
| `display_name` | character varying | NO |  |  |
| `description` | text | YES |  |  |
| `icon_name` | character varying | YES |  |  |
| `color_hex` | character varying | YES |  |  |
| `sort_order` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ai_extraction_passes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `snapshot_id` | uuid | YES |  |  |
| `platform` | text | NO |  |  |
| `extraction_method` | text | NO |  |  |
| `extractor_version` | text | NO |  |  |
| `fields_extracted` | integer | YES | 0 |  |
| `fields_confirmed` | integer | YES | 0 |  |
| `fields_conflicted` | integer | YES | 0 |  |
| `cost_cents` | numeric | YES | 0 |  |
| `duration_ms` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ai_part_recognition_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_category` | text | NO |  |  |
| `primary_identifiers` | ARRAY | YES |  |  |
| `secondary_features` | ARRAY | YES |  |  |
| `dimensional_context` | text | YES |  |  |
| `typical_materials` | ARRAY | YES |  |  |
| `condition_checkpoints` | jsonb | YES |  |  |
| `wear_assessment_prompt` | text | YES |  |  |
| `often_confused_with` | ARRAY | YES |  |  |
| `distinguishing_features` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ai_processing_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `file_name` | text | YES |  |  |
| `ai_processing_status` | text | YES |  |  |
| `ai_processing_started_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `minutes_waiting` | numeric | YES |  |  |

### `ai_scan_progress`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `scan_type` | text | NO |  |  Values: `vehicle_images`, `organization_images`, `full_scan` |
| `status` | text | NO | 'queued' |  Values: `queued`, `running`, `paused`, `completed`, `failed` |
| `total_images` | integer | YES | 0 |  |
| `processed_images` | integer | YES | 0 |  |
| `failed_images` | integer | YES | 0 |  |
| `current_vehicle_id` | uuid | YES |  |  |
| `current_org_id` | uuid | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `error_message` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ai_work_assessments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `work_type` | text | YES |  |  |
| `complexity_level` | text | YES |  |  Values: `simple`, `moderate`, `complex`, `expert` |
| `estimated_hours` | numeric | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `ai_reasoning` | text | YES |  |  |
| `products_count` | integer | YES | 0 |  |
| `tools_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `alert_email_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `from_address` | text | YES |  |  |
| `subject` | text | YES |  |  |
| `source_slug` | text | YES |  |  |
| `urls_found` | integer | YES | 0 |  |
| `urls_queued` | integer | YES | 0 |  |
| `urls_deduped` | integer | YES | 0 |  |
| `urls` | jsonb | YES |  |  |
| `message_id` | text | YES |  |  |
| `status` | text | YES | 'received' |  |
| `raw_snippet` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `alternators_generators`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `type` | text | NO |  | Unit type: alternator (AC with rectifier) or generator (DC, pre-1960s). Values: `alternator`, `generator` |
| `manufacturer` | text | YES |  | Manufacturer, e.g. Delco-Remy, Bosch, Powermaster, Tuff-Stuff. |
| `part_number` | text | YES |  | Manufacturer or OEM part number. |
| `casting_number` | text | YES |  | Casting number on body (for originality verification). |
| `date_code` | text | YES |  | Date code stamped on unit. |
| `output_amps` | integer | YES |  | Rated output in amperes at full charge. |
| `voltage_output` | numeric | YES |  | Regulated output voltage, typically 13.8-14.4V. |
| `pulley_type` | text | YES |  | Pulley type, e.g. single_v, double_v, serpentine, overdrive. |
| `pulley_diameter_inches` | numeric | YES |  | Drive pulley diameter in inches. |
| `rotation` | text | YES |  | Rotation direction when viewed from pulley end: clockwise or counterclockwise. |
| `internal_regulator_yn` | boolean | YES |  | True if voltage regulator is integrated inside the unit. |
| `one_wire_yn` | boolean | YES |  | True if converted to one-wire/self-exciting configuration. |
| `regulator_part_number` | text | YES |  | External regulator part number, if applicable. |
| `is_original` | boolean | YES | true | True if factory-installed charging unit. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. brushes worn, diode plate failed. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `amenity_definitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `category` | text | NO |  |  |
| `icon` | text | YES |  |  |
| `applicable_to` | ARRAY | YES | ARRAY['villa', 'garage', 'workspace', 'storage'... |  |
| `is_quantifiable` | boolean | YES | false |  |
| `unit` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `aml_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `rule_code` | text | NO |  |  |
| `rule_name` | text | NO |  |  |
| `rule_description` | text | YES |  |  |
| `rule_type` | text | YES |  |  Values: `threshold`, `pattern`, `velocity`, `jurisdiction`, `watchlist`, `custom` |
| `conditions` | jsonb | NO |  |  |
| `threshold_amount` | numeric | YES |  |  |
| `threshold_count` | integer | YES |  |  |
| `time_window_hours` | integer | YES |  |  |
| `risk_level_increase` | text | YES |  |  |
| `auto_block` | boolean | YES | false |  |
| `require_review` | boolean | YES | false |  |
| `require_sar` | boolean | YES | false |  |
| `is_active` | boolean | YES | true |  |
| `effective_date` | date | YES | CURRENT_DATE |  |
| `end_date` | date | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `analysis_widgets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `category` | text | NO |  |  Values: `deal_health`, `pricing`, `market`, `presentation`, `exposure`, `timing` |
| `trigger_on_observation_kinds` | ARRAY | YES |  |  |
| `trigger_on_table_changes` | ARRAY | YES |  |  |
| `trigger_on_cron` | boolean | NO | true |  |
| `edge_function_name` | text | YES |  |  |
| `compute_sql` | text | YES |  |  |
| `compute_mode` | text | NO | 'edge_function' |  Values: `edge_function`, `inline_sql`, `hybrid` |
| `output_type` | text | NO | 'score' |  Values: `score`, `boolean`, `label`, `range`, `composite` |
| `severity_thresholds` | jsonb | YES |  |  |
| `default_priority` | integer | NO | 50 |  |
| `stale_after_hours` | integer | NO | 24 |  |
| `is_enabled` | boolean | NO | true |  |
| `is_beta` | boolean | NO | false |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `analytics_audit_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `audit_type` | text | NO |  |  |
| `passed_count` | integer | YES | 0 |  |
| `failed_count` | integer | YES | 0 |  |
| `critical_issues` | jsonb | YES | '[]' |  |
| `warnings` | jsonb | YES | '[]' |  |
| `recommendations` | jsonb | YES | '[]' |  |
| `raw_results` | jsonb | YES | '{}' |  |

### `angle_spectrum_zones`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `zone_id` | uuid | NO | gen_random_uuid() |  |
| `zone_name` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `x_min` | numeric | YES |  |  |
| `x_max` | numeric | YES |  |  |
| `y_min` | numeric | YES |  |  |
| `y_max` | numeric | YES |  |  |
| `z_min` | numeric | YES |  |  |
| `z_max` | numeric | YES |  |  |
| `domain` | text | NO |  |  |
| `side_applicability` | text | YES |  |  |
| `typical_use_case` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `angle_taxonomy_versions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `taxonomy_version` | text | NO |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `notes` | text | YES |  |  |

### `api_keys`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `name` | text | NO |  |  |
| `key_hash` | text | NO |  | SHA-256 hash of the API key (key itself is never stored) |
| `key_prefix` | text | NO |  | First 8 characters of key for identification in UI |
| `scopes` | ARRAY | YES | ARRAY['read', 'write'] | Array of permitted scopes: read, write, admin |
| `is_active` | boolean | YES | true |  |
| `rate_limit_per_hour` | integer | YES | 1000 |  |
| `rate_limit_remaining` | integer | YES | 1000 |  |
| `rate_limit_reset_at` | timestamp with time zone | YES |  |  |
| `last_used_at` | timestamp with time zone | YES |  |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `agent_registration_id` | text | YES |  |  |

### `app_config`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `key` | text | NO |  |  |
| `value` | text | NO |  |  |

### `archive_imports`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `import_name` | text | NO |  |  |
| `import_source` | text | YES | 'craigslist_archive' |  |
| `historian_user_id` | uuid | YES |  |  |
| `source_directory` | text | YES |  |  |
| `file_count` | integer | YES | 0 |  |
| `files_processed` | integer | YES | 0 |  |
| `files_failed` | integer | YES | 0 |  |
| `vehicles_created` | integer | YES | 0 |  |
| `vehicles_updated` | integer | YES | 0 |  |
| `contacts_created` | integer | YES | 0 |  |
| `timeline_events_created` | integer | YES | 0 |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `in_progress`, `completed`, `failed`, `cancelled` |
| `error_log` | jsonb | YES | '[]' |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ars_tier_transitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `previous_tier` | text | NO |  |  |
| `new_tier` | text | NO |  |  |
| `previous_score` | smallint | NO |  |  |
| `new_score` | smallint | NO |  |  |
| `trigger_event` | text | YES |  |  |
| `dimension_deltas` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `auction_event_links`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `from_auction_event_id` | uuid | NO |  |  |
| `to_auction_event_id` | uuid | NO |  |  |
| `link_type` | text | NO |  |  |
| `evidence` | jsonb | NO | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `auction_extraction_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `listing_source` | text | YES |  |  |
| `total_images` | bigint | YES |  |  |
| `receipts_found` | bigint | YES |  |  |
| `documents_found` | bigint | YES |  |  |
| `titles_found` | bigint | YES |  |  |
| `extractions_completed` | bigint | YES |  |  |
| `total_cost` | numeric | YES |  |  |
| `avg_cost_per_processed` | numeric | YES |  |  |
| `unique_listings` | bigint | YES |  |  |
| `avg_confidence` | numeric | YES |  |  |

### `auction_image_backfill_status`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `batch_id` | text | NO |  |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `total_listings` | integer | YES | 0 |  |
| `processed_listings` | integer | YES | 0 |  |
| `total_images` | integer | YES | 0 |  |
| `processed_images` | integer | YES | 0 |  |
| `documents_found` | integer | YES | 0 |  |
| `receipts_extracted` | integer | YES | 0 |  |
| `total_cost_usd` | numeric | YES | 0 |  |
| `status` | text | YES | 'running' |  Values: `running`, `paused`, `completed`, `failed` |
| `error_message` | text | YES |  |  |
| `filter_criteria` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `auction_pricing_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle` | text | YES |  |  |
| `auction_outcome` | text | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `high_bid` | integer | YES |  |  |
| `bat_auction_url` | text | YES |  |  |
| `price_display` | jsonb | YES |  |  |
| `data_quality_check` | text | YES |  |  |

### `auction_venues`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `venue_type` | text | NO |  |  |
| `buyer_premium_pct` | numeric | YES |  |  |
| `buyer_premium_min` | numeric | YES |  |  |
| `buyer_premium_cap` | numeric | YES |  |  |
| `seller_commission_pct` | numeric | YES |  |  |
| `seller_listing_fee` | numeric | YES |  |  |
| `avg_hammer_price` | numeric | YES |  |  |
| `total_sales_volume` | numeric | YES |  |  |
| `avg_sell_through_rate` | numeric | YES |  |  |
| `avg_days_on_market` | numeric | YES |  |  |
| `specializations` | ARRAY | YES |  |  |
| `geographic_reach` | text | YES |  |  |
| `website_url` | text | YES |  |  |
| `fee_schedule_url` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `audio_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `head_unit_type` | text | YES |  | Head unit media type: am, am_fm, cassette, cd, digital. |
| `head_unit_manufacturer` | text | YES |  | Head unit manufacturer, e.g. Delco, Pioneer, Kenwood, Alpine. |
| `head_unit_model` | text | YES |  | Head unit model name or number. |
| `head_unit_part_number` | text | YES |  | OEM or manufacturer part number. |
| `din_size` | text | YES |  | DIN form factor: single_din, double_din, one_half_din, custom. |
| `bluetooth_yn` | boolean | YES |  | True if Bluetooth audio streaming is supported. |
| `usb_yn` | boolean | YES |  | True if USB media playback is supported. |
| `aux_yn` | boolean | YES |  | True if 3.5mm aux input is present. |
| `satellite_yn` | boolean | YES |  | True if satellite radio (e.g. SiriusXM) is equipped. |
| `navigation_yn` | boolean | YES |  | True if built-in navigation is present. |
| `apple_carplay_yn` | boolean | YES |  | True if Apple CarPlay is supported. |
| `android_auto_yn` | boolean | YES |  | True if Android Auto is supported. |
| `amplifier_yn` | boolean | YES |  | True if a separate power amplifier is installed. |
| `amplifier_manufacturer` | text | YES |  | Amplifier manufacturer, e.g. Rockford Fosgate, JL Audio, Alpine. |
| `amplifier_model` | text | YES |  | Amplifier model name or number. |
| `amplifier_watts` | integer | YES |  | Total amplifier output in watts RMS. |
| `amplifier_channel_count` | integer | YES |  | Number of amplifier channels. |
| `speaker_count` | integer | YES |  | Total number of speakers (excluding subwoofers). |
| `speaker_locations_jsonb` | jsonb | YES | '[]' | JSON array of speaker location objects, e.g. [{"location":"front_door","size_inches":6.5,"brand":"Kicker"}]. |
| `subwoofer_yn` | boolean | YES |  | True if a subwoofer is installed. |
| `subwoofer_size_inches` | numeric | YES |  | Subwoofer cone diameter in inches. |
| `antenna_type` | text | YES |  | Antenna type: fixed_mast, power_mast, in_glass, shark_fin, none. |
| `is_original` | boolean | YES | true | True if factory-installed audio system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `axle_bearings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `axle_position` | text | NO |  | Which axle: front or rear. Values: `front`, `rear` |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `bearing_type` | text | YES |  | Bearing type: ball, tapered_roller, sealed_unit, needle, cylindrical_roller, other. |
| `bearing_part_number` | text | YES |  | Bearing part number, e.g. Timken A-6. |
| `bearing_manufacturer` | text | YES |  | Bearing manufacturer, e.g. Timken, Koyo, National. |
| `preload_spec` | text | YES |  | Bearing preload specification value. |
| `preload_method` | text | YES |  | How preload is set, e.g. crush_sleeve, shim, torque_spec. |
| `seal_type` | text | YES |  | Axle seal type, e.g. lip_seal, o_ring, unitized. |
| `seal_part_number` | text | YES |  | Seal part number. |
| `seal_manufacturer` | text | YES |  | Seal manufacturer. |
| `retainer_type` | text | YES |  | Bearing retainer type, e.g. c_clip, retainer_plate, press_fit. |
| `retainer_bolt_count` | integer | YES |  | Number of retainer plate bolts. |
| `abs_tone_ring` | boolean | YES | false | True if ABS tone ring is on the axle shaft or integrated into bearing. |
| `measured_play_mm` | numeric | YES |  | Last measured bearing end-play in mm. |
| `is_original` | boolean | YES | true | True if factory-installed bearing. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. slight growl at speed. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `backfill_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `status` | text | YES |  |  |
| `reason` | text | YES |  |  |
| `count` | bigint | YES |  |  |
| `avg_quality_score` | numeric | YES |  |  |
| `oldest_created` | timestamp with time zone | YES |  |  |
| `newest_created` | timestamp with time zone | YES |  |  |

### `badges`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `icon` | text | YES |  |  |
| `category` | text | YES |  |  |
| `requirements` | jsonb | NO |  |  |
| `points_value` | integer | YES | 0 |  |
| `rarity` | text | YES | 'common' |  Values: `common`, `uncommon`, `rare`, `epic`, `legendary` |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `bat_buyer_monitors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | YES |  |  |
| `buyer_username` | text | NO |  |  |
| `buyer_url` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `check_frequency_hours` | integer | YES | 12 |  |
| `last_checked_at` | timestamp with time zone | YES |  |  |
| `last_win_found_at` | timestamp with time zone | YES |  |  |
| `total_wins_found` | integer | YES | 0 |  |
| `wins_processed` | integer | YES | 0 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bat_identity_stats_v1`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `external_identity_id` | uuid | YES |  |  |
| `bat_username` | text | YES |  |  |
| `profile_url` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `claimed_by_user_id` | uuid | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `claim_confidence` | integer | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `comments_count` | integer | YES |  |  |
| `bids_count` | integer | YES |  |  |
| `total_bid_amount_usd` | numeric | YES |  |  |
| `avg_bid_amount_usd` | numeric | YES |  |  |
| `avg_sentiment_score` | numeric | YES |  |  |
| `avg_toxicity_score` | numeric | YES |  |  |
| `last_comment_at` | timestamp with time zone | YES |  |  |
| `listings_as_seller` | integer | YES |  |  |
| `last_seller_seen_at` | timestamp with time zone | YES |  |  |
| `purchases_count` | integer | YES |  |  |
| `total_spend_usd` | numeric | YES |  |  |
| `avg_purchase_usd` | numeric | YES |  |  |
| `last_purchase_at` | timestamp with time zone | YES |  |  |
| `last_activity_at` | timestamp with time zone | YES |  |  |
| `top_purchase_locations` | jsonb | YES |  |  |
| `vibe_score` | numeric | YES |  |  |

### `bat_scrape_jobs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `job_type` | text | NO | 'full_scrape' |  Values: `full_scrape`, `incremental`, `comments_only` |
| `status` | text | NO | 'pending' |  Values: `pending`, `running`, `completed`, `failed`, `cancelled` |
| `listings_found` | integer | YES | 0 |  |
| `listings_scraped` | integer | YES | 0 |  |
| `comments_extracted` | integer | YES | 0 |  |
| `users_created` | integer | YES | 0 |  |
| `vehicles_matched` | integer | YES | 0 |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `duration_seconds` | integer | YES |  |  |
| `error_message` | text | YES |  |  |
| `error_stack` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bat_seller_monitors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `seller_username` | text | NO |  |  |
| `seller_url` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `check_frequency_hours` | integer | YES | 6 |  |
| `last_checked_at` | timestamp with time zone | YES |  |  |
| `last_listing_found_at` | timestamp with time zone | YES |  |  |
| `total_listings_found` | integer | YES | 0 |  |
| `listings_processed` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `batteries`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `location` | text | YES |  | Physical location of battery, e.g. engine_bay, trunk, under_rear_seat, bed. |
| `type` | text | YES |  | Battery chemistry: lead_acid, agm, gel, lithium, optima. |
| `group_size` | text | YES |  | BCI group size designation, e.g. 24F, 34/78, 65, H6. |
| `manufacturer` | text | YES |  | Battery manufacturer, e.g. Delco, Interstate, Optima, Odyssey. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `cca` | integer | YES |  | Cold cranking amps rating at 0 degrees F. |
| `voltage` | numeric | YES |  | Nominal battery voltage: 6.0, 12.0, 16.0, 24.0, or 48.0. |
| `reserve_capacity_minutes` | integer | YES |  | Reserve capacity in minutes at 25A draw. |
| `amp_hour_rating` | numeric | YES |  | Amp-hour (Ah) capacity rating. |
| `age_years` | numeric | YES |  | Approximate age in years at time of record. |
| `date_code` | text | YES |  | Factory date code stamped on battery (format varies by manufacturer). |
| `terminal_type` | text | YES |  | Terminal post type, e.g. top_post, side_post, dual_post, j_strap. |
| `hold_down_type` | text | YES |  | Hold-down hardware type, e.g. top_bar, j_bolt, bracket. |
| `cable_gauge` | text | YES |  | Battery cable wire gauge, e.g. 2AWG, 1/0AWG. |
| `ground_strap_count` | integer | YES |  | Number of chassis ground straps installed. |
| `is_original` | boolean | YES | true | True if this is the factory-specified battery type for this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. terminal corrosion, cracked case. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: purchase date, retailer, reason for replacement. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `bets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `market_id` | uuid | YES |  |  |
| `side` | text | NO |  |  |
| `amount` | numeric | NO |  |  |
| `odds_at_placement` | numeric | YES |  |  |
| `potential_payout` | numeric | YES |  |  |
| `status` | text | YES | 'active' |  |
| `payout` | numeric | YES |  |  |
| `rake_paid` | numeric | YES |  |  |
| `settled_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `betting_transactions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `type` | text | NO |  |  |
| `amount` | numeric | NO |  |  |
| `bet_id` | uuid | YES |  |  |
| `market_id` | uuid | YES |  |  |
| `balance_before` | numeric | YES |  |  |
| `balance_after` | numeric | YES |  |  |
| `description` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `betting_wallets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | NO |  |  |
| `balance` | numeric | YES | 0 |  |
| `total_deposited` | numeric | YES | 0 |  |
| `total_withdrawn` | numeric | YES | 0 |  |
| `total_wagered` | numeric | YES | 0 |  |
| `total_won` | numeric | YES | 0 |  |
| `total_rake_paid` | numeric | YES | 0 |  |
| `bets_placed` | integer | YES | 0 |  |
| `bets_won` | integer | YES | 0 |  |
| `bets_lost` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `body_bumpers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `position` | text | NO |  | Bumper position: front or rear. |
| `bumper_type` | text | YES |  | Bumper design type: chrome, urethane, painted, steel, aluminum. |
| `material` | text | YES |  | Bumper face material: chrome_steel, stainless_steel, aluminum, urethane, fiberglass, abs_plastic, other. |
| `energy_absorber` | text | YES |  | Energy absorber / isolator description, e.g. none, rubber_bellows, hydraulic_5mph, foam. |
| `brackets_condition` | text | YES |  | Condition of mounting brackets: excellent, good, fair, poor, failed, missing. |
| `guards_overriders` | text | YES |  | Description of guards or overriders, e.g. none, factory_rubber_guards, euro_overriders. |
| `is_original` | boolean | YES | true | True if factory-installed bumper. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. light pitting at corners, straightened impact damage. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: replating shop, part number, date. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_convertible_tops`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `top_type` | text | YES |  | Operation type: manual (hand-lowered) or power (hydraulic/electric). |
| `material` | text | YES |  | Top fabric: vinyl, canvas, cloth, mohair. Mohair is highest-grade wool cloth. |
| `frame_material` | text | YES |  | Folding frame material: steel, aluminum, composite. |
| `window_type` | text | YES |  | Rear window material: glass (hard, zips or bonded) or plastic (flexible vinyl). |
| `frame_condition` | text | YES |  | Condition of the folding frame mechanism: excellent, good, fair, poor, failed. |
| `hydraulic_condition` | text | YES |  | Condition of the hydraulic system (power tops only): excellent, good, fair, poor, failed, not_equipped. |
| `liner_condition` | text | YES |  | Condition of the headliner inside the top: excellent, good, fair, poor, failed, missing. |
| `is_original` | boolean | YES | true | True if this is the factory-installed top. |
| `condition_grade` | text | YES | 'unknown' | Overall top condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform notes, e.g. crease at header bow, plastic window yellowed, new top installed 2022. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: manufacturer, installer, date. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_emblems_badges`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `location` | text | NO |  | Freeform location, e.g. hood_nose, front_fender_lf, trunk_lid_center, door_sill. |
| `badge_type` | text | YES |  | Badge category: emblem (3D plastic/metal), nameplate (flat script), badge (flat graphic), stripe (body stripe), decal (adhesive graphic), pinstripe. |
| `text_content` | text | YES |  | Text or model designation on the badge, e.g. SS 396, Mustang, GT350. |
| `original_yn` | boolean | YES |  | True if this specific piece is original to the vehicle, not a reproduction or aftermarket replacement. |
| `is_original` | boolean | YES | true | True if this badge was factory-installed on this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition notes, e.g. letters intact, chrome worn at edges, one letter missing. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: manufacturer, part number, date acquired. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_glass`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `location` | text | NO |  | Glazing opening: windshield, rear_glass, door_lf, door_rf, door_lr, door_rr, quarter_lf, quarter_rf, vent_lf, vent_rf. Values: `windshield`, `rear_glass`, `door_lf`, `door_rf`, `door_lr`, `door_rr` ... (10 total) |
| `glass_type` | text | YES |  | Glass construction: laminated (windshield, shatterproof) or tempered (side/rear, shatters into pebbles). |
| `tint` | text | YES |  | Tint description, e.g. clear, light_tint, dark_tint, factory_privacy, aftermarket_35pct. |
| `date_code` | text | YES |  | Date code printed in the glass DOT stamp, e.g. 3Q67 for third quarter 1967. |
| `manufacturer_mark` | text | YES |  | AS rating stamped in the glass per ANSI Z26.1: AS1 (windshield clear), AS2 (side/rear clear), AS3 (privacy), through AS14. |
| `seal_condition` | text | YES |  | Condition of the perimeter seal/weatherstrip: excellent, good, fair, poor, failed, missing. |
| `is_original` | boolean | YES | true | True if this is the factory-installed glass for this opening. |
| `condition_grade` | text | YES | 'unknown' | Glass condition: excellent, good, fair, poor (cracks/chips), failed (broken), unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform notes, e.g. small chip at lower right, star crack 3 inches from center. |
| `provenance` | text | YES | 'unknown' | Glass origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: manufacturer name, replacement date. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_lighting`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `location` | text | NO |  | Light position: headlight_lf, headlight_rf, tail_lf, tail_rf, turn_front_lf, turn_front_rf, turn_rear_lf, turn_rear_rf, marker_front_lf, marker_front_rf, marker_rear_lf, marker_rear_rf, reverse_lf, reverse_rf, fog_lf, fog_rf, third_brake, license_plate. Values: `headlight_lf`, `headlight_rf`, `tail_lf`, `tail_rf`, `turn_front_lf`, `turn_front_rf` ... (18 total) |
| `light_type` | text | YES |  | Light source technology: sealed_beam, halogen, hid (xenon), led, incandescent. |
| `housing_condition` | text | YES |  | Condition of the light housing/bucket: excellent, good, fair, poor, failed, missing. |
| `lens_condition` | text | YES |  | Condition of the lens: excellent, good (light fade), fair (hazing), poor (cracked), failed (broken), missing. |
| `is_original` | boolean | YES | true | True if factory-installed lighting assembly. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition notes, e.g. date-correct sealed beam, aftermarket LED retrofit. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: part number, manufacturer, date installed. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_mirrors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `side` | text | NO |  | Mirror position: left (driver), right (passenger), center (rear-view if exterior). Values: `left`, `right`, `center` |
| `mirror_type` | text | YES |  | Adjustment mechanism: manual (remote cable or direct), power (electric motor), heated, auto_dimming. |
| `finish` | text | YES |  | Mirror housing finish: chrome, painted, stainless, black_plastic, body_color. |
| `is_original` | boolean | YES | true | True if factory-installed mirror. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition notes, e.g. glass cracked, housing faded, bracket bent. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: part number, manufacturer. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_panels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `panel_name` | text | NO |  | Panel location: fender_lf, fender_rf, door_lf, door_rf, door_lr, door_rr, quarter_lf, quarter_rf, hood, trunk_tailgate, roof, rocker_lf, rocker_rf, cab_corner_lf, cab_corner_rf, bedside_lf, bedside_rf. Values: `fender_lf`, `fender_rf`, `door_lf`, `door_rf`, `door_lr`, `door_rr` ... (17 total) |
| `material` | text | YES |  | Panel material: steel, aluminum, fiberglass, carbon_fiber, smc. NULL if unknown. |
| `rust_grade` | text | YES | 'none' | Rust severity: none, surface (light oxidation), bubbling (under paint), perforation (holes through), structural (affects rigidity). Values: `none`, `surface`, `bubbling`, `perforation`, `structural` |
| `paint_match_yn` | boolean | YES |  | True if panel paint matches the rest of the vehicle. False indicates repaint or replacement. |
| `filler_detected_yn` | boolean | YES |  | True if body filler (Bondo or similar) has been detected in this panel via magnet or inspection. |
| `is_original` | boolean | YES | true | True if this is the factory-installed panel for this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. small dent at leading edge, professional repair visible. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: manufacturer, part number, date acquired. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_structure`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `frame_type` | text | YES |  | Construction type: unibody (integrated body/frame), body_on_frame (separate), space_frame (exoskeleton), tube_frame (race/kit). |
| `frame_material` | text | YES |  | Primary frame material: steel, aluminum, carbon_fiber, chrome_moly, mild_steel, other. |
| `frame_condition` | text | YES |  | Overall structural condition: excellent, good, fair, poor, failed. |
| `rust_locations_jsonb` | jsonb | YES | '[]' | JSON array of rust location objects. Each object: {location: string, severity: none/surface/bubbling/perforation/structural, notes: string}. |
| `repair_history` | text | YES |  | Freeform description of known structural repairs, e.g. frame straightened 1998, welded cab corners 2010. |
| `reinforcements` | text | YES |  | Description of any structural reinforcements added beyond factory, e.g. roll cage, frame boxing, subframe connector weld-in. |
| `subframe_connectors` | text | YES |  | Subframe connector description: none, bolt_in_brand, weld_in_brand, factory. Relevant to unibody vehicles. |
| `body_mount_condition` | text | YES |  | Condition of body-to-frame mounts (body-on-frame only): excellent, good, fair, poor, failed, not_applicable. |
| `is_original` | boolean | YES | true | True if the structure is unmodified from factory specification. |
| `condition_grade` | text | YES | 'unknown' | Overall structural condition grade: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform structural notes, e.g. factory floor pans intact, no evidence of collision repair per frame inspection. |
| `provenance` | text | YES | 'unknown' | Structure origin (relevant if frame replaced): original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance if structure was replaced or significantly modified. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_trim_chrome`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `location` | text | NO |  | Freeform location description, e.g. windshield_surround, door_sill_lf, trunk_lid_script. |
| `piece_type` | text | YES |  | Material/finish type: chrome, stainless, aluminum, anodized, plastic, rubber. |
| `description` | text | YES |  | Part name or description, e.g. drip rail molding, belt line trim, body side molding. |
| `pitting_grade` | text | YES |  | Chrome/metal pitting severity: none, light, moderate, heavy, pitted_through (base metal exposed). |
| `original_yn` | boolean | YES |  | True if this specific piece is original to the vehicle (not reproduced or replacement). |
| `is_original` | boolean | YES | true | True if this trim piece was factory-installed on this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. light surface rust at clip holes, polished to bright. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: manufacturer, part number, replating shop. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `body_weatherstripping`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `location` | text | NO |  | Seal location: door_lf, door_rf, door_lr, door_rr, windshield, rear_glass, trunk, cowl, roof_rail_lf, roof_rail_rf, vent_window_lf, vent_window_rf. Values: `door_lf`, `door_rf`, `door_lr`, `door_rr`, `windshield`, `rear_glass` ... (12 total) |
| `manufacturer` | text | YES |  | Weatherstripping manufacturer, e.g. GM, Metro Molded Parts, Steele Rubber. |
| `material` | text | YES |  | Seal material: rubber (EPDM or natural), foam, felt. |
| `is_original` | boolean | YES | true | True if this is the factory-installed weatherstripping. |
| `condition_grade` | text | YES | 'unknown' | Condition: excellent, good, fair, poor (hard/cracked), failed (leaking), unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition notes, e.g. cracked at lower corner, leaks at highway speed. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: part number, date installed. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `bot_personas`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `behavior_profile` | jsonb | NO | '{}' |  |
| `goals` | ARRAY | YES | '{}'[] |  |
| `patience_level` | integer | YES | 5 |  |
| `tech_savviness` | integer | YES | 5 |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `bot_test_runs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `persona_id` | uuid | YES |  |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `status` | text | YES | 'running' |  Values: `running`, `completed`, `failed`, `timeout` |
| `environment` | text | YES | 'production' |  |
| `browser` | text | YES | 'chromium' |  |
| `device_type` | text | YES | 'desktop' |  |
| `pages_visited` | integer | YES | 0 |  |
| `actions_performed` | integer | YES | 0 |  |
| `errors_encountered` | integer | YES | 0 |  |
| `bugs_found` | integer | YES | 0 |  |
| `execution_log` | jsonb | YES | '[]' |  |
| `final_summary` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |

### `brake_calipers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Which corner: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `caliper_type` | text | YES |  | Caliper type: fixed, floating, sliding, other. |
| `piston_count` | integer | YES |  | Number of pistons per caliper, 1-12. |
| `piston_diameter_mm` | numeric | YES |  | Piston diameter in mm (largest if differential bore). |
| `piston_material` | text | YES |  | Piston material, e.g. steel, phenolic, aluminum, titanium. |
| `caliper_material` | text | YES |  | Caliper body material: cast_iron, aluminum, forged_aluminum, other. |
| `manufacturer` | text | YES |  | Caliper manufacturer, e.g. Delco Moraine, Bendix, Kelsey-Hayes, Brembo, Wilwood. |
| `part_number` | text | YES |  | Caliper part number. |
| `casting_number` | text | YES |  | Casting number on the caliper body. |
| `bracket_type` | text | YES |  | Caliper bracket/mounting type, e.g. knuckle_mount, bracket_mount, direct. |
| `pad_retention` | text | YES |  | Pad retention method, e.g. pins, bolts, clips, spring. |
| `bleeder_location` | text | YES |  | Bleeder screw location, e.g. top_inboard, top_outboard. |
| `dust_boot_type` | text | YES |  | Piston dust boot type, e.g. square_cut_seal, lip_seal, wiper. |
| `is_original` | boolean | YES | true | True if factory-installed caliper. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brake_drums`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Which corner: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `diameter_inches` | numeric | YES |  | Drum inner diameter in inches. |
| `max_diameter_inches` | numeric | YES |  | Maximum allowable diameter in inches before replacement. |
| `width_inches` | numeric | YES |  | Drum braking surface width in inches. |
| `material` | text | YES |  | Drum material: cast_iron, aluminum_iron_liner, composite, other. |
| `shoe_width_inches` | numeric | YES |  | Brake shoe width that fits this drum in inches. |
| `finned` | boolean | YES | false | True if drum has external cooling fins. |
| `part_number` | text | YES |  | Drum part number. |
| `manufacturer` | text | YES |  | Drum manufacturer. |
| `weight_lbs` | numeric | YES |  | Drum weight in pounds. |
| `is_original` | boolean | YES | true | True if factory-installed drum. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. measured diameter, scoring. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brake_lines`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Which corner: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `line_material` | text | YES |  | Overall line material: steel, stainless_braided, rubber, ptfe, other. |
| `flex_hose_material` | text | YES |  | Flexible hose material, e.g. rubber, stainless_braided_ptfe. |
| `flex_hose_length_inches` | numeric | YES |  | Flexible hose length in inches. |
| `hard_line_material` | text | YES |  | Hard line material: steel, stainless_steel, nickel_copper, copper_nickel, other. |
| `hard_line_diameter_inches` | numeric | YES |  | Hard line outer diameter in inches, e.g. 0.187 (3/16), 0.250 (1/4). |
| `fitting_type` | text | YES |  | Line fitting type, e.g. double_flare, iso_bubble, an_fitting. |
| `routing_description` | text | YES |  | Line routing description for this corner. |
| `proportioning_inline` | boolean | YES | false | True if inline proportioning device is on this line. |
| `residual_pressure_valve` | boolean | YES | false | True if residual pressure valve is installed on this circuit. |
| `part_number` | text | YES |  | Line kit or hose part number. |
| `manufacturer` | text | YES |  | Line/hose manufacturer. |
| `is_original` | boolean | YES | true | True if factory-installed brake line. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brake_pads_and_shoes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Which corner: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `friction_type` | text | YES |  | Friction element type: pad (disc brake) or shoe (drum brake). |
| `friction_material` | text | YES |  | Friction material: organic, semi_metallic, ceramic, metallic, sintered, other. |
| `manufacturer` | text | YES |  | Pad/shoe manufacturer, e.g. EBC, Hawk, Raybestos, Wagner. |
| `compound` | text | YES |  | Specific compound name, e.g. HPS, DTC-60, Yellowstuff. |
| `part_number` | text | YES |  | Pad/shoe part number. |
| `thickness_mm` | numeric | YES |  | New pad/shoe lining thickness in mm. |
| `minimum_thickness_mm` | numeric | YES |  | Minimum lining thickness before replacement in mm. |
| `width_mm` | numeric | YES |  | Pad/shoe width in mm. |
| `length_mm` | numeric | YES |  | Pad/shoe length in mm. |
| `wear_sensor_equipped` | boolean | YES | false | True if electronic wear sensor is installed. |
| `chamfered` | boolean | YES |  | True if pad edges are chamfered. |
| `slotted` | boolean | YES |  | True if pad face has slots for gas/dust evacuation. |
| `noise_shim` | text | YES |  | Noise shim type, e.g. adhesive, clip_on, titanium, none. |
| `is_original` | boolean | YES | true | True if factory-installed pad/shoe. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. measured remaining thickness. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brake_rotors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Which corner: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `diameter_mm` | numeric | YES |  | Rotor outer diameter in mm. |
| `thickness_mm` | numeric | YES |  | Rotor thickness in mm (new). |
| `minimum_thickness_mm` | numeric | YES |  | Minimum allowable thickness in mm before replacement. |
| `rotor_type` | text | YES |  | Rotor type: solid, vented, drilled, slotted, drilled_slotted, other. |
| `material` | text | YES |  | Rotor material: cast_iron, carbon_ceramic, carbon_carbon, composite, other. |
| `hat_type` | text | YES |  | Rotor hat type, e.g. integral, two_piece_floating, aluminum_hat. |
| `hat_height_mm` | numeric | YES |  | Rotor hat height in mm. |
| `vane_count` | integer | YES |  | Number of internal cooling vanes (vented rotors). |
| `directional` | boolean | YES | false | True if rotor is directional (left/right specific vane pattern). |
| `bolt_pattern` | text | YES |  | Rotor to hub bolt pattern. |
| `part_number` | text | YES |  | Rotor part number. |
| `manufacturer` | text | YES |  | Rotor manufacturer, e.g. Brembo, StopTech, AC Delco. |
| `weight_lbs` | numeric | YES |  | Rotor weight in pounds. |
| `is_original` | boolean | YES | true | True if factory-installed rotor. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. measured thickness, runout. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brake_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `system_type` | text | YES |  | Brake layout: 4_wheel_disc, front_disc_rear_drum, 4_wheel_drum, other. |
| `boost_type` | text | YES |  | Brake assist type: vacuum, hydroboost, electric, manual, other. |
| `booster_diameter_inches` | numeric | YES |  | Brake booster diaphragm diameter in inches, e.g. 9, 11. |
| `booster_part_number` | text | YES |  | Brake booster part number. |
| `master_cylinder_bore_inches` | numeric | YES |  | Master cylinder bore diameter in inches, e.g. 1.000, 1.125. |
| `master_cylinder_type` | text | YES |  | Master cylinder type, e.g. single_reservoir, dual_reservoir, tandem. |
| `master_cylinder_part_number` | text | YES |  | Master cylinder part number. |
| `proportioning_valve_type` | text | YES |  | Proportioning valve type, e.g. fixed, height_sensing, adjustable. |
| `proportioning_valve_adjustable` | boolean | YES | false | True if proportioning valve is adjustable. |
| `proportioning_valve_part_number` | text | YES |  | Proportioning valve part number. |
| `distribution_block_type` | text | YES |  | Distribution/combination valve type. |
| `abs_equipped` | boolean | YES | false | True if ABS is installed. |
| `abs_generation` | text | YES |  | ABS generation or version identifier. |
| `abs_manufacturer` | text | YES |  | ABS system manufacturer, e.g. Bosch, Kelsey-Hayes, Delphi. |
| `abs_module_part_number` | text | YES |  | ABS control module part number. |
| `parking_brake_type` | text | YES |  | Parking brake mechanism, e.g. drum_in_hat, caliper_integrated, band, transmission. |
| `parking_brake_actuation` | text | YES |  | Parking brake actuation, e.g. foot_pedal, hand_lever, center_console, electric. |
| `brake_fluid_type` | text | YES |  | Required brake fluid, e.g. DOT3, DOT4, DOT5, DOT5_1. |
| `is_original` | boolean | YES | true | True if factory-original brake system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `brand_aliases`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `brand_id` | uuid | NO |  |  |
| `alias_name` | text | NO |  |  |
| `alias_type` | text | YES | 'common' |  Values: `common`, `misspelling`, `abbreviation`, `legacy` |
| `created_at` | timestamp with time zone | YES | now() |  |

### `broadcast_backfill_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `video_id` | text | NO |  |  |
| `video_url` | text | NO |  |  |
| `auction_house` | text | NO |  |  |
| `auction_name` | text | YES |  |  |
| `broadcast_date` | date | YES |  |  |
| `duration_seconds` | integer | YES |  |  |
| `status` | text | YES | 'pending' |  |
| `priority` | integer | YES | 0 |  |
| `claimed_by` | text | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `lots_extracted` | integer | YES |  |  |
| `lots_linked` | integer | YES |  |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `build_health_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `total_builds` | bigint | YES |  |  |
| `active_builds` | bigint | YES |  |  |
| `stagnant_builds` | bigint | YES |  |  |
| `abandoned_builds` | bigint | YES |  |  |
| `avg_health_score` | numeric | YES |  |  |
| `avg_stagnation_risk` | numeric | YES |  |  |

### `build_research_links`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `build_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `url` | text | NO |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `category` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `scraped_data` | jsonb | YES |  |  |
| `screenshot_url` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `build_thread_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `thread_title` | text | YES |  |  |
| `thread_url` | text | YES |  |  |
| `forum_slug` | text | YES |  |  |
| `forum_name` | text | YES |  |  |
| `author_handle` | text | YES |  |  |
| `vehicle_hints` | jsonb | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_year` | integer | YES |  |  |
| `vehicle_make` | text | YES |  |  |
| `vehicle_model` | text | YES |  |  |
| `post_count` | integer | YES |  |  |
| `posts_extracted` | integer | YES |  |  |
| `image_count_estimate` | integer | YES |  |  |
| `images_extracted` | integer | YES |  |  |
| `extraction_status` | text | YES |  |  |
| `first_post_date` | timestamp with time zone | YES |  |  |
| `last_activity_date` | timestamp with time zone | YES |  |  |

### `builder_programs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `program_name` | text | NO |  |  |
| `slug` | text | NO |  |  |
| `base_platform` | text | YES |  |  |
| `base_years` | text | YES |  |  |
| `total_planned` | integer | YES |  |  |
| `total_built` | integer | YES |  |  |
| `total_delivered` | integer | YES |  |  |
| `status` | text | YES | 'active' |  Values: `announced`, `active`, `sold_out`, `completed`, `cancelled` |
| `power_output` | text | YES |  |  |
| `engine_spec` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `body_material` | text | YES |  |  |
| `new_price_usd` | numeric | YES |  |  |
| `secondary_market_low` | numeric | YES |  |  |
| `secondary_market_high` | numeric | YES |  |  |
| `description` | text | YES |  |  |
| `notable_features` | ARRAY | YES |  |  |
| `source_urls` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `business_invite_codes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `code` | text | NO |  |  |
| `created_by` | uuid | YES |  |  |
| `role_type` | text | YES | 'technician' |  Values: `technician`, `manager`, `viewer` |
| `max_uses` | integer | YES | 10 |  |
| `uses_count` | integer | YES | 0 |  |
| `expires_at` | timestamp with time zone | YES | (now() + '30 days'::interval) |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' |  |

### `business_ownership`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `owner_id` | uuid | NO |  |  |
| `ownership_percentage` | numeric | NO |  |  |
| `ownership_type` | text | YES |  |  Values: `founder`, `partner`, `investor`, `employee_equity`, `acquired` |
| `ownership_title` | text | YES |  |  |
| `acquisition_date` | date | NO |  |  |
| `status` | text | YES | 'active' |  Values: `active`, `pending`, `transferred`, `dissolved` |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_sec_reportable` | boolean | YES |  | Auto-set to true if ownership >= 20% (SEC disclosure threshold) |

### `business_related_persons`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `person_type` | ARRAY | YES | ARRAY[][] | Array can include: director, executive_officer, promoter, beneficial_owner |
| `full_legal_name` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `business_street_address_1` | text | YES |  |  |
| `business_street_address_2` | text | YES |  |  |
| `business_city` | text | YES |  |  |
| `business_state` | text | YES |  |  |
| `business_zip_code` | text | YES |  |  |
| `business_country` | text | YES | 'US' |  |
| `title` | text | YES |  |  |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `is_current` | boolean | YES | true |  |
| `ownership_percentage` | numeric | YES |  |  |
| `share_count` | integer | YES |  |  |
| `share_class` | text | YES |  |  |
| `prior_experience` | text | YES |  |  |
| `educational_background` | text | YES |  |  |
| `other_business_affiliations` | text | YES |  |  |
| `annual_compensation` | numeric | YES |  |  |
| `compensation_currency` | text | YES | 'USD' |  |
| `equity_compensation_shares` | integer | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `business_share_classes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `share_class_name` | text | NO |  |  |
| `share_class_code` | text | YES |  |  |
| `authorized_shares` | integer | YES |  |  |
| `issued_shares` | integer | YES |  |  |
| `outstanding_shares` | integer | YES |  |  |
| `treasury_shares` | integer | YES |  |  |
| `reserved_for_options` | integer | YES |  |  |
| `voting_rights` | text | YES |  |  Values: `full`, `limited`, `none`, `super` |
| `votes_per_share` | numeric | YES | 1.0 |  |
| `dividend_rights` | text | YES |  |  |
| `dividend_rate` | numeric | YES |  |  |
| `dividend_priority` | integer | YES |  |  |
| `liquidation_preference` | numeric | YES | 1.0 | Multiple of original investment paid in liquidation (e.g., 1.5x) |
| `liquidation_priority` | integer | YES |  |  |
| `participation_rights` | text | YES |  |  |
| `participation_cap` | numeric | YES |  |  |
| `is_convertible` | boolean | YES | false |  |
| `conversion_ratio` | numeric | YES |  |  |
| `conversion_price` | numeric | YES |  |  |
| `conversion_triggers` | ARRAY | YES |  |  |
| `anti_dilution_type` | text | YES |  | Protection for existing shareholders when new shares issued at lower price Values: `none`, `full_ratchet`, `weighted_average_broad`, `weighted_average_narrow` |
| `is_redeemable` | boolean | YES | false |  |
| `redemption_price` | numeric | YES |  |  |
| `redemption_date` | date | YES |  |  |
| `description` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `business_type_taxonomy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `type_name` | text | NO |  |  |
| `category` | text | YES |  |  |
| `description` | text | YES |  |  |
| `example_businesses` | ARRAY | YES |  |  |
| `discovery_count` | integer | YES | 0 |  |
| `first_discovered_at` | timestamp with time zone | YES | now() |  |
| `last_discovered_at` | timestamp with time zone | YES | now() |  |

### `business_user_roles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `role_title` | text | NO |  |  |
| `role_type` | text | YES |  |  Values: `owner`, `manager`, `employee`, `contractor`, `intern`, `consultant`, `promoter` |
| `department` | text | YES |  |  |
| `permissions` | ARRAY | YES | ARRAY['view_business', 'view_projects'] |  |
| `can_manage_vehicles` | boolean | YES | false |  |
| `can_manage_users` | boolean | YES | false |  |
| `can_create_projects` | boolean | YES | true |  |
| `employment_type` | text | YES |  |  Values: `full_time`, `part_time`, `contract`, `temporary`, `volunteer` |
| `hourly_rate` | numeric | YES |  |  |
| `start_date` | date | NO |  |  |
| `end_date` | date | YES |  |  |
| `skill_level` | text | YES |  |  Values: `apprentice`, `journeyman`, `expert`, `master` |
| `specializations` | ARRAY | YES | ARRAY[][] |  |
| `status` | text | YES | 'active' |  Values: `active`, `inactive`, `on_leave`, `terminated` |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `businesses`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `business_name` | text | YES |  |  |
| `legal_name` | text | YES |  |  |
| `business_type` | text | YES |  |  |
| `industry_focus` | ARRAY | YES |  |  |
| `email` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `website` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip_code` | text | YES |  |  |
| `country` | text | YES |  |  |
| `description` | text | YES |  |  |
| `specializations` | ARRAY | YES |  |  |
| `services_offered` | ARRAY | YES |  |  |
| `years_in_business` | integer | YES |  |  |
| `employee_count` | integer | YES |  |  |
| `accepts_dropoff` | boolean | YES |  |  |
| `offers_mobile_service` | boolean | YES |  |  |
| `has_lift` | boolean | YES |  |  |
| `has_paint_booth` | boolean | YES |  |  |
| `has_dyno` | boolean | YES |  |  |
| `has_alignment_rack` | boolean | YES |  |  |
| `hourly_rate_min` | numeric | YES |  |  |
| `hourly_rate_max` | numeric | YES |  |  |
| `service_radius_miles` | integer | YES |  |  |
| `total_projects_completed` | integer | YES |  |  |
| `total_vehicles_worked` | integer | YES |  |  |
| `average_project_rating` | numeric | YES |  |  |
| `total_reviews` | integer | YES |  |  |
| `repeat_customer_rate` | numeric | YES |  |  |
| `on_time_completion_rate` | numeric | YES |  |  |
| `is_verified` | boolean | YES |  |  |
| `verification_date` | timestamp with time zone | YES |  |  |
| `verification_level` | text | YES |  |  |
| `status` | text | YES |  |  |
| `is_public` | boolean | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `is_for_sale` | boolean | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `business_license` | text | YES |  |  |
| `tax_id` | text | YES |  |  |
| `registration_state` | text | YES |  |  |
| `registration_date` | date | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `discovered_by` | uuid | YES |  |  |
| `logo_url` | text | YES |  |  |
| `banner_url` | text | YES |  |  |
| `total_vehicles` | integer | YES |  |  |
| `total_images` | integer | YES |  |  |
| `total_events` | integer | YES |  |  |
| `current_value` | numeric | YES |  |  |
| `is_tradable` | boolean | YES |  |  |
| `stock_symbol` | text | YES |  |  |
| `uploaded_by` | uuid | YES |  |  |
| `labor_rate` | numeric | YES |  |  |
| `currency` | text | YES |  |  |
| `tax_rate` | numeric | YES |  |  |
| `search_keywords` | ARRAY | YES |  |  |
| `search_vector` | tsvector | YES |  |  |
| `data_signals` | jsonb | YES |  |  |
| `ui_config` | jsonb | YES |  |  |
| `intelligence_last_updated` | timestamp with time zone | YES |  |  |
| `has_team_data` | boolean | YES |  |  |
| `dealer_license` | text | YES |  |  |
| `geographic_key` | text | YES |  |  |
| `discovered_via` | text | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `source_url` | text | YES |  |  |
| `member_since` | timestamp with time zone | YES |  |  |
| `total_listings` | integer | YES |  |  |
| `total_bids` | integer | YES |  |  |
| `total_comments` | integer | YES |  |  |
| `total_auction_wins` | integer | YES |  |  |
| `total_success_stories` | integer | YES |  |  |
| `primary_focus` | text | YES |  |  |
| `total_sold` | integer | YES |  |  |
| `gross_margin_pct` | numeric | YES |  |  |
| `inventory_turnover` | numeric | YES |  |  |
| `avg_days_to_sell` | numeric | YES |  |  |
| `project_completion_rate` | numeric | YES |  |  |
| `repeat_customer_count` | integer | YES |  |  |
| `gmv` | numeric | YES |  |  |
| `receipt_count` | integer | YES |  |  |
| `listing_count` | integer | YES |  |  |
| `total_projects` | integer | YES |  |  |
| `incorporation_jurisdiction` | text | YES |  |  |
| `year_incorporated` | integer | YES |  |  |
| `naics_code` | text | YES |  |  |
| `revenue_declaration_date` | date | YES |  |  |
| `is_sec_filer` | boolean | YES |  |  |
| `cik_number` | text | YES |  |  |
| `latest_form_d_date` | date | YES |  |  |
| `latest_form_c_date` | date | YES |  |  |
| `risk_factors` | text | YES |  |  |
| `intellectual_property` | jsonb | YES |  |  |
| `target_market_description` | text | YES |  |  |
| `slug` | text | YES |  |  |
| `social_links` | jsonb | YES |  |  |
| `inventory_url` | text | YES |  |  |
| `total_inventory` | integer | YES |  |  |
| `last_inventory_sync` | timestamp with time zone | YES |  |  |
| `scrape_source_id` | uuid | YES |  |  |
| `is_active` | boolean | YES |  |  |
| `legacy_org_id` | uuid | YES |  |  |
| `hours_of_operation` | jsonb | YES |  |  |
| `service_type` | USER-DEFINED | YES |  |  |
| `service_description` | text | YES |  |  |
| `powers_other_orgs` | boolean | YES |  |  |
| `powered_by_org_id` | uuid | YES |  |  |
| `parking_rate_per_day` | numeric | YES |  |  |
| `entity_type` | text | YES |  |  |
| `legal_structure` | text | YES |  |  |
| `entity_attributes` | jsonb | YES |  |  |
| `enrichment_status` | text | YES |  |  |
| `last_enriched_at` | timestamp with time zone | YES |  |  |
| `enrichment_sources` | ARRAY | YES |  |  |
| `brands_carried` | ARRAY | YES |  |  |

### `buyer_agency_agreements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `status` | text | NO | 'draft' |  Values: `draft`, `pending_signature`, `active`, `expired`, `cancelled` |
| `commission_rate` | numeric | NO | 4.00 |  |
| `max_authorized_bid_cents` | bigint | YES |  |  |
| `monthly_spending_limit_cents` | bigint | YES |  |  |
| `signature_data` | jsonb | YES |  |  |
| `signed_at` | timestamp with time zone | YES |  |  |
| `signed_ip_address` | inet | YES |  |  |
| `signed_user_agent` | text | YES |  |  |
| `legal_name` | text | NO |  |  |
| `legal_address` | jsonb | YES |  |  |
| `agreement_pdf_url` | text | YES |  |  |
| `agreement_version` | text | NO | '1.0' |  |
| `effective_date` | date | YES | CURRENT_DATE |  |
| `expiration_date` | date | YES | (CURRENT_DATE + '1 year'::interval) |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `buyer_tiers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `buyer_id` | uuid | NO |  |  |
| `tier` | text | NO | 'C' |  Values: `C`, `B`, `A`, `S`, `SS`, `SSS` |
| `total_bids` | integer | YES | 0 |  |
| `winning_bids` | integer | YES | 0 |  |
| `payment_reliability` | numeric | YES |  |  |
| `average_response_time_hours` | numeric | YES |  |  |
| `no_show_count` | integer | YES | 0 |  |
| `total_spent_cents` | bigint | YES | 0 |  |
| `average_bid_amount_cents` | bigint | YES |  |  |
| `highest_bid_cents` | bigint | YES |  |  |
| `disputes` | integer | YES | 0 |  |
| `positive_feedback` | integer | YES | 0 |  |
| `negative_feedback` | integer | YES | 0 |  |
| `tier_updated_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `platform_tier` | text | YES |  |  Values: `F`, `E`, `D`, `C`, `B`, `A` |
| `platform_score` | integer | YES | 0 |  |
| `platform_tier_breakdown` | jsonb | YES | '{}' |  |
| `platform_tier_updated_at` | timestamp with time zone | YES |  |  |

### `canonical_body_styles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `canonical_name` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `vehicle_type` | text | NO |  |  |
| `aliases` | ARRAY | YES | ARRAY[][] |  |
| `description` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `canonical_camera_positions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `position_key` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `category` | text | NO |  |  |
| `azimuth_deg` | numeric | NO |  |  |
| `elevation_deg` | numeric | NO |  |  |
| `distance_mm` | numeric | NO |  |  |
| `azimuth_tolerance` | numeric | YES | 15 |  |
| `elevation_tolerance` | numeric | YES | 10 |  |
| `distance_tolerance_pct` | numeric | YES | 0.3 |  |
| `subject_key` | text | YES | 'vehicle' |  |
| `coverage_weight` | numeric | YES | 1.0 |  |
| `description` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `canonical_vehicle_types`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `canonical_name` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `aliases` | ARRAY | YES | ARRAY[][] |  |
| `description` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `carpeting`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `material` | text | YES |  | Carpet weave type: loop, cut_pile, rubber, vinyl, other. |
| `color` | text | YES |  | Carpet color as described or observed. |
| `underlay_type` | text | YES |  | Carpet backing/underlay material: jute, felt, foam, mass_loaded, none, other. |
| `sound_deadening_type` | text | YES |  | Sound deadening layer under carpet: none, factory_tar, dynamat, second_skin, spray, mass_loaded_vinyl, other. |
| `floor_mat_type` | text | YES |  | Removable floor mat type: none, loop, cut_pile, rubber, all_weather, other. |
| `trunk_carpet_condition` | text | YES |  | Trunk/cargo area carpet condition: excellent, good, fair, poor, missing, unknown. |
| `is_original` | boolean | YES | true | True if factory-original carpet set. |
| `condition_grade` | text | YES | 'unknown' | Overall floor carpet condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. stains, burns, moth damage. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `cash_transactions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `amount_cents` | bigint | NO |  |  |
| `transaction_type` | text | NO |  |  Values: `deposit`, `withdrawal`, `trade_buy`, `trade_sell`, `fee`, `refund` |
| `status` | text | YES | 'completed' |  Values: `pending`, `completed`, `failed`, `cancelled` |
| `stripe_payment_id` | text | YES |  |  |
| `stripe_payout_id` | text | YES |  |  |
| `reference_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |

### `catalog_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `provider` | text | NO |  |  |
| `base_url` | text | YES |  |  |
| `pdf_document_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `catalytic_converters`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `position` | text | YES |  | Converter position: pre_cat, main, rear, underfloor, close_coupled. |
| `side` | text | YES |  | Which side: left, right, center, single. |
| `converter_count` | integer | YES | 1 | Number of converters at this position (usually 1). |
| `converter_type` | text | YES |  | Converter chemistry: two_way, three_way, three_way_heated, pre_cat, test_pipe, other. |
| `substrate` | text | YES |  | Internal substrate: ceramic, metallic, other. |
| `oem_yn` | boolean | YES |  | True if this is an OEM (factory-supplied) converter. |
| `cat_delete_yn` | boolean | YES | false | True if converter has been removed and replaced with a test pipe. |
| `part_number` | text | YES |  | Converter part number. |
| `manufacturer` | text | YES |  | Converter manufacturer, e.g. Magnaflow, Eastern, Walker. |
| `inlet_diameter_inches` | numeric | YES |  | Inlet pipe diameter in inches. |
| `outlet_diameter_inches` | numeric | YES |  | Outlet pipe diameter in inches. |
| `is_original` | boolean | YES | true | True if factory-installed catalytic converter. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. rattle indicates substrate failure. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `chart_of_accounts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `account_code` | text | NO |  |  |
| `account_name` | text | NO |  |  |
| `account_type` | text | NO |  |  Values: `asset`, `liability`, `equity`, `revenue`, `expense`, `cogs` |
| `account_subtype` | text | YES |  |  |
| `parent_account_code` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `is_system_account` | boolean | YES | false |  |
| `description` | text | YES |  |  |
| `quickbooks_account_id` | text | YES |  |  |
| `xero_account_id` | text | YES |  |  |
| `pennylane_account_id` | text | YES |  |  |
| `integration_mappings` | jsonb | YES | '{}' |  |
| `business_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `clarification_requests`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `request_type` | text | NO |  |  Values: `vehicle_identity`, `new_vs_existing`, `vehicle_assignment`, `album_confirmation`, `batch_assignment` |
| `photo_sync_item_ids` | ARRAY | YES |  |  |
| `sample_image_urls` | ARRAY | YES |  |  |
| `ai_analysis` | jsonb | YES |  |  |
| `candidate_vehicles` | jsonb | YES |  |  |
| `message_text` | text | YES |  |  |
| `message_sent_at` | timestamp with time zone | YES |  |  |
| `message_channel` | text | YES |  |  |
| `message_external_id` | text | YES |  |  |
| `response_text` | text | YES |  |  |
| `response_received_at` | timestamp with time zone | YES |  |  |
| `response_channel` | text | YES |  |  |
| `resolved_vehicle_id` | uuid | YES |  |  |
| `resolution` | text | YES |  |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `sent`, `replied`, `resolved`, `timeout`, `cancelled` |
| `reminder_count` | integer | YES | 0 |  |
| `max_reminders` | integer | YES | 1 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `claude_allowed_sessions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `session_id` | text | NO |  |  |
| `chat_id` | bigint | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `expires_at` | timestamp with time zone | YES | (now() + '24:00:00'::interval) |  |

### `clients`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `client_name` | text | NO |  |  |
| `company_name` | text | YES |  |  |
| `contact_email` | text | YES |  |  |
| `contact_phone` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `is_private` | boolean | YES | false |  |
| `blur_level` | text | YES | 'none' |  Values: `none`, `low`, `medium`, `high` |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `business_id` | uuid | YES |  |  |

### `comfort_electrical`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `power_windows_yn` | boolean | YES |  | True if power windows are equipped. |
| `power_windows_switch_type` | text | YES |  | Window switch type, e.g. rocker, momentary_toggle, auto_one_touch. |
| `power_locks_yn` | boolean | YES |  | True if power door locks are equipped. |
| `power_mirrors_yn` | boolean | YES |  | True if power-adjustable mirrors are equipped. |
| `power_seats_yn` | boolean | YES |  | True if power-adjustable seats are equipped. |
| `power_seat_positions` | text | YES |  | Power seat adjustment positions, e.g. 4-way, 6-way, 8-way, 10-way. |
| `cruise_control_yn` | boolean | YES |  | True if cruise control is equipped. |
| `cruise_control_type` | text | YES |  | Cruise control type, e.g. mechanical_cable, electronic_throttle, adaptive. |
| `keyless_entry_yn` | boolean | YES |  | True if remote keyless entry is equipped. |
| `keyless_entry_type` | text | YES |  | Keyless entry type, e.g. factory_fob, aftermarket_fob, proximity. |
| `remote_start_yn` | boolean | YES |  | True if remote start is equipped. |
| `power_antenna_yn` | boolean | YES |  | True if a power-retractable antenna is equipped. |
| `rear_defrost_yn` | boolean | YES |  | True if rear window electric defrost grid is equipped. |
| `heated_mirrors_yn` | boolean | YES |  | True if mirror heating elements are equipped. |
| `heated_seats_yn` | boolean | YES |  | True if seat heating elements are equipped. |
| `heated_steering_yn` | boolean | YES |  | True if heated steering wheel is equipped. |
| `rain_sensing_wipers_yn` | boolean | YES |  | True if rain-sensing automatic wiper control is equipped. |
| `auto_dimming_mirror_yn` | boolean | YES |  | True if auto-dimming (electrochromic) rearview mirror is equipped. |
| `memory_seats_yn` | boolean | YES |  | True if memory seat position system is equipped. |
| `memory_mirrors_yn` | boolean | YES |  | True if memory mirror position system is equipped. |
| `is_original` | boolean | YES | true | True if these features are factory-installed on this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Overall condition grade for comfort electrical systems: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform notes on non-functional or partially functional items. |
| `provenance` | text | YES | 'unknown' | System origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info for aftermarket upgrades. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `community_events`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `event_name` | text | NO |  |  |
| `event_type` | text | NO |  |  Values: `car_show`, `track_day`, `auction`, `workshop`, `meetup`, `rally` ... (12 total) |
| `description` | text | YES |  |  |
| `start_date` | timestamp with time zone | NO |  |  |
| `end_date` | timestamp with time zone | YES |  |  |
| `recurring` | text | YES |  |  Values: `once`, `weekly`, `biweekly`, `monthly`, `quarterly`, `annually` |
| `property_id` | uuid | YES |  |  |
| `venue_name` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `country` | text | YES | 'US' |  |
| `max_capacity` | integer | YES |  |  |
| `registered_count` | integer | YES | 0 |  |
| `attended_count` | integer | YES | 0 |  |
| `vehicle_spots` | integer | YES |  |  |
| `ticket_price_cents` | bigint | YES | 0 |  |
| `vip_price_cents` | bigint | YES |  |  |
| `sponsorship_revenue_cents` | bigint | YES | 0 |  |
| `total_revenue_cents` | bigint | YES | 0 |  |
| `total_cost_cents` | bigint | YES | 0 |  |
| `net_profit_cents` | bigint | YES | 0 |  |
| `organizer_id` | uuid | YES |  |  |
| `business_id` | uuid | YES |  |  |
| `status` | text | YES | 'planned' |  Values: `planned`, `announced`, `selling_tickets`, `sold_out`, `in_progress`, `completed`, `cancelled` |
| `primary_image_url` | text | YES |  |  |
| `image_urls` | ARRAY | YES | '{}'[] |  |
| `tags` | ARRAY | YES | '{}'[] |  |
| `featured_vehicles` | ARRAY | YES | '{}'::uuid[] |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `component_assembly_map`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `assembly_name` | text | NO |  |  |
| `assembly_category` | text | NO |  |  |
| `assembly_description` | text | YES |  |  |
| `sub_components` | jsonb | YES | '[]' |  |
| `catalog_part_map` | jsonb | YES | '{}' |  |
| `possible_states` | jsonb | YES | '[]' |  |
| `state_indicators` | jsonb | YES | '{}' |  |
| `application_years` | text | YES |  |  |
| `application_models` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `component_definitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model_family` | text | YES |  |  |
| `year_range_start` | integer | NO |  |  |
| `year_range_end` | integer | NO |  |  |
| `series` | ARRAY | YES |  |  |
| `body_styles` | ARRAY | YES |  |  |
| `component_category` | text | NO |  |  |
| `component_name` | text | NO |  |  |
| `component_subcategory` | text | YES |  |  |
| `visual_identifiers` | jsonb | YES |  | JSONB describing how to visually identify this component |
| `distinguishing_features` | ARRAY | YES |  |  |
| `common_variations` | ARRAY | YES |  |  |
| `oem_part_numbers` | ARRAY | YES |  |  |
| `common_aftermarket_brands` | ARRAY | YES |  |  |
| `superseded_by` | text | YES |  |  |
| `standard_on_trims` | ARRAY | YES |  |  |
| `optional_on_trims` | ARRAY | YES |  |  |
| `not_available_on_trims` | ARRAY | YES |  |  |
| `related_rpo_codes` | ARRAY | YES |  |  |
| `source_documents` | ARRAY | YES |  |  |
| `reference_pages` | jsonb | YES |  |  |
| `identification_priority` | integer | YES | 5 |  |
| `year_dating_significance` | integer | YES | 0 | 0-10 score: how much this component helps date the vehicle |
| `trim_identification_value` | integer | YES | 0 | 0-10 score: how much this indicates trim level |
| `originality_indicator` | integer | YES | 0 | 0-10 score: how much this proves OEM vs modified |
| `notes` | text | YES |  |  |
| `created_by` | uuid | YES |  |  |
| `verified_by` | uuid | YES |  |  |
| `is_verified` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `component_events`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). The vehicle this event pertains to. |
| `component_table` | text | NO |  | Name of the component table, e.g. engine_blocks, engine_heads. |
| `component_id` | uuid | NO |  | PK of the row in the component table this event references. |
| `event_type` | text | NO |  | What happened: installed, removed, rebuilt, inspected, modified, repaired, replaced, cleaned, painted, tested, measured, adjusted, condemned, sourced, purchased. Values: `installed`, `removed`, `rebuilt`, `inspected`, `modified`, `repaired` ... (15 total) |
| `actor_id` | uuid | YES |  | FK to actors(id). Who performed this work. |
| `event_date` | date | YES |  | When the event occurred. Use event_date_approximate if unsure. |
| `event_date_approximate` | boolean | YES | false | True if event_date is estimated rather than exact. |
| `mileage_at_event` | integer | YES |  | Odometer reading at time of event, if known. |
| `location` | text | YES |  | Where the work was performed. |
| `description` | text | YES |  | Freeform description of the work performed. |
| `cost_cents` | integer | YES |  | Cost in cents to avoid floating point. 150000 = $1,500.00. |
| `currency` | text | YES | 'USD' | ISO 4217 currency code, defaults to USD. |
| `invoice_reference` | text | YES |  | Invoice or receipt number for traceability. |
| `evidence_ids` | ARRAY | YES |  | Array of field_evidence.id UUIDs that support this event. |
| `metadata` | jsonb | YES | '{}' | Extensible JSON for event-specific data not covered by columns. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |
| `org_id` | uuid | YES |  | FK to organizations(id). The organization where this work was performed. |
| `work_order_id` | uuid | YES |  | FK to work_orders(id). The work order this event belongs to. |

### `component_identifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `analysis_record_id` | uuid | NO |  |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `component_definition_id` | uuid | YES |  |  |
| `component_type` | text | NO |  |  |
| `identification` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `brand` | text | YES |  |  |
| `status` | text | NO |  |  |
| `confidence` | numeric | YES |  |  |
| `source_references` | jsonb | YES |  |  |
| `citation_text` | text | YES |  |  |
| `inference_basis` | text | YES |  |  |
| `inference_method` | text | YES |  |  |
| `blocking_gaps` | ARRAY | YES |  |  |
| `alternative_possibilities` | ARRAY | YES |  |  |
| `bounding_box` | jsonb | YES |  |  |
| `visible_features` | ARRAY | YES |  |  |
| `condition_notes` | text | YES |  |  |
| `human_validated` | boolean | YES | false |  |
| `validated_by` | uuid | YES |  |  |
| `validated_at` | timestamp with time zone | YES |  |  |
| `validation_notes` | text | YES |  |  |
| `correction_applied` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `concierge_quotes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `guest_name` | text | YES |  |  |
| `guest_email` | text | YES |  |  |
| `guest_phone` | text | YES |  |  |
| `request_summary` | text | YES |  |  |
| `arrival_date` | date | YES |  |  |
| `departure_date` | date | YES |  |  |
| `guest_count` | integer | YES |  |  |
| `line_items` | jsonb | YES | '[]' |  |
| `subtotal` | numeric | YES |  |  |
| `white_glove_fee` | numeric | YES |  |  |
| `total` | numeric | YES |  |  |
| `deposit_amount` | numeric | YES |  |  |
| `deposit_paid` | boolean | YES | false |  |
| `status` | text | YES | 'draft' |  |
| `stripe_payment_intent_id` | text | YES |  |  |
| `stripe_checkout_session_id` | text | YES |  |  |
| `last_message_at` | timestamp with time zone | YES |  |  |
| `chat_history` | jsonb | YES | '[]' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `condition_distributions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `ymm_key` | text | YES |  |  |
| `group_type` | text | NO |  |  |
| `group_size` | integer | NO |  |  |
| `mean_score` | numeric | NO |  |  |
| `median_score` | numeric | NO |  |  |
| `std_dev` | numeric | NO |  |  |
| `percentile_10` | numeric | YES |  |  |
| `percentile_25` | numeric | YES |  |  |
| `percentile_50` | numeric | YES |  |  |
| `percentile_75` | numeric | YES |  |  |
| `percentile_90` | numeric | YES |  |  |
| `skewness` | numeric | YES |  |  |
| `lifecycle_distribution` | jsonb | YES |  |  |
| `top_descriptors` | jsonb | YES |  |  |
| `computed_at` | timestamp with time zone | NO | now() |  |
| `computation_version` | text | NO | 'v1' |  |

### `consoles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `console_type` | text | NO | 'none' | Console location: floor, overhead, none, other. Values: `floor`, `overhead`, `none`, `other` |
| `material` | text | YES |  | Primary surface material: hard_plastic, vinyl, leather, wood, carbon_fiber, other. |
| `color` | text | YES |  | Console color as observed. |
| `features_jsonb` | jsonb | YES | '[]' | JSON array of feature tags present, e.g. ["cupholder", "storage", "armrest", "shifter_boot", "coin_holder", "usb_ports"]. Empty if no console. |
| `lid_condition` | text | YES |  | Console lid/armrest lid condition: excellent, good, fair, poor, missing, not_equipped, unknown. |
| `is_original` | boolean | YES | true | True if factory-installed console. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `contractor_profile_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `contractor_user_id` | uuid | YES |  |  |
| `total_jobs` | bigint | YES |  |  |
| `shops_worked_for` | bigint | YES |  |  |
| `vehicles_worked_on` | bigint | YES |  |  |
| `total_labor_hours` | numeric | YES |  |  |
| `public_revenue` | numeric | YES |  |  |
| `total_revenue_all` | numeric | YES |  |  |
| `average_hourly_rate` | numeric | YES |  |  |
| `specializations` | ARRAY | YES |  |  |
| `first_job_date` | date | YES |  |  |
| `most_recent_job_date` | date | YES |  |  |

### `contractor_work_contributions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `contractor_user_id` | uuid | NO |  |  |
| `organization_id` | uuid | NO |  |  |
| `work_description` | text | NO |  |  |
| `work_category` | text | YES |  |  Values: `labor`, `fabrication`, `paint`, `upholstery`, `mechanical`, `electrical` ... (9 total) |
| `work_date` | date | NO |  |  |
| `labor_hours` | numeric | YES |  |  |
| `hourly_rate` | numeric | YES |  |  |
| `total_labor_value` | numeric | YES |  |  |
| `materials_cost` | numeric | YES | 0 |  |
| `total_value` | numeric | YES |  |  |
| `source_image_id` | uuid | YES |  |  |
| `source_document_url` | text | YES |  |  |
| `extracted_from_ocr` | boolean | YES | false |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_name` | text | YES |  |  |
| `is_public` | boolean | YES | false |  |
| `show_financial_details` | boolean | YES | false |  |
| `show_on_contractor_profile` | boolean | YES | true |  |
| `verified_by_shop` | boolean | YES | false |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `confidence_score` | integer | YES | 100 |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `contractor_hourly_rate` | numeric | YES |  | What the contractor was actually paid per hour (e.g., €30-35) |
| `shop_billed_to_customer` | numeric | YES |  | What the shop charged the customer for this work |
| `shop_hourly_rate` | numeric | YES |  | Shop billing rate to customer (e.g., €110-160) |

### `contribution_submissions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `contributor_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `contribution_type` | text | NO |  |  Values: `work_images`, `timeline_event`, `repair_documentation`, `parts_receipt`, `before_after_photos`, `diagnostic_data` |
| `image_ids` | ARRAY | YES | '{}'::uuid[] |  |
| `timeline_event_id` | uuid | YES |  |  |
| `document_url` | text | YES |  |  |
| `work_date` | date | NO |  |  |
| `work_date_source` | text | YES |  |  |
| `responsible_party_type` | text | NO |  |  Values: `organization`, `vehicle_owner`, `self`, `contractor_to_org`, `contractor_to_owner` |
| `responsible_party_org_id` | uuid | YES |  |  |
| `responsible_party_user_id` | uuid | YES |  |  |
| `work_category` | text | YES |  |  Values: `fabrication`, `welding`, `paint`, `bodywork`, `upholstery`, `mechanical` ... (18 total) |
| `work_description` | text | YES |  |  |
| `labor_hours` | numeric | YES |  |  |
| `estimated_value` | numeric | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `auto_approved`, `disputed` |
| `requires_approval_from` | ARRAY | NO |  |  |
| `notification_sent_to` | ARRAY | YES |  |  |
| `notified_at` | timestamp with time zone | YES |  |  |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `review_notes` | text | YES |  |  |
| `auto_approve_at` | timestamp with time zone | YES | (now() + '30 days'::interval) |  |
| `auto_approved` | boolean | YES | false |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `contribution_types`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO |  |  |
| `name` | text | NO |  |  |

### `coolant_hoses`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `hose_location` | text | NO |  | Hose position: upper_radiator, lower_radiator, heater_supply, heater_return, bypass, overflow, thermostat_housing, water_pump_inlet, other. Values: `upper_radiator`, `lower_radiator`, `heater_supply`, `heater_return`, `bypass`, `overflow` ... (9 total) |
| `side` | text | YES |  | Which side if applicable: left, right, center. |
| `material` | text | YES |  | Hose material: rubber, silicone, epdm, reinforced_rubber, other. |
| `inner_diameter_inches` | numeric | YES |  | Hose inner diameter in inches. |
| `length_inches` | numeric | YES |  | Hose length in inches. |
| `manufacturer` | text | YES |  | Hose manufacturer, e.g. Gates, Dayco, Mishimoto. |
| `part_number` | text | YES |  | Hose part number. |
| `clamp_type` | text | YES |  | Hose clamp type, e.g. tower, worm_gear, spring, t_bolt. |
| `reinforced` | boolean | YES | false | True if hose is internally reinforced. |
| `is_original` | boolean | YES | true | True if factory-installed hose. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. soft spot near clamp, cracking visible. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `cooling_fans`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `fan_type` | text | YES |  | Fan type: mechanical, electric, dual_electric, flex_fan, other. |
| `position` | text | YES |  | Fan position relative to radiator: pusher, puller, engine_driven, auxiliary. |
| `diameter_inches` | numeric | YES |  | Fan blade diameter in inches. |
| `blade_count` | integer | YES |  | Number of fan blades. |
| `clutch_type` | text | YES |  | Fan clutch type: thermal, non_thermal, severe_duty, electric, none. |
| `clutch_engagement_temp_f` | integer | YES |  | Temperature at which thermal clutch engages, in Fahrenheit. |
| `cfm_rating` | integer | YES |  | Rated airflow in cubic feet per minute. |
| `amperage_draw` | numeric | YES |  | Electric fan amperage draw. |
| `controller` | text | YES |  | Fan controller description, e.g. thermostatic_switch, ecu_controlled, manual_switch, adjustable. |
| `shroud_yn` | boolean | YES | false | True if a fan shroud is installed. |
| `shroud_material` | text | YES |  | Shroud material, e.g. plastic, fiberglass, aluminum, stamped_steel. |
| `manufacturer` | text | YES |  | Fan manufacturer, e.g. Flex-a-lite, SPAL, Hayden, OEM. |
| `part_number` | text | YES |  | Fan part number. |
| `thermostat_controlled` | boolean | YES | false | True if fan activation is thermostat-controlled. |
| `activation_temp_f` | integer | YES |  | Temperature at which electric fan activates, in Fahrenheit. |
| `is_original` | boolean | YES | true | True if factory-installed cooling fan. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. clutch slipping, fan wobble. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `coordinate_system_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `total_images` | bigint | YES |  |  |
| `images_with_observations` | bigint | YES |  |  |
| `total_observations` | bigint | YES |  |  |
| `label_derived_count` | bigint | YES |  |  |
| `ai_derived_count` | bigint | YES |  |  |
| `human_derived_count` | bigint | YES |  |  |
| `cluster_derived_count` | bigint | YES |  |  |
| `labels_needing_refinement` | bigint | YES |  |  |
| `avg_certainty` | numeric | YES |  |  |

### `coverage_gaps_by_vehicle`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `make` | text | YES |  |  |
| `model_family` | text | YES |  |  |
| `year_range_start` | integer | YES |  |  |
| `year_range_end` | integer | YES |  |  |
| `topics_complete` | bigint | YES |  |  |
| `topics_partial` | bigint | YES |  |  |
| `topics_missing` | bigint | YES |  |  |
| `avg_coverage` | numeric | YES |  |  |
| `total_blocked` | bigint | YES |  |  |

### `coverage_targets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_id` | uuid | YES |  |  |
| `segment_type` | text | NO | 'all' |  |
| `segment_value` | text | YES |  |  |
| `target_coverage_pct` | numeric | YES |  |  |
| `target_freshness_hours` | integer | YES |  |  |
| `target_extraction_hours` | integer | YES |  |  |
| `priority` | integer | YES | 50 |  |
| `is_active` | boolean | YES | true |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `crash_structure`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `front_crumple_zone` | text | YES |  | Front crumple zone description, e.g. factory_engineered, reinforced, none_pre_regulation. |
| `rear_crumple_zone` | text | YES |  | Rear crumple zone description. |
| `door_beam_type` | text | YES |  | Door beam type, e.g. side_impact_bar, tubular, stamped, none. |
| `door_beam_count_per_door` | integer | YES |  | Number of beams per door. |
| `b_pillar_reinforced` | boolean | YES |  | True if B-pillar has reinforcement. |
| `a_pillar_reinforced` | boolean | YES |  | True if A-pillar has reinforcement. |
| `roof_reinforced` | boolean | YES |  | True if roof has added reinforcement. |
| `bumper_reinforcement_front` | text | YES |  | Front bumper reinforcement description, e.g. impact_bar, energy_absorber, chrome_bumper_bracket. |
| `bumper_reinforcement_rear` | text | YES |  | Rear bumper reinforcement description. |
| `side_impact_bars` | boolean | YES | false | True if side impact protection bars are present. |
| `subframe_type` | text | YES |  | Chassis type: full_frame, unibody, body_on_frame, subframe_front, subframe_rear, space_frame, other. |
| `subframe_condition` | text | YES |  | Subframe/frame condition, e.g. solid, surface_rust, scale_rust, repaired, compromised. |
| `subframe_connectors_installed` | boolean | YES | false | True if aftermarket subframe connectors are installed (unibody vehicles). |
| `subframe_connector_type` | text | YES |  | Connector type, e.g. weld_in, bolt_in. |
| `front_bumper_type` | text | YES |  | Front bumper type, e.g. chrome, urethane, body_color, tube. |
| `rear_bumper_type` | text | YES |  | Rear bumper type. |
| `bumper_material` | text | YES |  | Primary bumper material, e.g. chrome_steel, aluminum, urethane, composite. |
| `accident_history_yn` | boolean | YES | false | True if vehicle has known accident history. |
| `accident_history_notes` | text | YES |  | Description of accident history if known. |
| `frame_straightened` | boolean | YES | false | True if frame/unibody has been straightened. |
| `structural_repair_notes` | text | YES |  | Description of any structural repairs performed. |
| `is_original` | boolean | YES | true | True if factory-original crash structure. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. minor surface rust on frame rails. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `credential_access_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `credential_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `action` | text | NO |  |  Values: `created`, `validated`, `refreshed`, `decrypted`, `bid_placed`, `2fa_requested` ... (9 total) |
| `platform` | text | YES |  |  |
| `ip_address` | inet | YES |  |  |
| `user_agent` | text | YES |  |  |
| `executor_instance` | text | YES |  |  |
| `success` | boolean | NO |  |  |
| `error_message` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `curated_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_name` | text | NO |  |  |
| `source_url` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `priority` | integer | YES | 5 |  |
| `is_active` | boolean | YES | true |  |
| `extraction_config` | jsonb | YES | '{}' |  |
| `auth_required` | boolean | YES | false |  |
| `auth_config` | jsonb | YES | '{}' |  |
| `expected_daily_vehicles` | integer | YES | 0 |  |
| `curation_notes` | text | YES |  |  |
| `curator_user_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `custom_investment_contracts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `contract_name` | text | NO |  |  |
| `contract_symbol` | text | NO |  |  |
| `contract_description` | text | YES |  |  |
| `contract_type` | text | YES | 'etf' |  Values: `etf`, `bond_fund`, `equity_fund`, `hybrid`, `project_fund`, `organization_fund` ... (9 total) |
| `curator_id` | uuid | NO |  |  |
| `manager_id` | uuid | YES |  |  |
| `curator_name` | text | YES |  |  |
| `curator_bio` | text | YES |  |  |
| `curator_credentials` | jsonb | YES | '[]' |  |
| `legal_entity_type` | text | YES | 'limited_partnership' |  Values: `limited_partnership`, `llc`, `trust`, `corporation`, `spv`, `other` |
| `legal_entity_name` | text | YES |  |  |
| `jurisdiction` | text | YES | 'Delaware, USA' |  |
| `regulatory_status` | text | YES | 'private_placement' |  Values: `private_placement`, `reg_d`, `reg_a`, `reg_cf`, `public`, `other` |
| `minimum_investment_cents` | bigint | YES | 10000 |  |
| `maximum_investment_cents` | bigint | YES |  |  |
| `share_structure` | text | YES | 'shares' |  Values: `shares`, `units`, `tokens`, `stakes` |
| `total_shares_authorized` | bigint | YES |  |  |
| `initial_share_price_cents` | bigint | YES |  |  |
| `current_nav_cents` | bigint | YES | 0 |  |
| `management_fee_pct` | numeric | YES | 0.10 |  |
| `performance_fee_pct` | numeric | YES | 0.00 |  |
| `performance_fee_hurdle_pct` | numeric | YES | 0.00 |  |
| `transaction_fee_pct` | numeric | YES | 0.05 |  |
| `setup_fee_cents` | bigint | YES | 0 |  |
| `early_exit_fee_pct` | numeric | YES | 0.00 |  |
| `liquidity_type` | text | YES | 'daily' |  Values: `daily`, `weekly`, `monthly`, `quarterly`, `annually`, `lockup_period`, `at_maturity`, `illiquid` |
| `lockup_period_days` | integer | YES |  |  |
| `redemption_frequency` | text | YES | 'daily' |  |
| `redemption_notice_days` | integer | YES | 0 |  |
| `investment_strategy` | text | YES |  |  |
| `target_returns_pct` | numeric | YES |  |  |
| `risk_level` | text | YES | 'moderate' |  Values: `conservative`, `moderate`, `aggressive`, `speculative` |
| `diversification_rules` | jsonb | YES | '{}' |  |
| `rebalancing_frequency` | text | YES | 'quarterly' |  |
| `transparency_level` | text | YES | 'full' |  Values: `full`, `partial`, `minimal` |
| `reporting_frequency` | text | YES | 'monthly' |  |
| `audit_required` | boolean | YES | false |  |
| `custodian_name` | text | YES |  |  |
| `status` | text | YES | 'draft' |  Values: `draft`, `pending_review`, `approved`, `active`, `closed`, `liquidating` ... (9 total) |
| `approval_required` | boolean | YES | false |  |
| `approved_by` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `launch_date` | timestamp with time zone | YES |  |  |
| `inception_date` | timestamp with time zone | YES |  |  |
| `closing_date` | timestamp with time zone | YES |  |  |
| `liquidation_date` | timestamp with time zone | YES |  |  |
| `total_assets_under_management_cents` | bigint | YES | 0 |  |
| `total_investors` | integer | YES | 0 |  |
| `total_return_pct` | numeric | YES | 0 |  |
| `annualized_return_pct` | numeric | YES | 0 |  |
| `prospectus_url` | text | YES |  |  |
| `legal_documents` | jsonb | YES | '[]' |  |
| `marketing_materials` | jsonb | YES | '[]' |  |
| `tags` | ARRAY | YES | '{}'[] |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `published_at` | timestamp with time zone | YES |  |  |

### `cv_joints_or_u_joints`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `location` | text | NO |  | Joint location in the driveline. See CHECK constraint for valid values. Values: `front_driveshaft_front`, `front_driveshaft_rear`, `rear_driveshaft_front`, `rear_driveshaft_rear`, `center_carrier`, `front_axle_inner_left` ... (14 total) |
| `joint_type` | text | NO |  | Joint type: u_joint, rzeppa_cv, birfield_cv, tripod_cv, double_cardan, plunging_cv, other. Values: `u_joint`, `rzeppa_cv`, `birfield_cv`, `tripod_cv`, `double_cardan`, `plunging_cv`, `other` |
| `series` | text | YES |  | U-joint series, e.g. 1310, 1330, 1350. NULL for CV joints. |
| `manufacturer` | text | YES |  | Joint manufacturer, e.g. Spicer, Moog, GKN, factory. |
| `part_number` | text | YES |  | Joint part number. |
| `cap_diameter_mm` | numeric | YES |  | U-joint bearing cap diameter in mm. |
| `snap_ring_type` | text | YES |  | Snap ring/clip type, e.g. external, internal, injected_nylon. |
| `grease_type` | text | YES |  | Required grease type, e.g. moly, nlgi2, cv_joint_grease. |
| `grease_fitting` | boolean | YES | false | True if joint has a grease zerk fitting. |
| `boot_type` | text | YES |  | CV boot type, e.g. standard, heavy_duty, split. NULL for U-joints. |
| `boot_material` | text | YES |  | Boot material, e.g. rubber, thermoplastic, silicone. |
| `boot_clamp_type` | text | YES |  | Boot clamp type, e.g. crimp, ear_type, worm_gear. |
| `max_angle_degrees` | numeric | YES |  | Maximum operating angle in degrees. |
| `operating_angle_degrees` | numeric | YES |  | Current installed operating angle in degrees. |
| `plunge_length_mm` | numeric | YES |  | Available plunge/slide length in mm (CV joints). |
| `is_original` | boolean | YES | true | True if factory-installed joint. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. slight play detected. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `dash_assemblies`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `material` | text | YES |  | Primary dash surface material: hard_plastic, soft_vinyl, padded_vinyl, leather_wrapped, wood_veneer, carbon_fiber, fiberglass, other. |
| `color` | text | YES |  | Dash color as observed, e.g. black, tan, ivory. |
| `pad_type` | text | YES |  | Dashboard pad construction: hard, soft, foam, other. |
| `gauge_cluster_type` | text | YES |  | Instrument cluster type, e.g. factory_round, factory_rectangular, aftermarket, digital, custom. |
| `vent_style` | text | YES |  | A/C-heater vent style, e.g. round_louver, rectangular_louver, integrated, center_stack. |
| `crack_locations_jsonb` | jsonb | YES | '[]' | JSON array of crack location descriptions, e.g. ["top_center", "left_of_cluster"]. Empty array if no cracks. |
| `defroster_duct_condition` | text | YES |  | Defroster duct condition, e.g. intact, cracked, missing. |
| `glovebox_condition` | text | YES |  | Glovebox door/box condition: excellent, good, fair, poor, missing, unknown. |
| `ashtray_present` | boolean | YES |  | True if the factory ashtray is present. |
| `is_original` | boolean | YES | true | True if this is the factory dash for the vehicle. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `data_cleanup_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | nextval('data_cleanup_log_id_seq'::regclass) |  |
| `cleanup_type` | text | NO |  |  |
| `affected_rows` | integer | YES |  |  |
| `details` | jsonb | YES |  |  |
| `executed_at` | timestamp with time zone | YES | now() |  |

### `data_gaps`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `entity_type` | text | NO |  |  |
| `entity_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `field_priority` | text | NO |  |  Values: `critical`, `high`, `medium`, `low` |
| `gap_reason` | text | YES |  |  |
| `points_reward` | integer | YES | 10 |  |
| `is_filled` | boolean | YES | false |  |
| `filled_by` | uuid | YES |  |  |
| `filled_at` | timestamp with time zone | YES |  |  |
| `detected_at` | timestamp with time zone | YES | now() |  |

### `data_parsing_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `component_type` | text | NO |  |  Values: `model`, `trim`, `series`, `drivetrain`, `engine`, `transmission`, `body_style` |
| `pattern` | text | NO |  |  |
| `extract_group` | integer | YES | 1 |  |
| `replacement_value` | text | YES |  |  |
| `priority` | integer | YES | 100 |  |
| `example_input` | text | YES |  |  |
| `example_output` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `data_provider_trust`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `source_name` | text | YES |  |  |
| `provider_role` | text | NO |  |  |
| `base_trust_score` | numeric | NO | 0.50 |  |
| `adjusted_trust_score` | numeric | NO | 0.50 |  |
| `total_claims` | integer | NO | 0 |  |
| `verified_claims` | integer | NO | 0 |  |
| `disputed_claims` | integer | NO | 0 |  |
| `verification_rate` | numeric | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `specializations` | ARRAY | YES | '{}'[] |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `data_quality_pollution_report`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `polluted_trim_long` | bigint | YES |  |  |
| `polluted_trim_junk` | bigint | YES |  |  |
| `verbose_transmission` | bigint | YES |  |  |
| `word_number_transmission` | bigint | YES |  |  |
| `verbose_interior_color` | bigint | YES |  |  |
| `html_interior_color` | bigint | YES |  |  |
| `polluted_model` | bigint | YES |  |  |
| `model_too_long` | bigint | YES |  |  |
| `non_canonical_body_style` | bigint | YES |  |  |
| `trim_has_auction_meta` | bigint | YES |  |  |
| `total_active` | bigint | YES |  |  |

### `data_source_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_name` | text | NO |  |  |
| `source_url` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `authority_level` | integer | YES | 5 |  |
| `reliability_score` | numeric | YES | 0.7 |  |
| `has_parts_catalog` | boolean | YES | false |  |
| `has_pricing` | boolean | YES | false |  |
| `has_technical_docs` | boolean | YES | false |  |
| `has_visual_references` | boolean | YES | false |  |
| `crawl_strategy` | text | YES |  |  |
| `requires_auth` | boolean | YES | false |  |
| `rate_limit_per_hour` | integer | YES |  |  |
| `makes_covered` | ARRAY | YES |  |  |
| `years_covered` | int4range | YES |  |  |
| `specialization` | text | YES |  |  |
| `last_indexed` | timestamp with time zone | YES |  |  |
| `indexed_page_count` | integer | YES | 0 |  |
| `index_completeness` | integer | YES | 0 |  |
| `api_endpoint` | text | YES |  |  |
| `api_key_required` | boolean | YES | false |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `data_source_trust_hierarchy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `source_type` | text | NO |  |  |
| `trust_level` | integer | NO |  |  |
| `override_rules` | ARRAY | YES |  |  |
| `description` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `data_truth_audit_report`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_identity` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `has_vin_decode` | text | YES |  |  |
| `vin_decode_confidence` | numeric | YES |  |  |
| `field_analysis` | jsonb | YES |  |  |
| `completeness_pct` | integer | YES |  |  |
| `source_trail` | jsonb | YES |  |  |
| `anomalies` | jsonb | YES |  |  |
| `evidence_count` | bigint | YES |  |  |
| `fields_with_evidence` | bigint | YES |  |  |
| `conflicts_detected` | bigint | YES |  |  |

### `data_truth_priority_fixes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_identity` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `priority` | integer | YES |  |  |
| `issue_type` | text | YES |  |  |
| `field_analysis` | jsonb | YES |  |  |
| `anomalies` | jsonb | YES |  |  |
| `recommended_action` | text | YES |  |  |
| `auto_fixable` | boolean | YES |  |  |

### `data_validation_consensus`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `entity_type` | text | YES |  |  |
| `entity_id` | uuid | YES |  |  |
| `field_name` | text | YES |  |  |
| `field_value` | text | YES |  |  |
| `source_count` | bigint | YES |  |  |
| `validator_count` | bigint | YES |  |  |
| `avg_confidence` | numeric | YES |  |  |
| `max_confidence` | integer | YES |  |  |
| `sources` | ARRAY | YES |  |  |
| `last_validated_at` | timestamp with time zone | YES |  |  |

### `data_validation_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `rule_name` | text | NO |  |  |
| `rule_type` | text | NO |  |  Values: `price`, `mileage`, `year`, `make`, `model`, `vin` |
| `min_value` | numeric | YES |  |  |
| `max_value` | numeric | YES |  |  |
| `pattern` | text | YES |  |  |
| `error_level` | text | YES | 'warning' |  Values: `info`, `warning`, `error`, `critical` |
| `error_message` | text | NO |  |  |
| `auto_fix_action` | text | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `deal_jackets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `stock_number` | text | YES |  |  |
| `deal_type` | text | YES |  |  |
| `acquired_from_id` | uuid | YES |  |  |
| `acquisition_date` | date | YES |  |  |
| `initial_cost` | numeric | YES |  |  |
| `flooring_cost` | numeric | YES |  |  |
| `shipping_cost_in` | numeric | YES |  |  |
| `total_initial_cost` | numeric | YES |  |  |
| `sold_to_id` | uuid | YES |  |  |
| `sold_date` | date | YES |  |  |
| `sale_price_inc_doc` | numeric | YES |  |  |
| `shipping_price` | numeric | YES |  |  |
| `total_selling_price` | numeric | YES |  |  |
| `document_fee` | numeric | YES |  |  |
| `title_fee` | numeric | YES |  |  |
| `permit_fee` | numeric | YES |  |  |
| `sales_tax` | numeric | YES |  |  |
| `service_contract` | numeric | YES |  |  |
| `acv_listing_credit` | numeric | YES |  |  |
| `detail_credit` | numeric | YES |  |  |
| `trade_in_allowance` | numeric | YES |  |  |
| `consignment_rate` | numeric | YES |  |  |
| `listing_fee` | numeric | YES |  |  |
| `feature_ad_fee` | numeric | YES |  |  |
| `net_auction_proceeds` | numeric | YES |  |  |
| `reconditioning_total` | numeric | YES |  |  |
| `total_cost` | numeric | YES |  |  |
| `gross_profit` | numeric | YES |  |  |
| `payment_method` | text | YES |  |  |
| `payment_amount` | numeric | YES |  |  |
| `payment_date` | date | YES |  |  |
| `deposit_amount` | numeric | YES |  |  |
| `deposit_date` | date | YES |  |  |
| `balance_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  |  |
| `visibility` | USER-DEFINED | NO | 'org'::intel_visibility |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `organization_id` | uuid | YES |  |  |

### `deal_ownership`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `owner_id` | uuid | YES |  |  |
| `ownership_type` | text | YES |  |  |
| `acquired_date` | date | YES |  |  |
| `disposed_date` | date | YES |  |  |
| `acquired_price` | numeric | YES |  |  |
| `disposed_price` | numeric | YES |  |  |
| `source_document` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `deal_vehicle_details`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `stock_number` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `style` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `color` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `odometer` | integer | YES |  |  |
| `odometer_notes` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `body_number` | text | YES |  |  |
| `msrp` | numeric | YES |  |  |
| `history` | text | YES |  |  |
| `condition_ratings` | jsonb | YES |  |  |
| `options` | jsonb | YES |  |  |
| `profile_image_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `organization_id` | uuid | YES |  |  |

### `dealer_sales_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `organization_id` | uuid | YES |  |  |
| `sold_last_30_days` | bigint | YES |  |  |
| `sold_last_90_days` | bigint | YES |  |  |
| `total_sold` | bigint | YES |  |  |
| `revenue_last_30_days` | numeric | YES |  |  |
| `profit_last_30_days` | numeric | YES |  |  |
| `avg_days_to_sell` | numeric | YES |  |  |
| `current_inventory_count` | bigint | YES |  |  |
| `inventory_investment` | numeric | YES |  |  |

### `dealer_site_schemas`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `domain` | text | NO |  |  |
| `site_name` | text | YES |  |  |
| `site_type` | text | YES |  |  Values: `directory`, `dealer_website`, `auction_house`, `marketplace` |
| `schema_data` | jsonb | NO | '{}' | JSONB structure mapping field locations and extraction patterns |
| `cataloged_at` | timestamp with time zone | YES | now() |  |
| `last_verified_at` | timestamp with time zone | YES |  |  |
| `is_valid` | boolean | YES | true |  |
| `extraction_confidence` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `cataloged_by` | text | YES | 'system' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `dealer_vehicle_specs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year` | integer | NO |  |  |
| `trim` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `horsepower` | integer | YES |  |  |
| `torque` | integer | YES |  |  |
| `transmission` | text | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `mpg_city` | integer | YES |  |  |
| `mpg_highway` | integer | YES |  |  |
| `mpg_combined` | integer | YES |  |  |
| `fuel_capacity_gallons` | numeric | YES |  |  |
| `weight_lbs` | integer | YES |  |  |
| `length_inches` | numeric | YES |  |  |
| `width_inches` | numeric | YES |  |  |
| `height_inches` | numeric | YES |  |  |
| `wheelbase_inches` | numeric | YES |  |  |
| `ground_clearance_inches` | numeric | YES |  |  |
| `seating_capacity` | integer | YES |  |  |
| `doors` | integer | YES |  |  |
| `cargo_volume_cubic_feet` | numeric | YES |  |  |
| `towing_capacity_lbs` | integer | YES |  |  |
| `payload_capacity_lbs` | integer | YES |  |  |
| `msrp` | integer | YES |  |  |
| `invoice_price` | integer | YES |  |  |
| `source` | text | YES |  |  |
| `source_date` | date | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `debug_agent_messages`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `from_agent_id` | uuid | YES |  |  |
| `to_agent_id` | uuid | YES |  |  |
| `finding_id` | uuid | YES |  |  |
| `message_type` | text | NO |  |  |
| `content` | text | NO |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `read_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `debug_agent_sessions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `agent_id` | uuid | YES |  |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `status` | text | YES | 'running' |  Values: `running`, `completed`, `failed` |
| `findings_processed` | integer | YES | 0 |  |
| `actions_taken` | integer | YES | 0 |  |
| `summary` | text | YES |  |  |
| `execution_log` | jsonb | YES | '[]' |  |
| `metadata` | jsonb | YES | '{}' |  |

### `debug_agents`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `role` | text | NO |  |  |
| `description` | text | YES |  |  |
| `capabilities` | jsonb | YES | '[]' |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `debug_fix_attempts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `investigation_id` | uuid | YES |  |  |
| `finding_id` | uuid | YES |  |  |
| `agent_session_id` | uuid | YES |  |  |
| `fix_type` | text | YES |  |  Values: `code_change`, `config_change`, `documentation`, `escalate_human` |
| `files_changed` | jsonb | YES | '[]' |  |
| `pr_url` | text | YES |  |  |
| `pr_number` | integer | YES |  |  |
| `branch_name` | text | YES |  |  |
| `verification_status` | text | YES | 'pending' |  Values: `pending`, `passed`, `failed`, `skipped` |
| `verification_notes` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `applied`, `rejected`, `merged`, `reverted` |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `debug_investigations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `finding_id` | uuid | YES |  |  |
| `agent_session_id` | uuid | YES |  |  |
| `root_cause_analysis` | text | YES |  |  |
| `affected_files` | jsonb | YES | '[]' |  |
| `related_code` | jsonb | YES | '[]' |  |
| `hypothesis` | text | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `suggested_fix` | text | YES |  |  |
| `fix_complexity` | text | YES |  |  Values: `trivial`, `simple`, `moderate`, `complex`, `architectural` |
| `estimated_effort` | text | YES |  |  |
| `similar_findings` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `department_presets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_type` | text | NO |  |  |
| `department_type` | text | NO |  |  |
| `department_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `typical_roles` | ARRAY | YES | '{}'[] |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `is_recommended` | boolean | YES | true |  |
| `preset_name` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |

### `differentials`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `axle_position` | text | NO |  | Which differential: front, rear, or center. Values: `front`, `rear`, `center` |
| `carrier_type` | text | YES |  | Carrier type: drop_in, nodular_iron, aluminum, billet, other. |
| `carrier_breaks` | text | YES |  | Carrier break point, e.g. 3.73_and_down for GM 12-bolt. |
| `gear_type` | text | YES |  | Ring and pinion gear type: hypoid, spiral_bevel, straight_bevel, worm, other. |
| `ring_gear_bolt_count` | integer | YES |  | Number of ring gear bolts. |
| `ring_gear_bolt_size` | text | YES |  | Ring gear bolt size, e.g. 7/16-20, 3/8-24. |
| `pinion_spline_count` | integer | YES |  | Pinion shaft spline count. |
| `pinion_depth_mm` | numeric | YES |  | Measured pinion depth in mm from centerline. |
| `backlash_mm` | numeric | YES |  | Measured ring gear backlash in mm. |
| `backlash_spec_mm` | text | YES |  | Factory backlash specification range, e.g. 0.15-0.20. |
| `pattern_contact` | text | YES |  | Gear contact pattern description, e.g. centered, heel_heavy, toe_heavy. |
| `carrier_bearing_preload` | text | YES |  | Carrier bearing preload specification. |
| `pinion_bearing_preload` | text | YES |  | Pinion bearing preload specification. |
| `crush_sleeve_part_number` | text | YES |  | Crush sleeve part number if applicable. |
| `shim_pack_thickness_mm` | numeric | YES |  | Total shim pack thickness in mm for pinion depth. |
| `pinion_nut_torque_lb_ft` | integer | YES |  | Pinion nut torque specification in lb-ft. |
| `ring_gear_torque_lb_ft` | integer | YES |  | Ring gear bolt torque specification in lb-ft. |
| `setup_bearing_used` | boolean | YES | false | True if setup was performed with dedicated setup bearings. |
| `gear_set_manufacturer` | text | YES |  | Ring and pinion manufacturer, e.g. factory, Motive, Yukon, US Gear, Richmond. |
| `gear_set_part_number` | text | YES |  | Ring and pinion gear set part number. |
| `is_original` | boolean | YES | true | True if factory-installed differential setup. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. gear whine at decel. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `discovered_persons`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | YES |  |  |
| `full_name` | text | NO |  |  |
| `bio` | text | YES |  |  |
| `avatar_url` | text | YES |  |  |
| `primary_role` | text | YES |  |  |
| `primary_organization_id` | uuid | YES |  |  |
| `email` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `location` | text | YES |  |  |
| `social_links` | jsonb | YES | '{}' |  |
| `known_for` | ARRAY | YES |  |  |
| `expertise_areas` | ARRAY | YES |  |  |
| `enrichment_status` | text | YES | 'stub' |  |
| `enrichment_sources` | ARRAY | YES |  |  |
| `last_enriched_at` | timestamp with time zone | YES |  |  |
| `confidence_score` | numeric | YES | 0.50 |  |
| `claimed_by_profile_id` | uuid | YES |  |  |
| `claimed_at` | timestamp with time zone | YES |  |  |
| `search_vector` | tsvector | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `discovered_vehicles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `discovery_source` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `is_active` | boolean | YES | true |  |
| `discovery_context` | text | YES |  |  |
| `interest_level` | text | YES |  |  Values: `casual`, `moderate`, `high`, `urgent` |
| `notes` | text | YES |  |  |
| `relationship_type` | text | YES | 'interested' | Type of relationship: interested, discovered, curated, consigned, previously_owned, or contributing Values: `interested`, `discovered`, `curated`, `consigned`, `previously_owned` |

### `document_extractions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `document_id` | uuid | NO |  |  |
| `extracted_data` | jsonb | NO |  |  |
| `validation_questions` | jsonb | YES |  |  |
| `user_corrections` | jsonb | YES |  |  |
| `status` | text | YES | 'pending_review' |  |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `applied_to_specs` | boolean | YES | false |  |
| `applied_at` | timestamp with time zone | YES |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `documents`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `entity_type` | text | NO |  | Type of entity this document belongs to (vehicle, organization, user, timeline_event) Values: `vehicle`, `organization`, `user`, `timeline_event` |
| `entity_id` | uuid | NO |  | ID of the parent entity (vehicle_id, org_id, user_id, or event_id) |
| `document_category` | text | NO |  |  Values: `receipt`, `invoice`, `title`, `registration`, `insurance`, `manual` ... (15 total) |
| `file_url` | text | NO |  |  |
| `file_name` | text | YES |  |  |
| `file_size` | integer | YES |  |  |
| `mime_type` | text | YES |  |  |
| `storage_bucket` | text | YES | 'vehicle-documents' |  |
| `storage_path` | text | YES |  |  |
| `ai_processing_status` | text | YES | 'pending' |  Values: `pending`, `processing`, `completed`, `failed` |
| `ai_extracted_data` | jsonb | YES | '{}' | Flexible JSONB storage for AI-extracted data (receipt line items, title info, invoice data, etc) |
| `ai_extraction_confidence` | numeric | YES |  |  |
| `ai_processing_error` | text | YES |  |  |
| `ai_processing_started_at` | timestamp with time zone | YES |  |  |
| `ai_processing_completed_at` | timestamp with time zone | YES |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `uploaded_by` | uuid | YES |  |  |
| `is_sensitive` | boolean | YES | false |  |
| `is_public` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `door_panels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `position` | text | NO |  | Door position: front_left, front_right, rear_left, rear_right, liftgate, tailgate. |
| `material` | text | YES |  | Panel surface material: hard_plastic, vinyl, cloth, leather, cardboard_backed, fiberglass, other. |
| `color` | text | YES |  | Panel color as observed. |
| `window_crank_or_switch` | text | YES |  | Window operation: manual_crank, power_switch, none, other. |
| `armrest_type` | text | YES |  | Armrest style: integrated (molded into panel), separate_padded, pull_strap, none, other. |
| `speaker_location` | text | YES |  | Speaker mounting location on panel, e.g. lower_front, upper_corner, none. |
| `map_pocket` | boolean | YES | false | True if panel has a map/storage pocket. |
| `reflector` | boolean | YES | false | True if door edge reflector is present. |
| `courtesy_light` | boolean | YES | false | True if panel has a courtesy/door-ajar light. |
| `armrest_condition` | text | YES |  | Armrest surface condition: excellent, good, fair, poor, missing, unknown. |
| `is_original` | boolean | YES | true | True if factory-original door panel. |
| `condition_grade` | text | YES | 'unknown' | Overall panel condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `driveshafts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `position` | text | NO |  | Position: front, rear, center, front_half, rear_half. |
| `length_inches` | numeric | YES |  | Overall driveshaft length in inches. |
| `tube_diameter_inches` | numeric | YES |  | Driveshaft tube outer diameter in inches. |
| `tube_wall_thickness_inches` | numeric | YES |  | Tube wall thickness in inches. |
| `tube_material` | text | YES |  | Tube material: steel, aluminum, carbon_fiber, chromoly, other. |
| `u_joint_series` | text | YES |  | U-joint series, e.g. 1310, 1330, 1350, 1410. |
| `u_joint_type` | text | YES |  | U-joint type, e.g. external_snap_ring, internal_clip, u_bolt, strap. |
| `slip_yoke_spline_count` | integer | YES |  | Slip yoke spline count for transmission/transfer case end. |
| `slip_yoke_type` | text | YES |  | Slip yoke type, e.g. internal, external. |
| `flange_yoke_bolt_count` | integer | YES |  | Flange yoke bolt count for pinion/output flange end. |
| `flange_yoke_bolt_circle_mm` | numeric | YES |  | Flange yoke bolt circle diameter in mm. |
| `carrier_bearing_equipped` | boolean | YES | false | True if two-piece shaft with carrier bearing. |
| `carrier_bearing_part_number` | text | YES |  | Carrier/center support bearing part number. |
| `cv_joint_equipped` | boolean | YES | false | True if driveshaft uses CV joint instead of U-joint. |
| `balance_weight_count` | integer | YES |  | Number of balance weights welded to tube. |
| `critical_speed_rpm` | integer | YES |  | Calculated critical speed in RPM for shaft whip. |
| `phasing_degrees` | numeric | YES |  | U-joint phasing angle in degrees. |
| `part_number` | text | YES |  | Driveshaft assembly part number. |
| `manufacturer` | text | YES |  | Driveshaft manufacturer, e.g. factory, Tom Wood, Inland Empire. |
| `is_original` | boolean | YES | true | True if factory-installed driveshaft. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. vibration at 65mph. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `ds_cost_tracking`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `date` | date | NO | CURRENT_DATE |  |
| `provider` | text | NO |  |  |
| `model` | text | NO |  |  |
| `total_extractions` | integer | YES | 0 |  |
| `total_cost_usd` | real | YES | 0 |  |
| `total_tokens_input` | integer | YES | 0 |  |
| `total_tokens_output` | integer | YES | 0 |  |
| `total_revenue_usd` | real | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ds_credit_transactions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `amount` | integer | NO |  |  |
| `transaction_type` | text | NO |  |  Values: `free_grant`, `purchase`, `extraction`, `refund`, `admin_adjustment` |
| `stripe_session_id` | text | YES |  |  |
| `stripe_payment_intent` | text | YES |  |  |
| `description` | text | YES |  |  |
| `balance_after` | integer | NO |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ds_deals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `deal_name` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `processing`, `review`, `completed`, `archived` |
| `merged_data` | jsonb | YES | '{}' |  |
| `vin` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `owner_name` | text | YES |  |  |
| `deal_date` | date | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `total_pages` | integer | YES | 0 |  |
| `pages_extracted` | integer | YES | 0 |  |
| `pages_needing_review` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ds_document_pages`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `deal_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `storage_path` | text | NO |  |  |
| `original_filename` | text | YES |  |  |
| `file_size_bytes` | integer | YES |  |  |
| `mime_type` | text | YES | 'image/jpeg' |  |
| `page_number` | integer | YES | 1 |  |
| `document_type` | text | YES |  |  |
| `document_type_confidence` | real | YES | 0 |  |
| `extracted_data` | jsonb | YES | '{}' |  |
| `confidences` | jsonb | YES | '{}' |  |
| `raw_ocr_text` | text | YES |  |  |
| `extraction_provider` | text | YES |  |  |
| `extraction_model` | text | YES |  |  |
| `extraction_cost_usd` | real | YES |  |  |
| `extraction_duration_ms` | integer | YES |  |  |
| `needs_review` | boolean | YES | false |  |
| `review_status` | text | YES | 'pending' |  Values: `pending`, `auto_accepted`, `user_reviewed`, `user_rejected` |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `user_edits` | jsonb | YES | '{}' |  |
| `uploaded_at` | timestamp with time zone | YES | now() |  |
| `extracted_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `ds_users`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO |  |  |
| `display_name` | text | YES |  |  |
| `company_name` | text | YES |  |  |
| `free_extractions_used` | integer | NO | 0 |  |
| `free_extractions_limit` | integer | NO | 100 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `duplicate_notifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `proposal_id` | uuid | NO |  |  |
| `title` | text | NO |  |  |
| `message` | text | NO |  |  |
| `status` | text | NO | 'unread' |  Values: `unread`, `read`, `acted` |
| `action_taken` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `read_at` | timestamp with time zone | YES |  |  |
| `acted_at` | timestamp with time zone | YES |  |  |

### `emissions_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `egr_equipped` | boolean | YES | false | True if EGR system is installed. |
| `egr_type` | text | YES |  | EGR valve type: ported_vacuum, backpressure, electronic, integral, none, other. |
| `egr_condition` | text | YES |  | EGR system condition description, e.g. functional, stuck_open, stuck_closed, removed. |
| `egr_delete` | boolean | YES | false | True if EGR system has been removed/disabled. |
| `egr_valve_part_number` | text | YES |  | EGR valve part number. |
| `air_injection_equipped` | boolean | YES | false | True if AIR (air injection reactor) system is installed. |
| `air_injection_type` | text | YES |  | Air injection type: belt_driven_pump, pulse_air, electric, none, other. |
| `air_injection_condition` | text | YES |  | Air injection condition description. |
| `air_injection_delete` | boolean | YES | false | True if air injection system has been removed. |
| `pcv_equipped` | boolean | YES | true | True if PCV system is installed (nearly all engines post-1963). |
| `pcv_type` | text | YES |  | PCV type: standard_valve, catch_can, road_draft_tube, breather_only, other. |
| `pcv_condition` | text | YES |  | PCV system condition description. |
| `pcv_valve_part_number` | text | YES |  | PCV valve part number. |
| `evap_equipped` | boolean | YES | false | True if evaporative emissions (EVAP) system is installed. |
| `evap_type` | text | YES |  | EVAP system type: canister_purge, fuel_tank_vent, sealed_cap, none, other. |
| `evap_condition` | text | YES |  | EVAP system condition description. |
| `charcoal_canister_yn` | boolean | YES | false | True if charcoal canister is present. |
| `charcoal_canister_condition` | text | YES |  | Charcoal canister condition, e.g. functional, saturated, cracked, missing. |
| `catalytic_equipped` | boolean | YES | false | True if catalytic converter(s) installed. See catalytic_converters table for details. |
| `catalytic_notes` | text | YES |  | Cross-reference notes for catalytic converter details. |
| `emissions_standard` | text | YES |  | Applicable emissions standard, e.g. pre_emissions, tier_1, carb, euro_4. |
| `emissions_state` | text | YES |  | State of registration for emissions compliance, e.g. CA, NY, federal. |
| `last_smog_check_date` | date | YES |  | Date of last smog/emissions test. |
| `last_smog_check_result` | text | YES |  | Last smog test result: pass, fail, exempt, waiver. |
| `is_original` | boolean | YES | true | True if factory-original emissions equipment. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `encryption_keys`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `key_name` | text | NO |  |  |
| `key_version` | integer | NO | 1 |  |
| `encrypted_key` | bytea | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `is_active` | boolean | YES | true |  |

### `engine_accessories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `accessory_type` | text | NO |  | Type: alternator, generator, starter, power_steering_pump, ac_compressor, smog_pump, etc. Values: `alternator`, `generator`, `starter`, `power_steering_pump`, `ac_compressor`, `smog_pump` ... (16 total) |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `model` | text | YES |  |  |
| `drive_type` | text | YES |  |  |
| `pulley_ratio` | numeric | YES |  |  |
| `bracket_type` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_blocks`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  | Foundry casting number stamped on the block, e.g. 3970010 for SBC. |
| `casting_date_code` | text | YES |  | Date code on the casting, e.g. K157 = Nov 15 1967. |
| `block_suffix` | text | YES |  | Assembly suffix code indicating application, e.g. DZ for 302. |
| `partial_vin` | text | YES |  | Partial VIN stamp on block pad for matching to vehicle. |
| `material` | text | YES |  | Block material: cast_iron, aluminum, billet_aluminum, other. |
| `cylinder_count` | integer | YES |  | Number of cylinders, 1-16. |
| `cylinder_configuration` | text | YES |  | Cylinder layout: inline, v, flat, w, rotary. |
| `bore_mm` | numeric | YES |  | Factory bore diameter in millimeters. |
| `stroke_mm` | numeric | YES |  | Factory stroke in millimeters. |
| `displacement_cc` | numeric | YES |  | Displacement in cubic centimeters. |
| `displacement_ci` | numeric | YES |  | Displacement in cubic inches. |
| `deck_height_mm` | numeric | YES |  | Block deck height in millimeters. |
| `main_bearing_count` | integer | YES |  | Number of main bearings. |
| `main_cap_material` | text | YES |  | Main cap material, e.g. cast_iron, steel, billet. |
| `oiling_system` | text | YES |  | Oiling system description, e.g. full_pressure, splash. |
| `factory_hp` | integer | YES |  | Factory rated horsepower. |
| `factory_torque_lb_ft` | integer | YES |  | Factory rated torque in lb-ft. |
| `factory_compression_ratio` | numeric | YES |  | Factory compression ratio, e.g. 10.50. |
| `factory_rpm_rating` | integer | YES |  | Factory rated RPM for peak HP. |
| `is_original` | boolean | YES | true | True if this is the factory-installed block for this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: manufacturer, part number, date acquired. |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_camshafts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `grind_number` | text | YES |  | Cam grind identification number. |
| `cam_type` | text | YES |  |  |
| `duration_intake_at_050` | integer | YES |  | Intake duration at 0.050 lift in degrees. |
| `duration_exhaust_at_050` | integer | YES |  |  |
| `duration_intake_advertised` | integer | YES |  |  |
| `duration_exhaust_advertised` | integer | YES |  |  |
| `lift_intake_mm` | numeric | YES |  |  |
| `lift_exhaust_mm` | numeric | YES |  |  |
| `lobe_separation_angle` | numeric | YES |  | LSA in degrees. Defines overlap characteristics. |
| `installed_centerline` | numeric | YES |  |  |
| `drive_type` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_carburetors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `list_number` | text | YES |  | Holley list number or equivalent carburetor identification. |
| `date_code` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `model` | text | YES |  |  |
| `cfm_rating` | integer | YES |  | Rated airflow in CFM. |
| `venturi_count` | integer | YES |  |  |
| `barrel_count` | integer | YES |  |  |
| `choke_type` | text | YES |  |  |
| `fuel_inlet` | text | YES |  |  |
| `metering_type` | text | YES |  |  |
| `secondary_type` | text | YES |  |  |
| `base_plate_type` | text | YES |  |  |
| `power_valve_rating` | numeric | YES |  |  |
| `primary_jet_size` | numeric | YES |  |  |
| `secondary_jet_size` | numeric | YES |  |  |
| `accelerator_pump_size` | text | YES |  |  |
| `float_level_mm` | numeric | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_connecting_rods`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `cylinder_number` | integer | NO |  | Cylinder number 1-12. |
| `casting_number` | text | YES |  |  |
| `forging_number` | text | YES |  |  |
| `material` | text | YES |  | Rod material: cast_iron, powdered_metal, forged_steel, billet_steel, billet_aluminum, titanium, other. |
| `center_to_center_mm` | numeric | YES |  | Center-to-center length in mm. |
| `big_end_diameter_mm` | numeric | YES |  |  |
| `small_end_diameter_mm` | numeric | YES |  |  |
| `weight_grams` | numeric | YES |  | Total rod weight in grams for balance matching. |
| `beam_type` | text | YES |  | Beam design, e.g. I-beam, H-beam. |
| `bolt_type` | text | YES |  |  |
| `is_matched_set` | boolean | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_cooling_interfaces`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `thermostat_temp_f` | integer | YES |  |  |
| `thermostat_type` | text | YES |  |  |
| `water_pump_type` | text | YES |  |  |
| `water_pump_part_number` | text | YES |  |  |
| `water_pump_manufacturer` | text | YES |  |  |
| `water_pump_flow_gpm` | numeric | YES |  |  |
| `bypass_type` | text | YES |  |  |
| `heater_core_port_size` | text | YES |  |  |
| `freeze_plug_material` | text | YES |  |  |
| `freeze_plug_count` | integer | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_crankshafts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  | FK to engine_blocks(id). Which block this crank is/was in. |
| `casting_number` | text | YES |  | Casting number if cast crank. |
| `forging_number` | text | YES |  | Forging number if forged crank. |
| `date_code` | text | YES |  |  |
| `material` | text | YES |  | Crank material: cast_iron, nodular_iron, forged_steel, billet_steel, other. |
| `journal_diameter_main_mm` | numeric | YES |  | Main bearing journal diameter in mm. |
| `journal_diameter_rod_mm` | numeric | YES |  | Rod bearing journal diameter in mm. |
| `stroke_mm` | numeric | YES |  | Stroke in mm. Should match block spec unless stroker. |
| `counterweight_count` | integer | YES |  |  |
| `balance_type` | text | YES |  | Balance type: internal, external, neutral. |
| `flange_type` | text | YES |  |  |
| `snout_length_mm` | numeric | YES |  |  |
| `rear_seal_type` | text | YES |  | Rear main seal type, e.g. two_piece_rope, one_piece_lip. |
| `nitride_treated` | boolean | YES |  | Whether journals are nitride-hardened. |
| `journal_finish_ra` | numeric | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_cylinder_measurements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  | FK to engine_blocks(id). Which block was measured. |
| `cylinder_number` | integer | NO |  | Cylinder number 1-12. Numbering per manufacturer convention. |
| `bore_diameter_mm` | numeric | YES |  | Measured bore diameter in mm to ten-thousandths. |
| `bore_taper_mm` | numeric | YES |  | Bore taper (top vs bottom difference) in mm. |
| `bore_out_of_round_mm` | numeric | YES |  | Out-of-round measurement in mm. |
| `bore_finish_ra` | numeric | YES |  | Surface finish roughness average (Ra) in microinches. |
| `ring_gap_top_mm` | numeric | YES |  | Top ring end gap in mm. |
| `ring_gap_second_mm` | numeric | YES |  | Second ring end gap in mm. |
| `ring_gap_oil_mm` | numeric | YES |  | Oil ring end gap in mm. |
| `compression_psi` | integer | YES |  | Cranking compression test result in PSI. |
| `leakdown_pct` | numeric | YES |  | Leakdown test percentage, 0-100. Lower is better. |
| `wall_thickness_mm` | numeric | YES |  | Cylinder wall thickness (sonic tested) in mm. |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `measured_at` | date | YES |  | Date the measurements were taken. |
| `measured_by_actor_id` | uuid | YES |  | FK to actors(id). Who performed the measurements. |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_distributors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `part_number` | text | YES |  |  |
| `date_code` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `distributor_type` | text | YES |  | Type: points, electronic, hei, msd, coil_on_plug, waste_spark, distributorless, other. |
| `advance_type` | text | YES |  |  |
| `initial_timing_degrees` | numeric | YES |  |  |
| `total_advance_degrees` | numeric | YES |  |  |
| `vacuum_advance` | boolean | YES |  |  |
| `coil_type` | text | YES |  |  |
| `cap_type` | text | YES |  |  |
| `rotor_type` | text | YES |  |  |
| `module_type` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_exhaust_manifolds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `bank` | text | YES |  |  |
| `casting_number` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `material` | text | YES |  |  |
| `manifold_type` | text | YES |  | Type: log, tubular, tri_y, four_into_one, shorty, long_tube, other. |
| `primary_tube_diameter_mm` | numeric | YES |  |  |
| `primary_tube_length_mm` | numeric | YES |  |  |
| `collector_diameter_mm` | numeric | YES |  |  |
| `collector_length_mm` | numeric | YES |  |  |
| `coating` | text | YES |  |  |
| `heat_riser` | boolean | YES |  |  |
| `o2_bung_count` | integer | YES | 0 |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_fuel_injection`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `system_type` | text | YES |  | FI type: tbi, mpfi, direct, mechanical, continuous, other. |
| `manufacturer` | text | YES |  |  |
| `model` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `ecu_part_number` | text | YES |  |  |
| `ecu_software_version` | text | YES |  |  |
| `injector_count` | integer | YES |  |  |
| `injector_size_cc` | numeric | YES |  |  |
| `fuel_pressure_psi` | numeric | YES |  |  |
| `fuel_rail_type` | text | YES |  |  |
| `throttle_body_size_mm` | numeric | YES |  |  |
| `maf_type` | text | YES |  |  |
| `map_sensor` | boolean | YES |  |  |
| `o2_sensor_count` | integer | YES |  |  |
| `wideband_o2` | boolean | YES |  |  |
| `idle_air_control` | text | YES |  |  |
| `knock_sensor` | boolean | YES |  |  |
| `coolant_temp_sensor` | boolean | YES |  |  |
| `intake_air_temp_sensor` | boolean | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_hardware`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `hardware_category` | text | NO |  | Category: fastener, gasket, seal, bearing, bushing, other. Values: `fastener`, `gasket`, `seal`, `bearing`, `bushing`, `other` |
| `hardware_type` | text | NO |  |  |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `material` | text | YES |  |  |
| `specification` | text | YES |  |  |
| `quantity` | integer | YES | 1 |  |
| `torque_spec_ft_lbs` | numeric | YES |  | Torque specification in ft-lbs if applicable. |
| `torque_spec_in_lbs` | numeric | YES |  |  |
| `torque_sequence` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_heads`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `bank` | text | YES |  | Which bank: left, right, single (inline), front/rear (flat). |
| `casting_number` | text | YES |  | Head casting number, e.g. 3991492 for early fuelie. |
| `casting_date_code` | text | YES |  |  |
| `material` | text | YES |  |  |
| `combustion_chamber_cc` | numeric | YES |  | Chamber volume in cc. Critical for compression ratio calculation. |
| `intake_port_cc` | numeric | YES |  | Intake port volume in cc. Indicator of flow potential. |
| `exhaust_port_cc` | numeric | YES |  |  |
| `intake_valve_diameter_mm` | numeric | YES |  |  |
| `exhaust_valve_diameter_mm` | numeric | YES |  |  |
| `valve_count_per_cylinder` | integer | YES |  |  |
| `valve_angle_degrees` | numeric | YES |  |  |
| `spring_type` | text | YES |  |  |
| `rocker_type` | text | YES |  |  |
| `rocker_ratio` | numeric | YES |  |  |
| `screw_in_studs` | boolean | YES |  |  |
| `guideplates` | boolean | YES |  |  |
| `hardened_seats` | boolean | YES |  |  |
| `ported` | boolean | YES | false |  |
| `port_type` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_intake_manifolds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `material` | text | YES |  |  |
| `manifold_type` | text | YES |  | Design: single_plane, dual_plane, tunnel_ram, ir_stack, log, cross_ram, other. |
| `runner_length_mm` | numeric | YES |  |  |
| `plenum_volume_cc` | numeric | YES |  |  |
| `throttle_bore_mm` | numeric | YES |  |  |
| `egr_provision` | boolean | YES |  |  |
| `heat_crossover` | boolean | YES |  |  |
| `port_matching` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_oil_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `oil_pump_type` | text | YES |  | Pump type: standard_volume, high_volume, high_pressure, high_volume_high_pressure, dry_sump, other. |
| `oil_pump_part_number` | text | YES |  |  |
| `oil_pump_manufacturer` | text | YES |  |  |
| `oil_pan_type` | text | YES |  |  |
| `oil_pan_capacity_quarts` | numeric | YES |  |  |
| `oil_filter_type` | text | YES |  |  |
| `oil_filter_part_number` | text | YES |  |  |
| `oil_cooler` | boolean | YES | false |  |
| `oil_cooler_type` | text | YES |  |  |
| `oil_accumulator` | boolean | YES | false |  |
| `oil_pressure_psi_idle` | numeric | YES |  |  |
| `oil_pressure_psi_cruise` | numeric | YES |  |  |
| `oil_temp_f_normal` | numeric | YES |  |  |
| `oil_type_recommended` | text | YES |  |  |
| `oil_weight_recommended` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `engine_pistons`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `engine_block_id` | uuid | YES |  |  |
| `cylinder_number` | integer | NO |  |  |
| `part_number` | text | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `material` | text | YES |  |  |
| `design_type` | text | YES |  |  |
| `dome_cc` | numeric | YES |  | Dome or dish volume in cc. Positive = dome, negative = dish. |
| `compression_distance_mm` | numeric | YES |  | Compression height (pin center to crown) in mm. |
| `skirt_diameter_mm` | numeric | YES |  |  |
| `weight_grams` | numeric | YES |  |  |
| `ring_count` | integer | YES |  |  |
| `pin_diameter_mm` | numeric | YES |  |  |
| `pin_offset_mm` | numeric | YES |  |  |
| `coating` | text | YES |  |  |
| `is_original` | boolean | YES | true |  |
| `condition_grade` | text | YES | 'unknown' |  Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  |  |
| `provenance` | text | YES | 'unknown' |  Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `enhanced_tag_context`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `tag_name` | text | YES |  |  |
| `tag_type` | character varying | YES |  |  |
| `confidence` | integer | YES |  |  |
| `source_type` | text | YES |  |  |
| `verified` | boolean | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `timeline_event_title` | text | YES |  |  |
| `event_date` | date | YES |  |  |
| `event_type` | text | YES |  |  |
| `labor_hours` | numeric | YES |  |  |
| `image_url` | text | YES |  |  |
| `taken_at` | timestamp with time zone | YES |  |  |
| `receipt_vendor` | text | YES |  |  |
| `receipt_amount` | numeric | YES |  |  |
| `tag_source` | text | YES |  |  |
| `work_session` | text | YES |  |  |
| `user_notes` | text | YES |  |  |
| `part_number` | text | YES |  |  |
| `brand` | text | YES |  |  |
| `category` | text | YES |  |  |
| `connected_receipt_id` | text | YES |  |  |

### `error_pattern_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `pattern_name` | text | NO |  |  |
| `pattern_description` | text | YES |  |  |
| `source_pattern` | text | YES |  |  |
| `extractor_pattern` | text | YES |  |  |
| `field_pattern` | text | YES |  |  |
| `error_code_pattern` | text | YES |  |  |
| `min_occurrences` | integer | YES | 5 |  |
| `time_window_hours` | integer | YES | 24 |  |
| `auto_heal_enabled` | boolean | YES | false |  |
| `healing_action` | text | YES |  |  Values: `retry_extraction`, `fallback_extractor`, `adjust_confidence`, `flag_for_review`, `invalidate_data`, `queue_for_backfill` ... (9 total) |
| `healing_priority` | integer | YES | 50 |  |
| `is_active` | boolean | YES | true |  |
| `last_matched_at` | timestamp with time zone | YES |  |  |
| `match_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `exhaust_pipes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `section` | text | NO |  | Pipe section: header_collector, y_pipe, h_pipe, x_pipe, cat_pipe, intermediate, over_axle, tailpipe. Values: `header_collector`, `y_pipe`, `h_pipe`, `x_pipe`, `cat_pipe`, `intermediate`, `over_axle`, `tailpipe` |
| `side` | text | YES |  | Which side: left, right, center, single (for single exhaust). |
| `diameter_inches` | numeric | YES |  | Pipe outer diameter in inches, e.g. 2.50. |
| `material` | text | YES |  | Pipe material: mild_steel, stainless, aluminized, titanium, other. |
| `wall_thickness_inches` | numeric | YES |  | Pipe wall thickness in inches. |
| `bend_type` | text | YES |  | How bends were formed: mandrel, crush, straight, other. |
| `length_inches` | numeric | YES |  | Section length in inches. |
| `manufacturer` | text | YES |  | Pipe or exhaust system manufacturer, e.g. Flowmaster, Magnaflow. |
| `part_number` | text | YES |  | Manufacturer part number for this section. |
| `coating` | text | YES |  | Applied coating, e.g. ceramic, high_temp_paint, raw. |
| `is_original` | boolean | YES | true | True if factory-installed exhaust pipe. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. surface rust at weld joints. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `exhaust_tips`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | YES |  | Which side: left, right, center, single. |
| `position` | text | YES |  | Tip exit position description, e.g. rear_bumper, side_exit, dumps. |
| `tip_type` | text | YES |  | Tip style: turn_down, rolled, angle_cut, dual_wall, slash_cut, intercooled, diffuser, stock, other. |
| `inlet_diameter_inches` | numeric | YES |  | Inlet diameter in inches (pipe it slides over). |
| `outlet_diameter_inches` | numeric | YES |  | Outlet (visible) diameter in inches. |
| `length_inches` | numeric | YES |  | Tip length in inches. |
| `material` | text | YES |  | Tip material: chrome, stainless, carbon_fiber, black, titanium, other. |
| `finish` | text | YES |  | Surface finish description, e.g. polished, brushed, powder_coated, burnt_blue. |
| `manufacturer` | text | YES |  | Tip manufacturer. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `tip_count` | integer | YES | 1 | Number of tips at this location (e.g. 2 for quad tips per side). |
| `is_original` | boolean | YES | true | True if factory-installed exhaust tip. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. pitting on chrome, discolored. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `expiring_licenses`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `license_id` | uuid | YES |  |  |
| `license_type` | text | YES |  |  |
| `license_number` | text | YES |  |  |
| `expiration_date` | date | YES |  |  |
| `shop_id` | uuid | YES |  |  |
| `shop_name` | character varying | YES |  |  |
| `owner_user_id` | uuid | YES |  |  |
| `location_name` | text | YES |  |  |
| `days_until_expiration` | integer | YES |  |  |

### `exterior_lighting_electrical`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `headlight_switch_type` | text | YES |  | Headlight switch design, e.g. push_pull_rheostat, rocker, stalk_auto. |
| `headlight_switch_location` | text | YES |  | Headlight switch location in interior, e.g. dash_left, column_stalk, instrument_panel. |
| `dimmer_location` | text | YES |  | High-beam dimmer location: floor, column, or stalk. |
| `high_beam_relay_yn` | boolean | YES |  | True if high-beam relay (for headlight upgrade) is installed. |
| `turn_signal_type` | text | YES |  | Turn signal mechanism: column_lever, dash_toggle, floor_switch, self_canceling, non_canceling. |
| `hazard_switch_location` | text | YES |  | Hazard flasher switch location, e.g. dash_center, column_button, steering_wheel. |
| `sequential_turn_yn` | boolean | YES |  | True if sequential turn signal operation (Thunderbird-style). |
| `dome_light_switch` | text | YES |  | Dome light switch type, e.g. door_jamb_only, dash_override, headlight_circuit. |
| `underhood_light_yn` | boolean | YES |  | True if engine compartment light is installed and functional. |
| `trunk_light_yn` | boolean | YES |  | True if trunk/cargo area light is installed and functional. |
| `courtesy_lights_jsonb` | jsonb | YES | '[]' | JSON array of courtesy light locations, e.g. [{"location":"front_footwell"},{"location":"rear_footwell"}]. |
| `map_lights_yn` | boolean | YES |  | True if map/reading lights are in the overhead console. |
| `reading_lights_yn` | boolean | YES |  | True if dedicated reading lights are present. |
| `backup_light_switch_type` | text | YES |  | Backup light switch activation, e.g. column_mounted, transmission_mounted, ecm_controlled. |
| `license_plate_light_yn` | boolean | YES |  | True if license plate illumination is present and functional. |
| `marker_lights_yn` | boolean | YES |  | True if side marker lights are present. |
| `fog_lights_yn` | boolean | YES |  | True if fog lights are installed. |
| `aux_lights_yn` | boolean | YES |  | True if auxiliary driving/spot lights are installed. |
| `is_original` | boolean | YES | true | True if factory-original lighting electrical configuration. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | System origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `extraction_attempts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `source_url` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `extractor_name` | text | NO |  |  |
| `extractor_version` | text | NO |  |  |
| `extractor_id` | uuid | YES |  |  |
| `status` | text | NO |  |  Values: `success`, `partial`, `failed` |
| `failure_code` | text | YES |  |  |
| `failure_reason` | text | YES |  |  |
| `failure_details` | jsonb | YES |  |  |
| `metrics` | jsonb | NO | '{}' |  |
| `extracted_data` | jsonb | YES |  |  |
| `validation_passed` | boolean | YES |  | Did extracted data meet acceptance criteria? |
| `validation_errors` | jsonb | YES |  |  |
| `snapshot_ref` | text | YES |  | Path to saved HTML - critical for proving correctness |
| `screenshot_ref` | text | YES |  |  |
| `snapshot_hash` | text | YES |  |  |
| `started_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `duration_ms` | integer | YES |  |  |
| `previous_attempt_id` | uuid | YES |  | Links repairs to original failed attempts |
| `repaired_by_attempt_id` | uuid | YES |  |  |
| `triggered_by` | text | YES | 'manual' |  |
| `user_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |

### `extraction_failures_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `failure_code` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `extractor_name` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `failure_count` | bigint | YES |  |  |
| `vehicles_affected` | bigint | YES |  |  |
| `last_failure` | timestamp with time zone | YES |  |  |
| `avg_duration_seconds` | numeric | YES |  |  |

### `extraction_metrics_24h`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `extractor_name` | text | YES |  |  |
| `source` | text | YES |  |  |
| `total_24h` | bigint | YES |  |  |
| `succeeded_24h` | bigint | YES |  |  |
| `failed_24h` | bigint | YES |  |  |
| `success_rate_pct` | numeric | YES |  |  |
| `avg_latency_ms` | numeric | YES |  |  |
| `p50_latency_ms` | numeric | YES |  |  |
| `p95_latency_ms` | numeric | YES |  |  |
| `last_run_at` | timestamp with time zone | YES |  |  |
| `error_breakdown` | jsonb | YES |  |  |

### `extraction_metrics_hourly`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `extractor_name` | text | YES |  |  |
| `source` | text | YES |  |  |
| `hour` | timestamp with time zone | YES |  |  |
| `total` | bigint | YES |  |  |
| `succeeded` | bigint | YES |  |  |
| `failed` | bigint | YES |  |  |
| `success_rate_pct` | numeric | YES |  |  |
| `avg_latency_ms` | numeric | YES |  |  |
| `p50_latency_ms` | numeric | YES |  |  |
| `p95_latency_ms` | numeric | YES |  |  |
| `error_breakdown` | jsonb | YES |  |  |

### `extraction_repair_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `source_url` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `failure_code` | text | YES |  |  |
| `failure_reason` | text | YES |  |  |
| `extractor_name` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `failed_at` | timestamp with time zone | YES |  |  |
| `hours_since_failure` | numeric | YES |  |  |
| `retry_count` | bigint | YES |  |  |

### `extractor_performance`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `name` | text | YES |  |  |
| `version` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `status` | text | YES |  |  |
| `total_attempts` | integer | YES |  |  |
| `success_count` | integer | YES |  |  |
| `failed_count` | integer | YES |  |  |
| `partial_count` | integer | YES |  |  |
| `success_rate` | numeric | YES |  |  |
| `health_status` | text | YES |  |  |
| `promoted_at` | timestamp with time zone | YES |  |  |
| `retired_at` | timestamp with time zone | YES |  |  |
| `attempts_last_24h` | bigint | YES |  |  |
| `success_last_24h` | bigint | YES |  |  |

### `extractor_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `version` | text | NO |  |  |
| `source_type` | text | NO |  |  |
| `status` | text | NO | 'active' | active=usable, preferred=recommended, deprecated=avoid, retired=never use Values: `active`, `preferred`, `deprecated`, `retired` |
| `total_attempts` | integer | YES | 0 |  |
| `success_count` | integer | YES | 0 |  |
| `failed_count` | integer | YES | 0 |  |
| `partial_count` | integer | YES | 0 |  |
| `success_rate` | numeric | YES |  | Auto-computed from success_count/total_attempts |
| `created_at` | timestamp with time zone | NO | now() |  |
| `promoted_at` | timestamp with time zone | YES |  |  |
| `deprecated_at` | timestamp with time zone | YES |  |  |
| `retired_at` | timestamp with time zone | YES |  |  |
| `description` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `config` | jsonb | YES | '{}' |  |
| `scrape_source_id` | uuid | YES |  | Links extractor to specific source from scrape_sources |
| `url_pattern` | text | YES |  | URL pattern this extractor handles (e.g., "bringatrailer.com") |
| `is_default` | boolean | YES | false | Default extractor when no specific one matches |

### `fb_listing_sightings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `listing_id` | uuid | NO |  |  |
| `sweep_job_id` | uuid | YES |  |  |
| `price_at_sighting` | numeric | YES |  |  |
| `seen_at` | timestamp with time zone | NO | now() |  |
| `source` | text | YES | 'sweep' |  |
| `submitted_by` | text | YES |  |  |

### `fb_sweep_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `locations_active` | bigint | YES |  |  |
| `locations_swept_24h` | bigint | YES |  |  |
| `total_listings` | bigint | YES |  |  |
| `active_listings` | bigint | YES |  |  |
| `sold_listings` | bigint | YES |  |  |
| `vintage_listings` | bigint | YES |  |  |
| `new_24h` | bigint | YES |  |  |
| `missing_count` | bigint | YES |  |  |
| `inferred_sold_count` | bigint | YES |  |  |
| `sweeps_running` | bigint | YES |  |  |
| `last_sweep_completed` | timestamp with time zone | YES |  |  |
| `system_health` | text | YES |  |  |

### `forensic_evidence_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_identity` | text | YES |  |  |
| `fields_with_evidence` | bigint | YES |  |  |
| `pending_evidence` | bigint | YES |  |  |
| `conflicted_evidence` | bigint | YES |  |  |
| `avg_confidence` | numeric | YES |  |  |
| `low_confidence_fields` | bigint | YES |  |  |

### `forensic_live_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `evidence_last_24h` | bigint | YES |  |  |
| `vehicles_updated_24h` | bigint | YES |  |  |
| `avg_confidence_24h` | numeric | YES |  |  |
| `total_evidence` | bigint | YES |  |  |
| `total_provenance` | bigint | YES |  |  |
| `total_vehicles` | bigint | YES |  |  |
| `high_confidence_fields` | bigint | YES |  |  |
| `critical_issues` | bigint | YES |  |  |
| `backfill_pending` | bigint | YES |  |  |
| `backfill_processing` | bigint | YES |  |  |

### `forum_extraction_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `name` | text | YES |  |  |
| `platform_type` | text | YES |  |  |
| `inspection_status` | text | YES |  |  |
| `estimated_build_count` | integer | YES |  |  |
| `discovered_threads` | bigint | YES |  |  |
| `extracted_threads` | bigint | YES |  |  |
| `queued_threads` | bigint | YES |  |  |
| `matched_vehicles` | bigint | YES |  |  |
| `total_posts_extracted` | bigint | YES |  |  |
| `total_images_extracted` | bigint | YES |  |  |
| `last_extraction` | timestamp with time zone | YES |  |  |

### `fractional_vehicle_platforms`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `business_name` | text | YES |  |  |
| `website` | text | YES |  |  |
| `country` | text | YES |  |  |
| `status` | text | YES |  |  |
| `service_type` | USER-DEFINED | YES |  |  |
| `platform_type` | text | YES |  |  |
| `min_investment_usd` | numeric | YES |  |  |
| `nuke_priority` | text | YES |  |  |
| `x_handle` | text | YES |  |  |
| `vehicle_focus` | text | YES |  |  |
| `funding_raised_usd` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |

### `front_axles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  | Housing casting number. |
| `part_number` | text | YES |  | Assembly part number. |
| `manufacturer` | text | YES |  | Axle manufacturer, e.g. Dana, GM Corporate, Ford, AAM. |
| `model` | text | YES |  | Axle model, e.g. Dana 44, Dana 60, GM 10-bolt, 8.25 IFS. |
| `date_code` | text | YES |  | Date code stamped on the housing. |
| `axle_type` | text | YES |  | Configuration: solid, ifs, ifs_cv, twin_traction_beam, dead_beam, other. |
| `ratio` | numeric | YES |  | Gear ratio, e.g. 3.730, 4.100. |
| `ring_gear_diameter_inches` | numeric | YES |  | Ring gear diameter in inches. |
| `spline_count` | integer | YES |  | Axle shaft spline count. |
| `locking_type` | text | YES |  | Differential locking: open, limited_slip, locking_manual, locking_auto, selectable, spool, other. |
| `locking_manufacturer` | text | YES |  | Locker/LSD manufacturer, e.g. ARB, Detroit, Eaton. |
| `locking_model` | text | YES |  | Locker/LSD model name. |
| `hub_type` | text | YES |  | Hub type: manual_locking, auto_locking, warn_premium, fixed, unit_bearing, other. |
| `hub_bolt_count` | integer | YES |  | Number of wheel studs/bolts per hub. |
| `hub_bolt_pattern` | text | YES |  | Bolt pattern, e.g. 6x5.5, 5x5. |
| `knuckle_type` | text | YES |  | Steering knuckle type: closed_knuckle, open_knuckle, kingpin, ball_joint, other. |
| `knuckle_material` | text | YES |  | Knuckle material, e.g. cast_iron, ductile_iron, forged_steel. |
| `kingpin_type` | text | YES |  | Kingpin type if applicable, e.g. closed_knuckle, open_knuckle. |
| `kingpin_size` | text | YES |  | Kingpin size/spec. |
| `axle_shaft_material` | text | YES |  | Axle shaft material, e.g. 1541h, 4340_chromoly, oem. |
| `axle_shaft_type` | text | YES |  | Axle shaft type, e.g. inner_outer, unit, birfield_cv. |
| `steering_stop_spec` | text | YES |  | Steering stop/lock specification. |
| `caster_degrees` | numeric | YES |  | Factory caster angle in degrees. |
| `camber_degrees` | numeric | YES |  | Factory camber angle in degrees. |
| `gross_axle_weight_rating_lbs` | integer | YES |  | GAWR in pounds. |
| `width_inches` | numeric | YES |  | Overall axle width in inches (flange to flange). |
| `is_original` | boolean | YES | true | True if factory-installed front axle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_control_arms`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `position` | text | NO |  | Arm position: upper or lower. |
| `material` | text | YES |  | Arm material: stamped_steel, cast_iron, forged_steel, tubular_steel, aluminum, chromoly, other. |
| `construction` | text | YES |  | Construction style, e.g. stamped, boxed, tubular, forged. |
| `bushing_type` | text | YES |  | Bushing style, e.g. press_in, bolt_through, bonded. |
| `bushing_material` | text | YES |  | Bushing material: rubber, polyurethane, delrin, spherical, other. |
| `ball_joint_type` | text | YES |  | Ball joint mounting: press_in, bolt_in, screw_in, riveted, other. |
| `ball_joint_manufacturer` | text | YES |  | Ball joint manufacturer, e.g. Moog, TRW, Spicer. |
| `ball_joint_part_number` | text | YES |  | Ball joint part number. |
| `shaft_type` | text | YES |  | Control arm shaft type, e.g. factory, offset_for_alignment. |
| `cross_shaft_part_number` | text | YES |  | Cross shaft or pivot bolt part number. |
| `part_number` | text | YES |  | Control arm assembly part number. |
| `manufacturer` | text | YES |  | Arm manufacturer. |
| `is_original` | boolean | YES | true | True if factory-installed control arm. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_dampers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `manufacturer` | text | YES |  | Damper manufacturer, e.g. Bilstein, Monroe, KYB, Koni. |
| `model` | text | YES |  | Model name, e.g. 5100 Series, Sensatrac, Sport. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `damper_type` | text | YES |  | Type: mono_tube, twin_tube, coilover, air, other. |
| `valving` | text | YES |  | Valving description or specification. |
| `adjustable` | boolean | YES | false | True if damping is externally adjustable. |
| `adjustment_positions` | integer | YES |  | Number of adjustment positions if adjustable. |
| `extended_length_inches` | numeric | YES |  | Fully extended length in inches. |
| `compressed_length_inches` | numeric | YES |  | Fully compressed length in inches. |
| `shaft_diameter_mm` | numeric | YES |  | Piston shaft diameter in mm. |
| `body_diameter_mm` | numeric | YES |  | Shock body outer diameter in mm. |
| `mount_type_upper` | text | YES |  | Upper mount type, e.g. stem, bar_pin, eye, stud. |
| `mount_type_lower` | text | YES |  | Lower mount type, e.g. stem, bar_pin, eye, stud. |
| `reservoir_type` | text | YES |  | Reservoir type, e.g. internal, remote, piggyback, none. |
| `gas_charged` | boolean | YES |  | True if gas (nitrogen) charged. |
| `is_original` | boolean | YES | true | True if factory-installed damper. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_springs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `spring_type` | text | YES |  | Spring type: coil, leaf, torsion_bar, air, other. |
| `rate_lbs_in` | numeric | YES |  | Spring rate in pounds per inch. |
| `free_length_inches` | numeric | YES |  | Uncompressed free length in inches (coil springs). |
| `installed_length_inches` | numeric | YES |  | Installed/compressed length in inches. |
| `material` | text | YES |  | Spring material: steel, chrome_vanadium, chrome_silicon, composite, other. |
| `wire_diameter_mm` | numeric | YES |  | Coil spring wire diameter in mm. |
| `coil_count` | numeric | YES |  | Number of coils (coil springs). May be fractional e.g. 5.5. |
| `leaf_count` | integer | YES |  | Number of leaves (leaf springs). |
| `leaf_width_inches` | numeric | YES |  | Leaf width in inches (leaf springs). |
| `torsion_bar_diameter_mm` | numeric | YES |  | Torsion bar diameter in mm. |
| `torsion_bar_length_mm` | numeric | YES |  | Torsion bar effective length in mm. |
| `progressive_rate` | boolean | YES | false | True if spring has a progressive (variable) rate. |
| `part_number` | text | YES |  | Spring part number. |
| `manufacturer` | text | YES |  | Spring manufacturer. |
| `color_code` | text | YES |  | Factory color code or stripe identification. |
| `is_original` | boolean | YES | true | True if factory-installed spring. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_steering_knuckles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `material` | text | YES |  | Knuckle material: cast_iron, ductile_iron, forged_steel, aluminum, other. |
| `spindle_type` | text | YES |  | Spindle type, e.g. integral, press_on, bolt_on. |
| `bearing_type` | text | YES |  | Wheel bearing type: tapered_roller, ball_bearing, unit_bearing, king_pin, other. |
| `hub_integration` | text | YES |  | Hub integration: separate_hub, integral_hub, unit_bearing, other. |
| `rotor_mounting` | text | YES |  | Rotor mounting style, e.g. hat_mount, hub_mount, lug_mount. |
| `caliper_mounting` | text | YES |  | Caliper bracket mounting description. |
| `steering_arm_type` | text | YES |  | Steering arm integration, e.g. integral, bolt_on. |
| `part_number` | text | YES |  | Knuckle part number. |
| `manufacturer` | text | YES |  | Knuckle manufacturer. |
| `casting_number` | text | YES |  | Casting number on the knuckle. |
| `is_original` | boolean | YES | true | True if factory-installed knuckle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_suspension_config`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `suspension_type` | text | YES |  | Type: solid_axle, ifs_torsion_bar, ifs_coilover, ifs_macpherson, ifs_double_wishbone, leaf_spring, other. |
| `subframe_type` | text | YES |  | Subframe style, e.g. bolt_in, welded, tubular, unibody, none. |
| `crossmember_part_number` | text | YES |  | Crossmember or subframe part number. |
| `ride_height_spec_mm` | numeric | YES |  | Factory ride height specification in mm. |
| `wheel_travel_mm` | numeric | YES |  | Total wheel travel in mm. |
| `caster_degrees` | numeric | YES |  | Caster angle specification in degrees. Positive = rearward tilt. |
| `caster_tolerance` | numeric | YES |  | Caster tolerance +/- in degrees. |
| `camber_degrees` | numeric | YES |  | Camber angle specification in degrees. Negative = top inward. |
| `camber_tolerance` | numeric | YES |  | Camber tolerance +/- in degrees. |
| `toe_in_mm` | numeric | YES |  | Toe-in specification in mm. Positive = toe-in, negative = toe-out. |
| `toe_tolerance_mm` | numeric | YES |  | Toe tolerance +/- in mm. |
| `steering_axis_inclination_degrees` | numeric | YES |  | Steering axis inclination (SAI/KPI) in degrees. |
| `scrub_radius_mm` | numeric | YES |  | Scrub radius at ground level in mm. Positive = offset outward. |
| `turning_radius_ft` | numeric | YES |  | Curb-to-curb turning radius in feet. |
| `is_original` | boolean | YES | true | True if factory-original suspension configuration. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `front_sway_bars`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `diameter_mm` | numeric | YES |  | Bar diameter in mm. |
| `material` | text | YES |  | Bar material: steel, chromoly, aluminum, hollow, other. |
| `type` | text | YES |  | Bar construction: solid, hollow, splined, other. |
| `end_link_type` | text | YES |  | End link type, e.g. dogbone, ball_joint, adjustable_rod_end. |
| `end_link_part_number` | text | YES |  | End link part number. |
| `bushing_type` | text | YES |  | Bushing style, e.g. split, clam_shell, greaseable. |
| `bushing_material` | text | YES |  | Bushing material: rubber, polyurethane, delrin, bronze, spherical, other. |
| `adjustable` | boolean | YES | false | True if bar has multiple mounting holes for rate adjustment. |
| `adjustment_holes` | integer | YES |  | Number of adjustment holes per arm. |
| `part_number` | text | YES |  | Sway bar part number. |
| `manufacturer` | text | YES |  | Manufacturer, e.g. Addco, Hellwig, factory. |
| `is_original` | boolean | YES | true | True if factory-installed sway bar. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuel_filters`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `filter_type` | text | YES |  | Filter type: inline, canister, in_carb, in_tank_sock, high_flow, other. |
| `location` | text | YES |  | Filter location, e.g. carb_inlet, frame_rail, engine_bay, in_tank. |
| `manufacturer` | text | YES |  | Filter manufacturer, e.g. AC Delco, Wix, K&N. |
| `part_number` | text | YES |  | Filter part number. |
| `micron_rating` | integer | YES |  | Filtration rating in microns, 1-1000. |
| `element_material` | text | YES |  | Filter element material, e.g. paper, sintered_bronze, stainless_mesh, nylon. |
| `mounting_type` | text | YES |  | How filter is mounted, e.g. hose_clamp, threaded, bracket, push_on. |
| `is_original` | boolean | YES | true | True if factory-type filter. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuel_lines`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `segment` | text | YES |  | Line segment: tank_to_pump, pump_to_filter, filter_to_carb, filter_to_rail, return, crossover, vent, other. |
| `material` | text | YES |  | Line material: steel, stainless_braided, nylon, rubber, ptfe, other. |
| `diameter_inches` | numeric | YES |  | Line inner diameter in inches, e.g. 0.375 for 3/8. |
| `fitting_type` | text | YES |  | Fitting type, e.g. compression, an_fitting, barb, push_lock, flare. |
| `routing` | text | YES |  | Line routing description, e.g. along_frame_rail, through_tunnel. |
| `return_line_yn` | boolean | YES | false | True if this is a fuel return line. |
| `manufacturer` | text | YES |  | Line or fitting manufacturer. |
| `part_number` | text | YES |  | Part number. |
| `is_original` | boolean | YES | true | True if factory-installed fuel line. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. kink at frame crossmember. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuel_pumps`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `pump_type` | text | YES |  | Pump type: mechanical, electric_inline, electric_in_tank, electric_external, high_pressure_efi, other. |
| `manufacturer` | text | YES |  | Pump manufacturer, e.g. AC Delco, Carter, Walbro, Holley, Aeromotive. |
| `part_number` | text | YES |  | Pump part number. |
| `flow_gph` | numeric | YES |  | Maximum fuel flow in gallons per hour. |
| `pressure_psi` | numeric | YES |  | Output pressure in PSI at rated flow. |
| `regulator_yn` | boolean | YES | false | True if a fuel pressure regulator is installed. |
| `regulator_type` | text | YES |  | Regulator type, e.g. bypass, deadhead, return_style. |
| `regulator_pressure_psi` | numeric | YES |  | Regulated fuel pressure in PSI. |
| `fuel_pump_relay_yn` | boolean | YES |  | True if pump is relay-controlled (vs direct key-on power). |
| `mounting_location` | text | YES |  | Where the pump is mounted, e.g. engine_block, frame_rail, in_tank, trunk. |
| `is_original` | boolean | YES | true | True if factory-installed fuel pump. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuel_system_electronics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `fuel_pressure_sensor_yn` | boolean | YES | false | True if fuel pressure sensor is installed. |
| `fuel_pressure_sensor_type` | text | YES |  | Sensor type, e.g. gauge_sender, ecu_input, stand_alone. |
| `fuel_pressure_sensor_location` | text | YES |  | Sensor location, e.g. fuel_rail, filter_outlet, return_line. |
| `fuel_rail_pressure_psi` | numeric | YES |  | Operating fuel rail pressure in PSI. |
| `fuel_rail_material` | text | YES |  | Fuel rail material: aluminum, stainless, composite, other. |
| `fuel_rail_type` | text | YES |  | Fuel rail type, e.g. stock, billet, tube_style. |
| `wideband_o2_yn` | boolean | YES | false | True if wideband O2 sensor is installed. |
| `wideband_o2_manufacturer` | text | YES |  | Wideband O2 manufacturer, e.g. Innovate, AEM, PLX. |
| `wideband_o2_part_number` | text | YES |  | Wideband O2 sensor part number. |
| `narrowband_o2_count` | integer | YES | 0 | Number of narrowband O2 sensors installed. |
| `flex_fuel_sensor_yn` | boolean | YES | false | True if flex fuel (ethanol content) sensor is installed. |
| `flex_fuel_sensor_manufacturer` | text | YES |  | Flex fuel sensor manufacturer. |
| `flex_fuel_ethanol_content_pct` | numeric | YES |  | Current ethanol content reading, 0-100 percent. |
| `ecu_manufacturer` | text | YES |  | Engine control unit manufacturer, e.g. GM, Holley, FAST, MegaSquirt. |
| `ecu_model` | text | YES |  | ECU model, e.g. Terminator_X, Sniper, MS3. |
| `ecu_tune` | text | YES |  | Current tune description or file reference. |
| `is_original` | boolean | YES | true | True if factory-original EFI electronics. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuel_tanks`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `capacity_gallons` | numeric | YES |  | Fuel capacity in US gallons. |
| `material` | text | YES |  | Tank material: steel, stainless, poly, aluminum, fiberglass, other. |
| `location` | text | YES |  | Tank location description, e.g. in_cab_behind_seat, under_bed, rear_of_chassis, in_trunk. |
| `sender_type` | text | YES |  | Fuel level sender type, e.g. arm_float, capacitive, resistive. |
| `vent_type` | text | YES |  | Tank vent system, e.g. vented_cap, evap_canister, rollover_valve. |
| `baffled_yn` | boolean | YES | false | True if tank has internal baffles to reduce slosh. |
| `filler_neck_location` | text | YES |  | Filler neck location, e.g. left_rear_quarter, right_rear_quarter, behind_license_plate. |
| `filler_neck_material` | text | YES |  | Filler neck material, e.g. steel, rubber_flex, stainless. |
| `fuel_pickup` | text | YES |  | Fuel pickup type, e.g. single_pickup, dual_pickup, sump. |
| `anti_slosh_foam` | boolean | YES | false | True if anti-slosh foam is installed inside the tank. |
| `manufacturer` | text | YES |  | Tank manufacturer, e.g. OEM, Tanks Inc, Spectra Premium. |
| `part_number` | text | YES |  | Tank part number. |
| `rust_grade` | text | YES |  | Interior rust condition: none, surface, moderate, severe, perforated. |
| `is_original` | boolean | YES | true | True if factory-installed fuel tank. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. seam seepage at rear. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `fuse_panels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `location` | text | YES |  | Panel location, e.g. under_dash_left, under_dash_right, under_hood, trunk. |
| `type` | text | YES |  | Fuse technology: glass_fuse, ato_blade, maxi_fuse, circuit_breaker, fusible_link. |
| `manufacturer` | text | YES |  | Panel manufacturer, e.g. GM, Ford, Littelfuse, Bussman. |
| `part_number` | text | YES |  | OEM or replacement part number. |
| `circuit_count` | integer | YES |  | Total number of fused circuits in this panel. |
| `max_amp_rating` | integer | YES |  | Highest rated fuse position in the panel in amps. |
| `fusible_link_count` | integer | YES |  | Number of fusible links feeding this panel. |
| `aftermarket_circuits_added` | integer | YES |  | Number of circuits added beyond the factory design. |
| `cover_present_yn` | boolean | YES |  | True if the protective cover/lid is present. |
| `label_legible_yn` | boolean | YES |  | True if circuit labels on panel or cover are still readable. |
| `grounds_clean_yn` | boolean | YES |  | True if chassis ground connections at panel are clean and tight. |
| `corrosion_present_yn` | boolean | YES |  | True if corrosion is visible on terminals or bus bars. |
| `is_original` | boolean | YES | true | True if this is the factory-installed fuse panel. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. evidence of past circuit fire, blown fuses. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `gauges_instruments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `gauge_type` | text | NO |  | Gauge function: speedometer, tachometer, fuel, coolant_temp, oil_pressure, voltmeter, ammeter, vacuum, boost, egt, wideband_afr, clock, odometer. Values: `speedometer`, `tachometer`, `fuel`, `coolant_temp`, `oil_pressure`, `voltmeter` ... (13 total) |
| `manufacturer` | text | YES |  | Gauge manufacturer, e.g. AC Delco, Stewart Warner, VDO, Auto Meter. |
| `part_number` | text | YES |  | Manufacturer or OEM part number. |
| `model_name` | text | YES |  | Gauge series/model name, e.g. Ultra-Lite, Sport-Comp, Cobalt. |
| `face_style` | text | YES |  | Face design description, e.g. black_printed, white_printed, orange_printed, analog, digital. |
| `face_diameter_inches` | numeric | YES |  | Gauge face diameter in inches, e.g. 2.0625, 2.625, 3.375, 5.0. |
| `scale_range` | text | YES |  | Full scale range, e.g. 0-80_psi, 0-8000_rpm, 120-160_f. |
| `unit` | text | YES |  | Unit of measure, e.g. psi, rpm, mph, kph, volts, amps, in_hg. |
| `lighting_type` | text | YES |  | Illumination method: none, incandescent, led, electroluminescent, fiber_optic. |
| `bezel_material` | text | YES |  | Bezel material, e.g. chrome, stainless, black_plastic, carbon_fiber. |
| `bezel_finish` | text | YES |  | Bezel finish, e.g. polished, brushed, powder_coated. |
| `sender_resistance_ohms` | text | YES |  | Sender resistance range for compatibility, e.g. 0-90, 240-33. |
| `accuracy` | text | YES |  | Stated accuracy, e.g. plus_minus_2pct, plus_minus_5pct. |
| `sweep_degrees` | integer | YES |  | Total pointer sweep arc in degrees. |
| `electric_yn` | boolean | YES |  | True if electrically driven (vs mechanical cable). |
| `stepper_motor_yn` | boolean | YES |  | True if gauge uses stepper motor movement (common in later factory clusters). |
| `trip_computer_yn` | boolean | YES |  | True if gauge includes trip computer functionality. |
| `location` | text | YES |  | Physical mounting location, e.g. instrument_cluster, a_pillar, dash_pod, under_dash. |
| `cluster_position` | text | YES |  | Position within cluster if part of a cluster, e.g. driver_left, center_top, auxiliary_1. |
| `is_original` | boolean | YES | true | True if factory-installed gauge. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. needle sticks at cold, face faded. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `generated_invoices`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `event_id` | uuid | NO |  |  |
| `contract_id` | uuid | YES |  |  |
| `invoice_number` | text | NO |  |  |
| `invoice_date` | date | YES | CURRENT_DATE |  |
| `due_date` | date | YES |  |  |
| `client_id` | uuid | YES |  |  |
| `business_id` | uuid | YES |  |  |
| `technician_id` | uuid | YES |  |  |
| `subtotal` | numeric | NO |  |  |
| `tax_amount` | numeric | YES | 0 |  |
| `tax_rate` | numeric | YES | 0 |  |
| `total_amount` | numeric | NO |  |  |
| `amount_paid` | numeric | YES | 0 |  |
| `amount_due` | numeric | YES |  |  |
| `payment_status` | text | YES | 'unpaid' |  Values: `unpaid`, `partial`, `paid`, `overdue`, `cancelled` |
| `pdf_url` | text | YES |  |  |
| `html_content` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `terms` | text | YES |  |  |
| `status` | text | YES | 'draft' |  Values: `draft`, `sent`, `viewed`, `paid`, `cancelled` |
| `sent_at` | timestamp with time zone | YES |  |  |
| `viewed_at` | timestamp with time zone | YES |  |  |
| `paid_at` | timestamp with time zone | YES |  |  |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `work_order_id` | uuid | YES |  |  |
| `heat_score` | integer | YES | 0 |  |
| `heat_factors` | jsonb | YES | '{}' |  |

### `geography_columns`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `f_table_catalog` | name | YES |  |  |
| `f_table_schema` | name | YES |  |  |
| `f_table_name` | name | YES |  |  |
| `f_geography_column` | name | YES |  |  |
| `coord_dimension` | integer | YES |  |  |
| `srid` | integer | YES |  |  |
| `type` | text | YES |  |  |

### `geometry_columns`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `f_table_catalog` | character varying | YES |  |  |
| `f_table_schema` | name | YES |  |  |
| `f_table_name` | name | YES |  |  |
| `f_geometry_column` | name | YES |  |  |
| `coord_dimension` | integer | YES |  |  |
| `srid` | integer | YES |  |  |
| `type` | character varying | YES |  |  |

### `gm_paint_codes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `code` | text | NO |  |  |
| `name` | text | NO |  |  |
| `hex_color` | text | YES |  |  |
| `year_start` | integer | YES |  |  |
| `year_end` | integer | YES |  |  |
| `brands` | ARRAY | YES |  |  |
| `type` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `harness_designs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `build_id` | uuid | YES |  |  |
| `user_id` | uuid | NO |  |  |
| `name` | text | NO | 'Untitled Harness' |  |
| `description` | text | YES |  |  |
| `vehicle_type` | text | YES |  |  |
| `engine_type` | text | YES |  |  |
| `ecu_platform` | text | YES |  |  |
| `pdm_platform` | text | YES |  |  |
| `template_id` | uuid | YES |  |  |
| `canvas_state` | jsonb | YES | '{"nodes": [], "viewport": {"x": 0, "y": 0, "zo... |  |
| `total_endpoints` | integer | YES | 0 |  |
| `total_connections` | integer | YES | 0 |  |
| `total_amperage` | numeric | YES | 0 |  |
| `recommended_alternator_amps` | integer | YES |  |  |
| `recommended_battery_ah` | integer | YES |  |  |
| `completeness_score` | numeric | YES | 0 |  |
| `missing_systems` | ARRAY | YES | '{}'[] |  |
| `status` | text | YES | 'draft' |  Values: `draft`, `in_progress`, `review`, `finalized`, `ordered` |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `harness_sections`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `design_id` | uuid | NO |  |  |
| `name` | text | NO |  |  |
| `section_type` | text | NO |  |  Values: `engine`, `transmission`, `chassis`, `interior`, `body`, `lighting` ... (11 total) |
| `color` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |
| `bounds_x` | numeric | YES |  |  |
| `bounds_y` | numeric | YES |  |  |
| `bounds_w` | numeric | YES |  |  |
| `bounds_h` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `harness_templates`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `vehicle_type` | text | YES |  |  |
| `engine_type` | text | YES |  |  |
| `ecu_platform` | text | YES |  |  |
| `template_data` | jsonb | NO | '{}' |  |
| `source` | text | YES | 'manual' |  Values: `manual`, `barton_invoice`, `factory`, `community` |
| `source_reference` | text | YES |  |  |
| `is_public` | boolean | YES | true |  |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `headliners`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `material` | text | YES |  | Headliner surface material: cloth, vinyl, perforated_vinyl, suede, cardboard_backed, molded_abs, other. |
| `color` | text | YES |  | Headliner color as observed. |
| `attachment_type` | text | YES |  | How headliner is retained: bow (wire bows), glue, snap, molded, other. |
| `dome_light_condition` | text | YES |  | Dome/interior light condition: functional, inoperative, missing, not_equipped, unknown. |
| `sagging_yn` | boolean | YES | false | True if headliner is sagging or delaminating from substrate. |
| `stain_locations_jsonb` | jsonb | YES | '[]' | JSON array of stain location descriptions, e.g. ["front_center", "rear_left"]. Empty array if clean. |
| `is_original` | boolean | YES | true | True if factory-original headliner. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `heater_cores`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `manufacturer` | text | YES |  | Heater core manufacturer, e.g. Spectra, Dorman, ACDelco, GM. |
| `part_number` | text | YES |  | OEM or aftermarket part number. |
| `material` | text | YES |  | Core tank and tube material: copper_brass (vintage/rebuildable) or aluminum (modern). |
| `width_inches` | numeric | YES |  | Core width dimension in inches. |
| `height_inches` | numeric | YES |  | Core height dimension in inches. |
| `depth_inches` | numeric | YES |  | Core depth (thickness) dimension in inches. |
| `inlet_diameter_inches` | numeric | YES |  | Coolant inlet hose diameter in inches. |
| `outlet_diameter_inches` | numeric | YES |  | Coolant outlet hose diameter in inches. |
| `row_count` | integer | YES |  | Number of tube rows in the core. |
| `fin_count_per_inch` | integer | YES |  | Fin density, fins per inch of core depth. |
| `shutoff_valve_type` | text | YES |  | Heater flow shutoff valve type: none, cable_operated, vacuum_operated, electric_solenoid, manual_inline. |
| `hose_size_inches` | numeric | YES |  | Heater hose diameter in inches, e.g. 0.625, 0.75. |
| `hose_condition` | text | YES |  | Heater hose condition: excellent, good, fair, cracked, leaking, replaced. |
| `leak_history_yn` | boolean | YES |  | True if the core has had or currently has a coolant leak. |
| `bypass_yn` | boolean | YES |  | True if heater core coolant circuit has been bypassed (hoses looped together). |
| `sealer_evidence_yn` | boolean | YES |  | True if evidence of stop-leak or sealer compound is present. |
| `is_original` | boolean | YES | true | True if factory-installed heater core. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. weeping at inlet tank, replaced 2022. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `hubs_and_wheel_bearings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Wheel position: front_left, front_right, rear_left, rear_right. Values: `front_left`, `front_right`, `rear_left`, `rear_right` |
| `hub_type` | text | YES |  | Hub type: serviceable, unit_bearing, manual_locking, auto_locking, free_spinning, drive_flange, other. |
| `hub_part_number` | text | YES |  | Hub assembly part number. |
| `hub_manufacturer` | text | YES |  | Hub manufacturer. |
| `hub_material` | text | YES |  | Hub material, e.g. cast_iron, ductile_iron, aluminum. |
| `hub_bolt_count` | integer | YES |  | Number of wheel studs. |
| `hub_bolt_pattern` | text | YES |  | Bolt pattern, e.g. 5x4.75, 6x5.5. |
| `hub_bolt_size` | text | YES |  | Wheel stud thread size, e.g. 7/16-20, 1/2-20, M12x1.5. |
| `bearing_type` | text | YES |  | Bearing type: tapered_roller, ball, sealed_unit, needle, other. |
| `bearing_inner_part_number` | text | YES |  | Inner wheel bearing part number (serviceable hubs). |
| `bearing_outer_part_number` | text | YES |  | Outer wheel bearing part number (serviceable hubs). |
| `bearing_manufacturer` | text | YES |  | Bearing manufacturer, e.g. Timken, SKF, Koyo. |
| `preload_spec` | text | YES |  | Bearing preload specification. |
| `preload_method` | text | YES |  | How preload is set, e.g. torque_and_back_off, torque_to_spec, cotter_pin. |
| `seal_type` | text | YES |  | Wheel bearing grease seal type. |
| `seal_part_number` | text | YES |  | Seal part number. |
| `dust_cap_type` | text | YES |  | Dust cap type, e.g. press_fit, threaded, integrated. |
| `cotter_pin_required` | boolean | YES |  | True if cotter pin is used to retain spindle nut. |
| `spindle_nut_torque_lb_ft` | integer | YES |  | Spindle nut torque specification in lb-ft. |
| `abs_sensor_equipped` | boolean | YES | false | True if ABS wheel speed sensor is installed at this corner. |
| `abs_sensor_type` | text | YES |  | ABS sensor type, e.g. passive_magnetic, active_hall_effect. |
| `abs_sensor_part_number` | text | YES |  | ABS sensor part number. |
| `abs_tone_ring_tooth_count` | integer | YES |  | ABS tone ring tooth count. |
| `wheel_stud_size` | text | YES |  | Wheel stud thread size. |
| `wheel_stud_material` | text | YES |  | Wheel stud material, e.g. grade_8, arp. |
| `is_original` | boolean | YES | true | True if factory-installed hub/bearing assembly. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. repack interval due. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `hvac_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `system_type` | text | YES |  | Overall HVAC capability: heat_only, heat_ac, auto_climate. |
| `ac_type` | text | YES |  | AC installation origin: none, factory_original, dealer_installed, aftermarket_retrofit. |
| `refrigerant` | text | YES |  | Refrigerant type: r12 (vintage), r134a (1992-2017), r1234yf (2017+). |
| `compressor_manufacturer` | text | YES |  | Compressor manufacturer, e.g. Harrison/Frigidaire, Sanden, Denso, Delphi. |
| `compressor_model` | text | YES |  | Compressor model, e.g. A6, DA-6, R4, V5, SD-7H15. |
| `compressor_part_number` | text | YES |  | Compressor OEM or aftermarket part number. |
| `compressor_displacement_cc` | numeric | YES |  | Compressor displacement per revolution in cc. |
| `compressor_clutch_type` | text | YES |  | Clutch type, e.g. electromagnetic, variable_displacement, continuously_variable. |
| `condenser_type` | text | YES |  | Condenser construction, e.g. tube_and_fin, parallel_flow, serpentine. |
| `condenser_location` | text | YES |  | Condenser location, e.g. front_of_radiator, side_mount, roof_mount. |
| `condenser_rows` | integer | YES |  | Number of tube rows in condenser core. |
| `evaporator_location` | text | YES |  | Evaporator location, e.g. under_dash, under_seat, in_dash, trunk. |
| `evaporator_type` | text | YES |  | Evaporator construction, e.g. tube_and_fin, plate_fin, stacked. |
| `expansion_valve_type` | text | YES |  | Expansion device type, e.g. thermostatic_expansion_valve, orifice_tube, block_valve. |
| `orifice_tube_size` | text | YES |  | Orifice tube size/color code if applicable, e.g. green, brown, red. |
| `ac_charge_oz` | numeric | YES |  | System refrigerant charge specification in ounces. |
| `system_pressure_low_psi` | integer | YES |  | Specified low-side operating pressure in PSI. |
| `system_pressure_high_psi` | integer | YES |  | Specified high-side operating pressure in PSI. |
| `receiver_drier_yn` | boolean | YES |  | True if a receiver-drier (TXV system) is installed. |
| `accumulator_yn` | boolean | YES |  | True if an accumulator-drier (orifice tube system) is installed. |
| `is_original` | boolean | YES | true | True if factory-installed HVAC system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. system holds charge, blows 40F. |
| `provenance` | text | YES | 'unknown' | System origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info, e.g. retrofit installer, conversion date. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `ignition_switches`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `type` | text | YES |  | Switch activation type: key, push_button, toggle. |
| `manufacturer` | text | YES |  | Switch manufacturer, e.g. GM, Ford, Painless, Ididit. |
| `part_number` | text | YES |  | Manufacturer or OEM part number. |
| `location` | text | YES |  | Physical location, e.g. column, dash_center, dash_right, floor_console. |
| `position_count` | integer | YES |  | Number of switch positions, typically 4 (off/acc/on/start) or 3. |
| `positions_available` | ARRAY | YES |  | Array of switch positions, e.g. {off, accessory, on, start}. |
| `tumbler_condition` | text | YES |  | Lock cylinder condition: smooth, stiff, worn, damaged, replaced. |
| `key_count` | integer | YES |  | Number of keys with the vehicle. |
| `key_type` | text | YES |  | Key type, e.g. single_sided, double_sided, transponder, vats. |
| `anti_theft_type` | text | YES |  | Anti-theft system tied to switch, e.g. none, vats, passlock, passlock2. |
| `wiring_connector_type` | text | YES |  | Wiring harness connector type at switch. |
| `lock_cylinder_included_yn` | boolean | YES |  | True if the lock cylinder is present and functional. |
| `is_original` | boolean | YES | true | True if factory-installed ignition switch assembly. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `image_analysis_records`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `analysis_tier` | integer | NO |  |  |
| `analyzed_at` | timestamp with time zone | YES | now() |  |
| `analyzed_by_model` | text | YES |  |  |
| `references_available` | ARRAY | YES |  |  |
| `references_used` | ARRAY | YES |  |  |
| `references_missing` | ARRAY | YES |  |  |
| `reference_coverage_snapshot` | jsonb | YES |  |  |
| `confirmed_findings` | jsonb | YES |  |  |
| `inferred_findings` | jsonb | YES |  |  |
| `unknown_items` | jsonb | YES |  |  |
| `gaps_discovered` | ARRAY | YES |  |  |
| `research_queue` | jsonb | YES |  |  |
| `handoff_notes` | text | YES |  |  |
| `reanalysis_triggers` | ARRAY | YES |  |  |
| `supersedes` | uuid | YES |  |  |
| `superseded_by` | uuid | YES |  |  |
| `superseded_at` | timestamp with time zone | YES |  |  |
| `superseded_reason` | text | YES |  |  |
| `overall_confidence` | numeric | YES |  |  |
| `citation_count` | integer | YES | 0 |  |
| `inference_count` | integer | YES | 0 |  |
| `unknown_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `image_angle_classifications_view`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `image_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `medium_url` | text | YES |  |  |
| `large_url` | text | YES |  |  |
| `is_primary` | boolean | YES |  |  |
| `caption` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `taken_at` | timestamp with time zone | YES |  |  |
| `angle_family` | text | YES |  |  |
| `primary_label` | text | YES |  |  |
| `view_axis` | text | YES |  |  |
| `elevation` | text | YES |  |  |
| `distance` | text | YES |  |  |
| `focal_length` | text | YES |  |  |
| `role` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `mapped_to_angle_id` | uuid | YES |  |  |
| `needs_review` | boolean | YES |  |  |
| `validation_notes` | text | YES |  |  |
| `part_name` | text | YES |  |  |
| `part_category` | text | YES |  |  |
| `system_area` | text | YES |  |  |
| `spatial_x` | numeric | YES |  |  |
| `spatial_y` | numeric | YES |  |  |
| `spatial_z` | numeric | YES |  |  |
| `repair_stage` | text | YES |  |  |
| `is_repair_image` | boolean | YES |  |  |
| `mapped_angle_name` | text | YES |  |  |

### `image_angle_spectrum`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `x_coordinate` | numeric | NO |  |  |
| `y_coordinate` | numeric | NO |  |  |
| `z_coordinate` | numeric | NO |  |  |
| `distance_meters` | numeric | YES |  |  |
| `zone_id` | uuid | YES |  |  |
| `zone_name` | text | YES |  |  |
| `canonical_angle_id` | uuid | YES |  |  |
| `canonical_angle_key` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `source` | text | NO |  |  |
| `source_model` | text | YES |  |  |
| `evidence` | jsonb | YES |  |  |
| `observed_at` | timestamp with time zone | YES | now() |  |
| `sensor_plane_angle` | numeric | YES |  |  |
| `subject_to_camera_angle` | numeric | YES |  |  |
| `lens_angle_of_view` | numeric | YES |  |  |
| `focal_length_mm` | numeric | YES |  |  |
| `sensor_size_mm` | numeric | YES |  |  |
| `crop_factor` | numeric | YES |  |  |
| `camera_position_x_m` | numeric | YES |  |  |
| `camera_position_y_m` | numeric | YES |  |  |
| `camera_position_z_m` | numeric | YES |  |  |
| `subject_center_x_m` | numeric | YES |  |  |
| `subject_center_y_m` | numeric | YES |  |  |
| `subject_center_z_m` | numeric | YES |  |  |

### `image_camera_analysis`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `subject_key` | text | YES |  |  |
| `camera_x_mm` | numeric | YES |  |  |
| `camera_y_mm` | numeric | YES |  |  |
| `camera_z_mm` | numeric | YES |  |  |
| `azimuth_deg` | numeric | YES |  |  |
| `elevation_deg` | numeric | YES |  |  |
| `distance_mm` | numeric | YES |  |  |
| `azimuth_direction` | text | YES |  |  |
| `elevation_description` | text | YES |  |  |
| `distance_description` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `source` | text | YES |  |  |
| `observed_at` | timestamp with time zone | YES |  |  |

### `image_classification_progress`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `total_images` | bigint | YES |  |  |
| `classified_images` | bigint | YES |  |  |
| `remaining_images` | bigint | YES |  |  |
| `percent_complete` | numeric | YES |  |  |
| `total_classifications` | bigint | YES |  |  |
| `mapped_classifications` | bigint | YES |  |  |
| `needs_review_count` | bigint | YES |  |  |
| `avg_confidence` | numeric | YES |  |  |

### `image_coordinate_consensus`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `image_id` | uuid | YES |  |  |
| `x_consensus` | numeric | YES |  |  |
| `y_consensus` | numeric | YES |  |  |
| `z_consensus` | numeric | YES |  |  |
| `distance_consensus_m` | numeric | YES |  |  |
| `x_certainty` | numeric | YES |  |  |
| `y_certainty` | numeric | YES |  |  |
| `z_certainty` | numeric | YES |  |  |
| `overall_certainty` | numeric | YES |  |  |
| `observation_count` | bigint | YES |  |  |
| `last_observed` | timestamp with time zone | YES |  |  |
| `sources` | ARRAY | YES |  |  |
| `best_zone` | text | YES |  |  |

### `image_forensic_metadata`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `image_id` | uuid | NO |  |  |
| `timestamp_trust_score` | numeric | YES |  |  |
| `sensor_fingerprint_hash` | text | YES |  |  |
| `exif_completeness_pct` | numeric | YES |  |  |
| `edit_history_software` | ARRAY | YES |  |  |
| `compression_artifact_score` | numeric | YES |  |  |
| `ai_generation_probability` | numeric | YES |  |  |
| `has_c2pa_manifest` | boolean | YES |  |  |
| `gps_consistent` | boolean | YES |  |  |
| `stripped_exif` | boolean | YES |  |  |
| `overall_authenticity_score` | numeric | YES |  |  |
| `analyzed_at` | timestamp with time zone | YES | now() |  |
| `analyzer_version` | text | YES |  |  |

### `image_sets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `created_by` | uuid | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `color` | text | YES | '#808080' |  |
| `icon` | text | YES |  |  |
| `is_primary` | boolean | YES | false |  |
| `display_order` | integer | YES | 0 |  |
| `timeline_event_id` | uuid | YES |  |  |
| `event_date` | timestamp with time zone | YES |  |  |
| `tags` | ARRAY | YES | '{}'[] |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_personal` | boolean | YES | false |  |
| `user_id` | uuid | YES |  |  |
| `is_auto_session` | boolean | YES | false | True if created by session_detector, false if manual album |
| `session_type_id` | uuid | YES |  |  |
| `session_type_key` | text | YES |  | FK-like key into session_type_taxonomy.canonical_key |
| `session_type_confidence` | numeric | YES |  |  |
| `session_start` | timestamp with time zone | YES |  |  |
| `session_end` | timestamp with time zone | YES |  |  |
| `session_duration_minutes` | numeric | YES |  |  |
| `session_location` | jsonb | YES |  |  |
| `detection_method` | text | YES |  |  |
| `detection_version` | text | YES |  |  |
| `narrative` | text | YES |  | Denormalized session narrative (latest from session_narratives) |
| `narrative_version` | text | YES |  |  |
| `predecessor_session_id` | uuid | YES |  |  |
| `successor_session_id` | uuid | YES |  |  |

### `image_subject_analysis`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `image_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `subject_key` | text | YES |  |  |
| `subject_name` | text | YES |  |  |
| `subject_domain` | text | YES |  |  |
| `subject_category` | text | YES |  |  |
| `subject_x` | numeric | YES |  |  |
| `subject_y` | numeric | YES |  |  |
| `subject_z` | numeric | YES |  |  |
| `subject_distance_m` | numeric | YES |  |  |
| `vehicle_x` | numeric | YES |  |  |
| `vehicle_y` | numeric | YES |  |  |
| `vehicle_z` | numeric | YES |  |  |
| `zone_name` | text | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `framing_quality` | numeric | YES |  |  |
| `subject_coverage_pct` | numeric | YES |  |  |
| `secondary_subjects` | jsonb | YES |  |  |
| `secondary_subject_count` | integer | YES |  |  |
| `source` | text | YES |  |  |
| `source_model` | text | YES |  |  |
| `observed_at` | timestamp with time zone | YES |  |  |

### `image_vehicle_mismatches`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `current_vehicle_id` | uuid | NO |  |  |
| `detected_vehicle` | jsonb | YES |  |  |
| `expected_vehicle` | jsonb | YES |  |  |
| `validation_status` | text | YES |  |  Values: `mismatch`, `uncertain`, `valid`, `not_validated` |
| `confidence_score` | integer | YES |  |  |
| `mismatch_reason` | text | YES |  |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `suggested_confidence` | integer | YES |  |  |
| `mismatch_source` | text | YES |  |  Values: `ai_validation`, `metadata_analysis`, `user_report`, `bulk_import_error`, `scraper_error` |
| `resolved` | boolean | YES | false |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `resolved_by` | uuid | YES |  |  |
| `resolution_action` | text | YES |  |  Values: `moved_to_correct_vehicle`, `removed_from_vehicle`, `marked_as_uncertain`, `confirmed_correct`, `pending_review` |
| `resolution_notes` | text | YES |  |  |
| `detected_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `import_queue_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `status` | text | YES |  |  |
| `count` | bigint | YES |  |  |
| `oldest_created_at` | timestamp with time zone | YES |  |  |
| `newest_created_at` | timestamp with time zone | YES |  |  |
| `next_attempt_at_min` | timestamp with time zone | YES |  |  |
| `next_attempt_at_max` | timestamp with time zone | YES |  |  |

### `ingestion_ledger`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `organization_id` | uuid | YES |  |  |
| `channel` | text | NO |  |  |
| `submission_type` | text | NO |  |  |
| `description` | text | YES |  |  |
| `status` | text | NO | 'received' |  |
| `items_total` | integer | NO | 0 |  |
| `items_received` | integer | NO | 0 |  |
| `items_ingested` | integer | NO | 0 |  |
| `items_analyzed` | integer | NO | 0 |  |
| `items_validated` | integer | NO | 0 |  |
| `items_failed` | integer | NO | 0 |  |
| `details` | jsonb | YES | '{}' |  |
| `errors` | jsonb | YES | '[]' |  |
| `vehicle_ids` | ARRAY | YES | '{}'::uuid[] |  |
| `deal_jacket_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `insurance_partners`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `partner_name` | text | NO |  |  |
| `partner_type` | text | NO |  |  |
| `api_endpoint` | text | YES |  |  |
| `api_key_encrypted` | text | YES |  |  |
| `supported_products` | ARRAY | YES | ARRAY[][] |  |
| `commission_rate` | numeric | YES |  |  |
| `is_active` | boolean | YES | false |  |
| `sandbox_mode` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `intelligence_patterns`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `pattern_type` | text | NO |  |  |
| `pattern_definition` | jsonb | NO |  |  |
| `resolution` | text | NO |  |  Values: `APPROVE`, `DOUBT`, `REJECT` |
| `confidence` | double precision | NO |  |  |
| `source_doubt_ids` | ARRAY | YES | '{}'::uuid[] |  |
| `examples_count` | integer | YES | 1 |  |
| `is_active` | boolean | YES | true |  |
| `created_by` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `last_matched_at` | timestamp with time zone | YES |  |  |
| `match_count` | integer | YES | 0 |  |

### `intelligent_parts_catalog`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `part_name` | text | YES |  |  |
| `oem_part_number` | text | YES |  |  |
| `category` | text | YES |  |  |
| `subcategory` | text | YES |  |  |
| `fits_makes` | ARRAY | YES |  |  |
| `fits_models` | ARRAY | YES |  |  |
| `fits_years` | int4range | YES |  |  |
| `description` | text | YES |  |  |
| `install_notes` | text | YES |  |  |
| `part_image_urls` | ARRAY | YES |  |  |
| `supplier_listings` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `condition_indicators` | jsonb | YES |  |  |
| `typical_lifespan_miles` | integer | YES |  |  |
| `typical_lifespan_years` | integer | YES |  |  |
| `common_failure_modes` | ARRAY | YES |  |  |
| `wear_patterns` | jsonb | YES |  |  |
| `price_new_cents` | integer | YES |  |  |
| `price_excellent_cents` | integer | YES |  |  |
| `price_good_cents` | integer | YES |  |  |
| `price_fair_cents` | integer | YES |  |  |
| `price_poor_cents` | integer | YES |  |  |
| `price_core_cents` | integer | YES |  |  |
| `key_visual_features` | ARRAY | YES |  |  |
| `mounting_location` | text | YES |  |  |
| `adjacent_parts` | ARRAY | YES |  |  |
| `color_variants` | ARRAY | YES |  |  |
| `size_dimensions` | jsonb | YES |  |  |
| `example_images_new` | ARRAY | YES |  |  |
| `example_images_worn` | ARRAY | YES |  |  |
| `example_images_damaged` | ARRAY | YES |  |  |
| `ai_recognition_confidence_threshold` | numeric | YES |  |  |
| `condition_guidelines` | jsonb | YES |  |  |
| `wear_pattern_definitions` | jsonb | YES |  |  |
| `ai_recognition_rule` | jsonb | YES |  |  |

### `intercoolers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `intercooler_type` | text | YES |  | Cooling medium: air_to_air, air_to_water, other. |
| `mounting` | text | YES |  | Mount position: top_mount, front_mount, side_mount, trunk_mount, other. |
| `core_width_inches` | numeric | YES |  | Core width in inches. |
| `core_height_inches` | numeric | YES |  | Core height in inches. |
| `core_thickness_inches` | numeric | YES |  | Core thickness in inches. |
| `pipe_diameter_inches` | numeric | YES |  | Charge pipe outer diameter in inches. |
| `pipe_material` | text | YES |  | Charge pipe material: aluminum, stainless, silicone, rubber, other. |
| `core_material` | text | YES |  | Core material: aluminum, copper_brass, other. |
| `end_tank_material` | text | YES |  | End tank material, e.g. cast_aluminum, fabricated_aluminum, plastic. |
| `manufacturer` | text | YES |  | Intercooler manufacturer, e.g. Garrett, Mishimoto, Bell, OEM. |
| `part_number` | text | YES |  | Intercooler part number. |
| `spray_bar_equipped` | boolean | YES | false | True if water spray bar is installed for additional cooling. |
| `is_original` | boolean | YES | true | True if factory-installed intercooler. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. bent fins on leading edge. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `interior_trim`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `location` | text | NO |  | Trim piece location: a_pillar_lf, a_pillar_rf, b_pillar_lf, b_pillar_rf, c_pillar_lf, c_pillar_rf, kick_panel_lf, kick_panel_rf, sill_plate_lf, sill_plate_rf, sail_panel_lf, sail_panel_rf, package_tray, other. Values: `a_pillar_lf`, `a_pillar_rf`, `b_pillar_lf`, `b_pillar_rf`, `c_pillar_lf`, `c_pillar_rf` ... (14 total) |
| `material` | text | YES |  | Trim material: hard_plastic, vinyl, cloth, cardboard_backed, fiberglass, carpet, other. |
| `color` | text | YES |  | Trim color as observed. |
| `is_original` | boolean | YES | true | True if factory-original trim piece. |
| `condition_grade` | text | YES | 'unknown' | Condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. crack at mounting tab, repainted. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `investability_tier_requirements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `tier` | text | NO |  |  |
| `tier_order` | integer | NO |  |  |
| `min_overall_score` | integer | NO |  |  |
| `min_traction_score` | integer | YES | 0 |  |
| `min_financial_score` | integer | YES | 0 |  |
| `min_operational_score` | integer | YES | 0 |  |
| `required_milestones` | ARRAY | YES | ARRAY[][] |  |
| `required_data_connections` | ARRAY | YES | ARRAY[][] |  |
| `display_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `typical_raise_range` | text | YES |  |  |

### `knowledge_gaps`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `discovered_at` | timestamp with time zone | YES | now() |  |
| `discovered_during_analysis_id` | uuid | YES |  |  |
| `discovered_by` | uuid | YES |  |  |
| `vehicle_context` | jsonb | YES |  |  |
| `gap_type` | text | NO |  |  |
| `description` | text | NO |  |  |
| `affected_components` | ARRAY | YES |  |  |
| `required_reference_type` | text | YES |  |  |
| `required_reference_title` | text | YES |  |  |
| `required_reference_specificity` | text | YES |  |  |
| `priority` | integer | YES | 5 | Auto-adjusted priority based on impact |
| `impact_count` | integer | YES | 1 | How many analyses have been blocked by this missing reference |
| `last_encountered` | timestamp with time zone | YES | now() |  |
| `status` | text | YES | 'open' |  |
| `resolved_at` | timestamp with time zone | YES |  |  |
| `resolved_by_document_id` | uuid | YES |  |  |
| `resolution_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `labor_rate_comparison`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `task_name` | text | YES |  |  |
| `hours` | numeric | YES |  |  |
| `current_rate` | numeric | YES |  |  |
| `reported_rate` | numeric | YES |  |  |
| `calculated_rate` | numeric | YES |  |  |
| `rate_source` | text | YES |  |  |
| `reported_cost` | numeric | YES |  |  |
| `calculated_cost` | numeric | YES |  |  |
| `cost_difference` | numeric | YES |  |  |
| `calculation_metadata` | jsonb | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `event_date` | date | YES |  |  |

### `labor_rate_history`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `actor_id` | uuid | NO |  |  |
| `rate_cents` | integer | NO |  |  |
| `currency` | text | YES | 'USD' |  |
| `rate_type` | text | NO | 'hourly' |  Values: `hourly`, `daily`, `flat_rate`, `per_piece` |
| `effective_date` | date | NO |  |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `landing_page_cache`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | boolean | NO | true |  |
| `data` | jsonb | NO |  |  |
| `refreshed_at` | timestamp with time zone | NO | now() |  |

### `legal_documents`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `parent_company_id` | uuid | YES |  |  |
| `offering_id` | uuid | YES |  |  |
| `document_type` | text | NO |  |  |
| `document_name` | text | NO |  |  |
| `version` | text | YES | '1.0' |  |
| `template_data` | jsonb | YES | '{}' |  |
| `generated_content` | text | YES |  |  |
| `pdf_url` | text | YES |  |  |
| `status` | text | YES | 'draft' |  |
| `approved_by` | text | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `lending_partners`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `partner_name` | text | NO |  |  |
| `partner_type` | text | NO |  |  |
| `funding_capacity` | numeric | YES |  |  |
| `min_loan_amount` | numeric | YES |  |  |
| `max_loan_amount` | numeric | YES |  |  |
| `base_rate` | numeric | YES |  |  |
| `spread` | numeric | YES |  |  |
| `max_ltv` | numeric | YES |  |  |
| `supported_terms` | ARRAY | YES | ARRAY[12, 24, 36, 48, 60] |  |
| `is_active` | boolean | YES | false |  |
| `sandbox_mode` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `listing_attribution`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `first_listed_platform` | text | NO |  |  |
| `first_listed_at` | timestamp with time zone | NO |  |  |
| `n_zero_listed_first` | boolean | NO |  |  |
| `external_listing_id` | uuid | YES |  |  |
| `commission_eligible` | boolean | YES | false |  |
| `attribution_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `listing_extraction_health_latest`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `platform` | text | YES |  |  |
| `listing_url` | text | YES |  |  |
| `snapshot_id` | uuid | YES |  |  |
| `extractor_name` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES |  |  |
| `overall_score` | integer | YES |  |  |
| `ok` | boolean | YES |  |  |
| `error_message` | text | YES |  |  |
| `health` | jsonb | YES |  |  |

### `live_auction_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | YES |  |  |
| `slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `base_url` | text | NO |  |  |
| `sync_method` | USER-DEFINED | NO | 'polling_scrape'::auction_sync_method |  |
| `supports_websocket` | boolean | YES | false |  |
| `supports_sse` | boolean | YES | false |  |
| `supports_api` | boolean | YES | false |  |
| `default_poll_interval_ms` | integer | YES | 60000 |  |
| `soft_close_poll_interval_ms` | integer | YES | 5000 |  |
| `soft_close_window_seconds` | integer | YES | 120 |  |
| `rate_limit_requests_per_minute` | integer | YES | 20 |  |
| `requires_auth` | boolean | YES | false |  |
| `auth_type` | text | YES |  |  |
| `supports_proxy_bidding` | boolean | YES | false |  |
| `auction_duration_typical` | text | YES |  |  |
| `has_reserve_auctions` | boolean | YES | true |  |
| `has_no_reserve_auctions` | boolean | YES | true |  |
| `has_soft_close` | boolean | YES | true |  |
| `websocket_url` | text | YES |  |  |
| `sse_url` | text | YES |  |  |
| `api_base_url` | text | YES |  |  |
| `bid_endpoint` | text | YES |  |  |
| `state_endpoint` | text | YES |  |  |
| `comments_endpoint` | text | YES |  |  |
| `scraping_config` | jsonb | YES | '{}' |  |
| `requires_residential_proxy` | boolean | YES | false |  |
| `requires_session_rotation` | boolean | YES | false |  |
| `known_rate_limits` | jsonb | YES | '{}' |  |
| `known_anti_bot_measures` | ARRAY | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `last_successful_sync` | timestamp with time zone | YES |  |  |
| `last_sync_error` | text | YES |  |  |
| `consecutive_failures` | integer | YES | 0 |  |
| `health_status` | text | YES | 'unknown' |  Values: `healthy`, `degraded`, `unhealthy`, `unknown` |
| `priority` | integer | YES | 50 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `auction_format` | USER-DEFINED | YES |  |  |

### `live_auctions_view`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `external_auction_id` | text | YES |  |  |
| `external_auction_url` | text | YES |  |  |
| `current_bid_cents` | bigint | YES |  |  |
| `current_bid_dollars` | numeric | YES |  |  |
| `bid_count` | integer | YES |  |  |
| `high_bidder_username` | text | YES |  |  |
| `reserve_status` | text | YES |  |  |
| `auction_end_time` | timestamp with time zone | YES |  |  |
| `seconds_remaining` | integer | YES |  |  |
| `is_in_soft_close` | boolean | YES |  |  |
| `last_sync` | timestamp with time zone | YES |  |  |
| `platform` | text | YES |  |  |
| `platform_name` | text | YES |  |  |
| `soft_close_window_seconds` | integer | YES |  |  |

### `location_collaborations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `location_address` | text | NO |  |  |
| `location_latitude` | numeric | YES |  |  |
| `location_longitude` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `organization_id` | uuid | NO |  |  |
| `can_view_vehicles` | boolean | YES | true |  |
| `can_add_work` | boolean | YES | true |  |
| `can_view_work_history` | boolean | YES | true |  |
| `can_upload_images` | boolean | YES | false |  |
| `granted_by_organization_id` | uuid | YES |  |  |
| `granted_by_user_id` | uuid | YES |  |  |
| `status` | text | YES | 'active' |  Values: `active`, `pending`, `revoked` |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `low_confidence_extractions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vehicle` | text | YES |  |  |
| `field_name` | text | YES |  |  |
| `field_value` | text | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `extraction_method` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES |  |  |

### `make_case_variants`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `normalized_make` | text | YES |  |  |
| `variants` | ARRAY | YES |  |  |
| `total_count` | numeric | YES |  |  |

### `market_benchmarks`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `benchmark_code` | text | NO |  |  |
| `benchmark_name` | text | NO |  |  |
| `benchmark_type` | text | NO |  |  Values: `internal`, `hagerty`, `composite`, `custom` |
| `data_source` | text | YES |  |  Values: `calculated`, `hagerty_api`, `manual`, `import` |
| `description` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `market_fund_holdings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `fund_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `shares_owned` | numeric | NO | 0 |  |
| `entry_nav` | numeric | NO | 0 |  |
| `current_nav` | numeric | NO | 0 |  |
| `unrealized_gain_loss_usd` | numeric | NO | 0 |  |
| `unrealized_gain_loss_pct` | numeric | NO | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `market_funds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `segment_id` | uuid | NO |  |  |
| `symbol` | text | NO |  |  |
| `fund_type` | text | NO | 'etf' |  Values: `etf`, `fund` |
| `status` | text | NO | 'active' |  Values: `active`, `paused`, `closed` |
| `nav_share_price` | numeric | NO | 10.0000 |  |
| `total_shares_outstanding` | numeric | NO | 0 |  |
| `total_aum_usd` | numeric | NO | 0 |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `market_indexes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `index_code` | text | NO |  |  |
| `index_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `calculation_method` | jsonb | YES | '{}' | JSON config: {"type": "price_weighted", "top_n": 50, "filters": {...}} |
| `components_query` | text | YES |  | Optional SQL query to dynamically select index components |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `market_segment_stats_cache`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `segment_id` | uuid | NO |  |  |
| `vehicle_count` | bigint | NO | 0 |  |
| `market_cap_usd` | numeric | NO | 0 |  |
| `avg_vehicle_price` | numeric | YES |  |  |
| `change_7d_pct` | numeric | YES |  |  |
| `change_30d_pct` | numeric | YES |  |  |
| `refreshed_at` | timestamp with time zone | NO | now() |  |
| `source` | text | YES | 'clean_vehicle_prices' |  |

### `market_segments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `year_min` | integer | YES |  |  |
| `year_max` | integer | YES |  |  |
| `makes` | ARRAY | YES |  |  |
| `model_keywords` | ARRAY | YES |  |  |
| `manager_type` | text | NO | 'ai' |  Values: `ai`, `human` |
| `status` | text | NO | 'active' |  Values: `active`, `draft`, `archived` |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `market_segments_index`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `segment_id` | uuid | YES |  |  |
| `slug` | text | YES |  |  |
| `name` | text | YES |  |  |
| `description` | text | YES |  |  |
| `manager_type` | text | YES |  |  |
| `status` | text | YES |  |  |
| `year_min` | integer | YES |  |  |
| `year_max` | integer | YES |  |  |
| `makes` | ARRAY | YES |  |  |
| `model_keywords` | ARRAY | YES |  |  |
| `vehicle_count` | integer | YES |  |  |
| `market_cap_usd` | numeric | YES |  |  |
| `change_7d_pct` | numeric | YES |  |  |
| `change_30d_pct` | numeric | YES |  |  |
| `subcategory_count` | integer | YES |  |  |
| `subcategories` | jsonb | YES |  |  |

### `marketplace_metro_pulse`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `metro` | text | YES |  |  |
| `total_listings` | bigint | YES |  |  |
| `active` | bigint | YES |  |  |
| `removed` | bigint | YES |  |  |
| `sold` | bigint | YES |  |  |
| `avg_price` | numeric | YES |  |  |
| `turnover_pct` | numeric | YES |  |  |
| `new_last_24h` | bigint | YES |  |  |
| `removed_last_24h` | bigint | YES |  |  |
| `unique_sellers` | bigint | YES |  |  |
| `oldest_listing` | timestamp with time zone | YES |  |  |
| `newest_listing` | timestamp with time zone | YES |  |  |
| `avg_year` | numeric | YES |  |  |

### `marketplace_seller_leaderboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `seller_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `fb_user_id` | text | YES |  |  |
| `seller_type` | text | YES |  |  |
| `total_listings` | bigint | YES |  |  |
| `active_listings` | bigint | YES |  |  |
| `completed_listings` | bigint | YES |  |  |
| `avg_price` | numeric | YES |  |  |
| `makes_listed` | ARRAY | YES |  |  |
| `locations` | ARRAY | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `inferred_type` | text | YES |  |  |

### `marketplace_velocity`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `state` | text | YES |  |  |
| `city` | text | YES |  |  |
| `make` | text | YES |  |  |
| `active_count` | bigint | YES |  |  |
| `removed_count` | bigint | YES |  |  |
| `sold_count` | bigint | YES |  |  |
| `avg_active_price` | numeric | YES |  |  |
| `avg_sold_price` | numeric | YES |  |  |
| `avg_hours_on_market` | numeric | YES |  |  |
| `total_listings` | bigint | YES |  |  |
| `turnover_pct` | numeric | YES |  |  |

### `micro_scrape_runs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `run_type` | text | YES | 'scheduled' |  Values: `scheduled`, `manual`, `triggered` |
| `batch_size` | integer | YES | 20 |  |
| `vehicles_analyzed` | integer | YES | 0 |  |
| `vehicles_improved` | integer | YES | 0 |  |
| `vehicles_marked_complete` | integer | YES | 0 |  |
| `actions_executed` | integer | YES | 0 |  |
| `actions_succeeded` | integer | YES | 0 |  |
| `actions_failed` | integer | YES | 0 |  |
| `runtime_ms` | integer | YES |  |  |
| `status` | text | YES | 'completed' |  Values: `running`, `completed`, `failed`, `timeout` |
| `error_message` | text | YES |  |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `model_drivetrain_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model_pattern` | text | NO |  |  |
| `allowed_drivetrains` | ARRAY | NO |  |  |
| `auto_correct` | boolean | YES | true |  |
| `correction_model_prefix` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `model_year_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | NO |  |  |
| `action` | text | YES | 'warn' |  Values: `warn`, `correct`, `reject` |
| `suggested_model` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `suggested_model_before` | text | YES |  |  |
| `suggested_model_after` | text | YES |  |  |

### `mufflers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `position` | text | YES |  | Muffler position: main, rear, resonator_front, resonator_rear. |
| `side` | text | YES |  | Which side: left, right, center, single. |
| `manufacturer` | text | YES |  | Muffler manufacturer, e.g. Flowmaster, Magnaflow, Borla, Cherry Bomb. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `muffler_type` | text | YES |  | Muffler design: chambered, turbo, straight_through, glasspack, resonator, cherry_bomb, bullet, other. |
| `inlet_diameter_inches` | numeric | YES |  | Inlet pipe diameter in inches. |
| `outlet_diameter_inches` | numeric | YES |  | Outlet pipe diameter in inches. |
| `inlet_count` | integer | YES | 1 | Number of inlets (1 for single, 2 for dual-in). |
| `outlet_count` | integer | YES | 1 | Number of outlets (1 for single, 2 for dual-out). |
| `body_length_inches` | numeric | YES |  | Muffler body length in inches. |
| `body_width_inches` | numeric | YES |  | Muffler body width in inches. |
| `body_height_inches` | numeric | YES |  | Muffler body height in inches (for oval bodies). |
| `material` | text | YES |  | Body material: mild_steel, stainless, aluminized, titanium, other. |
| `internal_construction` | text | YES |  | Internal design description, e.g. two_chamber, louvered_core, perforated_core. |
| `is_original` | boolean | YES | true | True if factory-installed muffler. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. slight blow at inlet weld. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `nhtsa_integration_status`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `total_vehicles` | bigint | YES |  |  |
| `vehicles_with_vin` | bigint | YES |  |  |
| `vehicles_with_nhtsa` | bigint | YES |  |  |
| `vehicles_with_conflicts` | bigint | YES |  |  |
| `vehicles_needing_enrichment` | bigint | YES |  |  |
| `nhtsa_coverage_pct` | numeric | YES |  |  |

### `normalization_rules`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `canonical_value` | text | NO |  |  |
| `variants` | ARRAY | NO |  |  |
| `field_type` | text | NO |  |  |
| `normalization_logic` | text | YES |  |  |
| `confidence_boost` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `notification_preferences`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `push_enabled` | boolean | YES | true |  |
| `push_likes` | boolean | YES | true |  |
| `push_comments` | boolean | YES | true |  |
| `push_follows` | boolean | YES | true |  |
| `push_mentions` | boolean | YES | true |  |
| `push_auctions` | boolean | YES | true |  |
| `push_streams` | boolean | YES | true |  |
| `push_system` | boolean | YES | true |  |
| `email_enabled` | boolean | YES | true |  |
| `email_daily_digest` | boolean | YES | true |  |
| `email_weekly_summary` | boolean | YES | true |  |
| `email_auction_updates` | boolean | YES | true |  |
| `email_stream_notifications` | boolean | YES | false |  |
| `email_marketing` | boolean | YES | false |  |
| `inapp_enabled` | boolean | YES | true |  |
| `inapp_sound` | boolean | YES | true |  |
| `inapp_desktop` | boolean | YES | true |  |
| `quiet_hours_enabled` | boolean | YES | false |  |
| `quiet_hours_start` | time without time zone | YES | '22:00:00'::time without time zone |  |
| `quiet_hours_end` | time without time zone | YES | '08:00:00'::time without time zone |  |
| `quiet_hours_timezone` | text | YES | 'UTC' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `notification_templates`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `template_key` | text | NO |  |  |
| `notification_type` | USER-DEFINED | NO |  |  |
| `title_template` | text | NO |  |  |
| `body_template` | text | YES |  |  |
| `language` | text | YES | 'en' |  |
| `variables` | jsonb | YES | '{}' |  |
| `active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `notifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `type` | text | NO |  |  |
| `title` | text | NO |  |  |
| `message` | text | NO |  |  |
| `metadata` | jsonb | YES |  |  |
| `action_url` | text | YES |  |  |
| `read` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `oauth_state_tracker`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `state` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `platform` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `expires_at` | timestamp with time zone | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `observation_extractors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_id` | uuid | NO |  |  |
| `slug` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `extractor_type` | text | NO |  |  |
| `edge_function_name` | text | YES |  |  |
| `extractor_config` | jsonb | YES | '{}' |  |
| `produces_kinds` | ARRAY | NO |  |  |
| `is_active` | boolean | YES | true |  |
| `schedule_type` | text | YES | 'on_demand' |  |
| `schedule_cron` | text | YES |  |  |
| `rate_limit_per_hour` | integer | YES |  |  |
| `min_interval_seconds` | integer | YES | 1 |  |
| `last_run_at` | timestamp with time zone | YES |  |  |
| `last_success_at` | timestamp with time zone | YES |  |  |
| `last_error` | text | YES |  |  |
| `consecutive_failures` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `observation_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `source` | text | YES |  |  |
| `category` | USER-DEFINED | YES |  |  |
| `observation_count` | bigint | YES |  |  |
| `vehicles_observed` | bigint | YES |  |  |
| `earliest_observation` | timestamp with time zone | YES |  |  |
| `latest_observation` | timestamp with time zone | YES |  |  |
| `unprocessed_count` | bigint | YES |  |  |

### `oem_drivetrain_codes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `code` | text | NO |  |  |
| `description` | text | NO |  |  |
| `manufacturer` | text | NO |  |  |
| `drive_wheels` | text | YES |  |  |
| `transfer_case_type` | text | YES |  |  |
| `used_from` | integer | YES |  |  |
| `used_until` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `oem_models`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `division` | text | YES |  |  |
| `model_name` | text | NO |  |  |
| `model_family` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `year_start` | integer | NO |  |  |
| `year_end` | integer | YES |  |  |
| `platform_code` | text | YES |  |  |
| `chassis_generation` | text | YES |  |  |
| `rpm_code` | text | YES |  |  |
| `body_code` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `oem_weight_classes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `class_code` | text | NO |  |  |
| `description` | text | NO |  |  |
| `manufacturer` | text | NO |  |  |
| `gvwr_min_lbs` | integer | YES |  |  |
| `gvwr_max_lbs` | integer | YES |  |  |
| `payload_capacity_lbs` | integer | YES |  |  |
| `towing_capacity_lbs` | integer | YES |  |  |
| `used_from` | integer | YES |  |  |
| `used_until` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `org_assets`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `org_slug` | text | NO |  |  |
| `asset_type` | text | NO |  |  |
| `asset_url` | text | NO |  |  |
| `storage_path` | text | YES |  |  |
| `width` | integer | YES |  |  |
| `height` | integer | YES |  |  |
| `file_size` | integer | YES |  |  |
| `mime_type` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `org_capabilities`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `org_id` | uuid | NO |  |  |
| `capability_type` | text | NO |  |  Values: `engine_machining`, `engine_assembly`, `engine_tuning`, `engine_diagnostics`, `transmission_rebuild`, `differential_rebuild` ... (64 total) |
| `complexity_tier` | text | NO | 'basic' |  Values: `basic`, `intermediate`, `advanced`, `expert`, `master` |
| `evidence_count` | integer | NO | 0 |  |
| `contributing_actor_count` | integer | NO | 0 |  |
| `first_demonstrated` | date | YES |  |  |
| `last_demonstrated` | date | YES |  |  |
| `best_outcome_vehicle_id` | uuid | YES |  |  |
| `best_outcome_description` | text | YES |  |  |
| `avg_spec_compliance` | numeric | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `org_memberships`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `actor_id` | uuid | NO |  | FK to actors(id). The person. |
| `org_id` | uuid | NO |  | FK to organizations(id). The organization. |
| `role` | text | NO |  | Role: owner, partner, lead_tech, senior_tech, journeyman, apprentice, specialist, contractor, consultant, manager, service_writer, parts_manager, detailer. Values: `owner`, `partner`, `lead_tech`, `senior_tech`, `journeyman`, `apprentice` ... (13 total) |
| `title` | text | YES |  |  |
| `is_primary` | boolean | YES | true |  |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `org_mention_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `mention_type` | text | YES |  |  |
| `status` | text | YES |  |  |
| `count` | bigint | YES |  |  |
| `unique_mentions` | bigint | YES |  |  |
| `matched_orgs` | bigint | YES |  |  |

### `org_profiles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `org_id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `org_type` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `specializations` | ARRAY | YES |  |  |
| `specialty_makes` | ARRAY | YES |  |  |
| `trust_score` | integer | YES |  |  |
| `total_documented_jobs` | integer | YES |  |  |
| `years_in_business` | integer | YES |  |  |
| `has_paint_booth` | boolean | YES |  |  |
| `has_dyno` | boolean | YES |  |  |
| `has_machine_shop` | boolean | YES |  |  |
| `hourly_rate_cents` | integer | YES |  |  |
| `active_member_count` | bigint | YES |  |  |
| `active_projects` | bigint | YES |  |  |
| `top_capabilities` | jsonb | YES |  |  |

### `organization_analysis_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `organization_id` | uuid | YES |  |  |
| `pending_count` | bigint | YES |  |  |
| `oldest_image` | timestamp with time zone | YES |  |  |
| `newest_image` | timestamp with time zone | YES |  |  |

### `organization_capabilities`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `capability_type` | text | NO |  |  |
| `capability_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `proficiency_level` | text | YES | 'expert' |  Values: `beginner`, `intermediate`, `advanced`, `expert` |
| `years_experience` | integer | YES |  |  |
| `evidence_count` | integer | YES | 0 |  |
| `last_work_date` | date | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `verified` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_contributors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `role` | text | NO |  |  Values: `owner`, `co_founder`, `board_member`, `manager`, `employee`, `technician` ... (11 total) |
| `start_date` | date | YES | CURRENT_DATE |  |
| `end_date` | date | YES |  |  |
| `status` | text | YES | 'active' |  Values: `active`, `inactive`, `pending` |
| `contribution_count` | integer | YES | 0 |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `agent_id` | text | YES |  |  |
| `actor_type` | text | YES | 'user' |  Values: `user`, `agent` |

### `organization_external_profiles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `platform` | text | NO |  |  |
| `username` | text | NO |  |  |
| `profile_url` | text | YES |  |  |
| `verified` | boolean | YES | false |  |
| `claimed_by_user_id` | uuid | YES |  |  |
| `claimed_at` | timestamp with time zone | YES | now() |  |
| `auto_import_enabled` | boolean | YES | false |  |
| `last_synced_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_hierarchy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `parent_organization_id` | uuid | NO |  |  |
| `child_organization_id` | uuid | NO |  |  |
| `relationship_type` | text | NO |  |  Values: `parent_company`, `subsidiary`, `dba`, `division`, `franchise`, `partnership` |
| `ownership_percentage` | numeric | YES |  |  |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_narratives`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `narrative_type` | text | NO |  |  |
| `time_period_start` | timestamp with time zone | NO |  |  |
| `time_period_end` | timestamp with time zone | NO |  |  |
| `narrative` | jsonb | NO |  |  |
| `image_count` | integer | NO |  |  |
| `confidence_score` | numeric | NO | 0.7 |  |
| `investment_signals` | ARRAY | YES |  |  |
| `business_stage` | text | YES |  |  |
| `investor_alerted` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_ownership_verifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `verification_type` | text | NO |  |  Values: `business_license`, `tax_id`, `articles_incorporation`, `dba_certificate`, `lease_agreement`, `utility_bill` |
| `status` | text | NO | 'pending' |  Values: `pending`, `documents_uploaded`, `ai_processing`, `human_review`, `approved`, `rejected`, `expired` |
| `document_url` | text | NO |  |  |
| `supporting_documents` | jsonb | YES | '[]' |  |
| `extracted_data` | jsonb | YES | '{}' |  |
| `ai_confidence_score` | numeric | YES |  |  |
| `human_reviewer_id` | uuid | YES |  |  |
| `human_review_notes` | text | YES |  |  |
| `rejection_reason` | text | YES |  |  |
| `submitted_at` | timestamp with time zone | YES | now() |  |
| `ai_processed_at` | timestamp with time zone | YES |  |  |
| `human_reviewed_at` | timestamp with time zone | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `expires_at` | timestamp with time zone | YES | (now() + '90 days'::interval) |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organization_seller_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `total_listings` | integer | NO | 0 |  |
| `total_sold` | integer | NO | 0 |  |
| `total_unsold` | integer | NO | 0 |  |
| `active_listings` | integer | NO | 0 |  |
| `sell_through_rate` | numeric | YES |  |  |
| `total_gross_sales` | numeric | YES |  |  |
| `avg_sale_price` | numeric | YES |  |  |
| `median_sale_price` | numeric | YES |  |  |
| `highest_sale_price` | numeric | YES |  |  |
| `lowest_sale_price` | numeric | YES |  |  |
| `avg_bid_count` | numeric | YES |  |  |
| `avg_comment_count` | numeric | YES |  |  |
| `avg_view_count` | numeric | YES |  |  |
| `avg_auction_duration_hours` | numeric | YES |  |  |
| `first_listing_date` | timestamp with time zone | YES |  |  |
| `last_listing_date` | timestamp with time zone | YES |  |  |
| `listing_frequency_days` | numeric | YES |  |  |
| `primary_categories` | ARRAY | YES |  |  |
| `primary_makes` | ARRAY | YES |  |  |
| `avg_sentiment_score` | numeric | YES |  |  |
| `common_concerns` | ARRAY | YES |  |  |
| `common_praise` | ARRAY | YES |  |  |
| `calculated_at` | timestamp with time zone | NO | now() |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `organization_vehicle_notifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | NO |  |  |
| `organization_vehicle_id` | uuid | NO |  |  |
| `verification_id` | uuid | YES |  |  |
| `notification_type` | text | NO |  |  Values: `relationship_verification`, `sale_verification`, `status_change_request` |
| `message` | text | NO |  |  |
| `priority` | text | YES | 'normal' |  Values: `low`, `normal`, `high`, `urgent` |
| `status` | text | YES | 'unread' |  Values: `unread`, `read`, `dismissed`, `resolved` |
| `assigned_to_user_id` | uuid | YES |  |  |
| `created_by_user_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `read_at` | timestamp with time zone | YES |  |  |
| `resolved_at` | timestamp with time zone | YES |  |  |

### `organizations_archived_20260129`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `slug` | text | YES |  |  |
| `type` | text | NO |  |  Values: `dealer`, `auction_house`, `shop`, `parts_supplier`, `restoration`, `collection` ... (9 total) |
| `description` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `country` | text | YES | 'USA' |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `website` | text | YES |  |  |
| `social_links` | jsonb | YES | '{}' |  |
| `hours_of_operation` | jsonb | YES | '{}' |  |
| `dealer_license` | text | YES |  |  |
| `dealer_type` | text | YES |  |  |
| `specialties` | ARRAY | YES |  |  |
| `inventory_url` | text | YES |  |  |
| `scrape_source_id` | uuid | YES |  |  |
| `total_inventory` | integer | YES | 0 |  |
| `squarebody_inventory` | integer | YES | 0 |  |
| `last_inventory_sync` | timestamp with time zone | YES |  |  |
| `source_url` | text | YES |  |  |
| `discovered_via` | text | YES |  |  |
| `logo_url` | text | YES |  |  |
| `banner_url` | text | YES |  |  |
| `is_verified` | boolean | YES | false |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `organizations_compat`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `type` | text | YES |  |  |
| `slug` | text | YES |  |  |
| `description` | text | YES |  |  |
| `website` | text | YES |  |  |
| `email` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `country` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `logo_url` | text | YES |  |  |
| `banner_url` | text | YES |  |  |
| `dealer_license` | text | YES |  |  |
| `is_verified` | boolean | YES |  |  |
| `is_active` | boolean | YES |  |  |
| `social_links` | jsonb | YES |  |  |
| `inventory_url` | text | YES |  |  |
| `total_inventory` | integer | YES |  |  |
| `last_inventory_sync` | timestamp with time zone | YES |  |  |
| `specialties` | ARRAY | YES |  |  |
| `scrape_source_id` | uuid | YES |  |  |
| `source_url` | text | YES |  |  |
| `discovered_via` | text | YES |  |  |
| `hours_of_operation` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `organized_ai_analysis`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `image_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `consensus_angle` | text | YES |  |  |
| `angle_confidence` | numeric | YES |  |  |
| `consensus_category` | text | YES |  |  |
| `all_extractions` | jsonb | YES |  |  |
| `extraction_count` | integer | YES |  |  |
| `angle` | text | YES |  |  |
| `category` | text | YES |  |  |
| `labels` | ARRAY | YES |  |  |
| `appraiser_label` | text | YES |  |  |
| `appraiser_angle` | text | YES |  |  |
| `ai_processing_status` | text | YES |  |  |
| `total_processing_cost` | numeric | YES |  |  |

### `orgs_needing_investigation`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `business_name` | text | YES |  |  |
| `website` | text | YES |  |  |
| `business_type` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `current_inventory_count` | bigint | YES |  |  |
| `is_easy_target` | boolean | YES |  |  |
| `priority_score` | integer | YES |  |  |
| `already_queued` | boolean | YES |  |  |

### `overflow_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `system_type` | text | YES |  | System type: expansion_tank, overflow_bottle, surge_tank, none. |
| `material` | text | YES |  | Tank material: plastic, aluminum, stainless, stamped_steel, other. |
| `capacity_quarts` | numeric | YES |  | Tank capacity in quarts. |
| `cap_pressure_psi` | integer | YES |  | Pressure cap rating in PSI (if pressurized system). |
| `pressurized` | boolean | YES | false | True if this is a pressurized expansion tank (vs simple overflow). |
| `mounting_location` | text | YES |  | Where tank is mounted, e.g. fender_well, firewall, radiator_support. |
| `manufacturer` | text | YES |  | Tank manufacturer. |
| `part_number` | text | YES |  | Part number. |
| `level_sensor_yn` | boolean | YES | false | True if coolant level sensor is installed. |
| `is_original` | boolean | YES | true | True if factory-installed overflow system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. yellowed plastic, cap seal worn. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `overhead_costs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `org_id` | uuid | NO |  |  |
| `cost_type` | text | NO |  |  Values: `rent`, `utilities`, `insurance`, `equipment_lease`, `software`, `supplies` ... (14 total) |
| `monthly_amount_cents` | integer | NO |  |  |
| `currency` | text | YES | 'USD' |  |
| `effective_date` | date | NO |  |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `ownership_verifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES | auth.uid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `documents_uploaded`, `ai_processing`, `human_review`, `approved`, `rejected`, `expired` |
| `title_document_url` | text | NO |  |  |
| `drivers_license_url` | text | NO |  |  |
| `face_scan_url` | text | YES |  |  |
| `insurance_document_url` | text | YES |  |  |
| `extracted_data` | jsonb | YES | '{}' |  |
| `title_owner_name` | text | YES |  |  |
| `license_holder_name` | text | YES |  |  |
| `vehicle_vin_from_title` | text | YES |  |  |
| `ai_confidence_score` | numeric | YES |  |  |
| `ai_processing_results` | jsonb | YES | '{}' |  |
| `name_match_score` | numeric | YES |  |  |
| `vin_match_confirmed` | boolean | YES |  |  |
| `document_authenticity_score` | numeric | YES |  |  |
| `human_reviewer_id` | uuid | YES |  |  |
| `human_review_notes` | text | YES |  |  |
| `rejection_reason` | text | YES |  |  |
| `requires_supervisor_review` | boolean | YES | false |  |
| `submitted_at` | timestamp without time zone | YES | now() |  |
| `ai_processed_at` | timestamp without time zone | YES |  |  |
| `human_reviewed_at` | timestamp without time zone | YES |  |  |
| `approved_at` | timestamp without time zone | YES |  |  |
| `rejected_at` | timestamp without time zone | YES |  |  |
| `expires_at` | timestamp without time zone | YES | (now() + '90 days'::interval) |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |
| `verification_type` | character varying | YES | 'title' |  |
| `inserted_at` | timestamp without time zone | NO | now() |  |
| `supporting_documents` | jsonb | YES | '[]' | Array of document references for ownership proof. Each document contains: - type: "title" / "bill_of_sale" / "registration" / "insurance" - url: storage URL of the uploaded document - uploaded_at: timestamp of upload - file_name: original filename - file_size: size in bytes - mime_type: file MIME type |
| `verification_category` | text | YES |  |  |
| `claim_source` | text | YES |  |  |
| `sms_submission_id` | uuid | YES |  |  |

### `paint_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `paint_code` | text | YES |  | Factory or aftermarket paint code, e.g. L76, Hugger Orange, PPG DAU. |
| `paint_name` | text | YES |  | Human-readable paint color name, e.g. Fathom Green, Moulin Rouge. |
| `base_color` | text | YES |  | Simplified base color descriptor, e.g. red, blue, silver, black. |
| `paint_type` | text | YES |  | Chemistry: lacquer, enamel, urethane, basecoat_clearcoat, single_stage. |
| `metallic_yn` | boolean | YES |  | True if paint contains metallic flake. |
| `pearl_yn` | boolean | YES |  | True if paint contains pearl pigment. |
| `original_color_yn` | boolean | YES |  | True if this is the factory-correct color for this vehicle per trim tag or data plate. |
| `respray_count` | integer | YES | 0 | Number of complete resprays beyond the factory coat. 0 = factory paint only. |
| `clear_coat_condition` | text | YES |  | Condition of the clear coat layer: excellent, good, fair, poor, failed, not_applicable (single-stage). |
| `paint_thickness_mils` | numeric | YES |  | Average paint thickness in mils measured with paint depth gauge. |
| `color_match_quality` | text | YES |  | Panel-to-panel color match quality: factory_match, excellent, good, fair, poor, mismatched. |
| `is_original` | boolean | YES | true | True if this row describes the factory-applied paint. |
| `condition_grade` | text | YES | 'unknown' | Overall paint condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. light orange peel on hood, overspray on trim. |
| `provenance` | text | YES | 'unknown' | Paint origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance: shop name, date painted, product used. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `paper_trade_pnl`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `total_trades` | bigint | YES |  |  |
| `closed_trades` | bigint | YES |  |  |
| `winning_trades` | bigint | YES |  |  |
| `losing_trades` | bigint | YES |  |  |
| `win_rate_pct` | numeric | YES |  |  |
| `total_pnl` | numeric | YES |  |  |
| `avg_profit_per_trade` | numeric | YES |  |  |
| `avg_win` | numeric | YES |  |  |
| `avg_loss` | numeric | YES |  |  |

### `paper_trades`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `prediction_id` | uuid | YES |  |  |
| `entry_price` | numeric | NO |  |  |
| `entry_time` | timestamp with time zone | NO | now() |  |
| `predicted_hammer` | numeric | NO |  |  |
| `predicted_flip_profit` | numeric | YES |  |  |
| `estimated_buyer_fee` | numeric | YES |  |  |
| `estimated_seller_fee` | numeric | YES |  |  |
| `actual_hammer` | numeric | YES |  |  |
| `actual_profit` | numeric | YES |  |  |
| `call_accuracy_pct` | numeric | YES |  |  |
| `profitable` | boolean | YES |  |  |
| `closed_at` | timestamp with time zone | YES |  |  |
| `rationale` | text | YES |  |  |
| `platform` | text | YES | 'bat' |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `parent_company`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `legal_name` | text | NO |  |  |
| `dba_name` | text | YES |  |  |
| `entity_type` | text | NO |  |  |
| `state_of_formation` | text | NO |  |  |
| `formation_date` | date | YES |  |  |
| `fiscal_year_end` | text | YES | '12/31' |  |
| `ein` | text | YES |  |  |
| `state_tax_id` | text | YES |  |  |
| `sec_file_number` | text | YES |  |  |
| `cik_number` | text | YES |  |  |
| `principal_address` | jsonb | YES | '{}' |  |
| `mailing_address` | jsonb | YES | '{}' |  |
| `registered_agent` | jsonb | YES | '{}' |  |
| `ceo_name` | text | YES |  |  |
| `cfo_name` | text | YES |  |  |
| `compliance_officer` | text | YES |  |  |
| `contact_email` | text | YES |  |  |
| `contact_phone` | text | YES |  |  |
| `quickbooks_realm_id` | text | YES |  |  |
| `quickbooks_access_token` | text | YES |  |  |
| `quickbooks_refresh_token` | text | YES |  |  |
| `quickbooks_token_expires_at` | timestamp with time zone | YES |  |  |
| `quickbooks_connected_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `owner_user_id` | uuid | YES |  |  |

### `part_alternatives`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_order_part_id` | uuid | YES |  |  |
| `brand` | text | NO |  |  |
| `part_number` | text | YES |  |  |
| `condition` | text | YES | 'new' |  |
| `retailer` | text | NO |  |  |
| `price` | numeric | NO |  |  |
| `store_location` | text | YES |  |  |
| `in_stock` | boolean | YES | true |  |
| `url` | text | YES |  |  |
| `is_selected` | boolean | YES | false |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `part_assemblies`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `slug` | text | YES |  |  |
| `assembly_image_url` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `category` | text | YES |  |  |
| `subcategory` | text | YES |  |  |
| `description` | text | YES |  |  |
| `fits_year_start` | integer | YES |  |  |
| `fits_year_end` | integer | YES |  |  |
| `fits_models` | ARRAY | YES |  |  |
| `total_parts_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `part_catalog`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_name` | text | NO |  |  |
| `oem_part_number` | text | YES |  |  |
| `category` | text | YES |  |  |
| `subcategory` | text | YES |  |  |
| `fits_makes` | ARRAY | YES |  |  |
| `fits_models` | ARRAY | YES |  |  |
| `fits_years` | int4range | YES |  |  |
| `description` | text | YES |  |  |
| `install_notes` | text | YES |  |  |
| `part_image_urls` | ARRAY | YES |  |  |
| `supplier_listings` | jsonb | YES | '[]' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `condition_indicators` | jsonb | YES |  |  |
| `typical_lifespan_miles` | integer | YES |  |  |
| `typical_lifespan_years` | integer | YES |  |  |
| `common_failure_modes` | ARRAY | YES |  |  |
| `wear_patterns` | jsonb | YES |  |  |
| `price_new_cents` | integer | YES |  |  |
| `price_excellent_cents` | integer | YES |  |  |
| `price_good_cents` | integer | YES |  |  |
| `price_fair_cents` | integer | YES |  |  |
| `price_poor_cents` | integer | YES |  |  |
| `price_core_cents` | integer | YES |  |  |
| `key_visual_features` | ARRAY | YES |  |  |
| `mounting_location` | text | YES |  |  |
| `adjacent_parts` | ARRAY | YES |  |  |
| `color_variants` | ARRAY | YES |  |  |
| `size_dimensions` | jsonb | YES | '{}' |  |
| `example_images_new` | ARRAY | YES |  |  |
| `example_images_worn` | ARRAY | YES |  |  |
| `example_images_damaged` | ARRAY | YES |  |  |
| `ai_recognition_confidence_threshold` | numeric | YES | 0.80 |  |

### `part_categories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `parent_category_id` | uuid | YES |  |  |
| `description` | text | YES |  |  |
| `icon` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |

### `part_condition_guidelines`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_category` | text | NO |  |  |
| `condition_grade` | integer | YES |  |  |
| `condition_label` | text | YES |  |  |
| `visual_indicators` | jsonb | YES |  |  |
| `disqualifying_damage` | ARRAY | YES |  |  |
| `price_multiplier` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `part_suppliers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `supplier_name` | text | NO |  |  |
| `supplier_url` | text | YES |  |  |
| `supplier_logo_url` | text | YES |  |  |
| `api_available` | boolean | YES | false |  |
| `api_key_encrypted` | text | YES |  |  |
| `scrape_config` | jsonb | YES |  |  |
| `commission_rate` | numeric | YES |  |  |
| `shipping_methods` | jsonb | YES |  |  |
| `return_policy` | text | YES |  |  |
| `trust_score` | integer | YES | 100 |  |
| `active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `part_wear_patterns`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_category` | text | NO |  |  |
| `wear_type` | text | NO |  |  |
| `visual_description` | text | YES |  |  |
| `typical_appearance` | jsonb | YES |  |  |
| `severity_levels` | jsonb | YES |  |  |
| `common_causes` | ARRAY | YES |  |  |
| `value_impact_percentage` | integer | YES |  |  |
| `repairability` | text | YES |  |  Values: `easy`, `moderate`, `difficult`, `impossible` |
| `repair_cost_range` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `parts_catalog`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `part_number` | text | NO |  |  |
| `oem_part_number` | text | YES |  |  |
| `aftermarket_part_numbers` | ARRAY | YES | '{}'[] |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `brand` | text | NO |  |  |
| `category` | USER-DEFINED | NO |  |  |
| `compatible_makes` | ARRAY | YES | '{}'[] |  |
| `compatible_models` | ARRAY | YES | '{}'[] |  |
| `compatible_years` | ARRAY | YES | '{}'[] |  |
| `specifications` | jsonb | YES | '{}' |  |
| `dimensions` | jsonb | YES | '{}' |  |
| `weight_lbs` | numeric | YES |  |  |
| `average_price` | numeric | YES |  |  |
| `min_price` | numeric | YES |  |  |
| `max_price` | numeric | YES |  |  |
| `price_updated_at` | timestamp with time zone | YES |  |  |
| `install_count` | integer | YES | 0 |  |
| `popularity_score` | integer | YES | 0 |  |
| `verified` | boolean | YES | false |  |
| `verified_by` | uuid | YES |  |  |
| `data_source` | text | YES | 'user_contributed' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `parts_reception`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `supplier_id` | uuid | NO |  |  |
| `po_number` | text | YES |  |  |
| `part_id` | uuid | YES |  |  |
| `part_number` | text | YES |  |  |
| `quantity_ordered` | integer | NO |  |  |
| `quantity_received` | integer | YES |  |  |
| `order_date` | timestamp with time zone | NO |  |  |
| `expected_delivery_date` | date | YES |  |  |
| `actual_delivery_date` | timestamp with time zone | YES |  |  |
| `condition_on_arrival` | text | YES |  |  Values: `excellent`, `good`, `acceptable`, `damaged`, `wrong_item` |
| `quality_check_passed` | boolean | YES | true |  |
| `quality_notes` | text | YES |  |  |
| `unit_cost` | numeric | YES |  |  |
| `shipping_cost` | numeric | YES |  |  |
| `total_cost` | numeric | YES |  |  |
| `status` | text | YES | 'ordered' |  Values: `ordered`, `shipped`, `received`, `installed`, `returned` |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `payment_processors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `processor_name` | text | NO |  |  |
| `processor_type` | text | NO |  |  |
| `api_endpoint` | text | YES |  |  |
| `api_key_encrypted` | text | YES |  |  |
| `supported_methods` | ARRAY | YES | ARRAY[][] |  |
| `fee_structure` | jsonb | YES | '{}' |  |
| `settlement_days` | integer | YES | 2 |  |
| `is_active` | boolean | YES | false |  |
| `sandbox_mode` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `pending_contribution_approvals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `contributor_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `contribution_type` | text | YES |  |  |
| `work_date` | date | YES |  |  |
| `work_category` | text | YES |  |  |
| `work_description` | text | YES |  |  |
| `responsible_party_type` | text | YES |  |  |
| `responsible_party_org_id` | uuid | YES |  |  |
| `status` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `auto_approve_at` | timestamp with time zone | YES |  |  |
| `contributor_name` | text | YES |  |  |
| `contributor_email` | text | YES |  |  |
| `contributor_avatar` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vehicle_title` | text | YES |  |  |
| `organization_name` | text | YES |  |  |
| `image_count` | integer | YES |  |  |

### `person_organization_roles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `person_id` | uuid | NO |  |  |
| `organization_id` | uuid | NO |  |  |
| `role_title` | text | NO |  |  |
| `role_type` | text | YES | 'staff' |  Values: `founder`, `owner`, `ceo`, `executive`, `staff`, `sales` ... (12 total) |
| `is_current` | boolean | YES | true |  |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `source_url` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `photo_coverage_requirements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `platform` | text | NO |  |  |
| `zone` | text | NO |  |  |
| `requirement` | text | NO | 'recommended' |  |
| `points` | smallint | NO | 0 |  |
| `coaching_prompt` | text | YES |  |  |
| `sort_position` | smallint | YES |  |  |

### `photo_inbox`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `image_data` | text | YES |  |  |
| `source` | text | YES | 'manual' |  |
| `received_at` | timestamp with time zone | YES | now() |  |
| `processed` | boolean | YES | false |  |
| `vehicle_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `confidence` | double precision | YES |  |  |
| `ai_match` | text | YES |  |  |
| `needs_review` | boolean | YES | false |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `corrected_from` | text | YES |  |  |

### `photo_sync_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `started_at` | timestamp with time zone | NO | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `date_range_start` | text | YES |  |  |
| `date_range_end` | text | YES |  |  |
| `photos_scanned` | integer | YES | 0 |  |
| `photos_filtered` | integer | YES | 0 |  |
| `clusters_created` | integer | YES | 0 |  |
| `photos_uploaded` | integer | YES | 0 |  |
| `photos_matched` | integer | YES | 0 |  |
| `photos_pending` | integer | YES | 0 |  |
| `photos_skipped` | integer | YES | 0 |  |
| `vehicles_touched` | ARRAY | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `photo_sync_state`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `last_processed_date` | timestamp with time zone | YES |  |  |
| `last_processed_uuid` | text | YES |  |  |
| `last_poll_at` | timestamp with time zone | YES |  |  |
| `last_successful_upload_at` | timestamp with time zone | YES |  |  |
| `daemon_version` | text | YES |  |  |
| `daemon_started_at` | timestamp with time zone | YES |  |  |
| `daemon_hostname` | text | YES |  |  |
| `photos_processed_total` | integer | YES | 0 |  |
| `photos_uploaded_total` | integer | YES | 0 |  |
| `photos_skipped_total` | integer | YES | 0 |  |
| `errors_total` | integer | YES | 0 |  |
| `poll_interval_seconds` | integer | YES | 60 |  |
| `batch_size` | integer | YES | 10 |  |
| `auto_create_vehicles` | boolean | YES | true |  |
| `auto_create_albums` | boolean | YES | true |  |
| `min_confidence_auto_assign` | real | YES | 0.8 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `pipeline_sellers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `cl_handle` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `seller_type` | text | YES | 'unknown' |  Values: `private`, `dealer`, `flipper`, `wholesaler`, `unknown` |
| `dealer_score` | integer | YES | 0 |  |
| `listing_count` | integer | YES | 0 |  |
| `active_listing_count` | integer | YES | 0 |  |
| `region_count` | integer | YES | 0 |  |
| `regions_seen` | ARRAY | YES | '{}'[] |  |
| `platforms_seen` | ARRAY | YES | '{}'[] |  |
| `makes_seen` | ARRAY | YES | '{}'[] |  |
| `is_cross_poster` | boolean | YES | false |  |
| `cross_post_count` | integer | YES | 0 |  |
| `avg_days_listed` | integer | YES |  |  |
| `price_reduction_rate` | numeric | YES |  |  |
| `typical_price_drop_pct` | numeric | YES |  |  |
| `avg_asking_price` | numeric | YES |  |  |
| `avg_deal_score` | numeric | YES |  |  |
| `tags` | ARRAY | YES | '{}'[] |  |
| `notes` | text | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `business_name` | text | YES |  |  |
| `website` | text | YES |  |  |
| `primary_region` | text | YES |  |  |
| `primary_state` | text | YES |  |  |
| `business_type` | text | YES |  |  Values: `licensed_dealer`, `restoration_shop`, `consignment_dealer`, `wholesaler`, `broker`, `auction_rep` ... (10 total) |
| `specialties` | ARRAY | YES | '{}'[] |  |
| `eras_seen` | int4range | YES |  |  |
| `intel_value` | text | YES | 'comp_source' |  Values: `comp_source`, `wholesale_target`, `restoration_partner`, `watch_only`, `blocklist` |
| `contact_status` | text | YES | 'not_contacted' |  Values: `not_contacted`, `contacted`, `relationship_active`, `declined`, `blocked` |
| `relationship_notes` | text | YES |  |  |
| `median_asking_price` | numeric | YES |  |  |
| `price_range_low` | numeric | YES |  |  |
| `price_range_high` | numeric | YES |  |  |
| `makes_histogram` | jsonb | YES | '{}' |  |
| `models_seen` | ARRAY | YES | '{}'[] |  |
| `listings_per_month` | numeric | YES |  |  |
| `discovered_via` | text | YES | 'craigslist_scrape' |  Values: `craigslist_scrape`, `facebook_marketplace`, `manual_entry`, `classic_com`, `bat_monitor`, `other` |
| `enrichment_status` | text | YES | 'raw' |  Values: `raw`, `partial`, `enriched`, `verified` |
| `last_enriched_at` | timestamp with time zone | YES |  |  |

### `platform_config`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `config_key` | text | NO |  |  |
| `config_value` | jsonb | NO |  |  |
| `description` | text | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `updated_by` | uuid | YES |  |  |

### `platform_credentials`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `platform` | text | NO |  |  Values: `bat`, `cars_and_bids`, `pcarmarket`, `collecting_cars`, `broad_arrow`, `rmsothebys` ... (9 total) |
| `encrypted_credentials` | bytea | NO |  | AES-256-GCM encrypted JSON containing username and password |
| `encryption_iv` | bytea | NO |  | 12-byte initialization vector for AES-GCM |
| `encryption_tag` | bytea | NO |  | 16-byte authentication tag for AES-GCM integrity verification |
| `session_token_encrypted` | bytea | YES |  |  |
| `session_expires_at` | timestamp with time zone | YES |  |  |
| `cookies_encrypted` | bytea | YES |  |  |
| `requires_2fa` | boolean | YES | false |  |
| `totp_secret_encrypted` | bytea | YES |  | Encrypted TOTP secret for automated 2FA code generation |
| `last_2fa_method` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `validating`, `active`, `expired`, `2fa_required`, `invalid`, `suspended` |
| `last_validated_at` | timestamp with time zone | YES |  |  |
| `validation_error` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `platform_integrations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `integration_name` | text | NO |  |  |
| `status` | text | NO | 'disconnected' |  |
| `token_expires_at` | timestamp with time zone | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `portfolio_stats_cache`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | text | NO | 'global' |  |
| `total_vehicles` | integer | YES | 0 |  |
| `total_value` | numeric | YES | 0 |  |
| `for_sale_count` | integer | YES | 0 |  |
| `active_auctions` | integer | YES | 0 |  |
| `sales_count_today` | integer | YES | 0 |  |
| `sales_volume_today` | numeric | YES | 0 |  |
| `vehicles_added_today` | integer | YES | 0 |  |
| `avg_value` | numeric | YES | 0 |  |
| `value_realized_total` | numeric | YES | 0 |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `market_interest_value` | numeric | YES | 0 |  |
| `rnm_vehicle_count` | integer | YES | 0 |  |

### `power_steering_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `pump_type` | text | YES |  | Pump type: saginaw_p_series, saginaw_tc, thompson, vane, gear, electric, remote_reservoir, other. |
| `pump_manufacturer` | text | YES |  | Pump manufacturer, e.g. Saginaw, Thompson, ZF. |
| `pump_part_number` | text | YES |  | Pump part number. |
| `pump_flow_rate_gpm` | numeric | YES |  | Pump flow rate in gallons per minute. |
| `pump_max_pressure_psi` | integer | YES |  | Maximum pump pressure in PSI. |
| `fluid_type` | text | YES |  | Required fluid type, e.g. atf_dexron, power_steering_fluid, synthetic. |
| `fluid_capacity_oz` | numeric | YES |  | System fluid capacity in ounces. |
| `cooler_equipped` | boolean | YES | false | True if power steering cooler is installed. |
| `cooler_type` | text | YES |  | Cooler type, e.g. tube_fin, remote, integrated_in_radiator. |
| `hose_material` | text | YES |  | Hose material: rubber, braided_stainless, nylon, ptfe, other. |
| `pressure_hose_part_number` | text | YES |  | High pressure hose part number. |
| `return_hose_part_number` | text | YES |  | Return hose part number. |
| `pressure_spec_psi` | integer | YES |  | System operating pressure specification in PSI. |
| `reservoir_type` | text | YES |  | Reservoir type, e.g. integral, remote, canister. |
| `reservoir_part_number` | text | YES |  | Reservoir part number. |
| `filter_equipped` | boolean | YES | false | True if in-line filter is installed. |
| `is_original` | boolean | YES | true | True if factory-installed power steering system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `prediction_accuracy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `model_version` | integer | YES |  |  |
| `total_predictions` | bigint | YES |  |  |
| `scored` | bigint | YES |  |  |
| `avg_abs_error_pct` | numeric | YES |  |  |
| `median_abs_error_pct` | numeric | YES |  |  |
| `avg_bias_pct` | numeric | YES |  |  |
| `within_5pct` | bigint | YES |  |  |
| `within_10pct` | bigint | YES |  |  |
| `within_20pct` | bigint | YES |  |  |

### `price_change_alerts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `old_value` | numeric | NO |  |  |
| `new_value` | numeric | NO |  |  |
| `percent_change` | numeric | NO |  |  |
| `changed_at` | timestamp with time zone | YES | now() |  |
| `changed_by` | uuid | YES |  |  |
| `requires_review` | boolean | YES | false |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `reviewed_by` | uuid | YES |  |  |
| `review_decision` | text | YES |  |  |
| `review_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `product_value_database`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `generic_name` | text | NO |  |  |
| `specific_names` | ARRAY | YES |  |  |
| `year_range` | int4range | YES |  |  |
| `makes` | ARRAY | YES |  |  |
| `models` | ARRAY | YES |  |  |
| `oem_low` | numeric | YES |  |  |
| `oem_high` | numeric | YES |  |  |
| `aftermarket_low` | numeric | YES |  |  |
| `aftermarket_high` | numeric | YES |  |  |
| `performance_low` | numeric | YES |  |  |
| `performance_high` | numeric | YES |  |  |
| `removal_hours` | numeric | YES |  |  |
| `installation_hours` | numeric | YES |  |  |
| `total_labor_hours` | numeric | YES |  |  |
| `skill_level` | character varying | YES |  |  |
| `mitchell_labor_id` | text | YES |  |  |
| `chilton_procedure_id` | text | YES |  |  |
| `factory_service_manual_page` | text | YES |  |  |
| `part_category` | character varying | YES |  |  |
| `affects_value_significantly` | boolean | YES | true |  |
| `typical_condition_impact` | numeric | YES |  |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `updated_at` | timestamp without time zone | YES | now() |  |

### `professional_scores`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `score` | integer | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `profile_achievements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `achievement_type` | text | NO |  |  Values: `first_vehicle`, `profile_complete`, `first_image`, `contributor`, `vehicle_collector`, `image_enthusiast` ... (9 total) |
| `achievement_title` | text | NO |  |  |
| `achievement_description` | text | YES |  |  |
| `icon_url` | text | YES |  |  |
| `points_awarded` | integer | YES | 0 |  |
| `earned_at` | timestamp without time zone | YES | now() |  |
| `created_at` | timestamp without time zone | YES | now() |  |

### `profile_completion`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `basic_info_complete` | boolean | YES | false |  |
| `avatar_uploaded` | boolean | YES | false |  |
| `bio_added` | boolean | YES | false |  |
| `social_links_added` | boolean | YES | false |  |
| `first_vehicle_added` | boolean | YES | false |  |
| `skills_added` | boolean | YES | false |  |
| `location_added` | boolean | YES | false |  |
| `total_completion_percentage` | integer | YES | 0 |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `last_updated` | timestamp without time zone | YES | now() |  |

### `profile_image_insights`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `batch_id` | text | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_name` | text | YES |  |  |
| `summary_date` | date | NO |  |  |
| `summary` | text | YES |  |  |
| `condition_score` | numeric | YES |  |  |
| `condition_label` | text | YES |  |  |
| `estimated_value_usd` | numeric | YES |  |  |
| `labor_hours` | numeric | YES |  |  |
| `confidence` | numeric | YES |  |  |
| `key_findings` | jsonb | YES | '[]' |  |
| `recommendations` | jsonb | YES | '[]' |  |
| `image_ids` | ARRAY | YES | '{}'::uuid[] |  |
| `raw_response` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `checklist` | jsonb | YES | '{}' |  |

### `profile_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `vehicles_count` | integer | YES | 0 |  |
| `total_vehicles` | integer | YES | 0 |  |
| `last_activity` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `total_images` | integer | YES | 0 |  |
| `total_contributions` | integer | NO | 0 |  |
| `total_timeline_events` | integer | NO | 0 |  |

### `profiles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO |  |  |
| `email` | text | YES |  |  |
| `full_name` | text | YES |  |  |
| `avatar_url` | text | YES |  |  |
| `bio` | text | YES |  |  |
| `location` | text | YES |  |  |
| `website` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `user_type` | USER-DEFINED | YES | 'user'::user_type |  |
| `phone_number` | text | YES |  |  |
| `phone_verified` | boolean | YES | false |  |
| `phone_verification_code` | text | YES |  |  |
| `phone_verification_expires_at` | timestamp with time zone | YES |  |  |
| `id_verification_status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `expired` |
| `verification_level` | text | YES | 'unverified' |  Values: `unverified`, `phone_only`, `id_only`, `fully_verified` |
| `verified_at` | timestamp with time zone | YES |  |  |
| `verification_notes` | text | YES |  |  |
| `primary_id_document_id` | uuid | YES |  |  |
| `verification_document_ids` | ARRAY | YES | '{}'::uuid[] |  |
| `website_url` | text | YES |  |  |
| `github_url` | text | YES |  |  |
| `linkedin_url` | text | YES |  |  |
| `is_public` | boolean | YES | true |  |
| `is_verified` | boolean | YES | false |  |
| `username` | text | YES |  |  |
| `id_document_type` | text | YES |  |  |
| `id_document_url` | text | YES |  |  |
| `username_lower` | text | YES |  |  |
| `can_view_sensitive` | boolean | NO | false |  |
| `payment_verified` | boolean | YES | false |  |
| `phone` | text | YES |  |  |
| `role` | text | YES | 'user' |  |
| `moderator_level` | text | YES | 'none' |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `tool_inventory_public` | boolean | YES | false |  |
| `total_tool_value` | numeric | YES | 0 |  |
| `tool_count` | integer | YES | 0 |  |
| `profession` | USER-DEFINED | YES | 'enthusiast'::user_profession |  |
| `expertise_areas` | ARRAY | YES | '{}'[] |  |
| `business_name` | text | YES |  |  |
| `business_license` | text | YES |  |  |
| `dealer_license` | text | YES |  |  |
| `search_vector` | tsvector | YES |  | Full-text search vector for user searches |
| `member_since` | timestamp with time zone | YES |  | Date when user first became active (earliest activity) |
| `total_listings` | integer | YES | 0 | Total number of listings (BaT-style) |
| `total_bids` | integer | YES | 0 | Total number of bids placed |
| `total_comments` | integer | YES | 0 | Total number of comments made |
| `total_auction_wins` | integer | YES | 0 | Total number of auction wins |
| `total_success_stories` | integer | YES | 0 | Total number of success stories |
| `telegram_id` | text | YES |  |  |
| `onboarded_via` | text | YES | 'web' |  |

### `project_economics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_order_id` | uuid | NO |  |  |
| `quoted_cost_cents` | integer | YES |  |  |
| `actual_cost_cents` | integer | YES |  |  |
| `labor_hours` | numeric | YES |  |  |
| `labor_cost_cents` | integer | YES |  |  |
| `parts_cost_cents` | integer | YES |  |  |
| `overhead_allocation_cents` | integer | YES |  |  |
| `tool_depreciation_cents` | integer | YES |  |  |
| `profit_cents` | integer | YES |  |  |
| `profit_margin_pct` | numeric | YES |  |  |
| `roi_pct` | numeric | YES |  |  |
| `computed_at` | timestamp with time zone | NO | now() |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `property_types`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `parent_type_id` | uuid | YES |  |  |
| `default_amenities` | jsonb | YES | '[]' |  |
| `required_fields` | ARRAY | YES | ARRAY[][] |  |
| `optional_fields` | ARRAY | YES | ARRAY[][] |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `public_builds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `description` | text | YES |  |  |
| `status` | text | YES |  |  |
| `start_date` | date | YES |  |  |
| `target_completion_date` | date | YES |  |  |
| `actual_completion_date` | date | YES |  |  |
| `total_budget` | numeric | YES |  |  |
| `total_spent` | numeric | YES |  |  |
| `total_hours_estimated` | integer | YES |  |  |
| `total_hours_actual` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |

### `public_investment_opportunities`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `business_stage` | text | YES |  |  |
| `trajectory` | text | YES |  |  |
| `investment_score` | numeric | YES |  |  |
| `investment_range` | text | YES |  |  |
| `investor_pitch` | text | YES |  |  |
| `growth_signals` | jsonb | YES |  |  |
| `investment_signals` | ARRAY | YES |  |  |
| `confidence_score` | numeric | YES |  |  |
| `time_period_start` | timestamp with time zone | YES |  |  |
| `time_period_end` | timestamp with time zone | YES |  |  |
| `image_count` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |

### `purchase_order_items`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `purchase_order_id` | uuid | NO |  |  |
| `work_order_part_id` | uuid | YES |  |  |
| `part_name` | text | NO |  |  |
| `part_number` | text | YES |  |  |
| `brand` | text | YES |  |  |
| `quantity` | integer | NO | 1 |  |
| `unit_price` | numeric | YES |  |  |
| `total_price` | numeric | YES |  |  |
| `buy_url` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `ordered`, `backordered`, `shipped`, `delivered`, `installed`, `returned`, `cancelled` |
| `tracking_number` | text | YES |  |  |
| `estimated_delivery` | date | YES |  |  |
| `actual_delivery` | date | YES |  |  |
| `received_by` | uuid | YES |  |  |
| `received_at` | timestamp with time zone | YES |  |  |
| `installed_at` | timestamp with time zone | YES |  |  |
| `installed_by` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `purchase_orders`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_order_id` | uuid | NO |  |  |
| `invoice_id` | uuid | YES |  |  |
| `supplier_name` | text | NO |  |  |
| `supplier_url` | text | YES |  |  |
| `supplier_account_id` | text | YES |  |  |
| `supplier_contact_email` | text | YES |  |  |
| `supplier_contact_phone` | text | YES |  |  |
| `po_number` | text | NO |  |  |
| `po_date` | timestamp with time zone | YES | now() |  |
| `subtotal` | numeric | YES | 0 |  |
| `tax_estimate` | numeric | YES | 0 |  |
| `shipping_estimate` | numeric | YES | 0 |  |
| `total_estimate` | numeric | YES | 0 |  |
| `status` | text | YES | 'pending_approval' |  Values: `pending_approval`, `approved`, `submitted`, `confirmed`, `partial_shipped`, `shipped` ... (11 total) |
| `order_method` | text | YES | 'manual' |  Values: `api`, `email`, `browser`, `phone`, `manual` |
| `order_confirmation` | text | YES |  |  |
| `tracking_numbers` | ARRAY | YES |  |  |
| `estimated_delivery` | date | YES |  |  |
| `actual_delivery` | date | YES |  |  |
| `ship_to_name` | text | YES |  |  |
| `ship_to_address` | text | YES |  |  |
| `ship_to_phone` | text | YES |  |  |
| `auto_ordered` | boolean | YES | false |  |
| `auto_order_trigger` | text | YES |  |  |
| `buy_urls` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `quality_backfill_state`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | integer | NO | 1 |  |
| `last_vehicle_id` | uuid | YES |  |  |
| `total_updated` | bigint | YES | 0 |  |
| `completed` | boolean | YES | false |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `range_min` | uuid | YES |  |  |
| `range_max` | uuid | YES |  |  |

### `queue_lock_health`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `table_name` | text | YES |  |  |
| `locked_count` | bigint | YES |  |  |
| `stale_count` | bigint | YES |  |  |
| `oldest_lock` | timestamp with time zone | YES |  |  |
| `newest_lock` | timestamp with time zone | YES |  |  |

### `radiators`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `radiator_type` | text | YES |  | Flow direction: crossflow, downflow, dual_pass, other. |
| `core_material` | text | YES |  | Core material: copper_brass, aluminum, plastic_aluminum, other. |
| `tank_material` | text | YES |  | Tank material: brass, aluminum, plastic, other. |
| `rows` | integer | YES |  | Number of tube rows, 1-6. |
| `tube_size` | text | YES |  | Tube size description, e.g. 1_inch, 5_8_inch. |
| `core_width_inches` | numeric | YES |  | Core width in inches. |
| `core_height_inches` | numeric | YES |  | Core height in inches. |
| `core_thickness_inches` | numeric | YES |  | Core thickness (depth) in inches. |
| `capacity_quarts` | numeric | YES |  | Radiator coolant capacity in quarts. |
| `cap_pressure_psi` | integer | YES |  | Radiator cap pressure rating in PSI. |
| `inlet_location` | text | YES |  | Inlet hose connection location, e.g. upper_left, upper_right. |
| `outlet_location` | text | YES |  | Outlet hose connection location, e.g. lower_left, lower_right. |
| `trans_cooler_built_in` | boolean | YES | false | True if automatic transmission cooler is built into the radiator. |
| `manufacturer` | text | YES |  | Radiator manufacturer, e.g. Harrison, Champion, Griffin, Be Cool. |
| `part_number` | text | YES |  | Radiator part number. |
| `fin_density_fpi` | integer | YES |  | Fin density in fins per inch. |
| `is_original` | boolean | YES | true | True if factory-installed radiator. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. re-cored in 2019, minor seepage at tank seam. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_axles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  | Housing casting number. |
| `part_number` | text | YES |  | Assembly part number. |
| `axle_code` | text | YES |  | Axle code stamped on housing or tag, e.g. GM RPO code GU6. |
| `date_code` | text | YES |  | Date code stamped on the housing or tag. |
| `manufacturer` | text | YES |  | Axle manufacturer, e.g. Dana, GM Corporate, Ford, Chrysler, AAM, Eaton. |
| `model` | text | YES |  | Axle model, e.g. Dana 60, GM 12-bolt, Ford 9-inch, Chrysler 8.75. |
| `housing_type` | text | YES |  | Housing style: banjo, salisbury, semi_floating, full_floating, irs, other. |
| `ring_gear_diameter_inches` | numeric | YES |  | Ring gear diameter in inches, e.g. 8.875 for GM 12-bolt. |
| `ratio` | numeric | YES |  | Gear ratio, e.g. 3.730, 4.100, 4.560. |
| `spline_count` | integer | YES |  | Axle shaft spline count. |
| `limited_slip_type` | text | YES |  | Differential type: open, clutch_type, cone_type, gear_type, viscous, electronic, locker, spool, mini_spool, other. |
| `limited_slip_manufacturer` | text | YES |  | LSD/locker manufacturer, e.g. Eaton, Auburn, Detroit Truetrac, ARB. |
| `limited_slip_model` | text | YES |  | LSD/locker model name. |
| `axle_shaft_type` | text | YES |  | Shaft type, e.g. c_clip, full_floating, press_fit. |
| `axle_shaft_material` | text | YES |  | Shaft material, e.g. 1541h, 4340_chromoly, oem. |
| `axle_shaft_c_clip` | boolean | YES |  | True if axle shafts are retained by C-clips in the differential. |
| `axle_bearing_type` | text | YES |  | Axle bearing type, e.g. ball, tapered_roller, sealed_unit. |
| `hub_bolt_count` | integer | YES |  | Number of wheel studs per hub. |
| `hub_bolt_pattern` | text | YES |  | Bolt pattern, e.g. 5x4.75, 6x5.5. |
| `cover_type` | text | YES |  | Differential cover type, e.g. stamped_steel, cast_aluminum, finned_aluminum, girdle. |
| `cover_material` | text | YES |  | Cover material. |
| `fluid_type` | text | YES |  | Required gear oil, e.g. gl5_75w90, gl5_80w90_ls. |
| `fluid_capacity_quarts` | numeric | YES |  | Gear oil capacity in quarts. |
| `gross_axle_weight_rating_lbs` | integer | YES |  | GAWR in pounds. |
| `width_inches` | numeric | YES |  | Overall axle width in inches (flange to flange). |
| `pinion_offset_inches` | numeric | YES |  | Pinion offset from axle centerline (hypoid offset) in inches. |
| `is_original` | boolean | YES | true | True if factory-installed rear axle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_cargo_areas`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `cargo_material` | text | YES |  | Cargo floor surface: carpet, rubber, vinyl, bare_metal, spray_liner, drop_in_liner, wood, other. |
| `spare_tire_location` | text | YES |  | Spare tire storage location: underbody, inside_cargo, bumper_mount, roof_rack, absent, not_applicable, other. |
| `cargo_mat` | text | YES |  | Cargo mat description, e.g. factory_rubber, aftermarket_all_weather, none. |
| `tie_downs` | text | YES |  | Tie-down hardware description, e.g. factory_d_rings, aftermarket_cleats, none. |
| `cargo_cover_type` | text | YES |  | Cargo cover type: rigid_panel, roll_up, soft_tonneau, hard_tonneau, none, other. |
| `spare_present_yn` | boolean | YES |  | True if spare tire is present. |
| `jack_present_yn` | boolean | YES |  | True if factory or supplemental jack is present. |
| `tools_present_yn` | boolean | YES |  | True if factory tool kit (lug wrench, etc.) is present. |
| `third_seat_yn` | boolean | YES | false | True if a third-row/rumble seat is installed in this cargo area. |
| `is_original` | boolean | YES | true | True if cargo area is in factory-original configuration. |
| `condition_grade` | text | YES | 'unknown' | Overall cargo area condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Configuration origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_dampers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `manufacturer` | text | YES |  | Damper manufacturer, e.g. Bilstein, Monroe, KYB, Koni. |
| `model` | text | YES |  | Model name, e.g. 5100 Series, Sensatrac, Sport. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `damper_type` | text | YES |  | Type: mono_tube, twin_tube, coilover, air, other. |
| `valving` | text | YES |  | Valving description or specification. |
| `adjustable` | boolean | YES | false | True if damping is externally adjustable. |
| `adjustment_positions` | integer | YES |  | Number of adjustment positions if adjustable. |
| `extended_length_inches` | numeric | YES |  | Fully extended length in inches. |
| `compressed_length_inches` | numeric | YES |  | Fully compressed length in inches. |
| `shaft_diameter_mm` | numeric | YES |  | Piston shaft diameter in mm. |
| `body_diameter_mm` | numeric | YES |  | Shock body outer diameter in mm. |
| `mount_type_upper` | text | YES |  | Upper mount type, e.g. stem, bar_pin, eye, stud. |
| `mount_type_lower` | text | YES |  | Lower mount type, e.g. stem, bar_pin, eye, stud. |
| `reservoir_type` | text | YES |  | Reservoir type, e.g. internal, remote, piggyback, none. |
| `gas_charged` | boolean | YES |  | True if gas (nitrogen) charged. |
| `stagger_position` | text | YES |  | Stagger shock position if applicable, e.g. front_of_axle, rear_of_axle. |
| `is_original` | boolean | YES | true | True if factory-installed damper. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_springs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | NO |  | Which side: left or right. Values: `left`, `right` |
| `spring_type` | text | YES |  | Spring type: coil, leaf, torsion_bar, air, other. |
| `rate_lbs_in` | numeric | YES |  | Spring rate in pounds per inch. |
| `free_length_inches` | numeric | YES |  | Uncompressed free length in inches (coil springs). |
| `installed_length_inches` | numeric | YES |  | Installed/compressed length in inches. |
| `material` | text | YES |  | Spring material: steel, chrome_vanadium, chrome_silicon, composite, other. |
| `wire_diameter_mm` | numeric | YES |  | Coil spring wire diameter in mm. |
| `coil_count` | numeric | YES |  | Number of coils (coil springs). May be fractional. |
| `leaf_count` | integer | YES |  | Number of leaves (leaf springs). |
| `leaf_width_inches` | numeric | YES |  | Leaf width in inches (leaf springs). |
| `leaf_thickness_inches` | numeric | YES |  | Individual leaf thickness in inches. |
| `eye_type` | text | YES |  | Leaf spring eye type, e.g. standard_eye, military_wrap, berlin_eye. |
| `progressive_rate` | boolean | YES | false | True if spring has a progressive (variable) rate. |
| `helper_spring` | boolean | YES | false | True if helper/overload spring is present. |
| `overload_leaf` | boolean | YES | false | True if an overload leaf is included in the pack. |
| `part_number` | text | YES |  | Spring part number. |
| `manufacturer` | text | YES |  | Spring manufacturer. |
| `color_code` | text | YES |  | Factory color code or stripe identification. |
| `is_original` | boolean | YES | true | True if factory-installed spring. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_suspension_config`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `suspension_type` | text | YES |  | Type: leaf_spring, coil_spring, coilover, irs, torsion_bar, air_ride, other. |
| `axle_type` | text | YES |  | Axle type: semi_floating, full_floating, independent, 3_quarter_floating, other. |
| `axle_ratio` | text | YES |  | Ring and pinion ratio, e.g. 3.73, 4.10, 4.56. |
| `axle_spline_count` | integer | YES |  | Axle shaft spline count, e.g. 28, 31, 33, 35, 40. |
| `axle_part_number` | text | YES |  | Axle housing or assembly part number. |
| `ride_height_spec_mm` | numeric | YES |  | Factory ride height specification in mm. |
| `wheel_travel_mm` | numeric | YES |  | Total wheel travel in mm. |
| `camber_degrees` | numeric | YES |  | Rear camber specification in degrees. |
| `camber_tolerance` | numeric | YES |  | Rear camber tolerance +/- in degrees. |
| `toe_in_mm` | numeric | YES |  | Rear toe specification in mm. |
| `toe_tolerance_mm` | numeric | YES |  | Rear toe tolerance +/- in mm. |
| `thrust_angle_degrees` | numeric | YES |  | Thrust angle specification in degrees. |
| `thrust_angle_tolerance` | numeric | YES |  | Thrust angle tolerance +/- in degrees. |
| `pinion_angle_degrees` | numeric | YES |  | Driveshaft pinion angle in degrees. |
| `is_original` | boolean | YES | true | True if factory-original rear suspension configuration. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_sway_bars`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `diameter_mm` | numeric | YES |  | Bar diameter in mm. |
| `material` | text | YES |  | Bar material: steel, chromoly, aluminum, hollow, other. |
| `type` | text | YES |  | Bar construction: solid, hollow, splined, other. |
| `end_link_type` | text | YES |  | End link type, e.g. dogbone, ball_joint, adjustable_rod_end. |
| `end_link_part_number` | text | YES |  | End link part number. |
| `bushing_type` | text | YES |  | Bushing style, e.g. split, clam_shell, greaseable. |
| `bushing_material` | text | YES |  | Bushing material: rubber, polyurethane, delrin, bronze, spherical, other. |
| `adjustable` | boolean | YES | false | True if bar has multiple mounting holes for rate adjustment. |
| `adjustment_holes` | integer | YES |  | Number of adjustment holes per arm. |
| `part_number` | text | YES |  | Sway bar part number. |
| `manufacturer` | text | YES |  | Manufacturer, e.g. Addco, Hellwig, factory. |
| `is_original` | boolean | YES | true | True if factory-installed sway bar. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `rear_trailing_arms_and_links`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `side` | text | YES |  | Which side: left, right, or center (for panhard/watts). NULL for shared components. |
| `link_position` | text | YES |  | Link position description, e.g. upper, lower, lateral, diagonal. |
| `link_type` | text | YES |  | Link type: trailing_arm, 4_link, 3_link, watts_link, panhard, torque_arm, ladder_bar, traction_bar, other. |
| `material` | text | YES |  | Link material: steel, chromoly, aluminum, tubular_steel, other. |
| `bushing_type` | text | YES |  | Bushing style, e.g. press_in, bolt_through, bonded. |
| `bushing_material` | text | YES |  | Bushing material: rubber, polyurethane, delrin, spherical, other. |
| `adjustable` | boolean | YES | false | True if link length is adjustable (threaded body or heim joints). |
| `length_inches` | numeric | YES |  | Link length center-to-center in inches. |
| `part_number` | text | YES |  | Link part number. |
| `manufacturer` | text | YES |  | Link manufacturer. |
| `is_original` | boolean | YES | true | True if factory-installed link. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `reference_coverage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model_family` | text | NO |  |  |
| `year_range_start` | integer | NO |  |  |
| `year_range_end` | integer | NO |  |  |
| `topic` | text | NO |  |  |
| `coverage_status` | text | YES | 'missing' |  |
| `coverage_percentage` | integer | YES | 0 |  |
| `available_documents` | ARRAY | YES |  |  |
| `available_sources` | jsonb | YES |  |  |
| `missing_references` | ARRAY | YES |  |  |
| `gap_description` | text | YES |  |  |
| `blocked_analyses_count` | integer | YES | 0 |  |
| `last_assessed` | timestamp with time zone | YES | now() |  |
| `assessed_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `reference_library_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `series` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `document_count` | bigint | YES |  |  |
| `vehicle_count` | bigint | YES |  |  |
| `contributor_count` | bigint | YES |  |  |
| `total_downloads` | bigint | YES |  |  |
| `total_views` | bigint | YES |  |  |
| `last_updated` | timestamp with time zone | YES |  |  |
| `is_verified` | boolean | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |

### `repair_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `overall_score` | integer | YES |  |  |
| `issues` | ARRAY | YES |  |  |
| `needs_bat_images` | boolean | YES |  |  |
| `needs_price_backfill` | boolean | YES |  |  |
| `needs_vin_lookup` | boolean | YES |  |  |
| `needs_deletion` | boolean | YES |  |  |
| `image_count` | integer | YES |  |  |
| `bat_image_count` | integer | YES |  |  |
| `dropbox_image_count` | integer | YES |  |  |
| `repair_action` | text | YES |  |  |
| `priority` | text | YES |  |  |

### `research_queue`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `search_type` | text | YES |  |  |
| `search_query` | text | YES |  |  |
| `priority` | integer | YES |  |  |
| `year` | text | YES |  |  |
| `make` | text | YES |  |  |
| `component_types` | ARRAY | YES |  |  |
| `target_sources` | ARRAY | YES |  |  |
| `status` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `gap_description` | text | YES |  |  |
| `impact_count` | integer | YES |  |  |

### `research_requests`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `triggered_by_analysis_id` | uuid | YES |  |  |
| `triggered_by_gap_id` | uuid | YES |  |  |
| `triggered_by_user_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_context` | jsonb | NO |  |  |
| `search_type` | text | NO |  |  |
| `search_query` | text | NO |  |  |
| `component_types` | ARRAY | YES |  |  |
| `target_sources` | ARRAY | YES |  |  |
| `search_strategy` | jsonb | YES |  |  |
| `priority` | integer | YES | 5 |  |
| `status` | text | YES | 'pending' |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `results_found` | integer | YES | 0 |  |
| `sources_searched` | ARRAY | YES |  |  |
| `sources_successful` | ARRAY | YES |  |  |
| `reference_documents_created` | ARRAY | YES |  |  |
| `component_definitions_created` | ARRAY | YES |  |  |
| `parts_pricing_added` | integer | YES | 0 |  |
| `error_log` | jsonb | YES |  |  |
| `retry_count` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `role_change_requests`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `current_role_value` | text | YES |  |  |
| `requested_role` | text | NO |  |  Values: `viewer`, `contributor`, `photographer`, `previous_owner`, `mechanic`, `restorer` ... (10 total) |
| `reason` | text | NO |  |  |
| `evidence` | jsonb | YES | '{}' |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `approved`, `rejected`, `expired` |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `review_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `expires_at` | timestamp with time zone | YES | (now() + '30 days'::interval) |  |

### `role_requirements`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `role_name` | text | NO |  |  |
| `requires_documents` | boolean | YES | false |  |
| `required_document_types` | ARRAY | YES | '{}'[] |  |
| `requires_experience_proof` | boolean | YES | false |  |
| `requires_professional_reference` | boolean | YES | false |  |
| `requires_owner_approval` | boolean | YES | true |  |
| `approval_level` | text | YES | 'standard' |  Values: `standard`, `elevated`, `admin` |
| `description` | text | NO |  |  |
| `permissions` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `rpo_code_definitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `code` | text | NO |  |  |
| `name` | text | NO |  |  |
| `category` | text | NO |  |  |
| `description` | text | YES |  |  |
| `engine_displacement` | text | YES |  |  |
| `engine_liters` | numeric | YES |  |  |
| `transmission_model` | text | YES |  |  |
| `transmission_type` | text | YES |  |  |
| `trim_name` | text | YES |  |  |
| `years_applicable` | ARRAY | YES |  |  |
| `make` | text | YES | 'GM' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `rpo_code_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `code` | text | NO |  |  |
| `description` | text | NO |  |  |
| `source_vehicle_id` | uuid | YES |  |  |
| `source_spid_image_id` | uuid | YES |  |  |
| `vehicle_year` | integer | YES |  |  |
| `vehicle_model` | text | YES |  |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `extraction_model` | text | YES |  |  |

### `rpo_consensus_definitions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `code` | text | YES |  |  |
| `consensus_description` | text | YES |  |  |
| `seen_on_vehicles` | bigint | YES |  |  |
| `all_descriptions_seen` | ARRAY | YES |  |  |
| `years_seen` | ARRAY | YES |  |  |
| `models_seen` | ARRAY | YES |  |  |
| `first_seen` | timestamp with time zone | YES |  |  |
| `last_seen` | timestamp with time zone | YES |  |  |

### `safety_equipment`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `seatbelts` | jsonb | YES | '[]' | JSONB array of per-position seatbelt specs. Each element: {position: "driver"/"passenger"/"rear_left"/"rear_center"/"rear_right", type: "lap"/"3_point"/"4_point"/"5_point"/"6_point"/"none", manufacturer: text, condition: text, date_code: text}. |
| `airbag_equipped` | boolean | YES | false | True if any airbags are installed. |
| `airbag_locations` | ARRAY | YES |  | Array of airbag locations, e.g. {driver_wheel, passenger_dash, side_curtain, knee}. |
| `airbag_module_manufacturer` | text | YES |  | Airbag control module manufacturer. |
| `airbag_warning_light_status` | text | YES |  | Airbag warning light status, e.g. off, illuminated, flashing, removed. |
| `roll_protection` | text | YES |  | Roll protection level: none, roll_bar, half_cage, full_cage, factory_rops, other. |
| `roll_bar_manufacturer` | text | YES |  | Roll bar/cage manufacturer, e.g. Autopower, Kirk, custom. |
| `roll_bar_material` | text | YES |  | Roll bar material, e.g. mild_steel, chromoly, dom_tubing. |
| `roll_bar_tube_diameter_inches` | numeric | YES |  | Roll bar tube outer diameter in inches. |
| `roll_bar_padding_yn` | boolean | YES |  | True if roll bar padding is installed. |
| `roll_bar_certified` | text | YES |  | Certification standard, e.g. scca, nhra_8_50, fia, nhra_7_50, none. |
| `fire_extinguisher_yn` | boolean | YES | false | True if fire extinguisher is installed. |
| `fire_extinguisher_type` | text | YES |  | Extinguisher type, e.g. halon, dry_chemical, afff, clean_agent. |
| `fire_extinguisher_mount` | text | YES |  | Mount location, e.g. driver_seat, center_tunnel, trunk. |
| `kill_switch_yn` | boolean | YES | false | True if master kill switch is installed. |
| `kill_switch_location` | text | YES |  | Kill switch location, e.g. dash, rear_of_vehicle, under_hood. |
| `window_net_yn` | boolean | YES | false | True if window net(s) installed. |
| `window_net_type` | text | YES |  | Window net type, e.g. mesh, ribbon, sfi_rated. |
| `harness_bar_yn` | boolean | YES | false | True if harness bar is installed for racing harnesses. |
| `arm_restraints_yn` | boolean | YES | false | True if arm restraints are installed. |
| `first_aid_kit_yn` | boolean | YES | false | True if first aid kit is present. |
| `is_original` | boolean | YES | true | True if factory-original safety equipment. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. seatbelt webbing frayed, retractor stiff. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `schema_migrations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `version` | bigint | NO |  |  |
| `inserted_at` | timestamp without time zone | YES |  |  |

### `scraper_versions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `scraper_name` | text | NO |  |  |
| `version` | text | NO |  |  |
| `improvements` | ARRAY | YES | ARRAY[][] |  |
| `fields_affected` | ARRAY | YES | ARRAY[][] |  |
| `bug_fixes` | ARRAY | YES | ARRAY[][] |  |
| `backfill_required` | boolean | YES | false |  |
| `backfill_priority` | integer | YES | 5 |  |
| `backfill_completed` | boolean | YES | false |  |
| `backfilled_count` | integer | YES | 0 |  |
| `deployed_at` | timestamp with time zone | YES | now() |  |
| `deployed_by` | text | YES |  |  |
| `release_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `search_analytics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `query` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `result_count` | integer | YES |  |  |
| `timestamp` | timestamp with time zone | YES | now() |  |
| `session_id` | text | YES |  |  |
| `filters` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `seats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `position` | text | NO |  | Seat position: driver, passenger, rear_left, rear_center, rear_right, third_row_left, third_row_right. |
| `seat_type` | text | YES |  | Seat style: bucket, bench, sport, racing, captain, other. |
| `material` | text | YES |  | Primary surface material: vinyl, cloth, leather, alcantara, velour, other. |
| `color` | text | YES |  | Seat color as described or observed, e.g. black, saddle, parchment. |
| `headrest_type` | text | YES |  | Headrest style, e.g. integrated, adjustable_separate, none. |
| `power_yn` | boolean | YES |  | True if seat has power adjustment motors. |
| `heated_yn` | boolean | YES |  | True if seat has heating elements. |
| `cooled_yn` | boolean | YES |  | True if seat has ventilation/cooling. |
| `lumbar_yn` | boolean | YES |  | True if seat has lumbar support (power or manual). |
| `track_operation` | text | YES |  | Fore-aft track operation: full_range, partial_range, stuck, missing, not_applicable. |
| `recliner_operation` | text | YES |  | Seatback recliner state: functional, stiff, stuck, missing, not_applicable. |
| `bolster_condition` | text | YES |  | Condition of seat bolsters, e.g. excellent, cracked, worn_through. |
| `foam_condition` | text | YES |  | Condition of seat cushion foam, e.g. firm, collapsed, replaced. |
| `frame_condition` | text | YES |  | Condition of seat frame/structure, e.g. solid, cracked, repaired. |
| `is_original` | boolean | YES | true | True if factory-installed seat for this position. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: manufacturer, part number, date acquired. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `secure_document_duplicates`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `file_hash` | text | YES |  |  |
| `cnt` | bigint | YES |  |  |

### `security_audit_log`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `event_type` | character varying | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `ip_address` | inet | YES |  |  |
| `user_agent` | text | YES |  |  |
| `details` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `seller_blocklist`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `fingerprint_type` | text | NO |  |  Values: `domain`, `phone`, `email`, `cl_user`, `name` |
| `fingerprint_value` | text | NO |  |  |
| `reason` | text | NO |  |  Values: `scammer`, `dealer`, `fraudulent`, `spam`, `overpriced` |
| `notes` | text | YES |  |  |
| `active` | boolean | NO | true |  |
| `first_seen_url` | text | YES |  |  |
| `blocked_at` | timestamp with time zone | NO | now() |  |
| `blocked_by` | text | NO | 'system' |  |

### `seller_sightings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `seller_id` | uuid | NO |  |  |
| `pipeline_id` | uuid | YES |  |  |
| `platform` | text | NO | 'craigslist' |  |
| `region` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `url` | text | NO |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `listing_status` | text | YES | 'active' |  Values: `active`, `price_drop`, `relisted`, `sold`, `removed`, `unknown` |
| `deal_score` | integer | YES |  |  |
| `price_delta` | numeric | YES |  |  |
| `is_new_listing` | boolean | YES | true |  |
| `is_cross_region` | boolean | YES | false |  |
| `vehicle_fingerprint` | text | YES |  |  |
| `seen_at` | timestamp with time zone | NO | now() |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `seller_tiers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `seller_id` | uuid | NO |  |  |
| `tier` | text | NO | 'C' |  Values: `C`, `B`, `A`, `S`, `SS`, `SSS` |
| `total_sales` | integer | YES | 0 |  |
| `successful_sales` | integer | YES | 0 |  |
| `total_revenue_cents` | bigint | YES | 0 |  |
| `average_rating` | numeric | YES |  |  |
| `completion_rate` | numeric | YES |  |  |
| `no_reserve_qualification` | boolean | YES | false |  |
| `average_vehicle_quality_score` | integer | YES |  |  |
| `documentation_score` | integer | YES |  |  |
| `condition_accuracy_score` | integer | YES |  |  |
| `tier_updated_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `platform_tier` | text | YES |  |  Values: `F`, `E`, `D`, `C`, `B`, `A` |
| `platform_score` | integer | YES | 0 |  |
| `platform_tier_breakdown` | jsonb | YES | '{}' |  |
| `platform_tier_updated_at` | timestamp with time zone | YES |  |  |
| `s_tier_eligibility_score` | integer | YES | 0 |  |
| `s_tier_invitation_status` | text | YES | 'not_eligible' |  Values: `not_eligible`, `tracking`, `eligible`, `invited`, `declined` |
| `s_tier_eligibility_updated_at` | timestamp with time zone | YES |  |  |
| `eligibility_tracks` | jsonb | YES | '{}' |  |

### `service_integrations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `service_key` | text | NO |  |  |
| `service_name` | text | NO |  |  |
| `provider` | text | NO |  |  |
| `category` | text | NO |  |  Values: `documentation`, `history`, `appraisal`, `marketplace`, `inspection`, `certification` |
| `integration_type` | text | NO |  |  Values: `api`, `email`, `web_form`, `manual`, `webhook` |
| `endpoint_url` | text | YES |  |  |
| `auth_method` | text | YES |  |  |
| `trigger_mode` | text | NO |  |  Values: `auto`, `manual`, `conditional` |
| `trigger_conditions` | jsonb | YES |  |  |
| `required_fields` | ARRAY | YES |  |  |
| `is_free` | boolean | YES | true |  |
| `price_usd` | numeric | YES |  |  |
| `price_type` | text | YES |  |  |
| `avg_turnaround_hours` | numeric | YES |  |  |
| `success_rate` | numeric | YES |  |  |
| `fields_populated` | ARRAY | YES |  |  |
| `document_types` | ARRAY | YES |  |  |
| `is_enabled` | boolean | YES | true |  |
| `is_beta` | boolean | YES | false |  |
| `requires_approval` | boolean | YES | false |  |
| `description` | text | YES |  |  |
| `icon_url` | text | YES |  |  |
| `documentation_url` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `session_narratives`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `session_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `narrative` | text | NO |  |  |
| `summary` | text | YES |  |  |
| `key_observations` | ARRAY | YES |  |  |
| `session_type_key` | text | YES |  |  |
| `continuity_note` | text | YES |  |  |
| `source` | text | NO |  |  |
| `pass_number` | smallint | YES | 1 |  |
| `confidence` | numeric | YES |  |  |
| `image_descriptions_used` | ARRAY | YES |  |  |
| `evidence` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `session_type_taxonomy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `canonical_key` | text | NO |  |  |
| `display_label` | text | NO |  |  |
| `category` | text | NO |  |  |
| `description` | text | YES |  |  |
| `typical_zone_pattern` | ARRAY | YES |  |  |
| `typical_photo_count_range` | int4range | YES |  |  |
| `example_keywords` | ARRAY | YES |  |  |
| `taxonomy_version` | text | YES | 'v1_2026_03' |  |
| `deprecated_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `share_holdings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `offering_id` | uuid | NO |  |  |
| `holder_id` | uuid | NO |  |  |
| `shares_owned` | integer | NO |  |  |
| `entry_price` | numeric | NO |  |  |
| `entry_date` | timestamp with time zone | YES | now() |  |
| `current_mark` | numeric | NO |  |  |
| `unrealized_gain_loss` | numeric | YES |  |  |
| `unrealized_gain_loss_pct` | numeric | YES |  |  |
| `total_bought` | integer | YES | 0 |  |
| `total_sold` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `shop_fee_settings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `business_id` | uuid | NO |  |  |
| `shop_fee_type` | text | YES |  |  Values: `flat`, `percentage`, `tiered`, `none` |
| `shop_fee_amount` | numeric | YES |  |  |
| `shop_fee_description` | text | YES | 'Shop fee' |  |
| `additional_fees` | jsonb | YES | '[]' |  |
| `overhead_percentage` | numeric | YES | 0 |  |
| `parts_markup_percentage` | numeric | YES | 0 |  |
| `default_payment_terms` | text | YES | 'Due on completion' |  |
| `requires_deposit` | boolean | YES | false |  |
| `deposit_percentage` | numeric | YES | 0 |  |
| `effective_date` | date | YES | CURRENT_DATE |  |
| `expiration_date` | date | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `shop_invitations_archived_20260129`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `shop_id` | uuid | NO |  |  |
| `email` | text | NO |  |  |
| `role` | USER-DEFINED | NO | 'staff'::shop_member_role |  |
| `invited_by` | uuid | NO |  |  |
| `token` | text | NO |  |  |
| `status` | USER-DEFINED | NO | 'pending'::invite_status |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `department_id` | uuid | YES |  |  |

### `shop_licenses`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `shop_id` | uuid | NO |  |  |
| `location_id` | uuid | YES |  |  |
| `license_type` | text | NO |  |  |
| `license_number` | text | NO |  |  |
| `issuing_authority` | text | YES |  |  |
| `issued_date` | date | YES |  |  |
| `expiration_date` | date | YES |  |  |
| `document_id` | uuid | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `verified` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `shop_locations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `shop_id` | uuid | NO |  |  |
| `name` | text | NO |  |  |
| `is_primary` | boolean | YES | false |  |
| `address_line1` | text | NO |  |  |
| `address_line2` | text | YES |  |  |
| `city` | text | NO |  |  |
| `state` | text | NO |  |  |
| `postal_code` | text | NO |  |  |
| `country` | text | NO | 'US' |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `hours_of_operation` | jsonb | YES | '{}' |  |
| `is_active` | boolean | YES | true |  |
| `settings` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `is_headquarters` | boolean | YES | false |  |

### `shoppable_tags_with_suppliers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `image_id` | uuid | YES |  |  |
| `x_position` | double precision | YES |  |  |
| `y_position` | double precision | YES |  |  |
| `tag_type` | character varying | YES |  |  |
| `text` | text | YES |  |  |
| `verification_status` | character varying | YES |  |  |
| `trust_score` | integer | YES |  |  |
| `created_by` | character varying | YES |  |  |
| `verified_by` | character varying | YES |  |  |
| `verified_at` | timestamp without time zone | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `inserted_at` | timestamp without time zone | YES |  |  |
| `updated_at` | timestamp without time zone | YES |  |  |
| `product_id` | uuid | YES |  |  |
| `product_relation` | character varying | YES |  |  |
| `service_id` | uuid | YES |  |  |
| `service_status` | character varying | YES |  |  |
| `technician_id` | uuid | YES |  |  |
| `shop_id` | uuid | YES |  |  |
| `service_date` | timestamp without time zone | YES |  |  |
| `service_cost_cents` | integer | YES |  |  |
| `service_warranty_expires` | timestamp without time zone | YES |  |  |
| `source_type` | text | YES |  |  |
| `exif_data` | jsonb | YES |  |  |
| `gps_coordinates` | jsonb | YES |  |  |
| `automated_confidence` | double precision | YES |  |  |
| `needs_human_verification` | boolean | YES |  |  |
| `condition_before` | character varying | YES |  |  |
| `condition_after` | character varying | YES |  |  |
| `severity_level` | character varying | YES |  |  |
| `estimated_cost_cents` | integer | YES |  |  |
| `insurance_claim_number` | character varying | YES |  |  |
| `work_order_number` | character varying | YES |  |  |
| `work_started_at` | timestamp without time zone | YES |  |  |
| `work_completed_at` | timestamp without time zone | YES |  |  |
| `estimated_completion` | timestamp without time zone | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `tag_name` | text | YES |  |  |
| `width` | numeric | YES |  |  |
| `height` | numeric | YES |  |  |
| `confidence` | integer | YES |  |  |
| `ai_detection_data` | jsonb | YES |  |  |
| `verified` | boolean | YES |  |  |
| `manual_override` | boolean | YES |  |  |
| `training_feedback` | jsonb | YES |  |  |
| `parent_tag_id` | uuid | YES |  |  |
| `validation_status` | text | YES |  |  |
| `validation_stage` | integer | YES |  |  |
| `related_image_ids` | ARRAY | YES |  |  |
| `cross_validation_count` | integer | YES |  |  |
| `reasoning` | ARRAY | YES |  |  |
| `oem_part_number` | text | YES |  |  |
| `aftermarket_part_numbers` | ARRAY | YES |  |  |
| `part_description` | text | YES |  |  |
| `fits_vehicles` | ARRAY | YES |  |  |
| `suppliers` | jsonb | YES |  |  |
| `lowest_price_cents` | integer | YES |  |  |
| `highest_price_cents` | integer | YES |  |  |
| `price_last_updated` | timestamp with time zone | YES |  |  |
| `is_shoppable` | boolean | YES |  |  |
| `affiliate_links` | jsonb | YES |  |  |
| `condition` | text | YES |  |  |
| `warranty_info` | text | YES |  |  |
| `install_difficulty` | text | YES |  |  |
| `estimated_install_time_minutes` | integer | YES |  |  |
| `receipt_line_item_id` | uuid | YES |  |  |
| `labor_record_id` | uuid | YES |  |  |
| `part_installed_by` | uuid | YES |  |  |
| `install_shop_id` | uuid | YES |  |  |
| `install_labor_hours` | numeric | YES |  |  |
| `install_labor_rate` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `catalog_part_name` | text | YES |  |  |
| `catalog_description` | text | YES |  |  |
| `install_notes` | text | YES |  |  |
| `supplier_listings` | jsonb | YES |  |  |
| `supplier_name` | text | YES |  |  |
| `supplier_url` | text | YES |  |  |
| `commission_rate` | numeric | YES |  |  |

### `shops_archived_20260129`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | character varying | NO |  |  |
| `business_type` | character varying | NO |  |  |
| `license_number` | character varying | YES |  |  |
| `certifications` | ARRAY | YES | ARRAY[][] |  |
| `services_offered` | ARRAY | YES | ARRAY[][] |  |
| `contact_info` | jsonb | YES | '{}' |  |
| `address` | jsonb | YES | '{}' |  |
| `business_hours` | jsonb | YES | '{}' |  |
| `specializes_in` | ARRAY | YES | ARRAY[][] |  |
| `equipment_available` | ARRAY | YES | ARRAY[][] |  |
| `active` | boolean | YES | true |  |
| `inserted_at` | timestamp without time zone | NO |  |  |
| `updated_at` | timestamp without time zone | NO | now() |  |
| `slug` | text | YES |  |  |
| `description` | text | YES |  |  |
| `category` | text | YES | 'automotive' |  |
| `status` | text | YES | 'pending' |  |
| `business_name` | text | YES |  |  |
| `tax_id` | text | YES |  |  |
| `email` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `website` | text | YES |  |  |
| `address_line1` | text | YES |  |  |
| `address_line2` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `postal_code` | text | YES |  |  |
| `country` | text | YES | 'US' |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `logo_url` | text | YES |  |  |
| `banner_url` | text | YES |  |  |
| `hours_of_operation` | jsonb | YES | '{}' |  |
| `settings` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `created_by` | uuid | YES |  | Legacy column - shop creator, may be same as owner_user_id |
| `owner_user_id` | uuid | YES |  | Primary owner/creator of the shop - used by shops_core.sql |
| `is_verified` | boolean | YES | false |  |
| `website_url` | text | YES |  |  |
| `location_city` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `location_country` | text | YES |  |  |
| `is_public` | boolean | YES | true |  |
| `verification_status` | text | YES | 'unverified' |  |
| `display_name` | text | YES |  |  |
| `org_type` | USER-DEFINED | YES | 'shop'::org_type |  |
| `legal_name` | text | YES |  |  |
| `business_entity_type` | USER-DEFINED | YES |  |  |
| `ein_last4` | text | YES |  |  |
| `state_business_id` | text | YES |  |  |
| `license_expiration_date` | date | YES |  |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `verified_by` | uuid | YES |  |  |
| `services` | ARRAY | YES |  |  |
| `specialties` | ARRAY | YES |  |  |
| `service_regions` | ARRAY | YES |  |  |

### `site_scout_candidates`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `run_id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `address` | text | YES |  |  |
| `area` | text | YES |  |  |
| `lat` | double precision | YES |  |  |
| `lng` | double precision | YES |  |  |
| `price` | numeric | YES |  |  |
| `sqft` | numeric | YES |  |  |
| `zoning` | text | YES |  |  |
| `source` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `score` | numeric | YES |  |  |
| `scores` | jsonb | YES |  |  |
| `reasoning` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `site_scout_runs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `started_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `status` | text | NO | 'pending' |  |
| `phase` | text | YES |  |  |
| `candidates_found` | integer | YES | 0 |  |
| `sites_scored` | integer | YES | 0 |  |
| `summary` | text | YES |  |  |
| `area_scores` | jsonb | YES |  |  |
| `top_sites` | jsonb | YES |  |  |
| `error` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `skill_categories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `icon_url` | text | YES |  |  |
| `created_at` | timestamp without time zone | YES | now() |  |

### `sms_conversations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `technician_phone_link_id` | uuid | NO |  |  |
| `state` | text | YES | 'idle' |  Values: `idle`, `awaiting_vehicle`, `awaiting_work_type`, `awaiting_description`, `awaiting_confirmation`, `onboarding_name`, `onboarding_payment`, `onboarding_complete` |
| `context` | jsonb | YES | '{}' |  |
| `current_vehicle_id` | uuid | YES |  |  |
| `recent_messages` | jsonb | YES | '[]' |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `last_message_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `sms_verification_submissions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `from_phone` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `message_sid` | text | YES |  |  |
| `verification_type` | text | NO |  |  Values: `identity`, `title`, `platform_claim`, `phone` |
| `media_urls` | ARRAY | YES | '{}'[] |  |
| `message_body` | text | YES |  |  |
| `ai_processed_at` | timestamp with time zone | YES |  |  |
| `ai_result` | jsonb | YES | '{}' |  |
| `ai_confidence` | numeric | YES |  |  |
| `extracted_name` | text | YES |  |  |
| `extracted_address` | text | YES |  |  |
| `extracted_vin` | text | YES |  |  |
| `extracted_platform` | text | YES |  |  |
| `extracted_handle` | text | YES |  |  |
| `routed_to_table` | text | YES |  |  |
| `routed_to_id` | uuid | YES |  |  |
| `status` | text | YES | 'received' |  Values: `received`, `processing`, `routed`, `needs_more`, `verified`, `rejected` |
| `follow_up_sent_at` | timestamp with time zone | YES |  |  |
| `follow_up_response` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `social_posts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `platform` | text | NO |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `post_id` | text | YES |  |  |
| `content` | text | YES |  |  |
| `post_url` | text | YES |  |  |
| `insight_id` | uuid | YES |  |  |
| `likes` | integer | YES | 0 |  |
| `reposts` | integer | YES | 0 |  |
| `replies` | integer | YES | 0 |  |
| `views` | integer | YES | 0 |  |
| `posted_at` | timestamp with time zone | YES | now() |  |
| `metrics_updated_at` | timestamp with time zone | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |

### `sold_vehicle_proof`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `org_vehicle_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `listing_status` | text | YES |  |  |
| `sale_date` | date | YES |  |  |
| `sale_price` | numeric | YES |  |  |
| `relationship_type` | text | YES |  |  |
| `marked_sold_at` | timestamp with time zone | YES |  |  |
| `org_vehicle_notes` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `proof_url` | text | YES |  |  |
| `proof_platform` | text | YES |  |  |
| `external_listing_id` | uuid | YES |  |  |
| `external_listing_status` | text | YES |  |  |
| `external_final_price` | numeric | YES |  |  |
| `external_sold_at` | timestamp with time zone | YES |  |  |
| `external_end_date` | timestamp with time zone | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `timeline_sale_date` | date | YES |  |  |
| `timeline_title` | text | YES |  |  |
| `timeline_description` | text | YES |  |  |
| `timeline_sale_price` | numeric | YES |  |  |
| `timeline_source` | text | YES |  |  |
| `timeline_bat_url` | text | YES |  |  |
| `lot_number` | text | YES |  |  |
| `validation_proof` | json | YES |  |  |
| `proof_type` | text | YES |  |  |
| `proof_confidence` | integer | YES |  |  |

### `sound_deadening`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `deadening_type` | text | NO | 'none' | Material brand/type: factory, dynamat, second_skin, spray, mass_loaded_vinyl, none, other. Values: `factory`, `dynamat`, `second_skin`, `spray`, `mass_loaded_vinyl`, `none`, `other` |
| `locations_jsonb` | jsonb | YES | '[]' | JSON array of application locations, e.g. ["floor_pan", "firewall", "doors", "roof"]. Empty array if none. |
| `weight_added_lbs` | numeric | YES |  | Estimated weight added by treatment in pounds. |
| `coverage_pct` | numeric | YES |  | Estimated percentage of interior surface covered, 0-100. |
| `condition_grade` | text | YES | 'unknown' | Condition of the deadening material: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. peeling in footwells, dried out. |
| `provenance` | text | YES | 'unknown' | Treatment origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: installer, date, product batch. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `source_census`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `source_id` | uuid | YES |  |  |
| `universe_total` | integer | YES |  |  |
| `universe_active` | integer | YES |  |  |
| `universe_historical` | integer | YES |  |  |
| `census_method` | text | NO |  |  |
| `census_confidence` | numeric | YES |  |  |
| `census_url` | text | YES |  |  |
| `census_notes` | text | YES |  |  |
| `census_at` | timestamp with time zone | NO | now() |  |
| `census_duration_ms` | integer | YES |  |  |
| `next_census_at` | timestamp with time zone | YES |  |  |
| `by_year` | jsonb | YES | '{}' |  |
| `by_make` | jsonb | YES | '{}' |  |
| `by_category` | jsonb | YES | '{}' |  |
| `raw_response` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `estimated_turnover_per_day` | integer | YES |  |  |

### `source_completeness`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `universe_total` | integer | YES |  |  |
| `universe_active` | integer | YES |  |  |
| `census_confidence` | numeric | YES |  |  |
| `census_at` | timestamp with time zone | YES |  |  |
| `vehicles_extracted` | bigint | YES |  |  |
| `completeness_pct` | numeric | YES |  |  |
| `gap` | bigint | YES |  |  |

### `source_dashboard_view`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `category` | text | YES |  |  |
| `status` | text | YES |  |  |
| `extractor_function` | text | YES |  |  |
| `total_extracted` | integer | YES |  |  |
| `total_vehicles_created` | integer | YES |  |  |
| `success_rate_24h` | double precision | YES |  |  |
| `avg_extraction_ms` | integer | YES |  |  |
| `last_successful_at` | timestamp with time zone | YES |  |  |
| `estimated_extraction_hours` | numeric | YES |  |  |
| `monitoring_strategy` | text | YES |  |  |
| `monitoring_frequency_hours` | integer | YES |  |  |
| `listing_url_pattern` | text | YES |  |  |
| `observation_source_id` | uuid | YES |  |  |
| `obs_category` | text | YES |  |  |
| `base_url` | text | YES |  |  |
| `logo_url` | text | YES |  |  |
| `business_name` | text | YES |  |  |
| `business_id` | uuid | YES |  |  |
| `universe_total` | integer | YES |  |  |
| `universe_active` | integer | YES |  |  |
| `census_at` | timestamp with time zone | YES |  |  |

### `source_extraction_methods`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `domain` | text | NO |  |  |
| `display_name` | text | NO |  |  |
| `extraction_method` | text | NO |  |  |
| `extractor_function` | text | YES |  |  |
| `local_script` | text | YES |  |  |
| `fetch_method` | text | NO | 'direct' |  |
| `needs_js_rendering` | boolean | YES | false |  |
| `needs_auth` | boolean | YES | false |  |
| `rate_limit_per_minute` | integer | YES |  |  |
| `avg_extraction_seconds` | numeric | YES |  |  |
| `success_rate` | numeric | YES |  |  |
| `total_extracted` | integer | YES | 0 |  |
| `total_failed` | integer | YES | 0 |  |
| `last_extraction_at` | timestamp with time zone | YES |  |  |
| `status` | text | YES | 'active' |  |
| `broken_reason` | text | YES |  |  |
| `fields_extracted` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `source_extractor_health`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `source_id` | uuid | YES |  |  |
| `source_name` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `is_active` | boolean | YES |  |  |
| `last_successful_scrape` | timestamp with time zone | YES |  |  |
| `extractor_id` | uuid | YES |  |  |
| `extractor_name` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `extractor_status` | text | YES |  |  |
| `success_rate` | numeric | YES |  |  |
| `total_attempts` | integer | YES |  |  |
| `failed_count` | integer | YES |  |  |
| `health_status` | text | YES |  |  |

### `source_quality_current`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `source` | text | YES |  |  |
| `total` | bigint | YES |  |  |
| `ymm_pct` | numeric | YES |  |  |
| `vin_valid_pct` | numeric | YES |  |  |
| `price_pct` | numeric | YES |  |  |
| `avg_score` | numeric | YES |  |  |
| `null_year` | bigint | YES |  |  |
| `null_make` | bigint | YES |  |  |
| `null_or_bad_model` | bigint | YES |  |  |
| `junk_price` | bigint | YES |  |  |
| `bad_vin` | bigint | YES |  |  |

### `source_target_coverage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `source_slug` | text | YES |  |  |
| `total_targets` | bigint | YES |  |  |
| `in_queue` | bigint | YES |  |  |
| `extracted` | bigint | YES |  |  |
| `pending` | bigint | YES |  |  |
| `failed` | bigint | YES |  |  |
| `skipped` | bigint | YES |  |  |
| `duplicate` | bigint | YES |  |  |
| `gap` | bigint | YES |  |  |

### `sources_without_extractors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `url` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `is_active` | boolean | YES |  |  |
| `last_successful_scrape` | timestamp with time zone | YES |  |  |
| `failed_count` | bigint | YES |  |  |
| `success_count` | bigint | YES |  |  |

### `spare_wheel_tire`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `type` | text | YES |  | Spare type: full_size_matching, full_size_different, compact_temporary (donut), none. |
| `location` | text | YES |  | Spare storage location: under_bed, trunk, tailgate_mount, roof_mount, side_mount. |
| `wheel_diameter_inches` | numeric | YES |  | Spare wheel diameter in inches. |
| `wheel_width_inches` | numeric | YES |  | Spare wheel width in inches. |
| `wheel_material` | text | YES |  | Spare wheel material, e.g. steel, cast_alloy, forged_alloy. |
| `wheel_manufacturer` | text | YES |  | Spare wheel manufacturer. |
| `wheel_finish` | text | YES |  | Spare wheel finish, e.g. painted, bare_steel, polished. |
| `wheel_condition` | text | YES |  | Spare wheel condition assessment. |
| `tire_size_designation` | text | YES |  | Spare tire size designation, e.g. T125/70R16, P215/65R15. |
| `tire_brand` | text | YES |  | Spare tire brand. |
| `tire_dot_date_code` | text | YES |  | DOT date code (last 4 digits) on spare tire. |
| `tire_tread_depth_32nds` | numeric | YES |  | Spare tire tread depth in 32nds of an inch. |
| `tire_condition` | text | YES |  | Spare tire condition assessment, e.g. like_new, good, dry_rotted. |
| `inflated_yn` | boolean | YES |  | True if spare is properly inflated. |
| `pressure_psi` | integer | YES |  | Current inflation pressure in PSI. |
| `jack_present_yn` | boolean | YES |  | True if the vehicle jack is present with the spare. |
| `jack_type` | text | YES |  | Jack type, e.g. scissors, bottle, floor, factory_scissors. |
| `lug_wrench_present_yn` | boolean | YES |  | True if the lug wrench is present. |
| `extension_bar_present_yn` | boolean | YES |  | True if a lug wrench extension bar is present (trucks). |
| `wheel_lock_key_present_yn` | boolean | YES |  | True if wheel lock key is present (if vehicle has wheel locks). |
| `is_original` | boolean | YES | true | True if spare is the factory-original spare assembly. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `specialization_taxonomy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `category` | text | NO |  |  |
| `parent_slug` | text | YES |  |  |
| `detection_keywords` | ARRAY | YES | ARRAY[][] |  |
| `detection_event_types` | ARRAY | YES | ARRAY[][] |  |
| `detection_part_categories` | ARRAY | YES | ARRAY[][] |  |
| `market_demand` | text | YES | 'stable' |  |
| `avg_hourly_rate_low` | numeric | YES |  |  |
| `avg_hourly_rate_high` | numeric | YES |  |  |
| `often_paired_with` | ARRAY | YES | ARRAY[][] |  |
| `prerequisite_for` | ARRAY | YES | ARRAY[][] |  |
| `display_order` | integer | YES | 100 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `stage_transition_labor_map`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `from_stage` | text | NO |  |  |
| `to_stage` | text | NO |  |  |
| `zone_pattern` | text | YES | '*' |  |
| `labor_operation_codes` | ARRAY | YES | '{}'[] |  |
| `description` | text | YES |  |  |
| `estimated_hours_min` | real | NO |  |  |
| `estimated_hours_max` | real | NO |  |  |
| `estimated_hours_typical` | real | NO |  |  |
| `materials_cost_min` | real | YES | 0 |  |
| `materials_cost_max` | real | YES | 0 |  |
| `confidence` | text | YES | 'medium' |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `starters`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `type` | text | YES |  | Starter design: gear_reduction, direct_drive, high_torque_mini. |
| `manufacturer` | text | YES |  | Manufacturer, e.g. Delco-Remy, Nippondenso, Powermaster, Tilton. |
| `part_number` | text | YES |  | Manufacturer or OEM part number. |
| `casting_number` | text | YES |  | Casting number on housing for originality verification. |
| `date_code` | text | YES |  | Date code stamped on unit. |
| `torque_lb_ft` | numeric | YES |  | Cranking torque rating in lb-ft. |
| `engagement_type` | text | YES |  | Engagement mechanism, e.g. inertia_bendix, pre_engaged_solenoid. |
| `mounting_block` | text | YES |  | Mounting block/adapter used, e.g. stock, sbc_168_tooth, sbc_153_tooth. |
| `shim_count` | integer | YES |  | Number of shims used between starter and block for pinion clearance. |
| `solenoid_integrated_yn` | boolean | YES |  | True if solenoid is mounted on starter body. |
| `solenoid_part_number` | text | YES |  | Solenoid part number if separate or replacement. |
| `pinion_tooth_count` | integer | YES |  | Number of teeth on starter drive pinion gear. |
| `is_original` | boolean | YES | true | True if factory-installed starter. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. slow crank hot, brushes replaced. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `steering_columns`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `column_type` | text | YES |  | Column type: fixed, tilt, tilt_telescope, telescope, collapsible_fixed, other. |
| `collapsible` | boolean | YES |  | True if column is energy-absorbing/collapsible (post-1967 federal requirement). |
| `key_type` | text | YES |  | Ignition key type: ignition_lock, push_button, keyless, column_lock, other. |
| `column_shift` | boolean | YES | false | True if transmission shift lever is on the column. |
| `shift_indicator` | text | YES |  | Shift indicator type, e.g. column_quadrant, dash_indicator, none. |
| `tilt_range_degrees` | numeric | YES |  | Tilt adjustment range in degrees (tilt columns only). |
| `telescope_range_inches` | numeric | YES |  | Telescope adjustment range in inches. |
| `upper_bearing_type` | text | YES |  | Upper column bearing type. |
| `lower_bearing_type` | text | YES |  | Lower column bearing type. |
| `intermediate_shaft_type` | text | YES |  | Intermediate shaft type, e.g. solid, collapsible, universal_joint. |
| `rag_joint` | boolean | YES |  | True if steering column uses a rag joint (flexible coupling) at the gearbox. |
| `part_number` | text | YES |  | Column assembly part number. |
| `manufacturer` | text | YES |  | Column manufacturer. |
| `length_inches` | numeric | YES |  | Column length in inches. |
| `is_original` | boolean | YES | true | True if factory-installed column. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `steering_gearboxes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `gearbox_type` | text | YES |  | Type: recirculating_ball, rack_and_pinion, worm_and_sector, worm_and_roller, cam_and_lever, other. |
| `ratio_overall` | text | YES |  | Overall steering ratio, e.g. 16:1, 12.7:1. |
| `ratio_on_center` | text | YES |  | On-center steering ratio if variable, e.g. 14:1. |
| `turns_lock_to_lock` | numeric | YES |  | Number of steering wheel turns lock to lock. |
| `power_assist_type` | text | YES |  | Assist type: manual, hydraulic, electric, electro_hydraulic, other. |
| `manufacturer` | text | YES |  | Gearbox manufacturer, e.g. Saginaw, Gemmer, ZF, TRW. |
| `part_number` | text | YES |  | Gearbox part number. |
| `casting_number` | text | YES |  | Casting number on the gearbox housing. |
| `date_code` | text | YES |  | Date code stamped on the gearbox. |
| `sector_shaft_spline_count` | integer | YES |  | Output (sector/pitman) shaft spline count. |
| `input_shaft_spline_count` | integer | YES |  | Input (steering column) shaft spline count. |
| `mounting_bolt_count` | integer | YES |  | Number of frame mounting bolts, e.g. 3, 4. |
| `is_original` | boolean | YES | true | True if factory-installed steering gear. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `steering_linkage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `linkage_type` | text | YES |  | Linkage geometry: parallelogram, rack, cross_steer, drag_link, other. |
| `tie_rod_type` | text | YES |  | Tie rod construction: inner_outer, one_piece, adjustable_sleeve, other. |
| `tie_rod_end_type` | text | YES |  | Tie rod end type, e.g. standard, greaseable, sealed. |
| `tie_rod_end_manufacturer` | text | YES |  | Tie rod end manufacturer, e.g. Moog, TRW, Spicer. |
| `tie_rod_end_part_number` | text | YES |  | Tie rod end part number. |
| `drag_link_type` | text | YES |  | Drag link type description. |
| `drag_link_part_number` | text | YES |  | Drag link part number. |
| `pitman_arm_type` | text | YES |  | Pitman arm type, e.g. standard, drop, raised. |
| `pitman_arm_part_number` | text | YES |  | Pitman arm part number. |
| `pitman_arm_spline_count` | integer | YES |  | Pitman arm spline count for sector shaft fit. |
| `idler_arm_type` | text | YES |  | Idler arm type description. |
| `idler_arm_part_number` | text | YES |  | Idler arm part number. |
| `center_link_part_number` | text | YES |  | Center link (relay rod) part number. |
| `relay_rod_part_number` | text | YES |  | Relay rod part number (same as center link on some applications). |
| `sleeve_clamp_type` | text | YES |  | Tie rod adjusting sleeve clamp type, e.g. pinch_bolt, clamp. |
| `dampener_equipped` | boolean | YES | false | True if steering dampener/stabilizer is installed. |
| `dampener_manufacturer` | text | YES |  | Steering dampener manufacturer. |
| `is_original` | boolean | YES | true | True if factory-original steering linkage. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `steering_wheels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `material` | text | YES |  | Rim grip material: hard_plastic, foam, leather, wood, alcantara, carbon_fiber, bakelite, other. |
| `diameter_inches` | numeric | YES |  | Outer diameter in inches, typically 14-17 for factory wheels. |
| `wheel_type` | text | YES |  | Spoke configuration: two_spoke, three_spoke, four_spoke, sport, deep_dish, banjo, other. |
| `horn_button_type` | text | YES |  | Horn button style, e.g. factory_emblem, sport_ring, full_pad, aftermarket. |
| `wrap_condition` | text | YES |  | Condition of rim material/wrap, e.g. excellent, cracked, worn, retrimmed. |
| `column_cover_condition` | text | YES |  | Steering column shroud/cover condition, e.g. excellent, cracked, missing. |
| `is_original` | boolean | YES | true | True if factory-installed steering wheel. |
| `condition_grade` | text | YES | 'unknown' | Overall condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `stream_action_packs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `slug` | text | NO |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `price_cents` | bigint | NO | 0 |  |
| `is_active` | boolean | NO | true |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `stripe_connect_accounts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `stripe_account_id` | text | NO |  |  |
| `display_name` | text | YES |  |  |
| `contact_email` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `subject_coverage_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `subject_key` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `domain` | text | YES |  |  |
| `category` | text | YES |  |  |
| `image_count` | bigint | YES |  |  |
| `vehicle_count` | bigint | YES |  |  |
| `avg_confidence` | numeric | YES |  |  |
| `avg_framing` | numeric | YES |  |  |
| `sources` | jsonb | YES |  |  |

### `supplier_accounts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `supplier_name` | text | NO |  |  |
| `supplier_url` | text | YES |  |  |
| `account_number` | text | YES |  |  |
| `account_email` | text | YES |  |  |
| `api_enabled` | boolean | YES | false |  |
| `api_endpoint` | text | YES |  |  |
| `api_key_vault_ref` | text | YES |  |  |
| `order_method` | text | YES | 'manual' |  Values: `api`, `email`, `browser`, `phone`, `manual` |
| `default_ship_method` | text | YES |  |  |
| `discount_tier` | text | YES |  |  |
| `discount_percentage` | numeric | YES | 0 |  |
| `avg_delivery_days` | integer | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `supplier_ratings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `supplier_id` | uuid | NO |  |  |
| `quality_score` | numeric | YES | 100 |  |
| `responsiveness_score` | numeric | YES | 100 |  |
| `pricing_score` | numeric | YES | 100 |  |
| `overall_score` | numeric | YES |  |  |
| `total_orders` | integer | YES | 0 |  |
| `on_time_deliveries` | integer | YES | 0 |  |
| `quality_issues` | integer | YES | 0 |  |
| `on_time_percentage` | numeric | YES |  |  |
| `quality_pass_percentage` | numeric | YES |  |  |
| `last_updated` | timestamp with time zone | YES | now() |  |

### `suppliers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `type` | text | YES |  |  Values: `vendor`, `marketplace`, `shop`, `labor`, `individual` |
| `website` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `address` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `user_id` | uuid | YES |  |  |

### `system_state`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `key` | text | NO |  |  |
| `value` | jsonb | NO | '{}' |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `tag_analysis_view`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `tag_name` | text | YES |  |  |
| `tag_type` | character varying | YES |  |  |
| `source_type` | text | YES |  |  |
| `confidence` | integer | YES |  |  |
| `automated_confidence` | double precision | YES |  |  |
| `verified` | boolean | YES |  |  |
| `validation_status` | text | YES |  |  |
| `created_by` | character varying | YES |  |  |
| `verified_at` | timestamp without time zone | YES |  |  |
| `manual_override` | boolean | YES |  |  |
| `x_position` | double precision | YES |  |  |
| `y_position` | double precision | YES |  |  |
| `width` | numeric | YES |  |  |
| `height` | numeric | YES |  |  |
| `ai_detection_data` | jsonb | YES |  |  |
| `training_feedback` | jsonb | YES |  |  |
| `parent_tag_id` | uuid | YES |  |  |
| `tag_origin_type` | text | YES |  |  |
| `reliability_score` | double precision | YES |  |  |

### `tag_categories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | character varying | NO |  |  |
| `description` | text | YES |  |  |
| `color_hex` | character | YES | '#007bff'::bpchar |  |
| `icon_name` | character varying | YES |  |  |
| `is_system` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `technician_career_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `technician_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `telegram_id` | text | YES |  |  |
| `total_sessions` | bigint | YES |  |  |
| `unique_vehicles` | bigint | YES |  |  |
| `total_hours` | numeric | YES |  |  |
| `total_labor_value` | numeric | YES |  |  |
| `total_job_value` | numeric | YES |  |  |
| `first_session` | date | YES |  |  |
| `last_session` | date | YES |  |  |
| `unique_tools_used` | bigint | YES |  |  |
| `total_tool_depreciation` | numeric | YES |  |  |

### `technician_phone_links`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `phone_number` | text | NO |  |  |
| `phone_hash` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `external_identity_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `specialties` | ARRAY | YES | '{}'[] |  |
| `onboarding_status` | text | YES | 'pending_verification' |  Values: `pending_verification`, `verified`, `active`, `paused`, `churned` |
| `invited_by` | uuid | YES |  |  |
| `invitation_code` | text | YES |  |  |
| `primary_shop_id` | uuid | YES |  |  |
| `assigned_vehicles` | ARRAY | YES | '{}'::uuid[] |  |
| `reminder_frequency` | text | YES | 'daily' |  Values: `none`, `daily`, `twice_daily`, `per_session` |
| `preferred_language` | text | YES | 'en' |  |
| `ai_personality` | text | YES | 'friendly' |  |
| `payment_method` | text | YES |  |  |
| `payment_handle` | text | YES |  |  |
| `pending_payout` | numeric | YES | 0 |  |
| `total_earned` | numeric | YES | 0 |  |
| `photos_submitted` | integer | YES | 0 |  |
| `work_sessions_logged` | integer | YES | 0 |  |
| `last_submission_at` | timestamp with time zone | YES |  |  |
| `last_reminder_sent_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' |  |
| `avatar_url` | text | YES |  |  |
| `location_city` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `years_experience` | integer | YES |  |  |
| `certifications` | ARRAY | YES | '{}'[] |  |
| `payment_verified` | boolean | YES | false |  |
| `onboarding_step` | text | YES | 'start' |  |
| `terms_accepted_at` | timestamp with time zone | YES |  |  |
| `magic_link_token` | text | YES |  |  |
| `magic_link_expires_at` | timestamp with time zone | YES |  |  |
| `lifetime_photos` | integer | YES | 0 |  |
| `lifetime_jobs` | integer | YES | 0 |  |
| `rating_avg` | numeric | YES |  |  |
| `rating_count` | integer | YES | 0 |  |
| `active_vehicle_id` | uuid | YES |  |  |
| `active_vin` | text | YES |  |  |

### `technician_specializations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `technician_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `work_type` | text | YES |  |  |
| `job_count` | bigint | YES |  |  |
| `total_hours` | numeric | YES |  |  |
| `labor_value` | numeric | YES |  |  |
| `avg_job_value` | numeric | YES |  |  |
| `first_job` | date | YES |  |  |
| `last_job` | date | YES |  |  |

### `technician_tool_proficiency`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `technician_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `tool_category` | text | YES |  |  |
| `tools_in_category` | bigint | YES |  |  |
| `total_uses` | bigint | YES |  |  |
| `total_depreciation` | numeric | YES |  |  |

### `technician_vehicle_expertise`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `technician_id` | uuid | YES |  |  |
| `display_name` | text | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `era` | text | YES |  |  |
| `sessions` | bigint | YES |  |  |
| `hours_worked` | numeric | YES |  |  |

### `technicians`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO |  |  |
| `name` | character varying | NO |  |  |
| `license_number` | character varying | YES |  |  |
| `certification_level` | character varying | YES |  |  |
| `specializations` | ARRAY | YES | ARRAY[][] |  |
| `shop_id` | uuid | YES |  |  |
| `hourly_rate_cents` | integer | YES |  |  |
| `experience_years` | integer | YES |  |  |
| `contact_info` | jsonb | YES | '{}' |  |
| `active` | boolean | YES | true |  |
| `inserted_at` | timestamp without time zone | NO |  |  |
| `updated_at` | timestamp without time zone | NO |  |  |

### `telegram_tasks`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `task_type` | text | NO | 'query' |  |
| `prompt` | text | NO |  |  |
| `context` | jsonb | YES | '{}' |  |
| `chat_id` | bigint | NO |  |  |
| `user_id` | bigint | YES |  |  |
| `reply_to_message_id` | bigint | YES |  |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `processing`, `completed`, `failed`, `cancelled` |
| `assigned_to` | text | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `result` | jsonb | YES | '{}' |  |
| `result_text` | text | YES |  |  |
| `error` | text | YES |  |  |
| `priority` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `attempts` | integer | YES | 0 |  |
| `max_attempts` | integer | YES | 3 |  |
| `next_retry_at` | timestamp with time zone | YES |  |  |

### `telegram_technicians`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `telegram_id` | bigint | NO |  |  |
| `telegram_username` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `phone_number` | text | YES |  |  |
| `status` | text | YES | 'active' |  |
| `active_vehicle_id` | uuid | YES |  |  |
| `active_vin` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `last_active_at` | timestamp with time zone | YES | now() |  |
| `business_id` | uuid | YES |  |  |
| `invite_code_used` | text | YES |  |  |
| `onboarded_at` | timestamp with time zone | YES |  |  |

### `telegram_users`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `telegram_id` | bigint | NO |  |  |
| `telegram_username` | text | YES |  |  |
| `first_name` | text | YES |  |  |
| `last_name` | text | YES |  |  |
| `phone` | text | YES |  |  |
| `role` | text | YES | 'submitter' |  |
| `status` | text | YES | 'pending' |  |
| `registered_at` | timestamp with time zone | YES | now() |  |
| `last_active_at` | timestamp with time zone | YES | now() |  |
| `metadata` | jsonb | YES | '{}' |  |

### `timeline_event_comments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `event_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `comment_text` | text | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `vehicle_id` | uuid | YES |  |  |

### `tires`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Corner position: lf (left front), rf (right front), lr (left rear), rr (right rear). Values: `lf`, `rf`, `lr`, `rr` |
| `size_designation` | text | YES |  | Full tire size designation, e.g. P215/65R15, LT265/75R16, F60-15, L60-15. |
| `brand` | text | YES |  | Tire brand, e.g. Goodyear, Firestone, BFGoodrich, Michelin. |
| `model` | text | YES |  | Tire model name, e.g. Eagle GT, Radial T/A, All-Terrain T/A KO2. |
| `type` | text | YES |  | Tire usage category: all_season, summer, winter, all_terrain, mud_terrain, highway, performance. |
| `speed_rating` | text | YES |  | Speed rating letter, e.g. S, T, H, V, W, Y, Z. |
| `load_index` | integer | YES |  | Load index number (60-150). Higher = more load capacity. |
| `ply_rating` | text | YES |  | Ply rating or load range designation, e.g. 4-ply, C, D, E. |
| `dot_date_code` | text | YES |  | DOT date code (last 4 digits of DOT), e.g. 2819 = week 28 of 2019. |
| `tread_depth_32nds` | numeric | YES |  | Remaining tread depth in 32nds of an inch. New tires typically 10/32 to 12/32. |
| `dry_rot_yn` | boolean | YES |  | True if dry rot (surface cracking/hardening from age/UV) is present. |
| `sidewall_condition` | text | YES |  | Sidewall assessment: excellent, good, cracked, bulged, damaged, dry_rotted. |
| `ozone_cracking_yn` | boolean | YES |  | True if ozone cracking (fine circumferential cracks) is visible. |
| `plugged_yn` | boolean | YES |  | True if tire has been plug-repaired. |
| `patched_yn` | boolean | YES |  | True if tire has been patch-repaired from inside. |
| `is_original` | boolean | YES | true | True if these are the factory-specified tires. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. uneven wear on inside edge, feathering. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: purchase date, retailer, mileage at install. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `tool_brands`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `logo_url` | text | YES |  | URL or path to the brand logo image |
| `website` | text | YES |  |  |
| `support_phone` | text | YES |  |  |
| `support_email` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tool_categories`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `parent_category_id` | uuid | YES |  |  |
| `description` | text | YES |  |  |
| `icon` | text | YES |  |  |
| `sort_order` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tool_franchisors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `name` | text | NO |  |  |
| `brand_id` | uuid | YES |  |  |
| `corporate_website` | text | YES |  |  |
| `dealer_portal_url` | text | YES |  |  |
| `api_endpoint` | text | YES |  |  |
| `integration_available` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tool_receipt_documents`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `original_filename` | text | NO |  |  |
| `file_size` | integer | NO |  |  |
| `mime_type` | text | NO |  |  |
| `file_hash` | text | NO |  | SHA-256 hash to prevent duplicate uploads |
| `storage_path` | text | NO |  |  |
| `supplier_name` | text | YES |  |  |
| `receipt_date` | date | YES |  |  |
| `receipt_number` | text | YES |  |  |
| `total_amount` | numeric | YES |  |  |
| `processing_status` | text | NO | 'pending' | Current processing state: pending, processing, completed, failed Values: `pending`, `processing`, `completed`, `failed` |
| `tools_extracted` | integer | YES | 0 | Number of tools extracted from receipt |
| `tools_saved` | integer | YES | 0 | Number of tools successfully saved to database |
| `processing_errors` | jsonb | YES | '[]' |  |
| `extraction_metadata` | jsonb | YES | '{}' |  |
| `uploaded_at` | timestamp with time zone | NO | now() |  |
| `processed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `is_active` | boolean | YES | true | Controls visibility of tools from this receipt. Toggle off to hide without deleting data. |

### `tool_transaction_items`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `transaction_id` | uuid | YES |  |  |
| `catalog_id` | uuid | YES |  |  |
| `part_number` | text | NO |  |  |
| `description` | text | YES |  |  |
| `quantity` | integer | YES | 1 |  |
| `list_price` | numeric | YES |  |  |
| `discount_amount` | numeric | YES |  |  |
| `line_total` | numeric | YES |  |  |
| `serial_number` | text | YES |  |  |
| `line_type` | text | YES |  |  |
| `raw_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `tool_transactions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `transaction_number` | text | NO |  |  |
| `transaction_date` | date | NO |  |  |
| `transaction_type` | text | YES |  |  Values: `Sale`, `RA`, `EC`, `Warranty`, `Return`, `Exchange` |
| `user_id` | uuid | YES |  |  |
| `franchise_operator_id` | uuid | YES |  |  |
| `subtotal` | numeric | YES |  |  |
| `discount_total` | numeric | YES |  |  |
| `tax_amount` | numeric | YES |  |  |
| `total_amount` | numeric | YES |  |  |
| `payment_type` | text | YES |  |  |
| `payment_amount` | numeric | YES |  |  |
| `payment_reference` | text | YES |  |  |
| `receipt_url` | text | YES |  |  |
| `receipt_text` | text | YES |  |  |
| `raw_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `top_priority_gaps`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `gap_type` | text | YES |  |  |
| `description` | text | YES |  |  |
| `required_reference_title` | text | YES |  |  |
| `affected_components` | ARRAY | YES |  |  |
| `impact_count` | integer | YES |  |  |
| `priority` | integer | YES |  |  |
| `year` | text | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `last_encountered` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |

### `transfer_case_controls`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transfer_case_id` | uuid | YES |  | FK to transfer_cases(id). |
| `shift_type` | text | YES |  | Shift mechanism: manual_floor, manual_dash, electric_pushbutton, electric_switch, electric_dial, vacuum, cable, other. |
| `shift_lever_type` | text | YES |  | Shift lever description for manual shift, e.g. twin_stick, single_lever. |
| `shift_motor_manufacturer` | text | YES |  | Shift motor manufacturer. |
| `shift_motor_part_number` | text | YES |  | Shift motor part number. |
| `shift_motor_type` | text | YES |  | Shift motor type, e.g. dc_gear_motor, stepper. |
| `encoder_motor_part_number` | text | YES |  | Encoder motor part number for position feedback. |
| `position_sensor_type` | text | YES |  | Position/mode sensor type for electronic shift. |
| `position_sensor_part_number` | text | YES |  | Position sensor part number. |
| `front_axle_actuator_type` | text | YES |  | Front axle engagement actuator type, e.g. vacuum, electric, manual_hub. |
| `front_axle_actuator_part_number` | text | YES |  | Front axle actuator part number. |
| `vacuum_switch_type` | text | YES |  | Vacuum switch type for vacuum-actuated systems. |
| `indicator_light_type` | text | YES |  | Dashboard 4WD indicator light type. |
| `control_module_part_number` | text | YES |  | Electronic shift control module part number. |
| `control_module_manufacturer` | text | YES |  | Control module manufacturer. |
| `is_original` | boolean | YES | true | True if factory-installed controls. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. shift motor intermittent. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transfer_case_internals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transfer_case_id` | uuid | YES |  | FK to transfer_cases(id). |
| `chain_type` | text | YES |  | Drive chain type: morse_hy_vo, silent, roller, none (gear-driven), other. |
| `chain_part_number` | text | YES |  | Chain part number. |
| `chain_width_mm` | numeric | YES |  | Chain width in mm. |
| `chain_link_count` | integer | YES |  | Number of chain links. |
| `driven_sprocket_tooth_count` | integer | YES |  | Driven (output) sprocket tooth count. |
| `drive_sprocket_tooth_count` | integer | YES |  | Drive (input) sprocket tooth count. |
| `planetary_type` | text | YES |  | Planetary gear set type, e.g. simple, compound, ravigneaux. |
| `planetary_gear_count` | integer | YES |  | Number of planet gears. |
| `sun_gear_tooth_count` | integer | YES |  | Sun gear tooth count. |
| `ring_gear_tooth_count` | integer | YES |  | Ring gear tooth count. |
| `input_bearing_type` | text | YES |  | Input shaft bearing type. |
| `front_output_bearing_type` | text | YES |  | Front output shaft bearing type. |
| `rear_output_bearing_type` | text | YES |  | Rear output shaft bearing type. |
| `intermediate_bearing_type` | text | YES |  | Intermediate shaft bearing type. |
| `front_output_seal_type` | text | YES |  | Front output shaft seal type. |
| `rear_output_seal_type` | text | YES |  | Rear output shaft seal type. |
| `input_seal_type` | text | YES |  | Input shaft seal type. |
| `shift_shaft_seal_type` | text | YES |  | Shift lever shaft seal type. |
| `shift_fork_material` | text | YES |  | Shift fork material, e.g. cast_iron, steel, aluminum. |
| `shift_rail_count` | integer | YES |  | Number of shift rails. |
| `mode_sleeve_type` | text | YES |  | Mode/range selector sleeve type. |
| `is_original` | boolean | YES | true | True if factory-original internals. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. chain stretch measured at 0.5%. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transfer_cases`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  | Casting number on the case. |
| `serial_number` | text | YES |  | Transfer case serial number. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `date_code` | text | YES |  | Date code on the case. |
| `manufacturer` | text | YES |  | Manufacturer, e.g. New Process, Borg-Warner, Dana, Magna. |
| `model` | text | YES |  | Model designation, e.g. NP205, NP203, NP241, BW4401, BW1345. |
| `transfer_case_type` | text | YES |  | Type: part_time, full_time, awd, on_demand, selectable, other. |
| `ratio_high` | numeric | YES | 1.000 | High-range ratio, typically 1.000. |
| `ratio_low` | numeric | YES |  | Low-range ratio, e.g. 1.96 for NP205, 2.72 for NP241. |
| `drive_type` | text | YES |  | Internal drive mechanism: chain or gear. |
| `front_output_type` | text | YES |  | Front output configuration, e.g. fixed_yoke, slip_yoke, cv_flange. |
| `rear_output_type` | text | YES |  | Rear output configuration. |
| `front_output_spline_count` | integer | YES |  | Spline count on front output shaft. |
| `rear_output_spline_count` | integer | YES |  | Spline count on rear output shaft. |
| `input_spline_count` | integer | YES |  | Spline count on input shaft. |
| `fluid_type` | text | YES |  | Required fluid, e.g. atf, gl5_80w90, synthetic_atf. |
| `fluid_capacity_quarts` | numeric | YES |  | Fluid capacity in quarts. |
| `case_material` | text | YES |  | Case material: cast_iron, aluminum, magnesium, other. |
| `weight_lbs` | numeric | YES |  | Dry weight in pounds. |
| `torque_rating_lb_ft` | integer | YES |  | Maximum rated input torque in lb-ft. |
| `speedometer_drive` | text | YES |  | Speedometer drive location and type. |
| `is_original` | boolean | YES | true | True if factory-installed transfer case. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transfer_communications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `transfer_id` | uuid | NO |  |  |
| `source` | USER-DEFINED | NO |  |  |
| `direction` | USER-DEFINED | NO |  |  |
| `from_address` | text | YES |  |  |
| `to_address` | text | YES |  |  |
| `subject` | text | YES |  |  |
| `body_text` | text | YES |  |  |
| `received_at` | timestamp with time zone | YES |  |  |
| `parsed_events` | jsonb | NO | '{}' |  |
| `linked_milestone_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `milestone_type_inferred` | text | YES |  |  |
| `ai_classification_confidence` | integer | YES |  |  |
| `has_attachments` | boolean | NO | false |  |
| `attachment_names` | ARRAY | NO | '{}'[] |  |
| `raw_metadata` | jsonb | YES |  |  |

### `transmission_cases`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `casting_number` | text | YES |  | Casting number stamped on the case. |
| `serial_number` | text | YES |  | Transmission serial number. |
| `part_number` | text | YES |  | Manufacturer part number or GM service number. |
| `date_code` | text | YES |  | Date code on the case, e.g. P0910 = built Oct 9 at plant P. |
| `manufacturer` | text | YES |  | Manufacturer, e.g. Muncie, Borg-Warner, Tremec, GM Hydramatic, ZF, Aisin. |
| `model` | text | YES |  | Model designation, e.g. M22, T-10, TH400, 4L60E, T56. |
| `transmission_type` | text | YES |  | Type: manual, automatic, dct, cvt, semi_automatic, sequential, other. |
| `speed_count` | integer | YES |  | Number of forward speeds, 1-12. |
| `gear_driven` | boolean | YES | false | True if all gears are helical/spur (no synchronizers). |
| `overdrive` | boolean | YES | false | True if transmission has an overdrive gear (ratio < 1.0). |
| `case_material` | text | YES |  | Case material: cast_iron, aluminum, magnesium, other. |
| `tail_housing_type` | text | YES |  | Tail/extension housing style, e.g. long, short, integral. |
| `input_spline_count` | integer | YES |  | Number of splines on the input shaft. |
| `output_spline_count` | integer | YES |  | Number of splines on the output shaft. |
| `fluid_type` | text | YES |  | Required fluid, e.g. dexron_iii, atf4, gl4_75w90, gl5_80w90, mtf. |
| `fluid_capacity_quarts` | numeric | YES |  | Fluid capacity in quarts. |
| `weight_lbs` | numeric | YES |  | Dry weight of the transmission in pounds. |
| `torque_rating_lb_ft` | integer | YES |  | Maximum rated input torque in lb-ft. |
| `bellhousing_pattern` | text | YES |  | Bellhousing bolt pattern, e.g. gm_small_block, ford_small_block, mopar_a833. |
| `is_original` | boolean | YES | true | True if this is the factory-installed transmission. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: source, date acquired, documentation. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_clutch_systems`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `disc_diameter_inches` | numeric | YES |  | Clutch disc diameter in inches, e.g. 10.5, 11.0. |
| `disc_spline_count` | integer | YES |  | Number of splines on clutch disc hub. |
| `disc_material` | text | YES |  | Disc friction material: organic, ceramic, kevlar, carbon, metallic, sintered_iron, other. |
| `disc_type` | text | YES |  | Disc description, e.g. single, twin, triple. |
| `disc_manufacturer` | text | YES |  | Clutch disc manufacturer. |
| `disc_part_number` | text | YES |  | Clutch disc part number. |
| `disc_sprung` | boolean | YES | true | True if disc has dampener springs in hub. |
| `disc_marcel` | boolean | YES | true | True if disc has marcel (wavy) spring layer. |
| `pressure_plate_type` | text | YES |  | Pressure plate type: diaphragm, long_style, borg_beck, multi_disc, other. |
| `pressure_plate_manufacturer` | text | YES |  | Pressure plate manufacturer, e.g. GM, Centerforce, McLeod. |
| `pressure_plate_part_number` | text | YES |  | Pressure plate part number. |
| `clamp_load_lbs` | integer | YES |  | Pressure plate clamping force in pounds. |
| `pressure_plate_fingers` | integer | YES |  | Number of pressure plate fingers or diaphragm spring segments. |
| `throwout_bearing_type` | text | YES |  | Throwout/release bearing type, e.g. sealed_ball, self_aligning, hydraulic_integrated. |
| `throwout_bearing_part_number` | text | YES |  | Throwout bearing part number. |
| `release_mechanism` | text | YES |  | Clutch release mechanism: hydraulic, cable, mechanical_linkage, other. |
| `pivot_ball_type` | text | YES |  | Clutch fork pivot ball type, e.g. stock, hardened, roller. |
| `clutch_fork_type` | text | YES |  | Clutch fork type, e.g. stamped_steel, forged, aftermarket. |
| `master_cylinder_bore_mm` | numeric | YES |  | Clutch master cylinder bore diameter in mm. |
| `master_cylinder_part_number` | text | YES |  | Clutch master cylinder part number. |
| `slave_cylinder_bore_mm` | numeric | YES |  | Slave/release cylinder bore diameter in mm. |
| `slave_cylinder_type` | text | YES |  | Slave cylinder type, e.g. external, concentric, internal. |
| `clutch_line_type` | text | YES |  | Clutch hydraulic line type, e.g. rubber, stainless_braided. |
| `cable_type` | text | YES |  | Clutch cable type if cable-operated. |
| `cable_self_adjusting` | boolean | YES |  | True if clutch cable is self-adjusting. |
| `dual_mass_flywheel` | boolean | YES | false | True if paired with a dual-mass flywheel. |
| `is_original` | boolean | YES | true | True if factory-installed clutch system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. 60% disc life remaining. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_controllers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `controller_type` | text | YES |  | Controller type: standalone_tcm, integrated_pcm, aftermarket_standalone, none, other. |
| `tcm_part_number` | text | YES |  | TCM/PCM part number. |
| `tcm_manufacturer` | text | YES |  | TCM manufacturer, e.g. GM, Ford, Compushift, US Shift. |
| `calibration_id` | text | YES |  | TCM calibration/PROM identifier. |
| `software_version` | text | YES |  | Controller software version if updatable. |
| `shift_solenoid_count` | integer | YES |  | Number of shift solenoids. |
| `shift_solenoid_type` | text | YES |  | Shift solenoid type, e.g. on_off, pwm, variable_force. |
| `tcc_solenoid_type` | text | YES |  | Torque converter clutch solenoid type. |
| `pressure_control_solenoid_type` | text | YES |  | Pressure control solenoid type. |
| `epc_solenoid_type` | text | YES |  | Electronic pressure control solenoid type. |
| `input_speed_sensor_type` | text | YES |  | Input/turbine speed sensor type. |
| `output_speed_sensor_type` | text | YES |  | Output/vehicle speed sensor type. |
| `tft_sensor_type` | text | YES |  | Transmission fluid temperature sensor type. |
| `line_pressure_sensor` | boolean | YES | false | True if line pressure sensor is installed. |
| `range_sensor_type` | text | YES |  | Transmission range (PRNDL) sensor type. |
| `connector_type` | text | YES |  | Case connector type/pin count. |
| `wire_harness_part_number` | text | YES |  | Internal wire harness part number. |
| `is_original` | boolean | YES | true | True if factory-installed controller. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. DTC codes present. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_coolers`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `cooler_type` | text | YES |  | Cooler type: tube_fin, plate_fin, stacked_plate, radiator_internal, remote, other. |
| `cooler_location` | text | YES |  | Cooler mounting location, e.g. front_of_radiator, below_radiator, frame_mounted. |
| `cooler_manufacturer` | text | YES |  | Cooler manufacturer, e.g. Hayden, Derale, B&M. |
| `cooler_part_number` | text | YES |  | Cooler part number. |
| `capacity_gph` | numeric | YES |  | Cooler flow capacity in gallons per hour. |
| `row_count` | integer | YES |  | Number of tube rows in the cooler core. |
| `core_size` | text | YES |  | Core dimensions, e.g. 11x6x0.75. |
| `line_size` | text | YES |  | Cooler line size, e.g. 5/16, 3/8, -6AN. |
| `line_material` | text | YES |  | Cooler line material, e.g. steel, rubber, stainless_braided. |
| `fan_equipped` | boolean | YES | false | True if dedicated electric fan is on the cooler. |
| `fan_type` | text | YES |  | Fan type if equipped, e.g. pusher, puller. |
| `thermostat_equipped` | boolean | YES | false | True if inline thermostat is installed. |
| `thermostat_temp_f` | integer | YES |  | Thermostat opening temperature in Fahrenheit. |
| `integrated_in_radiator` | boolean | YES | true | True if cooler is the internal tank in the radiator (factory style). |
| `is_original` | boolean | YES | true | True if factory-installed cooler. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_gears`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). Which transmission this gear belongs to. |
| `gear_number` | integer | NO |  | Gear position: 1-12 for forward gears, -1 for reverse. 0 not used. |
| `ratio` | numeric | NO |  | Gear ratio, e.g. 2.20 for first gear, 0.73 for overdrive. |
| `synchro_type` | text | YES |  | Synchronizer type: brass, carbon, steel, paper, double_cone, triple_cone, none, other. |
| `synchro_material` | text | YES |  | Synchronizer ring material detail if non-standard. |
| `gear_material` | text | YES |  | Gear material, e.g. case_hardened_steel, sintered. |
| `gear_tooth_count` | integer | YES |  | Number of teeth on this gear for ratio verification. |
| `is_overdrive` | boolean | YES | false | True if this gear has a ratio less than 1.0. |
| `is_reverse` | boolean | YES | false | True if this is the reverse gear. |
| `is_original` | boolean | YES | true | True if factory-original gear. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. slight whine in 2nd. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_internals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `input_shaft_spline_count` | integer | YES |  | Number of splines on the input shaft. |
| `input_shaft_length_mm` | numeric | YES |  | Input shaft overall length in mm. |
| `input_shaft_material` | text | YES |  | Input shaft material. |
| `pilot_bearing_type` | text | YES |  | Pilot bushing/bearing type at input shaft tip, e.g. bronze_bushing, needle_bearing. |
| `output_shaft_spline_count` | integer | YES |  | Number of splines on the output shaft. |
| `output_shaft_length_mm` | numeric | YES |  | Output shaft overall length in mm. |
| `output_shaft_material` | text | YES |  | Output shaft material. |
| `countershaft_count` | integer | YES |  | Number of countershafts (1 for most, 2 for some heavy-duty or twin-countershaft designs). |
| `countershaft_material` | text | YES |  | Countershaft material. |
| `main_bearing_type` | text | YES |  | Main shaft bearing type: ball, roller, tapered_roller, needle, bushing, other. |
| `countershaft_bearing_type` | text | YES |  | Countershaft bearing type. |
| `tailshaft_bearing_type` | text | YES |  | Tailshaft/extension housing bearing type. |
| `bearing_preload_spec` | text | YES |  | Bearing preload specification. |
| `front_seal_type` | text | YES |  | Front pump or input shaft seal type. |
| `rear_seal_type` | text | YES |  | Rear output shaft seal type. |
| `shift_shaft_seal_type` | text | YES |  | Shift lever shaft seal type (manual). |
| `speedometer_seal_type` | text | YES |  | Speedometer drive gear seal type. |
| `band_count` | integer | YES |  | Number of friction bands (automatic only). |
| `band_material` | text | YES |  | Band friction material, e.g. organic, kevlar, carbon. |
| `servo_type` | text | YES |  | Band servo type/size. |
| `accumulator_type` | text | YES |  | Shift accumulator type for shift quality tuning. |
| `planetary_set_count` | integer | YES |  | Number of planetary gear sets (automatic only). |
| `sprag_type` | text | YES |  | One-way clutch/sprag type and count. |
| `valve_body_type` | text | YES |  | Valve body type: stock, shift_kit, manual, transbrake, full_manual. |
| `separator_plate_id` | text | YES |  | Separator plate identification for valve body compatibility. |
| `is_original` | boolean | YES | true | True if factory-original internals. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_shifters`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `shifter_type` | text | YES |  | Shifter type: floor_manual, console_auto, column_manual, column_auto, pistol_grip, ratchet, paddle, sequential, other. |
| `manufacturer` | text | YES |  | Shifter manufacturer, e.g. Hurst, B&M, factory. |
| `model` | text | YES |  | Shifter model, e.g. Competition Plus, Pro Stick, Quicksilver. |
| `part_number` | text | YES |  | Shifter part number. |
| `linkage_type` | text | YES |  | Linkage type: mechanical_rod, cable, electronic, direct_mount, other. |
| `shift_pattern` | text | YES |  | Shift pattern description, e.g. H_pattern, reverse_left_up, dogleg_first. |
| `shift_knob_material` | text | YES |  | Knob material, e.g. plastic, wood, leather, billet_aluminum, cue_ball. |
| `shift_boot_type` | text | YES |  | Shift boot type, e.g. rubber, leather, vinyl. |
| `console_mounted` | boolean | YES |  | True if shifter is mounted in a console. |
| `column_shift` | boolean | YES | false | True if column-mounted shifter. |
| `reverse_lockout` | boolean | YES | false | True if reverse lockout mechanism is present. |
| `short_throw` | boolean | YES | false | True if short-throw modification or aftermarket short-throw shifter. |
| `gate_type` | text | YES |  | Shift gate type, e.g. open, gated, spring_loaded. |
| `is_original` | boolean | YES | true | True if factory-installed shifter. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `transmission_torque_converters`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `transmission_case_id` | uuid | YES |  | FK to transmission_cases(id). |
| `manufacturer` | text | YES |  | Converter manufacturer, e.g. GM, Hughes, TCI, B&M, Precision Industries. |
| `part_number` | text | YES |  | Manufacturer part number. |
| `diameter_inches` | numeric | YES |  | Converter diameter in inches, e.g. 12.0 for TH400. |
| `stall_speed_rpm` | integer | YES |  | Stall speed in RPM, 500-8000. |
| `torque_multiplication` | numeric | YES |  | Torque multiplication ratio at stall. |
| `lockup_equipped` | boolean | YES | false | True if converter has lockup clutch. |
| `lockup_type` | text | YES |  | Lockup type: mechanical, electronic, multi_disc, none, other. |
| `bolt_count` | integer | YES |  | Number of converter-to-flexplate bolts. |
| `bolt_pattern` | text | YES |  | Bolt circle pattern description. |
| `pilot_diameter_mm` | numeric | YES |  | Pilot hub diameter in mm for crank register. |
| `fluid_coupling` | boolean | YES | false | True if fluid coupling (no torque multiplication) vs true converter. |
| `billet_cover` | boolean | YES | false | True if billet steel cover (performance/racing). |
| `anti_balloon_plate` | boolean | YES | false | True if anti-balloon plate installed for high RPM. |
| `furnace_brazed` | boolean | YES | false | True if fins are furnace-brazed (performance). |
| `weight_lbs` | numeric | YES |  | Converter weight in pounds. |
| `is_original` | boolean | YES | true | True if factory-installed torque converter. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `truck_beds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). ON DELETE CASCADE. |
| `bed_length_inches` | numeric | YES |  | Inside bed length in inches, e.g. 78.0 for long bed, 61.8 for short bed. |
| `material` | text | YES |  | Bed material: steel, aluminum, composite. |
| `liner_type` | text | YES |  | Bed liner type: none, spray_in (Rhino, Line-X), drop_in (plastic), wood (traditional planks). |
| `toolbox_yn` | boolean | YES |  | True if a toolbox is installed. |
| `tonneau_type` | text | YES |  | Cover type: none, soft_roll_up, hard_fold, retractable, hinged_fiberglass, camper_shell. |
| `bed_floor_condition` | text | YES |  | Condition of the bed floor/deck: excellent, good, fair, poor, failed. |
| `wheel_well_condition` | text | YES |  | Condition of the inner wheel well panels: excellent, good, fair, poor, failed. |
| `tailgate_condition` | text | YES |  | Condition of the tailgate: excellent, good, fair, poor, failed, missing. |
| `stake_pocket_condition` | text | YES |  | Condition of the stake pockets: excellent, good, fair, poor, damaged, missing. |
| `is_original` | boolean | YES | true | True if factory-installed bed. |
| `condition_grade` | text | YES | 'unknown' | Overall bed condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform notes, e.g. surface rust at drain holes, wood floor replaced, spray-in liner concealing rust. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `user_cash_balances`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | NO |  |  |
| `balance_cents` | bigint | YES | 0 |  |
| `available_cents` | bigint | YES | 0 |  |
| `reserved_cents` | bigint | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_contributions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | YES |  |  |
| `contribution_date` | date | NO |  |  |
| `contribution_type` | text | NO |  |  Values: `vehicle_data`, `image_upload`, `timeline_event`, `verification`, `annotation` |
| `contribution_count` | integer | YES | 1 |  |
| `related_vehicle_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp without time zone | YES | now() |  |
| `points` | integer | NO | 0 |  |
| `contribution_type_id` | bigint | YES |  |  |
| `shop_id` | uuid | YES |  |  |
| `agent_id` | text | YES |  |  |
| `actor_type` | text | YES | 'user' |  |

### `user_data_reputation`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `vehicles_submitted` | bigint | YES |  |  |
| `fields_corrected` | bigint | YES |  |  |
| `vehicles_needing_correction` | bigint | YES |  |  |
| `accuracy_score` | numeric | YES |  |  |

### `user_discovery_stats`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `total_discoveries` | bigint | YES |  |  |
| `discovered` | bigint | YES |  |  |
| `saved` | bigint | YES |  |  |
| `watching` | bigint | YES |  |  |
| `contacted` | bigint | YES |  |  |
| `negotiating` | bigint | YES |  |  |
| `purchased` | bigint | YES |  |  |
| `passed` | bigint | YES |  |  |
| `sources_used` | bigint | YES |  |  |
| `avg_price` | numeric | YES |  |  |
| `top_source` | text | YES |  |  |
| `first_discovery` | timestamp with time zone | YES |  |  |
| `latest_discovery` | timestamp with time zone | YES |  |  |

### `user_engagement_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `total_interactions` | bigint | YES |  |  |
| `unique_targets_interacted` | bigint | YES |  |  |
| `active_days` | bigint | YES |  |  |
| `avg_engagement_score` | numeric | YES |  |  |
| `last_activity` | timestamp with time zone | YES |  |  |
| `first_activity` | timestamp with time zone | YES |  |  |

### `user_external_profiles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | NO |  |  |
| `platform` | text | NO |  |  Values: `bringatrailer`, `cars_and_bids`, `hemmings`, `hagerty`, `instagram`, `youtube` ... (14 total) |
| `profile_url` | text | NO |  |  |
| `username` | text | YES |  |  |
| `verified` | boolean | YES | false |  |
| `auto_import_enabled` | boolean | YES | true |  |
| `last_synced_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `user_interaction_analytics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `total_interactions` | bigint | YES |  |  |
| `likes` | bigint | YES |  |  |
| `dislikes` | bigint | YES |  |  |
| `saves` | bigint | YES |  |  |
| `tags_verified` | bigint | YES |  |  |
| `tags_rejected` | bigint | YES |  |  |
| `vehicles_viewed` | bigint | YES |  |  |
| `active_days` | bigint | YES |  |  |
| `most_active_hour` | numeric | YES |  |  |
| `last_active` | timestamp with time zone | YES |  |  |

### `user_organized_photos`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `image_type` | text | YES |  |  |
| `category` | text | YES |  |  |
| `position` | integer | YES |  |  |
| `caption` | text | YES |  |  |
| `is_primary` | boolean | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `exif_data` | jsonb | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `image_context` | text | YES |  |  |
| `file_hash` | text | YES |  |  |
| `file_name` | text | YES |  |  |
| `file_size` | bigint | YES |  |  |
| `taken_at` | timestamp with time zone | YES |  |  |
| `source` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `is_external` | boolean | YES |  |  |
| `mime_type` | text | YES |  |  |
| `is_sensitive` | boolean | YES |  |  |
| `sensitive_type` | text | YES |  |  |
| `storage_path` | text | YES |  |  |
| `safe_preview_url` | text | YES |  |  |
| `process_stage` | text | YES |  |  |
| `workflow_role` | text | YES |  |  |
| `area` | text | YES |  |  |
| `part` | text | YES |  |  |
| `damage_type` | text | YES |  |  |
| `operation` | text | YES |  |  |
| `materials` | ARRAY | YES |  |  |
| `labels` | ARRAY | YES |  |  |
| `task_id` | uuid | YES |  |  |
| `event_id` | uuid | YES |  |  |
| `angle` | text | YES |  |  |
| `perspective` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `medium_url` | text | YES |  |  |
| `large_url` | text | YES |  |  |
| `optimization_status` | text | YES |  |  |
| `optimized_at` | timestamp with time zone | YES |  |  |
| `variants` | jsonb | YES |  |  |
| `spatial_tags` | ARRAY | YES |  |  |
| `ai_scan_metadata` | jsonb | YES |  |  |
| `ai_last_scanned` | timestamp with time zone | YES |  |  |
| `ai_component_count` | integer | YES |  |  |
| `ai_avg_confidence` | numeric | YES |  |  |
| `filename` | text | YES |  |  |
| `temp_session_id` | text | YES |  |  |
| `is_approved` | boolean | YES |  |  |
| `approved_by` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `imported_by` | uuid | YES |  |  |
| `ghost_user_id` | uuid | YES |  |  |
| `verification_status` | text | YES |  |  |
| `pending_submission_id` | uuid | YES |  |  |
| `image_category` | text | YES |  |  |
| `approval_status` | USER-DEFINED | YES |  |  |
| `submitted_by` | uuid | YES |  |  |
| `redaction_level` | USER-DEFINED | YES |  |  |
| `redacted_by` | uuid | YES |  |  |
| `redacted_at` | timestamp with time zone | YES |  |  |
| `redaction_reason` | text | YES |  |  |
| `uploaded_at` | timestamp with time zone | YES |  |  |
| `analysis_history` | jsonb | YES |  |  |
| `context_score` | integer | YES |  |  |
| `processing_models_used` | ARRAY | YES |  |  |
| `total_processing_cost` | numeric | YES |  |  |
| `rotation` | integer | YES |  |  |
| `document_classification` | text | YES |  |  |
| `is_document` | boolean | YES |  |  |
| `document_category` | text | YES |  |  |
| `manual_priority` | integer | YES |  |  |
| `display_order` | integer | YES |  |  |
| `user_tags` | ARRAY | YES |  |  |
| `user_notes` | text | YES |  |  |
| `ai_processing_status` | text | YES |  |  |
| `ai_processing_started_at` | timestamp with time zone | YES |  |  |
| `ai_processing_completed_at` | timestamp with time zone | YES |  |  |
| `ai_suggestions` | jsonb | YES |  |  |
| `organization_status` | text | YES |  |  |
| `organized_at` | timestamp with time zone | YES |  |  |
| `ai_detected_vehicle` | jsonb | YES |  |  |
| `ai_detected_angle` | text | YES |  |  |
| `ai_detected_angle_confidence` | real | YES |  |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `album_count` | bigint | YES |  |  |

### `user_photo_inbox`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `image_url` | text | YES |  |  |
| `image_type` | text | YES |  |  |
| `category` | text | YES |  |  |
| `position` | integer | YES |  |  |
| `caption` | text | YES |  |  |
| `is_primary` | boolean | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `exif_data` | jsonb | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `image_context` | text | YES |  |  |
| `file_hash` | text | YES |  |  |
| `file_name` | text | YES |  |  |
| `file_size` | bigint | YES |  |  |
| `taken_at` | timestamp with time zone | YES |  |  |
| `source` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `is_external` | boolean | YES |  |  |
| `mime_type` | text | YES |  |  |
| `is_sensitive` | boolean | YES |  |  |
| `sensitive_type` | text | YES |  |  |
| `storage_path` | text | YES |  |  |
| `safe_preview_url` | text | YES |  |  |
| `process_stage` | text | YES |  |  |
| `workflow_role` | text | YES |  |  |
| `area` | text | YES |  |  |
| `part` | text | YES |  |  |
| `damage_type` | text | YES |  |  |
| `operation` | text | YES |  |  |
| `materials` | ARRAY | YES |  |  |
| `labels` | ARRAY | YES |  |  |
| `task_id` | uuid | YES |  |  |
| `event_id` | uuid | YES |  |  |
| `angle` | text | YES |  |  |
| `perspective` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `thumbnail_url` | text | YES |  |  |
| `medium_url` | text | YES |  |  |
| `large_url` | text | YES |  |  |
| `optimization_status` | text | YES |  |  |
| `optimized_at` | timestamp with time zone | YES |  |  |
| `variants` | jsonb | YES |  |  |
| `spatial_tags` | ARRAY | YES |  |  |
| `ai_scan_metadata` | jsonb | YES |  |  |
| `ai_last_scanned` | timestamp with time zone | YES |  |  |
| `ai_component_count` | integer | YES |  |  |
| `ai_avg_confidence` | numeric | YES |  |  |
| `filename` | text | YES |  |  |
| `temp_session_id` | text | YES |  |  |
| `is_approved` | boolean | YES |  |  |
| `approved_by` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `imported_by` | uuid | YES |  |  |
| `ghost_user_id` | uuid | YES |  |  |
| `verification_status` | text | YES |  |  |
| `pending_submission_id` | uuid | YES |  |  |
| `image_category` | text | YES |  |  |
| `approval_status` | USER-DEFINED | YES |  |  |
| `submitted_by` | uuid | YES |  |  |
| `redaction_level` | USER-DEFINED | YES |  |  |
| `redacted_by` | uuid | YES |  |  |
| `redacted_at` | timestamp with time zone | YES |  |  |
| `redaction_reason` | text | YES |  |  |
| `uploaded_at` | timestamp with time zone | YES |  |  |
| `analysis_history` | jsonb | YES |  |  |
| `context_score` | integer | YES |  |  |
| `processing_models_used` | ARRAY | YES |  |  |
| `total_processing_cost` | numeric | YES |  |  |
| `rotation` | integer | YES |  |  |
| `document_classification` | text | YES |  |  |
| `is_document` | boolean | YES |  |  |
| `document_category` | text | YES |  |  |
| `manual_priority` | integer | YES |  |  |
| `display_order` | integer | YES |  |  |
| `user_tags` | ARRAY | YES |  |  |
| `user_notes` | text | YES |  |  |
| `ai_processing_status` | text | YES |  |  |
| `ai_processing_started_at` | timestamp with time zone | YES |  |  |
| `ai_processing_completed_at` | timestamp with time zone | YES |  |  |
| `ai_suggestions` | jsonb | YES |  |  |
| `organization_status` | text | YES |  |  |
| `organized_at` | timestamp with time zone | YES |  |  |
| `ai_detected_vehicle` | jsonb | YES |  |  |
| `ai_detected_angle` | text | YES |  |  |
| `ai_detected_angle_confidence` | real | YES |  |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `album_count` | bigint | YES |  |  |

### `user_preferences`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | NO |  |  |
| `preferred_view_mode` | text | YES | 'gallery' |  Values: `gallery`, `compact`, `technical` |
| `preferred_device` | text | YES | 'desktop' |  Values: `mobile`, `desktop`, `tablet` |
| `enable_gestures` | boolean | YES | true |  |
| `enable_haptic_feedback` | boolean | YES | true |  |
| `preferred_vendors` | ARRAY | YES | ARRAY[][] |  |
| `hidden_tags` | ARRAY | YES | ARRAY[][] |  |
| `favorite_makes` | ARRAY | YES | ARRAY[][] |  |
| `interaction_style` | jsonb | YES | '{}' |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_ratings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | NO |  |  |
| `overall_rating` | numeric | YES | 0.0 |  |
| `contribution_score` | integer | YES | 0 |  |
| `verification_level` | USER-DEFINED | YES | 'unverified'::verification_level |  |
| `reputation_points` | integer | YES | 0 |  |
| `badges` | ARRAY | YES | '{}'[] |  |
| `trust_level` | integer | YES | 1 |  |
| `vehicle_contributions` | integer | YES | 0 |  |
| `image_contributions` | integer | YES | 0 |  |
| `timeline_contributions` | integer | YES | 0 |  |
| `verification_contributions` | integer | YES | 0 |  |
| `community_rating` | numeric | YES | 0.0 |  |
| `email_verified_at` | timestamp with time zone | YES |  |  |
| `phone_verified_at` | timestamp with time zone | YES |  |  |
| `business_verified_at` | timestamp with time zone | YES |  |  |
| `expert_verified_at` | timestamp with time zone | YES |  |  |
| `profile_completion_score` | integer | YES | 0 |  |
| `last_activity_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_receipt_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `total_receipts` | bigint | YES |  |  |
| `total_spending` | numeric | YES |  |  |
| `first_receipt_date` | date | YES |  |  |
| `last_receipt_date` | date | YES |  |  |
| `avg_receipt_amount` | numeric | YES |  |  |
| `vendor_breakdown` | jsonb | YES |  |  |
| `spending_by_category` | jsonb | YES |  |  |

### `user_sync_preferences`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `preferred_channel` | text | YES | 'imessage' |  Values: `imessage`, `sms`, `whatsapp`, `telegram`, `none` |
| `fallback_channel` | text | YES | 'sms' |  |
| `phone_number` | text | YES |  |  |
| `imessage_address` | text | YES |  |  |
| `telegram_chat_id` | bigint | YES |  |  |
| `auto_create_vehicles` | boolean | YES | true |  |
| `auto_create_albums` | boolean | YES | true |  |
| `auto_assign_confidence` | real | YES | 0.8 |  |
| `filter_non_automotive` | boolean | YES | true |  |
| `quiet_start_hour` | integer | YES | 22 |  |
| `quiet_end_hour` | integer | YES | 7 |  |
| `timezone` | text | YES | 'America/Los_Angeles' |  |
| `max_messages_per_hour` | integer | YES | 3 |  |
| `max_messages_per_day` | integer | YES | 10 |  |
| `batch_clarifications` | boolean | YES | true |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_vehicle_discoveries`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `source_platform` | text | NO | 'manual' |  |
| `source_url` | text | YES |  |  |
| `source_external_id` | text | YES |  |  |
| `discovered_price` | numeric | YES |  |  |
| `discovered_location` | text | YES |  |  |
| `discovered_seller_name` | text | YES |  |  |
| `discovered_title` | text | YES |  |  |
| `interaction_status` | text | NO | 'discovered' |  Values: `discovered`, `saved`, `watching`, `contacted`, `negotiating`, `purchased`, `passed` |
| `notes` | text | YES |  |  |
| `tags` | ARRAY | YES | '{}'[] |  |
| `marketplace_listing_id` | uuid | YES |  |  |
| `discovered_at` | timestamp with time zone | NO | now() |  |
| `status_updated_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_vehicle_links`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `link_type` | text | NO |  | Relationship type: owner, previous_owner, favorite, watching, sold Values: `owner`, `previous_owner`, `favorite`, `watching`, `sold` |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_vehicle_preferences`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `is_favorite` | boolean | YES | false |  |
| `is_hidden` | boolean | YES | false | Hide from personal view but still visible in organization context |
| `collection_name` | text | YES |  | Custom collection name. NULL means not in any collection. Multiple vehicles can share same collection name. |
| `notes` | text | YES |  |  |
| `display_order` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `user_vehicle_relationships`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `color` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `owner_id` | uuid | YES |  |  |
| `relationship_type` | text | YES |  |  |
| `role` | text | YES |  |  |
| `is_verified_owner` | boolean | YES |  |  |

### `user_vehicle_roles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `user_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `role` | text | YES |  |  |
| `is_active` | boolean | YES |  |  |
| `granted_at` | timestamp with time zone | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `vin` | text | YES |  |  |

### `v_active_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `category` | text | YES |  |  |
| `status` | text | YES |  |  |
| `extractor_function` | text | YES |  |  |
| `data_quality_score` | double precision | YES |  |  |
| `is_ugly_source` | boolean | YES |  |  |
| `last_successful_at` | timestamp with time zone | YES |  |  |
| `success_rate_24h` | double precision | YES |  |  |
| `total_extracted` | integer | YES |  |  |
| `total_vehicles_created` | integer | YES |  |  |

### `v_cross_post_intel`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_fingerprint` | text | YES |  |  |
| `match_method` | text | YES |  |  |
| `regions_seen` | ARRAY | YES |  |  |
| `region_count` | integer | YES |  |  |
| `listing_count` | integer | YES |  |  |
| `price_variants` | ARRAY | YES |  |  |
| `has_price_variation` | boolean | YES |  |  |
| `deal_score` | integer | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `location_city` | text | YES |  |  |
| `location_state` | text | YES |  |  |
| `primary_url` | text | YES |  |  |
| `seller_id` | uuid | YES |  |  |
| `seller_type` | text | YES |  |  |
| `dealer_score` | integer | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |

### `v_dealer_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `phone` | text | YES |  |  |
| `email` | text | YES |  |  |
| `cl_handle` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `business_name` | text | YES |  |  |
| `website` | text | YES |  |  |
| `business_type` | text | YES |  |  |
| `seller_type` | text | YES |  |  |
| `specialties` | ARRAY | YES |  |  |
| `eras_seen` | int4range | YES |  |  |
| `intel_value` | text | YES |  |  |
| `contact_status` | text | YES |  |  |
| `relationship_notes` | text | YES |  |  |
| `enrichment_status` | text | YES |  |  |
| `primary_region` | text | YES |  |  |
| `primary_state` | text | YES |  |  |
| `regions_seen` | ARRAY | YES |  |  |
| `region_count` | integer | YES |  |  |
| `listing_count` | integer | YES |  |  |
| `listings_per_month` | numeric | YES |  |  |
| `is_cross_poster` | boolean | YES |  |  |
| `cross_post_count` | integer | YES |  |  |
| `platforms_seen` | ARRAY | YES |  |  |
| `dealer_score` | integer | YES |  |  |
| `avg_asking_price` | numeric | YES |  |  |
| `median_asking_price` | numeric | YES |  |  |
| `price_range_low` | numeric | YES |  |  |
| `price_range_high` | numeric | YES |  |  |
| `avg_deal_score` | numeric | YES |  |  |
| `avg_days_listed` | integer | YES |  |  |
| `price_reduction_rate` | numeric | YES |  |  |
| `makes_seen` | ARRAY | YES |  |  |
| `makes_histogram` | jsonb | YES |  |  |
| `models_seen` | ARRAY | YES |  |  |
| `tags` | ARRAY | YES |  |  |
| `discovered_via` | text | YES |  |  |
| `is_comp_source` | boolean | YES |  |  |
| `is_wholesale_candidate` | boolean | YES |  |  |
| `is_restoration_lead` | boolean | YES |  |  |
| `is_provenance_specialist` | boolean | YES |  |  |
| `active_90d` | boolean | YES |  |  |
| `new_listings_last_30d` | integer | YES |  |  |
| `avg_price_last_90d` | numeric | YES |  |  |
| `last_seen_make` | text | YES |  |  |
| `last_seen_price` | numeric | YES |  |  |
| `first_seen_at` | timestamp with time zone | YES |  |  |
| `last_seen_at` | timestamp with time zone | YES |  |  |
| `last_enriched_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `v_extraction_health`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `completed_1h` | bigint | YES |  |  |
| `completed_24h` | bigint | YES |  |  |
| `pending` | bigint | YES |  |  |
| `processing` | bigint | YES |  |  |
| `failed_1h` | bigint | YES |  |  |
| `items_per_hour` | numeric | YES |  |  |

### `v_extraction_health_trend`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `hour` | timestamp with time zone | YES |  |  |
| `avg_items_per_hour` | numeric | YES |  |  |
| `max_items_per_hour` | numeric | YES |  |  |
| `min_items_per_hour` | numeric | YES |  |  |
| `critical_alerts` | bigint | YES |  |  |
| `warning_alerts` | bigint | YES |  |  |
| `avg_pending` | bigint | YES |  |  |
| `avg_failures` | bigint | YES |  |  |

### `v_extraction_quality`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `listing_source` | text | YES |  |  |
| `total_vehicles` | bigint | YES |  |  |
| `pct_vin` | numeric | YES |  |  |
| `pct_mileage` | numeric | YES |  |  |
| `pct_color` | numeric | YES |  |  |
| `pct_interior_color` | numeric | YES |  |  |
| `pct_engine` | numeric | YES |  |  |
| `pct_transmission` | numeric | YES |  |  |
| `pct_description` | numeric | YES |  |  |
| `pct_sale_price` | numeric | YES |  |  |
| `pct_all_key_fields` | numeric | YES |  |  |
| `latest_vehicle_at` | timestamp with time zone | YES |  |  |

### `v_inbox_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `to_address` | text | YES |  |  |
| `total` | bigint | YES |  |  |
| `unread` | bigint | YES |  |  |
| `read` | bigint | YES |  |  |
| `replied` | bigint | YES |  |  |
| `archived` | bigint | YES |  |  |
| `latest_email` | timestamp with time zone | YES |  |  |

### `v_sentiment_by_make`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `make` | text | YES |  |  |
| `vehicle_count` | bigint | YES |  |  |
| `avg_sentiment` | numeric | YES |  |  |
| `median_sentiment` | double precision | YES |  |  |
| `most_common_sentiment` | text | YES |  |  |
| `avg_price` | numeric | YES |  |  |

### `v_sources_needing_attention`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `status` | text | YES |  |  |
| `last_successful_at` | timestamp with time zone | YES |  |  |
| `success_rate_24h` | double precision | YES |  |  |
| `cloudflare_protected` | boolean | YES |  |  |
| `attention_reason` | text | YES |  |  |

### `v_ugly_sources`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `slug` | text | YES |  |  |
| `display_name` | text | YES |  |  |
| `status` | text | YES |  |  |
| `data_quality_score` | double precision | YES |  |  |
| `quality_filters` | jsonb | YES |  |  |
| `total_extracted` | integer | YES |  |  |
| `total_vehicles_created` | integer | YES |  |  |

### `v_valuation_accuracy`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `nuke_estimate` | numeric | YES |  |  |
| `nuke_estimate_confidence` | integer | YES |  |  |
| `estimate_vs_sale` | numeric | YES |  |  |
| `estimate_error_pct` | numeric | YES |  |  |
| `abs_error_pct` | numeric | YES |  |  |
| `valuation_calculated_at` | timestamp with time zone | YES |  |  |

### `v_vehicle_canonical`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `canonical_platform` | text | YES |  |  |
| `platform_display_name` | text | YES |  |  |
| `platform_trust_score` | numeric | YES |  |  |
| `canonical_outcome` | text | YES |  |  |
| `canonical_sold_price` | numeric | YES |  |  |
| `price_type` | text | YES |  |  |
| `data_grade` | text | YES |  |  |
| `status` | text | YES |  |  |

### `v_vehicle_intelligence_full`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `owner_count` | integer | YES |  |  |
| `matching_numbers` | boolean | YES |  |  |
| `has_service_records` | boolean | YES |  |  |
| `is_modified` | boolean | YES |  |  |
| `total_production` | integer | YES |  |  |
| `acquisition_year` | integer | YES |  |  |
| `is_restored` | boolean | YES |  |  |
| `is_rust_free` | boolean | YES |  |  |
| `parts_mentioned` | ARRAY | YES |  |  |
| `service_shops` | ARRAY | YES |  |  |
| `overall_sentiment` | text | YES |  |  |
| `sentiment_score` | numeric | YES |  |  |
| `market_demand` | text | YES |  |  |
| `price_trend` | text | YES |  |  |
| `discussion_themes` | ARRAY | YES |  |  |

### `v_vehicle_ownership_status`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `title_holder_id` | uuid | YES |  |  |
| `title_status` | text | YES |  |  |
| `title_verified_at` | timestamp without time zone | YES |  |  |
| `current_owner_id` | uuid | YES |  |  |
| `ownership_type` | text | YES |  |  |
| `authority_score` | integer | YES |  |  |
| `ownership_start` | date | YES |  |  |
| `likely_possessor_id` | uuid | YES |  |  |
| `has_ownership_conflict` | boolean | YES |  |  |

### `validation_issues_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `error_level` | text | YES |  |  |
| `field_name` | text | YES |  |  |
| `rule_name` | text | YES |  |  |
| `issue_count` | bigint | YES |  |  |
| `auto_fix_action` | text | YES |  |  |

### `vault_active_sms_sessions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `phone_number` | text | YES |  |  |
| `state` | USER-DEFINED | YES |  |  |
| `selected_tier` | USER-DEFINED | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `last_message_at` | timestamp with time zone | YES |  |  |
| `expires_at` | timestamp with time zone | YES |  |  |
| `is_expired` | boolean | YES |  |  |
| `user_name` | text | YES |  |  |
| `vehicle_info` | text | YES |  |  |

### `vault_sms_sessions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `phone_number` | text | NO |  |  |
| `user_id` | uuid | YES |  |  |
| `state` | USER-DEFINED | YES | 'awaiting_image'::vault_sms_state |  |
| `last_image_url` | text | YES |  |  |
| `last_image_received_at` | timestamp with time zone | YES |  |  |
| `selected_tier` | USER-DEFINED | YES |  |  |
| `tier_selected_at` | timestamp with time zone | YES |  |  |
| `pwa_session_token` | text | YES |  |  |
| `pwa_link_sent_at` | timestamp with time zone | YES |  |  |
| `pwa_completed_at` | timestamp with time zone | YES |  |  |
| `app_link_sent_at` | timestamp with time zone | YES |  |  |
| `app_submission_received_at` | timestamp with time zone | YES |  |  |
| `result_vehicle_id` | uuid | YES |  |  |
| `result_attestation_id` | uuid | YES |  |  |
| `context` | jsonb | YES | '{}' |  |
| `message_history` | jsonb | YES | '[]' |  |
| `expires_at` | timestamp with time zone | YES | (now() + '01:00:00'::interval) |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `last_message_at` | timestamp with time zone | YES | now() |  |

### `vehicle_agent_messages`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_agent_id` | uuid | NO |  |  |
| `direction` | text | NO |  |  Values: `inbound`, `outbound` |
| `message_type` | text | NO |  |  |
| `content` | text | YES |  |  |
| `media_urls` | ARRAY | YES |  |  |
| `from_user_id` | uuid | YES |  |  |
| `from_tech_link_id` | uuid | YES |  |  |
| `channel` | text | YES |  |  |
| `ai_generated` | boolean | YES | false |  |
| `ai_model` | text | YES |  |  |
| `tokens_used` | integer | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_builds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `start_date` | date | YES |  |  |
| `target_completion_date` | date | YES |  |  |
| `actual_completion_date` | date | YES |  |  |
| `status` | text | YES | 'planning' |  Values: `planning`, `in_progress`, `on_hold`, `completed`, `cancelled` |
| `total_budget` | numeric | YES |  |  |
| `total_spent` | numeric | YES | 0 |  |
| `total_hours_estimated` | integer | YES |  |  |
| `total_hours_actual` | integer | YES | 0 |  |
| `is_public` | boolean | YES | false |  |
| `visibility_level` | text | YES | 'private' |  Values: `private`, `friends`, `public` |
| `show_costs` | boolean | YES | false |  |
| `allow_comments` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_contributors`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `role` | text | NO |  |  Values: `owner`, `previous_owner`, `restorer`, `contributor`, `mechanic`, `consigner` ... (24 total) |
| `start_date` | date | NO | CURRENT_DATE |  |
| `end_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `status` | text | YES | 'active' |  |
| `can_edit` | boolean | YES | true |  |
| `can_delete` | boolean | YES | false |  |
| `can_approve` | boolean | YES | false |  |
| `can_sell` | boolean | YES | false |  |
| `organization_id` | uuid | YES |  |  |

### `vehicle_data_history`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `field_name` | text | NO |  |  |
| `old_value` | text | YES |  |  |
| `new_value` | text | YES |  |  |
| `old_value_source` | text | YES |  |  |
| `old_value_user_id` | uuid | YES |  |  |
| `old_value_submitted_at` | timestamp with time zone | YES |  |  |
| `correction_source` | text | NO |  |  |
| `correction_submission_id` | uuid | YES |  |  |
| `correction_user_id` | uuid | YES |  |  |
| `correction_confidence` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_display_names`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `series` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `short_name` | text | YES |  |  |
| `full_name` | text | YES |  |  |
| `display_name` | text | YES |  |  |

### `vehicle_doc_value_v`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `doc_value_30d` | numeric | YES |  |  |
| `doc_value_lifetime` | numeric | YES |  |  |

### `vehicle_dynamic_data`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `field_name` | text | NO |  |  |
| `field_value` | text | YES |  |  |
| `field_type` | text | YES | 'text' |  |
| `field_category` | text | YES |  |  |
| `display_order` | integer | YES | 0 |  |
| `is_verified` | boolean | YES | false |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_event_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `total_events` | bigint | YES |  |  |
| `times_sold` | bigint | YES |  |  |
| `platforms_seen` | bigint | YES |  |  |
| `platform_list` | ARRAY | YES |  |  |
| `first_event_date` | timestamp with time zone | YES |  |  |
| `last_event_date` | timestamp with time zone | YES |  |  |
| `highest_sale_price` | numeric | YES |  |  |
| `lowest_sale_price` | numeric | YES |  |  |
| `avg_sale_price` | numeric | YES |  |  |
| `total_bids` | bigint | YES |  |  |
| `total_comments` | bigint | YES |  |  |
| `total_views` | bigint | YES |  |  |

### `vehicle_field_source_map`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_identity` | text | YES |  |  |
| `field_name` | text | YES |  |  |
| `current_value` | text | YES |  |  |
| `total_confidence` | integer | YES |  |  |
| `confidence_rating` | text | YES |  |  |
| `primary_source` | text | YES |  |  |
| `primary_trust_level` | integer | YES |  |  |
| `source_description` | text | YES |  |  |
| `supporting_sources` | ARRAY | YES |  |  |
| `factory_original_value` | text | YES |  |  |
| `modification_status` | text | YES |  |  |
| `modification_date` | date | YES |  |  |
| `evidence_trail` | jsonb | YES |  |  |
| `last_verified_at` | timestamp with time zone | YES |  |  |
| `last_verified_by` | text | YES |  |  |

### `vehicle_field_validators`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `field_name` | text | NO |  |  |
| `required_topics` | ARRAY | NO |  |  |
| `optional_topics` | ARRAY | YES |  |  |
| `description` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_full_name`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `series` | text | YES |  |  |
| `drive_type` | text | YES |  |  |
| `weight_class` | text | YES |  |  |
| `wheelbase` | text | YES |  |  |
| `cab_style` | text | YES |  |  |
| `is_dually` | boolean | YES |  |  |
| `full_name` | text | YES |  |  |
| `short_name` | text | YES |  |  |

### `vehicle_funding_rounds`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `builder_id` | uuid | NO |  |  |
| `target_amount_cents` | bigint | NO |  |  |
| `raised_amount_cents` | bigint | YES | 0 |  |
| `min_stake_cents` | bigint | YES | 300 |  |
| `max_stake_cents` | bigint | YES |  |  |
| `profit_share_pct` | numeric | NO |  |  |
| `builder_investment_cents` | bigint | YES | 0 |  |
| `status` | text | YES | 'fundraising' |  Values: `fundraising`, `funded`, `building`, `completed`, `failed`, `cancelled` |
| `funding_deadline` | timestamp with time zone | YES |  |  |
| `funded_at` | timestamp with time zone | YES |  |  |
| `sale_price_cents` | bigint | YES |  |  |
| `total_cost_basis_cents` | bigint | YES |  |  |
| `net_profit_cents` | bigint | YES |  |  |
| `staker_profit_pool_cents` | bigint | YES |  |  |
| `sold_at` | timestamp with time zone | YES |  |  |
| `distributed_at` | timestamp with time zone | YES |  |  |
| `description` | text | YES |  |  |
| `use_of_funds` | text | YES |  |  |
| `estimated_completion_date` | date | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_image_classifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `suggested_vehicle_id` | uuid | YES |  |  |
| `confidence` | numeric | NO | 0 |  |
| `reasoning` | text | YES |  |  |
| `detected_features` | jsonb | YES | '{}' |  |
| `auto_applied` | boolean | YES | false |  |
| `user_confirmed` | boolean | YES |  |  |
| `user_confirmed_at` | timestamp with time zone | YES |  |  |
| `classified_at` | timestamp with time zone | YES | now() |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_image_comments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `comment_text` | text | NO |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `vehicle_id` | uuid | YES |  |  |

### `vehicle_image_coverage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `exterior_essential_count` | bigint | YES |  |  |
| `exterior_essential_total` | bigint | YES |  |  |
| `interior_essential_count` | bigint | YES |  |  |
| `interior_essential_total` | bigint | YES |  |  |
| `undercarriage_essential_count` | bigint | YES |  |  |
| `undercarriage_essential_total` | bigint | YES |  |  |
| `engine_bay_essential_count` | bigint | YES |  |  |
| `engine_bay_essential_total` | bigint | YES |  |  |
| `vin_plates_essential_count` | bigint | YES |  |  |
| `vin_plates_essential_total` | bigint | YES |  |  |
| `essential_coverage_percent` | numeric | YES |  |  |
| `missing_essential_angles` | ARRAY | YES |  |  |

### `vehicle_image_day_docs_v`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `doc_date` | date | YES |  |  |
| `total_images` | bigint | YES |  |  |
| `actors_count` | bigint | YES |  |  |
| `unique_areas` | bigint | YES |  |  |
| `series_span_minutes` | numeric | YES |  |  |
| `avg_trust_weight` | numeric | YES |  |  |
| `hourly_rate` | integer | YES |  |  |

### `vehicle_jobs`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `created_by` | uuid | YES |  |  |
| `title` | text | NO |  |  |
| `description` | text | YES |  |  |
| `desired_completion_date` | date | YES |  |  |
| `desired_start_date` | date | YES |  |  |
| `estimated_hours` | numeric | YES |  |  |
| `location_preference` | text | NO | 'either' |  Values: `on_site`, `drop_off`, `either` |
| `budget_cents` | integer | YES |  |  |
| `currency` | text | NO | 'USD' |  |
| `allow_hold` | boolean | NO | false |  |
| `funding_status` | text | NO | 'none' |  Values: `none`, `requested`, `held`, `released`, `failed` |
| `status` | text | NO | 'draft' |  Values: `draft`, `listed`, `assigned`, `in_progress`, `completed`, `cancelled` |
| `visibility` | text | NO | 'private' |  Values: `private`, `invited`, `marketplace` |
| `metadata` | jsonb | NO | '{}' |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `technician_id` | uuid | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |

### `vehicle_labor_provenance`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `total_work_sessions` | bigint | YES |  |  |
| `total_minutes_worked` | integer | YES |  |  |
| `total_hours_worked` | numeric | YES |  |  |
| `total_parts_invested` | numeric | YES |  |  |
| `total_tool_depreciation` | numeric | YES |  |  |
| `total_labor_value` | numeric | YES |  |  |
| `total_investment` | numeric | YES |  |  |
| `first_work_date` | date | YES |  |  |
| `last_work_date` | date | YES |  |  |
| `total_photos` | bigint | YES |  |  |
| `total_notes` | bigint | YES |  |  |

### `vehicle_latest_event`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `source_organization_id` | uuid | YES |  |  |
| `source_platform` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `source_listing_id` | text | YES |  |  |
| `event_type` | text | YES |  |  |
| `event_status` | text | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `ended_at` | timestamp with time zone | YES |  |  |
| `sold_at` | timestamp with time zone | YES |  |  |
| `starting_price` | numeric | YES |  |  |
| `current_price` | numeric | YES |  |  |
| `final_price` | numeric | YES |  |  |
| `reserve_price` | numeric | YES |  |  |
| `buy_now_price` | numeric | YES |  |  |
| `bid_count` | integer | YES |  |  |
| `comment_count` | integer | YES |  |  |
| `view_count` | integer | YES |  |  |
| `watcher_count` | integer | YES |  |  |
| `seller_identifier` | text | YES |  |  |
| `buyer_identifier` | text | YES |  |  |
| `seller_external_identity_id` | uuid | YES |  |  |
| `buyer_external_identity_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `extracted_at` | timestamp with time zone | YES |  |  |
| `extraction_method` | text | YES |  |  |
| `extraction_source` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |

### `vehicle_listings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `seller_id` | uuid | NO |  |  |
| `list_price_cents` | bigint | NO |  |  |
| `reserve_price_cents` | bigint | YES |  |  |
| `accept_offers` | boolean | YES | true |  |
| `sale_type` | text | YES | 'auction' |  Values: `auction`, `live_auction`, `fixed_price`, `best_offer`, `hybrid` |
| `auction_start_time` | timestamp with time zone | YES |  |  |
| `auction_end_time` | timestamp with time zone | YES |  |  |
| `current_high_bid_cents` | bigint | YES |  |  |
| `bid_count` | integer | YES | 0 |  |
| `status` | text | YES | 'active' |  Values: `draft`, `active`, `sold`, `cancelled`, `expired` |
| `final_price_cents` | bigint | YES |  |  |
| `buyer_id` | uuid | YES |  |  |
| `sold_at` | timestamp with time zone | YES |  |  |
| `description` | text | YES |  |  |
| `terms_conditions` | text | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `current_high_bidder_id` | uuid | YES |  |  |
| `last_bid_time` | timestamp with time zone | YES |  |  |
| `sniping_extensions` | integer | YES | 0 |  |
| `sniping_protection_minutes` | integer | YES | 2 |  |
| `soft_close_enabled` | boolean | YES | true |  |
| `soft_close_window_seconds` | integer | YES | 120 |  |
| `soft_close_reset_seconds` | integer | YES | 120 |  |
| `auction_duration_minutes` | integer | YES |  |  |
| `auto_start_enabled` | boolean | YES | false |  |
| `auto_start_armed_at` | timestamp with time zone | YES |  |  |
| `auto_start_last_attempt_at` | timestamp with time zone | YES |  |  |
| `auto_start_last_error` | text | YES |  |  |
| `schedule_strategy` | text | YES | 'manual' |  Values: `manual`, `auto`, `premium` |
| `premium_status` | text | YES | 'none' |  Values: `none`, `requested`, `pending_payment`, `paid`, `scheduled`, `consumed`, `refunded`, `cancelled` |
| `premium_budget_cents` | bigint | YES |  |  |
| `premium_paid_at` | timestamp with time zone | YES |  |  |
| `premium_priority` | integer | YES | 0 |  |
| `readiness_last_checked_at` | timestamp with time zone | YES |  |  |
| `readiness_last_result` | jsonb | YES | '{}' |  |

### `vehicle_merge_proposals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `primary_vehicle_id` | uuid | NO |  |  |
| `duplicate_vehicle_id` | uuid | NO |  |  |
| `match_type` | text | NO |  |  Values: `vin_exact`, `vin_fuzzy`, `year_make_model_exact`, `year_make_model_fuzzy`, `dropbox_duplicate`, `owner_same_user`, `exact_listing_url`, `manual_merge` |
| `confidence_score` | integer | NO |  |  |
| `match_reasoning` | jsonb | YES | '{}' |  |
| `ai_summary` | text | YES |  |  |
| `recommended_primary` | uuid | YES |  |  |
| `recommendation_reason` | text | YES |  |  |
| `data_comparison` | jsonb | YES | '{}' |  |
| `status` | text | NO | 'detected' |  Values: `detected`, `proposed`, `approved`, `rejected`, `merged`, `auto_merged` |
| `visible_to_user_ids` | ARRAY | YES | ARRAY[]::uuid[] |  |
| `requires_approval_from` | uuid | YES |  |  |
| `reviewed_by` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `review_notes` | text | YES |  |  |
| `merged_by` | uuid | YES |  |  |
| `merged_at` | timestamp with time zone | YES |  |  |
| `merge_strategy` | text | YES |  |  |
| `detected_at` | timestamp with time zone | NO | now() |  |
| `detected_by` | text | YES | 'ai_system' |  |
| `detection_job_id` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_nhtsa_comparison`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `user_identity` | text | YES |  |  |
| `nhtsa_identity` | text | YES |  |  |
| `field_comparison` | jsonb | YES |  |  |
| `match_status` | text | YES |  |  |
| `enrichment_actions` | ARRAY | YES |  |  |

### `vehicle_nomenclature`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `series` | text | YES |  |  |
| `body_designation` | text | YES |  |  |
| `drive_type` | text | YES |  |  |
| `weight_class` | text | YES |  |  |
| `wheelbase` | text | YES |  |  |
| `bed_length` | text | YES |  |  |
| `cab_style` | text | YES |  |  |
| `is_dually` | boolean | YES | false |  |
| `is_diesel` | boolean | YES | false |  |
| `is_hd` | boolean | YES | false |  |
| `is_special_edition` | boolean | YES | false |  |
| `special_edition_name` | text | YES |  |  |
| `package_code` | text | YES |  |  |
| `interior_trim_code` | text | YES |  |  |
| `exterior_color_code` | text | YES |  |  |
| `paint_code` | text | YES |  |  |
| `oem_model_code` | text | YES |  |  |
| `oem_chassis_code` | text | YES |  |  |
| `confidence_score` | integer | YES | 50 |  |
| `source` | text | YES | 'user_input' |  |
| `created_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_notes`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `note` | text | NO |  |  |
| `source` | text | YES | 'manual' |  |
| `created_by` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_observation_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `total_observations` | bigint | YES |  |  |
| `source_count` | bigint | YES |  |  |
| `observation_types` | ARRAY | YES |  |  |
| `first_observed` | timestamp with time zone | YES |  |  |
| `last_observed` | timestamp with time zone | YES |  |  |
| `comment_count` | bigint | YES |  |  |
| `listing_count` | bigint | YES |  |  |
| `sale_count` | bigint | YES |  |  |

### `vehicle_offerings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `seller_id` | uuid | NO |  |  |
| `offering_type` | text | NO |  |  Values: `whole`, `fractional`, `both` |
| `total_shares` | integer | YES | 1000 |  |
| `initial_share_price` | numeric | NO |  |  |
| `current_share_price` | numeric | NO |  |  |
| `opening_price` | numeric | YES |  |  |
| `closing_price` | numeric | YES |  |  |
| `reserve_price` | numeric | YES |  |  |
| `minimum_bid_increment` | numeric | YES |  |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `scheduled`, `active`, `trading`, `closing_auction`, `closed`, `sold_out`, `cancelled` |
| `scheduled_start_time` | timestamp with time zone | YES |  |  |
| `actual_start_time` | timestamp with time zone | YES |  |  |
| `auction_duration_seconds` | integer | YES | 300 |  |
| `allow_extension` | boolean | YES | true |  |
| `extension_time_seconds` | integer | YES | 30 |  |
| `minimum_seconds_to_extend` | integer | YES | 60 |  |
| `total_bids` | integer | YES | 0 |  |
| `total_trades` | integer | YES | 0 |  |
| `total_volume_shares` | integer | YES | 0 |  |
| `total_volume_usd` | numeric | YES | 0 |  |
| `highest_bid` | numeric | YES |  |  |
| `lowest_ask` | numeric | YES |  |  |
| `bid_ask_spread` | numeric | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_ownerships`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `owner_profile_id` | uuid | NO |  |  |
| `role` | text | NO | 'owner' |  |
| `is_current` | boolean | NO | true |  |
| `start_date` | date | YES |  |  |
| `end_date` | date | YES |  |  |
| `proof_event_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `ownership_type` | text | YES |  |  |
| `verification_id` | uuid | YES |  |  |
| `authority_score` | integer | YES |  |  |

### `vehicle_part_locations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `make` | text | NO |  |  |
| `model` | text | NO |  |  |
| `year_start` | integer | YES |  |  |
| `year_end` | integer | YES |  |  |
| `body_style` | text | YES |  |  |
| `part_category` | text | NO |  |  |
| `part_name` | text | NO |  |  |
| `oem_part_number` | text | YES |  |  |
| `view_angle` | text | NO |  |  Values: `front`, `rear`, `side_driver`, `side_passenger`, `interior_dash`, `interior_seats`, `engine_bay`, `undercarriage` |
| `x_position_min` | numeric | YES |  |  |
| `x_position_max` | numeric | YES |  |  |
| `y_position_min` | numeric | YES |  |  |
| `y_position_max` | numeric | YES |  |  |
| `relative_to` | text | YES |  |  |
| `position_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |

### `vehicle_parts_intelligence`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `part_type` | text | YES |  |  |
| `reason` | text | YES |  |  |
| `priority` | integer | YES |  |  |
| `status` | text | YES |  |  |
| `best_price` | numeric | YES |  |  |
| `best_listing_url` | text | YES |  |  |
| `recommended_quality` | text | YES |  |  |
| `ebay_search_terms` | ARRAY | YES |  |  |
| `avg_price_low` | numeric | YES |  |  |
| `avg_price_high` | numeric | YES |  |  |
| `oem_available` | boolean | YES |  |  |
| `aftermarket_available` | boolean | YES |  |  |
| `top_seller_username` | text | YES |  |  |
| `last_checked_at` | timestamp with time zone | YES |  |  |
| `data_freshness` | text | YES |  |  |

### `vehicle_permissions_debug`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `uploaded_by` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `owner_id` | uuid | YES |  |  |
| `contributors` | json | YES |  |  |
| `old_contributor_roles` | json | YES |  |  |
| `org_access` | json | YES |  |  |

### `vehicle_rarity_view`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `body_style` | text | YES |  |  |
| `trim_level` | text | YES |  |  |
| `engine_option` | text | YES |  |  |
| `total_produced` | integer | YES |  |  |
| `rarity_level` | text | YES |  |  |
| `rarity_reason` | text | YES |  |  |
| `collector_demand_score` | integer | YES |  |  |
| `current_market_value_low` | numeric | YES |  |  |
| `current_market_value_high` | numeric | YES |  |  |
| `data_source` | text | YES |  |  |
| `last_updated` | timestamp with time zone | YES |  |  |

### `vehicle_receipts_rollup_v`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `total_lifetime` | numeric | YES |  |  |
| `total_90d` | numeric | YES |  |  |
| `total_365d` | numeric | YES |  |  |
| `receipts_count` | bigint | YES |  |  |

### `vehicle_reconstructions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `point_cloud_url` | text | YES |  |  |
| `camera_poses` | jsonb | NO | '{}' |  |
| `reconstruction_quality` | text | NO | 'pending' |  Values: `pending`, `good`, `poor`, `failed`, `skipped` |
| `image_count` | integer | NO | 0 |  |
| `reconstructed_at` | timestamp with time zone | NO | now() |  |
| `created_at` | timestamp with time zone | NO | now() |  |

### `vehicle_relationship_verifications`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_vehicle_id` | uuid | NO |  |  |
| `requested_by_user_id` | uuid | NO |  |  |
| `verification_type` | text | NO |  |  Values: `relationship`, `sale`, `status_change` |
| `current_relationship_type` | text | YES |  |  |
| `proposed_relationship_type` | text | YES |  |  |
| `proposed_status` | text | YES |  |  |
| `proof_type` | text | YES |  |  Values: `bat_url`, `receipt`, `contract`, `photo_metadata`, `other` |
| `proof_url` | text | YES |  |  |
| `proof_document_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `expired` |
| `reviewed_by_user_id` | uuid | YES |  |  |
| `reviewed_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_sale_settings`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `for_sale` | boolean | NO | false |  |
| `live_auction` | boolean | NO | false |  |
| `partners` | ARRAY | NO | '{}'[] |  |
| `reserve` | numeric | YES |  |  |
| `updated_at` | timestamp with time zone | NO | now() |  |
| `display_price_mode` | text | YES | 'asking' |  |
| `display_responsible_mode` | text | YES | 'owner' |  |
| `display_responsible_custom` | text | YES |  |  |
| `target_ready_hours` | integer | YES | 168 |  |

### `vehicle_search`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `generation` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `era` | text | YES |  |  |
| `segment` | text | YES |  |  |
| `segment_slug` | text | YES |  |  |
| `country_of_origin` | text | YES |  |  |
| `brand_tier` | text | YES |  |  |
| `auction_source` | text | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `winning_bid` | integer | YES |  |  |
| `high_bid` | integer | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `best_price` | numeric | YES |  |  |
| `auction_outcome` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `exterior_color` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `vehicle_source_counts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `auction_source` | text | YES |  |  |
| `total` | bigint | YES |  |  |
| `active` | bigint | YES |  |  |
| `sold` | bigint | YES |  |  |
| `public_visible` | bigint | YES |  |  |
| `pct_with_price` | numeric | YES |  |  |

### `vehicle_spid_data`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `image_id` | uuid | YES |  |  |
| `vin` | text | YES |  |  |
| `build_date` | text | YES |  |  |
| `build_sequence` | text | YES |  |  |
| `paint_code_exterior` | text | YES |  |  |
| `paint_code_interior` | text | YES |  |  |
| `engine_code` | text | YES |  |  |
| `transmission_code` | text | YES |  |  |
| `axle_ratio` | text | YES |  |  |
| `rpo_codes` | jsonb | YES | '[]' | Array of RPO (Regular Production Option) codes extracted from SPID sheet |
| `extraction_confidence` | integer | YES |  | Confidence score (0-100) of the AI extraction |
| `raw_extracted_text` | text | YES |  |  |
| `extraction_method` | text | YES | 'ai_vision' |  |
| `extracted_at` | timestamp with time zone | YES | now() |  |
| `is_verified` | boolean | YES | false |  |
| `verified_by` | uuid | YES |  |  |
| `verified_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `model_code` | text | YES |  |  |
| `sequence_number` | text | YES |  |  |
| `wheelbase` | text | YES |  | Factory wheelbase in inches from SPID |
| `tire_front` | text | YES |  |  |
| `tire_rear` | text | YES |  |  |
| `gvw_rating` | text | YES |  |  |
| `special_packages` | ARRAY | YES |  | Special equipment packages (Camper, Trailering, Off-Road, etc.) |
| `production_sequence` | text | YES |  |  |
| `assembly_plant_code` | text | YES |  |  |
| `paint_code_exterior_name` | text | YES |  |  |
| `paint_code_interior_name` | text | YES |  |  |
| `is_two_tone` | boolean | YES | false |  |
| `engine_rpo_code` | text | YES |  |  |
| `engine_displacement_ci` | text | YES |  |  |
| `engine_displacement_liters` | numeric | YES |  |  |
| `engine_type` | text | YES |  |  |
| `engine_description` | text | YES |  |  |
| `transmission_rpo_code` | text | YES |  |  |
| `transmission_model` | text | YES |  |  |
| `transmission_type` | text | YES |  |  |
| `transmission_speeds` | integer | YES |  |  |
| `transmission_description` | text | YES |  |  |
| `drive_type` | text | YES |  |  |
| `axle_description` | text | YES |  |  |
| `differential_type` | text | YES |  |  |
| `transfer_case_rpo` | text | YES |  |  |
| `gvw_pounds` | integer | YES |  |  |
| `suspension_package` | text | YES |  |  |
| `tire_size_front` | text | YES |  | Original factory front tire size from SPID |
| `tire_size_rear` | text | YES |  | Original factory rear tire size from SPID |
| `tire_load_rating` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `cab_configuration` | text | YES |  |  |
| `bed_length` | text | YES |  |  |
| `rpo_codes_with_descriptions` | jsonb | YES |  | All RPO codes with their descriptions as shown on SPID |
| `sticker_style` | text | YES |  | Detected label style: legacy_sid, rpo_era_1987plus, etc. |

### `vehicle_stats_cache`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | NO |  |  |
| `total_images` | integer | YES | 0 |  |
| `total_ai_tags` | integer | YES | 0 |  |
| `total_labor_hours` | numeric | YES | 0 |  |
| `total_receipts_value` | numeric | YES | 0 |  |
| `last_activity_date` | date | YES |  |  |
| `confidence_score` | integer | YES | 0 |  |
| `systems_worked` | ARRAY | YES | '{}'[] |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_suggested_parts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `part_catalog_id` | uuid | YES |  |  |
| `part_type` | text | NO |  |  |
| `reason` | text | NO |  | Why this part is suggested: high_mileage, common_failure, preventive, routine_maintenance, age_based |
| `reason_details` | text | YES |  |  |
| `priority` | integer | YES | 3 | 1=urgent (safety), 2=important (reliability), 3=recommended (maintenance), 4=optional, 5=nice-to-have |
| `ebay_listing_ids` | ARRAY | YES | '{}'[] |  |
| `best_price` | numeric | YES |  |  |
| `best_seller` | text | YES |  |  |
| `best_listing_url` | text | YES |  |  |
| `recommended_quality` | text | YES | 'premium_aftermarket' |  |
| `status` | text | YES | 'suggested' |  |
| `last_checked_at` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicle_surface_coverage`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `zone` | text | YES |  |  |
| `image_count` | bigint | YES |  |  |
| `observation_count` | bigint | YES |  |  |
| `max_resolution` | smallint | YES |  |  |
| `observation_types` | ARRAY | YES |  |  |
| `avg_severity` | double precision | YES |  |  |
| `max_severity` | real | YES |  |  |
| `lifecycle_states` | ARRAY | YES |  |  |
| `passes_completed` | ARRAY | YES |  |  |
| `condition_labels` | ARRAY | YES |  |  |
| `has_physical_coords` | boolean | YES |  |  |

### `vehicle_tech_assignments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `technician_phone_link_id` | uuid | NO |  |  |
| `assigned_by` | uuid | YES |  |  |
| `work_types` | ARRAY | YES | '{}'[] |  |
| `estimated_hours` | numeric | YES |  |  |
| `hourly_rate` | numeric | YES |  |  |
| `flat_rate` | numeric | YES |  |  |
| `status` | text | YES | 'active' |  Values: `active`, `completed`, `paused`, `cancelled` |
| `photos_received` | integer | YES | 0 |  |
| `hours_logged` | numeric | YES | 0 |  |
| `assigned_at` | timestamp with time zone | YES | now() |  |
| `completed_at` | timestamp with time zone | YES |  |  |

### `vehicle_timeline`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `event_type` | character varying | NO |  |  |
| `event_date` | timestamp without time zone | NO |  |  |
| `source` | character varying | YES |  |  |
| `confidence_score` | double precision | YES | 1.0 |  |
| `title` | character varying | NO |  |  |
| `description` | text | YES |  |  |
| `location` | character varying | YES |  |  |
| `creator_id` | uuid | YES |  |  |
| `verified` | boolean | NO | false |  |
| `verifier_id` | uuid | YES |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `inserted_at` | timestamp without time zone | NO |  |  |
| `updated_at` | timestamp without time zone | NO |  |  |

### `vehicle_timeline_events`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `event_type` | text | YES |  |  |
| `source` | text | YES |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `event_date` | date | YES |  |  |
| `image_urls` | ARRAY | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `mileage_at_event` | integer | YES |  |  |
| `cost_amount` | numeric | YES |  |  |
| `cost_currency` | text | YES |  |  |
| `duration_hours` | numeric | YES |  |  |
| `location_name` | text | YES |  |  |
| `location_address` | text | YES |  |  |
| `location_coordinates` | point | YES |  |  |
| `service_provider_name` | text | YES |  |  |
| `service_provider_type` | text | YES |  |  |
| `invoice_number` | text | YES |  |  |
| `warranty_info` | jsonb | YES |  |  |
| `parts_used` | ARRAY | YES |  |  |
| `verification_documents` | ARRAY | YES |  |  |
| `is_insurance_claim` | boolean | YES |  |  |
| `insurance_claim_number` | text | YES |  |  |
| `next_service_due_date` | date | YES |  |  |
| `next_service_due_mileage` | integer | YES |  |  |
| `data_source` | text | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `source_type` | text | YES |  |  |
| `event_category` | text | YES |  |  |
| `activity_type` | text | YES |  |  |
| `automated_tags` | ARRAY | YES |  |  |
| `manual_tags` | ARRAY | YES |  |  |
| `photo_analysis` | jsonb | YES |  |  |
| `receipt_data` | jsonb | YES |  |  |
| `parts_mentioned` | ARRAY | YES |  |  |
| `tools_mentioned` | ARRAY | YES |  |  |
| `labor_hours` | numeric | YES |  |  |
| `cost_estimate` | numeric | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `client_id` | uuid | YES |  |  |
| `is_monetized` | boolean | YES |  |  |
| `work_started` | timestamp with time zone | YES |  |  |
| `work_completed` | timestamp with time zone | YES |  |  |
| `contract_id` | uuid | YES |  |  |
| `applied_labor_rate` | numeric | YES |  |  |
| `applied_shop_rate` | numeric | YES |  |  |
| `rate_source` | text | YES |  |  |
| `contextual_analysis_status` | text | YES |  |  |
| `documented_by` | uuid | YES |  |  |
| `primary_technician` | uuid | YES |  |  |
| `quality_rating` | integer | YES |  |  |
| `quality_justification` | text | YES |  |  |
| `value_impact` | numeric | YES |  |  |
| `ai_confidence_score` | numeric | YES |  |  |
| `concerns` | ARRAY | YES |  |  |
| `industry_standard_comparison` | jsonb | YES |  |  |
| `search_vector` | tsvector | YES |  |  |
| `work_order_id` | uuid | YES |  |  |

### `vehicle_user_relationships`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | NO |  |  |
| `user_id` | uuid | NO |  |  |
| `role` | text | NO |  |  Values: `viewer`, `contributor`, `photographer`, `previous_owner`, `mechanic`, `restorer` ... (11 total) |
| `status` | text | NO | 'active' |  Values: `pending`, `active`, `suspended`, `revoked` |
| `granted_by` | uuid | YES |  |  |
| `granted_at` | timestamp with time zone | NO | now() |  |
| `context_modifiers` | jsonb | NO | '{"timeAsUser": 0, "trustScore": 0, "hasInsuran... |  |
| `custom_permissions` | ARRAY | YES |  |  |
| `restrictions` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vehicles_inventory`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `uploaded_by` | uuid | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `vin` | text | YES |  |  |
| `license_plate` | text | YES |  |  |
| `color` | text | YES |  |  |
| `mileage` | integer | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `engine_size` | text | YES |  |  |
| `horsepower` | integer | YES |  |  |
| `torque` | integer | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `body_style` | text | YES |  |  |
| `doors` | integer | YES |  |  |
| `seats` | integer | YES |  |  |
| `weight_lbs` | integer | YES |  |  |
| `length_inches` | integer | YES |  |  |
| `width_inches` | integer | YES |  |  |
| `height_inches` | integer | YES |  |  |
| `wheelbase_inches` | integer | YES |  |  |
| `fuel_capacity_gallons` | numeric | YES |  |  |
| `mpg_city` | integer | YES |  |  |
| `mpg_highway` | integer | YES |  |  |
| `mpg_combined` | integer | YES |  |  |
| `msrp` | numeric | YES |  |  |
| `current_value` | numeric | YES |  |  |
| `purchase_price` | numeric | YES |  |  |
| `purchase_date` | date | YES |  |  |
| `purchase_location` | text | YES |  |  |
| `previous_owners` | integer | YES |  |  |
| `is_modified` | boolean | YES |  |  |
| `modification_details` | text | YES |  |  |
| `condition_rating` | integer | YES |  |  |
| `maintenance_notes` | text | YES |  |  |
| `insurance_company` | text | YES |  |  |
| `insurance_policy_number` | text | YES |  |  |
| `registration_state` | text | YES |  |  |
| `registration_expiry` | date | YES |  |  |
| `inspection_expiry` | date | YES |  |  |
| `is_public` | boolean | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `sale_price` | integer | YES |  |  |
| `auction_end_date` | text | YES |  |  |
| `bid_count` | integer | YES |  |  |
| `view_count` | integer | YES |  |  |
| `auction_source` | text | YES |  |  |
| `ownership_verified` | boolean | YES |  |  |
| `ownership_verified_at` | timestamp without time zone | YES |  |  |
| `ownership_verification_id` | uuid | YES |  |  |
| `bat_auction_url` | text | YES |  |  |
| `bat_sold_price` | numeric | YES |  |  |
| `bat_sale_date` | date | YES |  |  |
| `bat_bid_count` | integer | YES |  |  |
| `bat_view_count` | integer | YES |  |  |
| `is_daily_driver` | boolean | YES |  |  |
| `is_weekend_car` | boolean | YES |  |  |
| `is_track_car` | boolean | YES |  |  |
| `is_show_car` | boolean | YES |  |  |
| `is_project_car` | boolean | YES |  |  |
| `is_garage_kept` | boolean | YES |  |  |
| `discovered_by` | uuid | YES |  |  |
| `discovery_source` | text | YES |  |  |
| `discovery_url` | text | YES |  |  |
| `bat_listing_title` | text | YES |  |  |
| `bat_bids` | integer | YES |  |  |
| `bat_comments` | integer | YES |  |  |
| `bat_views` | integer | YES |  |  |
| `bat_location` | text | YES |  |  |
| `bat_seller` | text | YES |  |  |
| `sale_status` | text | YES |  |  |
| `sale_date` | date | YES |  |  |
| `status` | text | YES |  |  |
| `completion_percentage` | integer | YES |  |  |
| `displacement` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `is_for_sale` | boolean | YES |  |  |
| `is_draft` | boolean | YES |  |  |
| `deleted_at` | timestamp with time zone | YES |  |  |
| `entry_type` | text | YES |  |  |
| `verification_status` | text | YES |  |  |
| `confidence_score` | integer | YES |  |  |
| `source` | text | YES |  |  |
| `import_source` | character varying | YES |  |  |
| `import_metadata` | jsonb | YES |  |  |
| `uploaded_at` | timestamp without time zone | YES |  |  |
| `asking_price` | numeric | YES |  |  |
| `owner_shop_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `acting_on_behalf_of` | text | YES |  |  |
| `ownership_percentage` | numeric | YES |  |  |
| `owner_name` | text | YES |  |  |
| `owner_contact` | text | YES |  |  |
| `relationship_notes` | text | YES |  |  |
| `description` | text | YES |  |  |
| `value_score` | numeric | YES |  |  |
| `value_breakdown` | jsonb | YES |  |  |
| `owner_id` | uuid | YES |  |  |
| `quality_grade` | numeric | YES |  |  |
| `investment_grade` | text | YES |  |  |
| `investment_confidence` | integer | YES |  |  |
| `quality_last_assessed` | timestamp with time zone | YES |  |  |
| `trim` | text | YES |  |  |
| `color_primary` | text | YES |  |  |
| `color_secondary` | text | YES |  |  |
| `paint_code` | text | YES |  |  |
| `paint_code_secondary` | text | YES |  |  |
| `zip_code` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `country` | text | YES |  |  |
| `gps_latitude` | numeric | YES |  |  |
| `gps_longitude` | numeric | YES |  |  |
| `imported_by` | uuid | YES |  |  |
| `title_transfer_date` | date | YES |  |  |
| `primary_image_url` | text | YES |  |  |
| `title` | text | YES |  |  |
| `data_quality_score` | integer | YES |  |  |
| `quality_issues` | ARRAY | YES |  |  |
| `requires_improvement` | boolean | YES |  |  |
| `last_quality_check` | timestamp with time zone | YES |  |  |
| `vin_source` | text | YES |  |  |
| `year_source` | text | YES |  |  |
| `make_source` | text | YES |  |  |
| `model_source` | text | YES |  |  |
| `mileage_source` | text | YES |  |  |
| `engine_source` | text | YES |  |  |
| `transmission_source` | text | YES |  |  |
| `color_source` | text | YES |  |  |
| `vin_confidence` | integer | YES |  |  |
| `year_confidence` | integer | YES |  |  |
| `make_confidence` | integer | YES |  |  |
| `model_confidence` | integer | YES |  |  |
| `created_by_user_id` | uuid | YES |  |  |
| `created_via_role` | text | YES |  |  |
| `import_method` | text | YES |  |  |
| `automation_script` | text | YES |  |  |
| `content_source_type` | text | YES |  |  |
| `content_source_id` | uuid | YES |  |  |
| `platform_source` | text | YES |  |  |
| `platform_url` | text | YES |  |  |
| `provenance_metadata` | jsonb | YES |  |  |
| `bat_buyer` | text | YES |  |  |
| `profile_origin` | text | YES |  |  |
| `origin_organization_id` | uuid | YES |  |  |
| `origin_metadata` | jsonb | YES |  |  |
| `series` | text | YES |  |  |
| `series_source` | text | YES |  |  |
| `series_confidence` | integer | YES |  |  |
| `trim_source` | text | YES |  |  |
| `trim_confidence` | integer | YES |  |  |
| `description_source` | text | YES |  |  |
| `description_generated_at` | timestamp with time zone | YES |  |  |
| `model_series` | text | YES |  |  |
| `cab_config` | text | YES |  |  |
| `trim_level` | text | YES |  |  |
| `engine_displacement` | text | YES |  |  |
| `engine_liters` | numeric | YES |  |  |
| `engine_type` | text | YES |  |  |
| `engine_code` | text | YES |  |  |
| `transmission_model` | text | YES |  |  |
| `transmission_type` | text | YES |  |  |
| `transmission_code` | text | YES |  |  |
| `merged_into_vehicle_id` | uuid | YES |  |  |
| `secondary_color` | text | YES |  |  |
| `has_molding` | boolean | YES |  |  |
| `has_pinstriping` | boolean | YES |  |  |
| `has_body_kit` | boolean | YES |  |  |
| `has_racing_stripes` | boolean | YES |  |  |
| `trim_details` | text | YES |  |  |
| `interior_color_secondary` | text | YES |  |  |
| `interior_color_tertiary` | text | YES |  |  |
| `seat_type` | text | YES |  |  |
| `seat_material_primary` | text | YES |  |  |
| `seat_material_secondary` | text | YES |  |  |
| `interior_material_details` | text | YES |  |  |
| `received_in_trade` | boolean | YES |  |  |
| `import_queue_id` | uuid | YES |  |  |
| `selling_organization_id` | uuid | YES |  |  |
| `price` | integer | YES |  |  |
| `sold_price` | integer | YES |  |  |
| `normalized_model` | text | YES |  |  |
| `normalized_series` | text | YES |  |  |
| `generation` | text | YES |  |  |
| `auction_outcome` | text | YES |  |  |
| `high_bid` | integer | YES |  |  |
| `winning_bid` | integer | YES |  |  |
| `vin_source_image_id` | uuid | YES |  |  |
| `location` | text | YES |  |  |
| `is_streaming` | boolean | YES |  |  |
| `image_url` | text | YES |  |  |
| `search_vector` | tsvector | YES |  |  |
| `listing_url` | text | YES |  |  |
| `listing_source` | text | YES |  |  |
| `listing_posted_at` | timestamp with time zone | YES |  |  |
| `listing_updated_at` | timestamp with time zone | YES |  |  |
| `listing_title` | text | YES |  |  |
| `listing_location` | text | YES |  |  |
| `analysis_tier` | integer | YES |  |  |
| `signal_score` | numeric | YES |  |  |
| `signal_reasons` | ARRAY | YES |  |  |
| `last_signal_assessed_at` | timestamp with time zone | YES |  |  |
| `listing_location_raw` | text | YES |  |  |
| `listing_location_observed_at` | timestamp with time zone | YES |  |  |
| `listing_location_source` | text | YES |  |  |
| `listing_location_confidence` | real | YES |  |  |
| `bat_lot_number` | text | YES |  |  |
| `bat_watchers` | integer | YES |  |  |
| `reserve_status` | text | YES |  |  |
| `canonical_vehicle_type` | text | YES |  |  |
| `canonical_body_style` | text | YES |  |  |
| `listing_kind` | text | YES |  |  |
| `segment_id` | uuid | YES |  |  |
| `era` | text | YES |  |  |
| `canonical_make_id` | uuid | YES |  |  |
| `source_listing_category` | text | YES |  |  |
| `dougs_take` | text | YES |  |  |
| `highlights` | text | YES |  |  |
| `equipment` | text | YES |  |  |
| `modifications` | text | YES |  |  |
| `known_flaws` | text | YES |  |  |
| `recent_service_history` | text | YES |  |  |
| `title_status` | text | YES |  |  |
| `seller_name` | text | YES |  |  |
| `comment_count` | integer | YES |  |  |
| `auction_status` | text | YES |  |  |
| `extractor_version` | text | YES |  |  |
| `rennlist_url` | text | YES |  |  |
| `rennlist_listing_id` | text | YES |  |  |
| `documents_on_hand` | jsonb | YES |  |  |
| `price_is_outlier` | boolean | YES |  |  |
| `price_outlier_reason` | text | YES |  |  |
| `data_gaps` | jsonb | YES |  |  |
| `nuke_estimate` | numeric | YES |  |  |
| `nuke_estimate_confidence` | integer | YES |  |  |
| `deal_score` | numeric | YES |  |  |
| `heat_score` | numeric | YES |  |  |
| `valuation_calculated_at` | timestamp with time zone | YES |  |  |
| `zero_to_sixty` | numeric | YES |  |  |
| `quarter_mile` | numeric | YES |  |  |
| `quarter_mile_speed` | numeric | YES |  |  |
| `top_speed_mph` | integer | YES |  |  |
| `braking_60_0_ft` | numeric | YES |  |  |
| `lateral_g` | numeric | YES |  |  |
| `redline_rpm` | integer | YES |  |  |
| `power_to_weight` | numeric | YES |  |  |
| `suspension_front` | text | YES |  |  |
| `suspension_rear` | text | YES |  |  |
| `brake_type_front` | text | YES |  |  |
| `brake_type_rear` | text | YES |  |  |
| `wheel_diameter_front` | integer | YES |  |  |
| `wheel_diameter_rear` | integer | YES |  |  |
| `tire_spec_front` | text | YES |  |  |
| `tire_spec_rear` | text | YES |  |  |
| `tire_condition_score` | integer | YES |  |  |
| `brake_condition_score` | integer | YES |  |  |
| `suspension_condition_score` | integer | YES |  |  |
| `perf_power_score` | integer | YES |  |  |
| `perf_acceleration_score` | integer | YES |  |  |
| `perf_braking_score` | integer | YES |  |  |
| `perf_handling_score` | integer | YES |  |  |
| `perf_comfort_score` | integer | YES |  |  |
| `social_positioning_score` | integer | YES |  |  |
| `investment_quality_score` | integer | YES |  |  |
| `provenance_score` | integer | YES |  |  |
| `overall_desirability_score` | integer | YES |  |  |
| `perf_scores_updated_at` | timestamp with time zone | YES |  |  |
| `social_positioning_breakdown` | jsonb | YES |  |  |
| `compression_ratio` | numeric | YES |  |  |
| `compression_test_psi` | jsonb | YES |  |  |
| `leakdown_test_pct` | jsonb | YES |  |  |
| `engine_health_score` | integer | YES |  |  |
| `timing_type` | text | YES |  |  |
| `cam_type` | text | YES |  |  |
| `intake_type` | text | YES |  |  |
| `carburetor_type` | text | YES |  |  |
| `fuel_pressure_psi` | numeric | YES |  |  |
| `fuel_octane` | integer | YES |  |  |
| `distributor_type` | text | YES |  |  |
| `headers_type` | text | YES |  |  |
| `exhaust_type` | text | YES |  |  |
| `exhaust_diameter` | text | YES |  |  |
| `manifold_type` | text | YES |  |  |
| `oil_type` | text | YES |  |  |
| `coolant_type` | text | YES |  |  |
| `bore_mm` | numeric | YES |  |  |
| `stroke_mm` | numeric | YES |  |  |
| `rear_axle_ratio` | numeric | YES |  |  |
| `rear_axle_type` | text | YES |  |  |
| `transfer_case` | text | YES |  |  |
| `clutch_type` | text | YES |  |  |
| `driveshaft_type` | text | YES |  |  |
| `transmission_speeds` | integer | YES |  |  |
| `steering_type` | text | YES |  |  |
| `steering_pump` | text | YES |  |  |
| `steering_condition_score` | integer | YES |  |  |
| `frame_type` | text | YES |  |  |
| `brake_booster_type` | text | YES |  |  |
| `brake_master_cylinder` | text | YES |  |  |
| `front_rotor_size` | text | YES |  |  |
| `rear_rotor_size` | text | YES |  |  |
| `abs_equipped` | boolean | YES |  |  |
| `drag_coefficient` | numeric | YES |  |  |
| `frontal_area_sqft` | numeric | YES |  |  |
| `ground_clearance_inches` | numeric | YES |  |  |
| `ride_height_inches` | numeric | YES |  |  |
| `has_spoiler` | boolean | YES |  |  |
| `has_air_dam` | boolean | YES |  |  |
| `lift_inches` | numeric | YES |  |  |
| `last_fuel_receipt` | jsonb | YES |  |  |
| `fuel_system_type` | text | YES |  |  |
| `last_inspection_date` | date | YES |  |  |
| `inspection_type` | text | YES |  |  |
| `inspection_passed` | boolean | YES |  |  |
| `smog_exempt` | boolean | YES |  |  |
| `segment_slug` | text | YES |  |  |
| `last_enrichment_attempt` | timestamp with time zone | YES |  |  |
| `enrichment_failures` | integer | YES |  |  |
| `msrp_source` | text | YES |  |  |
| `msrp_contributed_by` | uuid | YES |  |  |
| `color_family` | text | YES |  |  |
| `data_quality_flags` | jsonb | YES |  |  |
| `current_transfer_id` | uuid | YES |  |  |
| `ownership_confirmed_at` | timestamp with time zone | YES |  |  |

### `vehicles_needing_cascading_correction`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `validation` | jsonb | YES |  |  |

### `vehicles_needing_extraction`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `title` | text | YES |  |  |
| `source_url` | text | YES |  |  |
| `source_type` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `failed_attempts` | bigint | YES |  |  |
| `last_failed_at` | timestamp with time zone | YES |  |  |

### `vehicles_needing_forensic_review`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_identity` | text | YES |  |  |
| `conflicts` | bigint | YES |  |  |
| `low_confidence_pending` | bigint | YES |  |  |
| `fields_needing_review` | ARRAY | YES |  |  |

### `vehicles_needing_micro_scrape`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `discovery_url` | text | YES |  |  |
| `origin_metadata` | jsonb | YES |  |  |
| `quality_score` | integer | YES |  |  |
| `image_count` | bigint | YES |  |  |
| `missing_vin` | boolean | YES |  |  |
| `missing_price` | boolean | YES |  |  |
| `missing_description` | boolean | YES |  |  |
| `images_need_download` | boolean | YES |  |  |
| `below_threshold` | boolean | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `vehicles_needing_vin_decode`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vin` | text | YES |  |  |
| `vin_length` | integer | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `decode_type` | text | YES |  |  |

### `vehicles_with_issues`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle` | text | YES |  |  |
| `raw_make` | text | YES |  |  |
| `normalized_make` | text | YES |  |  |
| `raw_model` | text | YES |  |  |
| `normalized_model` | text | YES |  |  |
| `issue_count` | bigint | YES |  |  |
| `error_levels` | ARRAY | YES |  |  |

### `vendor_accounts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vendor_name` | text | NO |  |  |
| `service_type` | text | NO |  |  |
| `account_identifier` | text | YES |  |  |
| `current_balance` | numeric | YES |  |  |
| `balance_updated_at` | timestamp with time zone | YES |  |  |
| `monthly_spend_estimate` | numeric | YES |  |  |
| `low_balance_threshold` | numeric | YES |  |  |
| `status` | text | NO | 'unknown' |  |
| `auto_recharge` | boolean | YES | false |  |
| `billing_url` | text | YES |  |  |
| `dashboard_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `ventilation`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `vent_locations_jsonb` | jsonb | YES | '[]' | JSON array of vent outlet locations, e.g. [{"location":"dash_center"},{"location":"dash_left"},{"location":"floor_left"}]. |
| `dash_vent_count` | integer | YES |  | Number of dash-mounted directional vents. |
| `floor_duct_yn` | boolean | YES |  | True if floor heating ducts are present. |
| `rear_duct_yn` | boolean | YES |  | True if rear seat heating/cooling ducts are present. |
| `defroster_vent_yn` | boolean | YES |  | True if windshield defroster outlet duct is present. |
| `fan_motor_speed_count` | integer | YES |  | Number of blower motor speed settings, e.g. 3, 4, or infinitely variable. |
| `fan_motor_manufacturer` | text | YES |  | Blower motor manufacturer, e.g. AC Delco, Dorman, Behr. |
| `fan_motor_part_number` | text | YES |  | Blower motor part number. |
| `fan_motor_condition` | text | YES |  | Blower motor condition: excellent, good, fair, noisy, failed. |
| `resistor_pack_present_yn` | boolean | YES |  | True if a blower resistor pack (multi-speed control) is present. |
| `blower_wheel_type` | text | YES |  | Blower wheel style, e.g. squirrel_cage, centrifugal, axial. |
| `blend_door_type` | text | YES |  | Temperature blend door actuation: cable, vacuum, electric. |
| `blend_door_condition` | text | YES |  | Blend door condition: excellent, good, stiff, broken, failed. |
| `temperature_cable_type` | text | YES |  | Temperature control cable type if cable-operated, e.g. bowden, push_pull. |
| `mode_cable_count` | integer | YES |  | Number of mode/vent selection control cables. |
| `fresh_air_provision_yn` | boolean | YES |  | True if fresh outside air can be selected (vs all-recirculation). |
| `recirculate_yn` | boolean | YES |  | True if interior recirculation mode is available. |
| `recirculate_control` | text | YES |  | Recirculate control type, e.g. manual_door, cable, electric_actuator. |
| `defrost_type` | text | YES |  | Windshield defrost method: hot_air (from heater), electric (grid on glass), both. |
| `defrost_timer_yn` | boolean | YES |  | True if a timed defrost shutoff is present. |
| `cabin_filter_yn` | boolean | YES |  | True if a cabin air filter is equipped. |
| `cabin_filter_location` | text | YES |  | Cabin filter location, e.g. under_dash, behind_glove_box, cowl_area. |
| `is_original` | boolean | YES | true | True if factory-original ventilation system. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. blend door actuator broken, mode cable snapped. |
| `provenance` | text | YES | 'unknown' | System origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `verification_confidence_config`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `verification_type` | text | NO |  |  |
| `proof_method` | text | NO |  |  |
| `base_confidence` | integer | NO |  |  |
| `description` | text | YES |  |  |
| `requires_ai` | boolean | YES | false |  |
| `requires_human` | boolean | YES | false |  |

### `villa_inventory`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `name` | text | YES |  |  |
| `slug` | text | YES |  |  |
| `tagline` | text | YES |  |  |
| `region` | text | YES |  |  |
| `city` | text | YES |  |  |
| `base_price` | numeric | YES |  |  |
| `price_currency` | text | YES |  |  |
| `price_period` | text | YES |  |  |
| `listing_type` | text | YES |  |  |
| `bedrooms` | text | YES |  |  |
| `bathrooms` | text | YES |  |  |
| `max_guests` | text | YES |  |  |
| `sqft` | text | YES |  |  |
| `latitude` | numeric | YES |  |  |
| `longitude` | numeric | YES |  |  |
| `source_url` | text | YES |  |  |
| `is_featured` | boolean | YES |  |  |
| `manager_name` | text | YES |  |  |
| `manager_phone` | text | YES |  |  |
| `manager_website` | text | YES |  |  |
| `primary_image` | text | YES |  |  |

### `vin_conflicts_dashboard`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_id` | uuid | YES |  |  |
| `vin` | text | YES |  |  |
| `user_vehicle` | text | YES |  |  |
| `vin_vehicle` | text | YES |  |  |
| `comparison` | jsonb | YES |  |  |

### `vin_decode_cache`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vin` | text | NO |  |  |
| `valid` | boolean | NO | false |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `trim` | text | YES |  |  |
| `engine_size` | text | YES |  |  |
| `engine_cylinders` | integer | YES |  |  |
| `displacement_cc` | integer | YES |  |  |
| `displacement_liters` | text | YES |  |  |
| `fuel_type` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `transmission_speeds` | text | YES |  |  |
| `drivetrain` | text | YES |  |  |
| `body_type` | text | YES |  |  |
| `doors` | integer | YES |  |  |
| `manufacturer` | text | YES |  |  |
| `plant_country` | text | YES |  |  |
| `plant_city` | text | YES |  |  |
| `series` | text | YES |  |  |
| `vehicle_type` | text | YES |  |  |
| `gvwr` | text | YES |  |  |
| `brake_system` | text | YES |  |  |
| `error_message` | text | YES |  |  |
| `confidence` | integer | YES | 0 |  |
| `decoded_at` | timestamp with time zone | YES | now() |  |
| `provider` | text | YES | 'nhtsa' |  |
| `raw_data` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vin_match_candidates`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `vehicle_a` | uuid | YES |  |  |
| `vehicle_b` | uuid | YES |  |  |
| `vin` | text | YES |  |  |
| `url_a` | text | YES |  |  |
| `url_b` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `platform_a` | text | YES |  |  |
| `platform_b` | text | YES |  |  |

### `vin_plates_tags`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `tag_type` | text | NO |  | Tag type: vin_plate, body_tag, trim_tag, emission_label, tire_placard, fender_tag, cowl_tag, door_tag, engine_stamp, trans_stamp, axle_tag, other. Values: `vin_plate`, `body_tag`, `trim_tag`, `emission_label`, `tire_placard`, `fender_tag` ... (12 total) |
| `location` | text | NO |  | Physical location on the vehicle, e.g. dash_driver_side, door_jamb_driver, firewall, fender_inner_left. |
| `stamped_content` | text | YES |  | Raw text/numbers as stamped or printed on the tag. |
| `decoded_info` | jsonb | YES | '{}' | JSONB decoded interpretation of tag content. Structure varies by tag_type, e.g. {paint_code: "19", trim_code: "711", body_style: "37"} for a cowl tag. |
| `photo_evidence_id` | uuid | YES |  | UUID reference to field_evidence or vehicle_images for photographic documentation of this tag. |
| `legibility` | text | YES |  | How readable the tag is: clear, partial, faded, illegible, missing. |
| `tampered` | boolean | YES | false | True if tag shows signs of tampering (re-stamping, replacement, VIN swap). |
| `tamper_notes` | text | YES |  | Description of suspected tampering. |
| `attachment_method` | text | YES |  | How the tag is attached, e.g. rosette_rivets, spot_welded, adhesive, screwed. |
| `is_original` | boolean | YES | true | True if tag is believed to be factory-installed. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. paint overspray on tag, one rivet replaced. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `vin_validations`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `vehicle_id` | uuid | YES |  |  |
| `user_id` | uuid | YES |  |  |
| `vin_photo_url` | text | NO |  |  |
| `extracted_vin` | text | YES |  |  |
| `submitted_vin` | text | NO |  |  |
| `validation_status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `expired` |
| `confidence_score` | numeric | YES |  |  |
| `validation_method` | text | YES | 'manual' |  Values: `ocr`, `manual`, `ai_vision` |
| `expires_at` | timestamp with time zone | YES | (now() + '24:00:00'::interval) |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `vlva_contacts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `full_name` | text | YES |  |  |
| `first_name` | text | YES |  |  |
| `last_name` | text | YES |  |  |
| `company` | text | YES |  |  |
| `role` | ARRAY | YES |  |  |
| `address` | text | YES |  |  |
| `city` | text | YES |  |  |
| `state` | text | YES |  |  |
| `zip` | text | YES |  |  |
| `country` | text | YES |  |  |
| `phone_home` | text | YES |  |  |
| `phone_mobile` | text | YES |  |  |
| `phone_work` | text | YES |  |  |
| `phone_fax` | text | YES |  |  |
| `email` | text | YES |  |  |
| `ebay_username` | text | YES |  |  |
| `profile_image_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `organization_id` | uuid | YES |  |  |

### `vlva_deals`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `stock_number` | text | YES |  |  |
| `deal_type` | text | YES |  |  |
| `acquired_from_id` | uuid | YES |  |  |
| `acquisition_date` | date | YES |  |  |
| `initial_cost` | numeric | YES |  |  |
| `flooring_cost` | numeric | YES |  |  |
| `shipping_cost_in` | numeric | YES |  |  |
| `total_initial_cost` | numeric | YES |  |  |
| `sold_to_id` | uuid | YES |  |  |
| `sold_date` | date | YES |  |  |
| `sale_price_inc_doc` | numeric | YES |  |  |
| `shipping_price` | numeric | YES |  |  |
| `total_selling_price` | numeric | YES |  |  |
| `document_fee` | numeric | YES |  |  |
| `title_fee` | numeric | YES |  |  |
| `permit_fee` | numeric | YES |  |  |
| `sales_tax` | numeric | YES |  |  |
| `service_contract` | numeric | YES |  |  |
| `acv_listing_credit` | numeric | YES |  |  |
| `detail_credit` | numeric | YES |  |  |
| `trade_in_allowance` | numeric | YES |  |  |
| `consignment_rate` | numeric | YES |  |  |
| `listing_fee` | numeric | YES |  |  |
| `feature_ad_fee` | numeric | YES |  |  |
| `net_auction_proceeds` | numeric | YES |  |  |
| `reconditioning_total` | numeric | YES |  |  |
| `total_cost` | numeric | YES |  |  |
| `gross_profit` | numeric | YES |  |  |
| `payment_method` | text | YES |  |  |
| `payment_amount` | numeric | YES |  |  |
| `payment_date` | date | YES |  |  |
| `deposit_amount` | numeric | YES |  |  |
| `deposit_date` | date | YES |  |  |
| `balance_date` | date | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `created_by` | uuid | YES |  |  |
| `visibility` | USER-DEFINED | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |
| `organization_id` | uuid | YES |  |  |

### `vlva_vehicles`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `stock_number` | text | YES |  |  |
| `year` | integer | YES |  |  |
| `make` | text | YES |  |  |
| `model` | text | YES |  |  |
| `style` | text | YES |  |  |
| `vin` | text | YES |  |  |
| `color` | text | YES |  |  |
| `interior_color` | text | YES |  |  |
| `odometer` | integer | YES |  |  |
| `odometer_notes` | text | YES |  |  |
| `engine` | text | YES |  |  |
| `transmission` | text | YES |  |  |
| `body_number` | text | YES |  |  |
| `msrp` | numeric | YES |  |  |
| `history` | text | YES |  |  |
| `condition_ratings` | jsonb | YES |  |  |
| `options` | jsonb | YES |  |  |
| `profile_image_url` | text | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `organization_id` | uuid | YES |  |  |

### `wheels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). |
| `corner` | text | NO |  | Corner position: lf (left front), rf (right front), lr (left rear), rr (right rear). Values: `lf`, `rf`, `lr`, `rr` |
| `diameter_inches` | numeric | YES |  | Wheel diameter in inches (bead seat to bead seat), e.g. 15, 17, 20. |
| `width_inches` | numeric | YES |  | Wheel width in inches (bead seat to bead seat), e.g. 7, 8.5, 10. |
| `offset_mm` | numeric | YES |  | Wheel offset in mm. Positive = more positive/flush, negative = deeper dish. |
| `backspacing_inches` | numeric | YES |  | Backspacing in inches from mounting flange to inner bead seat. |
| `bolt_pattern` | text | YES |  | Bolt circle pattern, e.g. 5x4.75, 5x120, 4x100. |
| `center_bore_mm` | numeric | YES |  | Hub-centric center bore diameter in mm. |
| `material` | text | YES |  | Wheel material: steel, cast_alloy, forged_alloy, wire, magnesium. |
| `manufacturer` | text | YES |  | Wheel manufacturer, e.g. Kelsey-Hayes, American Racing, BBS, Enkei. |
| `model` | text | YES |  | Wheel model name, e.g. Torq-Thrust, Smoothie, Rally, Ansen Sprint. |
| `part_number` | text | YES |  | Manufacturer part number or OEM part number. |
| `finish` | text | YES |  | Wheel finish: painted, polished, chrome, machined, powder_coated. |
| `lug_nut_seat_type` | text | YES |  | Lug nut seat type, e.g. conical_60deg, ball_seat, flat_washer. |
| `lug_nut_thread_size` | text | YES |  | Lug nut thread size, e.g. 1/2-20, 7/16-20, 12x1.5. |
| `center_cap_present_yn` | boolean | YES |  | True if the center cap/hubcap is present. |
| `runout_thou` | numeric | YES |  | Measured lateral or radial runout in thousandths of an inch. |
| `weight_lbs` | numeric | YES |  | Wheel weight in pounds. |
| `curb_damage_yn` | boolean | YES |  | True if visible curb rash or impact damage is present on the rim. |
| `is_original` | boolean | YES | true | True if factory-original wheel for this vehicle. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. hairline crack at valve stem, stripped lug hole. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `wiring_harnesses`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Primary key. |
| `vehicle_id` | uuid | NO |  | FK to vehicles(id). The vehicle this harness belongs to. |
| `harness_zone` | text | NO |  | Area of vehicle the harness serves: engine, dash, body, tail, door, trunk. Values: `engine`, `dash`, `body`, `tail`, `door`, `trunk` |
| `type` | text | NO |  | Harness origin: original (factory), aftermarket (commercial replacement), custom (hand-built). Values: `original`, `aftermarket`, `custom` |
| `manufacturer` | text | YES |  | Harness manufacturer, e.g. GM, American Autowire, Painless Performance. |
| `part_number` | text | YES |  | Manufacturer or OEM part number. |
| `gauge_range` | text | YES |  | Wire gauge range present in harness, e.g. 12-18AWG, 16-20AWG. |
| `connector_types` | ARRAY | YES |  | Array of connector types present, e.g. {weatherpack, metripack,deutsch}. |
| `circuit_count` | integer | YES |  | Total number of individual circuits in this harness. |
| `wrapped_yn` | boolean | YES |  | True if harness is wrapped with tape or protective loom. |
| `loomed_yn` | boolean | YES |  | True if harness runs through protective split-loom conduit. |
| `terminal_material` | text | YES |  | Terminal material, e.g. tin_plated_copper, gold_plated, aluminum. |
| `date_code` | text | YES |  | Date code if present on harness (common on factory harnesses). |
| `is_original` | boolean | YES | true | True if this is the factory-installed harness for this zone. |
| `condition_grade` | text | YES | 'unknown' | Current condition: excellent, good, fair, poor, failed, unknown. Values: `excellent`, `good`, `fair`, `poor`, `failed`, `unknown` |
| `condition_notes` | text | YES |  | Freeform condition details, e.g. melted insulation near firewall, previous rodent damage. |
| `provenance` | text | YES | 'unknown' | Part origin: original, nos, reproduction, aftermarket, unknown. Values: `original`, `nos`, `reproduction`, `aftermarket`, `unknown` |
| `provenance_detail` | text | YES |  | Detailed provenance info: installer, date, reason for replacement. |
| `created_at` | timestamp with time zone | NO | now() | Row creation timestamp. |
| `updated_at` | timestamp with time zone | NO | now() | Last modification timestamp. |

### `work_order_assignments`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_order_id` | uuid | NO |  |  |
| `technician_id` | uuid | NO |  |  |
| `job_op_code` | text | YES |  |  |
| `role` | text | YES | 'technician' |  Values: `lead`, `technician`, `helper` |
| `status` | text | YES | 'pending' |  Values: `pending`, `offered`, `accepted`, `declined`, `in_progress`, `proof_submitted` ... (9 total) |
| `offered_at` | timestamp with time zone | YES |  |  |
| `accepted_at` | timestamp with time zone | YES |  |  |
| `declined_at` | timestamp with time zone | YES |  |  |
| `decline_reason` | text | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `payout_type` | text | YES | 'flat' |  Values: `flat`, `hourly`, `percentage` |
| `payout_rate` | numeric | YES |  |  |
| `payout_percentage` | numeric | YES |  |  |
| `estimated_payout` | numeric | YES |  |  |
| `actual_payout` | numeric | YES |  |  |
| `payout_status` | text | YES | 'unpaid' |  Values: `unpaid`, `pending_proof`, `pending_client_payment`, `ready`, `processing`, `paid` |
| `paid_at` | timestamp with time zone | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `work_order_labor`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `timeline_event_id` | uuid | YES |  | References timeline_events (vehicle timeline) not business_timeline_events |
| `task_name` | text | NO |  |  |
| `task_category` | text | YES |  |  |
| `hours` | numeric | NO |  |  |
| `hourly_rate` | numeric | YES |  |  |
| `total_cost` | numeric | YES |  |  |
| `difficulty_rating` | integer | YES |  |  |
| `notes` | text | YES |  |  |
| `industry_standard_hours` | numeric | YES |  |  |
| `ai_estimated` | boolean | YES | false |  |
| `added_by` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `reported_rate` | numeric | YES |  | Rate reported by organization/user (if available) |
| `calculated_rate` | numeric | YES |  | Rate calculated by system with multipliers |
| `rate_source` | text | YES |  | Source of rate: contract, user, organization, system_default |
| `difficulty_multiplier` | numeric | YES | 1.0 |  |
| `location_multiplier` | numeric | YES | 1.0 |  |
| `time_multiplier` | numeric | YES | 1.0 |  |
| `skill_multiplier` | numeric | YES | 1.0 |  |
| `calculation_metadata` | jsonb | YES | '{}' | Full calculation breakdown for "what if" scenarios |
| `work_order_id` | uuid | YES |  |  |
| `job_op_code` | text | YES |  |  |
| `is_comped` | boolean | YES | false |  |
| `comp_reason` | text | YES |  |  |
| `comp_retail_value` | numeric | YES |  |  |

### `work_order_line_items`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_order_id` | uuid | NO |  |  |
| `component_table` | text | YES |  |  |
| `component_id` | uuid | YES |  |  |
| `line_number` | integer | YES |  |  |
| `task_type` | text | NO |  |  Values: `rebuild`, `replace`, `repair`, `inspect`, `fabricate`, `refinish` ... (23 total) |
| `task_description` | text | YES |  |  |
| `actor_id` | uuid | YES |  |  |
| `spec_target` | text | YES |  | The specification target, e.g. 4.030 +/- 0.001 bore. |
| `spec_achieved` | text | YES |  | The measured result. This is the REAL quality signal. |
| `spec_in_tolerance` | boolean | YES |  | True if spec_achieved is within tolerance of spec_target. |
| `parts_used` | jsonb | YES | '[]' |  |
| `hours_labor` | numeric | YES |  |  |
| `labor_rate_cents` | integer | YES |  |  |
| `parts_cost_cents` | integer | YES |  |  |
| `total_cost_cents` | integer | YES |  |  |
| `status` | text | NO | 'pending' |  Values: `pending`, `in_progress`, `complete`, `rework`, `skipped`, `cancelled` |
| `component_event_id` | uuid | YES |  |  |
| `notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `work_order_summary`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `organization_id` | uuid | YES |  |  |
| `organization_name` | text | YES |  |  |
| `customer_id` | uuid | YES |  |  |
| `customer_name` | text | YES |  |  |
| `customer_phone` | text | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `vehicle_name` | text | YES |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `status` | text | YES |  |  |
| `urgency` | text | YES |  |  |
| `request_source` | text | YES |  |  |
| `estimated_total` | numeric | YES |  |  |
| `actual_total` | numeric | YES |  |  |
| `scheduled_start` | timestamp with time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `updated_at` | timestamp with time zone | YES |  |  |

### `work_orders`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `organization_id` | uuid | YES |  |  |
| `customer_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `request_source` | text | YES | 'web' |  Values: `web`, `sms`, `phone`, `email`, `in_person` |
| `customer_name` | text | YES |  |  |
| `customer_phone` | text | YES |  |  |
| `customer_email` | text | YES |  |  |
| `title` | text | NO |  |  |
| `description` | text | NO |  |  |
| `urgency` | text | YES | 'normal' |  Values: `low`, `normal`, `high`, `emergency` |
| `estimated_hours` | numeric | YES |  |  |
| `estimated_labor_cost` | numeric | YES |  |  |
| `estimated_parts_cost` | numeric | YES |  |  |
| `estimated_total` | numeric | YES |  |  |
| `quoted_at` | timestamp with time zone | YES |  |  |
| `quoted_by` | uuid | YES |  |  |
| `actual_hours` | numeric | YES |  |  |
| `actual_labor_cost` | numeric | YES |  |  |
| `actual_parts_cost` | numeric | YES |  |  |
| `actual_total` | numeric | YES |  |  |
| `status` | text | YES | 'pending' |  Values: `pending`, `quoted`, `approved`, `rejected`, `scheduled`, `in_progress` ... (9 total) |
| `scheduled_start` | timestamp with time zone | YES |  |  |
| `scheduled_end` | timestamp with time zone | YES |  |  |
| `actual_start` | timestamp with time zone | YES |  |  |
| `actual_end` | timestamp with time zone | YES |  |  |
| `sms_conversation_id` | text | YES |  |  |
| `original_sms_body` | text | YES |  |  |
| `images` | ARRAY | YES |  |  |
| `notes` | text | YES |  |  |
| `internal_notes` | text | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `originator_organization_id` | uuid | YES |  |  |
| `transfer_id` | uuid | YES |  |  |
| `obligation_id` | uuid | YES |  |  |
| `org_id` | uuid | YES |  | FK to organizations(id). Digital twin alias for organization_id. The shop/org performing the work. |
| `lead_actor_id` | uuid | YES |  | FK to actors(id). The primary technician/builder responsible. |
| `requesting_actor_id` | uuid | YES |  | FK to actors(id). The vehicle owner or person who requested the work. |
| `work_order_number` | text | YES |  | Shop-internal work order or invoice number. |
| `scope_description` | text | YES |  | Detailed description of the work scope. |
| `scope_category` | text | YES |  | High-level category: engine, transmission, body, paint, full_restoration, etc. |
| `estimated_cost_cents` | integer | YES |  | Quoted cost in cents. 500000 = $5,000.00. |
| `actual_cost_cents` | integer | YES |  | Final actual cost in cents. |
| `deposit_cents` | integer | YES |  |  |
| `currency` | text | YES | 'USD' |  |
| `estimated_days` | integer | YES |  |  |
| `actual_days` | integer | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `started_at` | timestamp with time zone | YES |  |  |
| `completed_at` | timestamp with time zone | YES |  |  |
| `warranty_until` | date | YES |  |  |
| `satisfaction_score` | integer | YES |  | Customer satisfaction 1-10. Subjective — spec compliance is the real measure. |
| `satisfaction_notes` | text | YES |  |  |
| `evidence_ids` | ARRAY | YES |  | Array of field_evidence.id UUIDs supporting this work order. |
| `metadata` | jsonb | YES | '{}' |  |

### `work_organization_matches`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `image_work_extraction_id` | uuid | YES |  |  |
| `timeline_event_id` | uuid | YES |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `matched_organization_id` | uuid | NO |  |  |
| `match_probability` | numeric | NO |  |  |
| `match_reasons` | jsonb | YES |  |  |
| `location_match` | boolean | YES | false |  |
| `location_distance_meters` | integer | YES |  |  |
| `work_type_match` | boolean | YES | false |  |
| `organization_capabilities` | ARRAY | YES |  |  |
| `date_range_match` | boolean | YES | false |  |
| `organization_active_dates` | daterange | YES |  |  |
| `notification_sent_at` | timestamp with time zone | YES |  |  |
| `notification_status` | text | YES | 'pending' |  Values: `pending`, `sent`, `viewed`, `responded` |
| `approval_status` | text | YES | 'pending' |  Values: `pending`, `approved`, `rejected`, `ignored` |
| `approved_by_user_id` | uuid | YES |  |  |
| `approved_at` | timestamp with time zone | YES |  |  |
| `rejection_reason` | text | YES |  |  |
| `auto_linked_work_contribution_id` | uuid | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

### `work_session_parts`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `work_session_id` | uuid | YES |  |  |
| `part_name` | text | NO |  |  |
| `part_number` | text | YES |  |  |
| `quantity` | integer | YES | 1 |  |
| `unit_cost` | numeric | NO |  |  |
| `total_cost` | numeric | NO |  |  |
| `vendor` | text | YES |  |  |
| `receipt_image_id` | uuid | YES |  |  |
| `purchase_date` | date | YES |  |  |
| `extracted_from_image` | boolean | YES | false |  |
| `extraction_confidence` | numeric | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `vehicle_id` | uuid | YES |  |  |
| `receipt_date` | date | YES |  |  |

### `work_session_timeline_events`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | YES |  |  |
| `vehicle_id` | uuid | YES |  |  |
| `title` | text | YES |  |  |
| `description` | text | YES |  |  |
| `event_type` | text | YES |  |  |
| `event_date` | timestamp without time zone | YES |  |  |
| `created_at` | timestamp with time zone | YES |  |  |
| `created_by` | uuid | YES |  |  |
| `mileage_at_event` | integer | YES |  |  |
| `metadata` | json | YES |  |  |
| `source` | text | YES |  |  |

### `work_sessions`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `user_id` | uuid | NO |  |  |
| `vehicle_id` | uuid | NO |  |  |
| `session_date` | date | NO |  |  |
| `start_time` | timestamp with time zone | NO |  |  |
| `end_time` | timestamp with time zone | NO |  |  |
| `duration_minutes` | integer | NO |  |  |
| `confidence_score` | numeric | NO | 0.0 |  |
| `image_count` | integer | NO | 0 |  |
| `work_description` | text | YES |  |  |
| `metadata` | jsonb | YES |  |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |
| `user_activity_id` | uuid | YES |  |  |
| `status` | text | YES | 'in_progress' |  |
| `title` | text | YES |  |  |
| `work_type` | text | YES |  |  |
| `total_parts_cost` | numeric | YES | 0 |  |
| `total_tool_depreciation` | numeric | YES | 0 |  |
| `labor_rate_per_hour` | numeric | YES |  |  |
| `total_labor_cost` | numeric | YES | 0 |  |
| `total_job_cost` | numeric | YES | 0 |  |
| `quoted_price` | numeric | YES |  |  |
| `final_invoice` | numeric | YES |  |  |
| `profit_margin` | numeric | YES |  |  |
| `finalized_at` | timestamp with time zone | YES |  |  |
| `technician_id` | uuid | YES |  |  |
| `session_type` | text | YES | 'auto_detected' |  |
| `start_image_id` | uuid | YES |  |  |
| `end_image_id` | uuid | YES |  |  |
| `zones_touched` | ARRAY | YES | '{}'[] |  |
| `stages_observed` | ARRAY | YES | '{}'[] |  |
| `stage_transitions` | jsonb | YES | '[]' |  |
| `technician_phone_link_id` | uuid | YES |  |  |

### `yono_model_registry`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `model_type` | text | NO | 'make_classifier' |  |
| `run_id` | text | NO |  |  |
| `status` | text | NO | 'training' |  Values: `training`, `trained`, `evaluating`, `promoted`, `rejected`, `rolled_back`, `failed` |
| `training_started_at` | timestamp with time zone | NO | now() |  |
| `training_completed_at` | timestamp with time zone | YES |  |  |
| `training_duration_s` | numeric | YES |  |  |
| `training_params` | jsonb | YES | '{}' |  |
| `val_accuracy` | numeric | YES |  |  |
| `val_loss` | numeric | YES |  |  |
| `eval_accuracy` | numeric | YES |  |  |
| `eval_results` | jsonb | YES |  |  |
| `promoted_at` | timestamp with time zone | YES |  |  |
| `rejected_reason` | text | YES |  |  |
| `checkpoint_path` | text | YES |  |  |
| `onnx_path` | text | YES |  |  |
| `created_at` | timestamp with time zone | NO | now() |  |
| `updated_at` | timestamp with time zone | NO | now() |  |

### `yono_training_metrics`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `model_registry_id` | uuid | YES |  |  |
| `metric_type` | text | NO |  |  Values: `eval_accuracy`, `eval_loss`, `inference_latency`, `health_check`, `drift_score`, `training_failure` |
| `metric_value` | numeric | NO |  |  |
| `metadata` | jsonb | YES | '{}' |  |
| `recorded_at` | timestamp with time zone | NO | now() |  |

### `youtube_channels`

**Rows:** 0 (0)

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() |  |
| `channel_id` | text | NO |  |  |
| `channel_handle` | text | YES |  |  |
| `channel_name` | text | NO |  |  |
| `description` | text | YES |  |  |
| `subscriber_count` | integer | YES |  |  |
| `video_count` | integer | YES |  |  |
| `view_count` | bigint | YES |  |  |
| `channel_type` | text | YES |  |  Values: `review`, `restoration`, `auction`, `collection`, `builder`, `documentary` ... (9 total) |
| `make_focus` | ARRAY | YES |  |  |
| `era_focus` | ARRAY | YES |  |  |
| `content_focus` | ARRAY | YES |  |  |
| `business_id` | uuid | YES |  |  |
| `is_active` | boolean | YES | true |  |
| `last_scraped_at` | timestamp with time zone | YES |  |  |
| `videos_processed` | integer | YES | 0 |  |
| `vehicles_extracted` | integer | YES | 0 |  |
| `created_at` | timestamp with time zone | YES | now() |  |
| `updated_at` | timestamp with time zone | YES | now() |  |

---

## Appendix: CHECK Constraints (Key Enumerations)

These CHECK constraints define valid values for enum-like columns.

### `vehicles`

- **`import_method`**: `manual`, `automated`, `api`, `scraper`, `bulk_import`
- **`?`**: `active`, `ended`, `sold`
- **`?`**: `no_reserve`, `reserve_met`, `reserve_not_met`
- **`?`**: `active`, `pending`, `sold`, `discovered`, `merged`, `rejected`, `inactive`, `archived`, `deleted`, `pending_backfill`, `duplicate`
- **`verification_status`**: `unverified`, `contributor_verified`, `title_verified`, `multi_verified`, `disputed`
- **`seat_type`**: `bench`, `bucket`, `split_bench`, `captain_chairs`, `bench_bucket_combo`
- **`?`**: `not_for_sale`, `for_sale`, `sold`, `pending`, `auction_live`, `ended`, `available`, `discovered`, `not_sold`, `unsold`, `upcoming`, `bid_to`
- **`listing_kind`**: `vehicle`, `non_vehicle_item`
- **`era`**: `pre-war`, `post-war`, `classic`, `malaise`, `modern-classic`, `modern`, `contemporary`
- **`entry_type`**: `owner_claim`, `contributor_data`, `title_verified`, `disputed`
- **`content_source_type`**: `organization`, `user`, `platform`, `third_party`
- `vehicles_confidence_score_check`: `CHECK (((confidence_score >= 0) AND (confidence_score <= 100)))`
- `vehicles_condition_rating_check`: `CHECK (((condition_rating >= 1) AND (condition_rating <= 10)))`
- **`auction_outcome`**: `sold`, `reserve_not_met`, `no_sale`, `pending`, `ended`
- `chk_zero_to_sixty`: `CHECK (((zero_to_sixty > (0)::numeric) AND (zero_to_sixty < (60)::numeric)))`
- **`?`**: `oem`, `user`, `ai_estimated`, `listing_parsed`, `oem_exact_trim`, `oem_fuzzy_trim`, `oem_model_avg`
- `chk_top_speed`: `CHECK (((top_speed_mph > 0) AND (top_speed_mph < 400)))`
- `chk_steering_cond`: `CHECK (((steering_condition_score >= 0) AND (steering_condition_score <= 100)))`
- `chk_social_pos`: `CHECK (((social_positioning_score >= 0) AND (social_positioning_score <= 100)))`
- `chk_provenance`: `CHECK (((provenance_score >= 0) AND (provenance_score <= 100)))`
- `chk_perf_power`: `CHECK (((perf_power_score >= 0) AND (perf_power_score <= 100)))`
- `chk_perf_handling`: `CHECK (((perf_handling_score >= 0) AND (perf_handling_score <= 100)))`
- `chk_perf_braking`: `CHECK (((perf_braking_score >= 0) AND (perf_braking_score <= 100)))`
- `chk_perf_accel`: `CHECK (((perf_acceleration_score >= 0) AND (perf_acceleration_score <= 100)))`
- `chk_invest_quality`: `CHECK (((investment_quality_score >= 0) AND (investment_quality_score <= 100)))`
- `chk_fuel_octane`: `CHECK ((fuel_octane = ANY (ARRAY[87, 89, 91, 93, 100, 110])))`
- `chk_engine_health`: `CHECK (((engine_health_score >= 0) AND (engine_health_score <= 100)))`
- `chk_desirability`: `CHECK (((overall_desirability_score >= 0) AND (overall_desirability_score <= 100)))`

### `vehicle_images`

- **`image_vehicle_match_status`**: `confirmed`, `mismatch`, `ambiguous`, `unrelated`
- **`?`**: `^https?://`, `data:image/%`
- **`image_medium`**: `photograph`, `render`, `drawing`, `screenshot`
- `interior_quality_range`: `CHECK (((interior_quality IS NULL) OR ((interior_quality >= 1) AND (interior_quality <= 5)))) NOT VALID`
- **`?`**: `receipt`, `invoice`, `title`, `registration`, `insurance`, `service_parts_id`, `vin_plate`, `window_sticker`, `build_sheet`, `manual`, `other_document`
- `vehicle_images_rotation_check`: `CHECK ((rotation = ANY (ARRAY[0, 90, 180, 270])))`
- **`verification_status`**: `pending`, `approved`, `rejected`
- **`?`**: `pending`, `processing`, `completed`, `failed`, `skipped`
- **`?`**: `pending`, `processing`, `optimized`, `failed`
- **`?`**: `unorganized`, `organized`, `ignored`

### `bat_extraction_queue`

- **`status`**: `pending`, `processing`, `complete`, `failed`

### `import_queue`

- **`status`**: `pending`, `processing`, `pending_review`, `pending_strategy`, `complete`, `failed`, `skipped`, `duplicate`

### `document_ocr_queue`

- **`status`**: `pending`, `classifying`, `extracting`, `linking`, `complete`, `failed`, `skipped`

### `ownership_transfers`

- **`public_visibility`**: `vague`, `detailed`, `hidden`

### `organization_vehicles`

- **`relationship_type`**: `owner`, `consigner`, `service_provider`, `work_location`, `sold_by`, `storage`, `auction_platform`, `buyer`
- **`status`**: `active`, `past`, `pending`, `sold`, `archived`
- **`service_status`**: `currently_in_service`, `service_archive`
- **`listing_status`**: `for_sale`, `sold`, `pending`, `new_arrival`, `in_build`, `auction_soon`, `consignment`, `trade_in`, `parts_car`, `archived`

### `external_listings`

- **`listing_status`**: `pending`, `active`, `ended`, `sold`, `unsold`, `cancelled`, `reserve_not_met`, `no_sale`
- **`platform`**: `bat`, `cars_and_bids`, `mecum`, `barrettjackson`, `russoandsteele`, `pcarmarket`, `sbx`, `bonhams`, `rmsothebys`, `collecting_cars` ... (23 total)

### `auction_events`

- **`outcome`**: `sold`, `reserve_not_met`, `no_sale`, `bid_to`, `cancelled`, `relisted`, `pending`, `live`

### `vehicle_form_completions`

- `vehicle_form_completions_completeness_pct_check`: `CHECK (((completeness_pct >= 0) AND (completeness_pct <= 100)))`
- **`status`**: `not_started`, `partial`, `complete`, `commissioned`, `in_progress`, `failed`

### `service_executions`

- **`trigger_type`**: `auto`, `manual`, `scheduled`
- **`status`**: `queued`, `executing`, `completed`, `failed`, `cancelled`, `pending_payment`

---

## Database Statistics

| Metric | Value |
|--------|-------|
| Total tables | 824 |
| Total columns | 14,739 |
| Total rows (estimated) | 76,231,187 |
| Tables > 1M rows | 7 |
| Tables > 100K rows | 57 |
| Tables < 100 rows | 610 |
| CHECK constraints | 1086 |
| Pipeline registry entries | 63+ |
| Observation sources | 131 |
