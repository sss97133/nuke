-- Describe vehicles: the 185 columns with no COMMENT ON COLUMN (157 of 342 described before, catalog count on prod,
-- 2026-10-06), one corrected column comment (era) and two corrected facts in the table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-06 UTC):
--   Columns, types, defaults, constraints and existing comments from pg_attribute, pg_constraint and pg_description.
--   Writers from code at origin/main a06456972 (supabase/functions, supabase/migrations, scripts, nuke_frontend/src,
--   apps), the 39 triggers on vehicles, every live public SQL function that names the column (pg_proc), pg_cron and
--   pipeline_registry (one undescribed column has an owner there: perf_comfort_score, calculate-vehicle-scores).
--   "Filled" means non-NULL and, for text, non-blank; booleans count true; json and arrays count non-empty.
-- LIMITS:
--   Fill counts come from one 1% block sample, TABLESAMPLE SYSTEM (1) REPEATABLE (20261006): 9,780 of about 1.01M
--   rows. "Rows created in the last 30 days" are the 600 sampled rows created after 2026-09-06. Block sampling
--   clusters rows of similar age, so small percentages are rough. Columns empty in the sample were checked against
--   ANALYZE statistics (pg_stats, 30,000-row sample, autoanalyze 2026-10-06 09:36Z); two of them hold a few rows.
--   No full-table scan was run (2.4 GB heap; the read API stops a statement at 10 s).
--   Writer attribution is from code and from row stamps where a writer leaves one. A writer that ran outside the repo
--   (hand-run scripts, deleted functions) is named only where a stamp or the commit history shows it; otherwise the
--   comment says the writer is not established.
--   Quoted values are categorical codes only: no names, contacts, VINs, addresses or amounts tied to a person.
--   "Model-level reference value": filled from other rows of the same year/make/model, an OEM table or an LLM's recall
--   of factory specs, not observed on the vehicle itself.
-- CHANGED EXISTING COMMENTS:
--   era: the old value list (antique/prewar/classic/muscle/malaise/90s/2000s/modern) contradicts CHECK
--   vehicles_era_check and its writer auto_classify_vehicle(), which use pre-war .. contemporary.
--   Table comment: earliest created_at is 2025-09-07, not 2025-11-28; the 291 foreign keys come from 287 tables.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicles IS
'CANONICAL for vehicle (291 foreign keys from 287 tables reference it, 2026-10-06; docs/ledger/theory/data-machine.md names it the vehicle entity). The vehicle entity: one row per physical vehicle (grain: one vehicle). Columns hold the current best value per field; canonical columns are resolved by trigger trg_resolve_canonical_columns, and the testimony behind them lives in vehicle_observations and the field evidence tables. Not an event table: created_at is when the row was created (ingest, 2025-09-07 onward), updated_at the last write. Writers: every extractor and many enrichment functions (pipeline_registry owners include extractor, decode-vin-and-update, compute-vehicle-valuation, calculate-vehicle-scores, enrich-msrp, ownership-transfer-system).';

-- ── Identity and core listing fields ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.id IS
'Surrogate key of the vehicle. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by 291 foreign keys from 287 tables (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.license_plate IS
'License plate number as an owner entered it. Owner-private. Unit: none. Source: the web app vehicle forms (VehicleForm, EditVehicle) under RLS; no extractor writes it. Empty in the 2026-10-06 sample; ANALYZE statistics estimate about 70 filled rows. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.color IS
'Exterior color as the source states it (free text, often a factory paint name). Unit: none. Source: listing extractors at insert or gap fill (extract-bat-core, process-cl-queue, extract-cars-and-bids-core, extract-mecum and others), the BaT snapshot parsers (parse_bat_snapshots_bulk, drain_bat_queue_from_snapshots), SPID decode (verify_vehicle_from_spid), project_vehicle_color(), the web app forms; scripts/normalize-colors.py cleans values. color_source names the writer when one stamps it. 42.6% filled (2026-10-06 sample); 527 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a (current best value).';
COMMENT ON COLUMN public.vehicles.mileage IS
'Odometer reading as the source states it. Unit: miles as published (no unit column). Source: listing extractors (extract-bat-core stamps mileage_source when it fills or replaces mileage on an existing row; extract-mecum; process-cl-queue; others), the BaT snapshot parsers, enrich_mine_mileage(), the web app forms. The reading is undated here (as of the listing that supplied it). 36.7% filled (2026-10-06 sample), 0 .. 1,965,000 (outliers present); 566 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission IS
'Transmission as the source states it (free text). Unit: none. Source: listing extractors (extract-bat-core stamps transmission_source when it fills or replaces it on an existing row), the BaT snapshot parsers, SPID decode (transmission_source spid), auto_populate_vehicle_specs() from oem_vehicle_specs (no live caller), the web app forms. transmission_type holds a normalized "N-speed manual/automatic" form. 41.8% filled (2026-10-06 sample); 572 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.body_style IS
'Body style as the source states it or as derived (free text; Coupe, Convertible, Truck, Sedan, SUV, Wagon most common). Unit: none. Source: listing extractors at insert, parse_bat_archive_fill(), enrich_body_from_model(), enrich_vehicle_from_nhtsa(), scripts/derive-specs-from-ymm.py (mode of the same year/make/model), the web app forms. canonical_body_style is its normalized form (trigger trg_set_vehicle_canonical_taxonomy). 58.6% filled (2026-10-06 sample); 259 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';

-- ── Dimensions and fuel economy (model-level reference values) ──────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.doors IS
'Number of doors. Model-level reference value, not observed on this vehicle. Unit: count. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of rows with the same year/make/model, then oem_vehicle_specs; run with triggers off, no per-row stamp; in the repo since 2026-02-24), enrich-factory-specs (LLM recall of factory specs, run 2026-02-15, stamped in origin_metadata.factory_specs_*), VIN-decode scripts (decode-all-vins.js, mass-vin-decode.ts), auto_populate_vehicle_specs() (no live caller), the web app forms. 20.5% filled (2026-10-06 sample), 0 .. 5; rows carrying it were created 2025-11-02 .. 2026-04-14. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.seats IS
'Seating capacity. Model-level reference value, not observed on this vehicle. Unit: count. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15, stamped in origin_metadata.factory_specs_*), auto_populate_vehicle_specs() (no live caller), the web app forms. 10.5% filled (2026-10-06 sample), 2 .. 9; rows carrying it were created 2025-11-02 .. 2026-04-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.weight_lbs IS
'Curb weight (enrich-factory-specs uses GVWR for motorhomes). Model-level reference value, not weighed on this vehicle. Unit: pounds. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs curb weight; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15, stamped in origin_metadata.factory_specs_*), auto_populate_vehicle_specs() (no live caller), the web app forms. 10.0% filled (2026-10-06 sample), 1,100 .. 7,260; rows carrying it were created 2025-11-02 .. 2026-04-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.length_inches IS
'Overall length. Model-level reference value, not measured on this vehicle. Unit: inches. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15, stamped in origin_metadata.factory_specs_*), auto_populate_vehicle_specs() (no live caller), the web app forms. 9.4% filled (2026-10-06 sample), 117 .. 252; rows carrying it were created 2025-11-02 .. 2026-04-07. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.width_inches IS
'Overall width (enrich-factory-specs asks for width excluding mirrors). Model-level reference value, not measured on this vehicle. Unit: inches. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() (no live caller), the web app forms. 9.4% filled (2026-10-06 sample), 52 .. 87; rows carrying it were created 2025-11-02 .. 2026-04-07. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.height_inches IS
'Overall height. Model-level reference value, not measured on this vehicle. Unit: inches. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() (no live caller), the web app forms. 9.3% filled (2026-10-06 sample), 44 .. 80; rows carrying it were created 2025-11-02 .. 2026-04-07. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.wheelbase_inches IS
'Wheelbase. Model-level reference value, not measured on this vehicle. Unit: inches. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() (no live caller), the web app forms. 10.3% filled (2026-10-06 sample), 72 .. 156; rows carrying it were created 2025-11-02 .. 2026-04-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.mpg_city IS
'City fuel economy. Model-level reference value, not observed on this vehicle. Unit: miles per gallon. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs, which scripts/import-epa-fuel-economy.mjs loads from fueleconomy.gov), enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() (no live caller), the web app forms. 6.1% filled (2026-10-06 sample), 6 .. 129; rows carrying it were created 2025-11-02 .. 2026-04-14. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.mpg_highway IS
'Highway fuel economy. Model-level reference value, not observed on this vehicle. Unit: miles per gallon. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model, then oem_vehicle_specs, which scripts/import-epa-fuel-economy.mjs loads from fueleconomy.gov), enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() (no live caller), the web app forms. 6.1% filled (2026-10-06 sample), 10 .. 116; rows carrying it were created 2025-11-02 .. 2026-04-14. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.mpg_combined IS
'Combined fuel economy. Model-level reference value, not observed on this vehicle. Unit: miles per gallon. Source (each fills only when NULL): enrich-factory-specs (LLM recall, 2026-02-15), auto_populate_vehicle_specs() from oem_vehicle_specs (no live caller), the web app forms; derive-specs-from-ymm.py does not fill it. 2.1% filled (2026-10-06 sample), 7 .. 123; rows carrying it were created 2025-12-11 .. 2026-04-14. Grain: one vehicle. Clock: n/a.';

-- ── Value and owner-entered fields ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.current_value IS
'MIXED, despite its name: not a market value. Trigger trigger_sync_bat_to_vehicle on bat_listings copies the BaT sale price into it when a listing sells and it is NULL; trigger auto_update_valuation_trigger on timeline_events writes purchase_price + parts + labor (recalculate_vehicle_value_from_evidence); update_vehicle_value_from_ai() and the web app forms write estimates. No as-of time is stored. Unit: USD by convention. Read as the last price fallback by clean_vehicle_prices and as a price signal by trg_vehicle_quality_score; read vehicle_price_facts() for prices. 4.4% filled (2026-10-06 sample); rows carrying it were created 2025-11-02 .. 2026-07-26. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.purchase_price IS
'Price the current owner paid. Owner-private amount. Unit: USD by convention (no currency column). Source: the web app forms, acquire-vehicle, api-v1-vehicles; merge functions carry it to the surviving row. Input to recalculate_vehicle_value_from_evidence() and trigger trg_log_vehicle_price_history. Empty in the 2026-10-06 sample and in ANALYZE statistics. Grain: one vehicle. Clock: n/a (purchase_date holds the event date).';
COMMENT ON COLUMN public.vehicles.purchase_location IS
'Where the current owner bought the vehicle (free text). Owner-private. Unit: none. Source: the web app forms (AddVehicle, EditVehicle). 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.previous_owners IS
'Number of previous owners. Unit: count. Source: the web app forms and apply_description_discoveries() (description mining); default 0. Every non-NULL sampled value is 0 (9,762 of 9,780 rows, 2026-10-06), so 0 means not recorded, not a one-owner vehicle. calculate-vehicle-scores treats any non-NULL value as owners known and credits it. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_modified IS
'Whether the vehicle is modified from stock. Unit: boolean. Source: default false; the web app forms; scripts/extract-descriptions.mjs (description extraction). True on 2 of 9,780 sampled rows (2026-10-06), so false mostly means not assessed. Read by nuke_build_class() and calculate-vehicle-scores. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.modification_details IS
'Owner description of modifications (free text). Unit: none. Source: the web app forms. Indexed into search_vector by trigger vehicles_search_vector_trigger; read by nuke_build_class(). The listing-section twin is modifications. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.maintenance_notes IS
'Owner maintenance notes (free text). Owner-private. Unit: none. Source: the web app forms. Read by nuke_build_class(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.insurance_company IS
'Insurer name as an owner entered it. Owner-private. Unit: none. Source: the web app forms (AddVehicle, EditVehicle, the dashboard edit modal). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.insurance_policy_number IS
'Insurance policy number as an owner entered it. Owner-private. Unit: none. Source: the web app forms (AddVehicle, EditVehicle, the dashboard edit modal). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.registration_state IS
'State or region where the vehicle is registered, as an owner entered it. Distinct from state (the listing location). Unit: none. Source: the web app forms. Empty in the 2026-10-06 sample; ANALYZE statistics estimate about 30 filled rows. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.registration_expiry IS
'Registration expiry date as an owner entered it. Unit: date. Source: the web app forms. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: event (document date).';
COMMENT ON COLUMN public.vehicles.inspection_expiry IS
'Inspection expiry date as an owner entered it (which inspection is not defined). Unit: date. Source: the web app forms. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: event (document date).';
COMMENT ON COLUMN public.vehicles.is_public IS
'Whether the vehicle may be shown publicly; search, feed and count functions (search_vehicles_*, get_vehicle_feed_data, count_vehicles_search and others) filter on it. Unit: boolean. Source: default true; extractors write true at insert (extract-bat-core and others); the web app forms. False on 3,147 of 9,780 sampled rows (2026-10-06), 2,520 of them soft-deleted. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.notes IS
'Free-text notes. In practice mostly machine notes: JSON text written by bulk importers (conceptcarz, Barrett-Jackson and Mecum event loaders, Mecum queue promotion); owners can also write it through the web app forms, so it may hold private text. vehicle_sale_basis() reads it for sale markers on rows created before 2026-09-27 (Mecum "Result: sold" and "Result: bid-goes-on", conceptcarz "status": "sold"). Unit: none. 33.2% filled (2026-10-06 sample); 1 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.created_at IS
'When the row was inserted; not the date of the vehicle, its listing or its sale. Unit: timestamptz (UTC). Source: default now(). Earliest 2025-09-07 (2026-10-06). Grain: one vehicle. Clock: ingest.';
COMMENT ON COLUMN public.vehicles.updated_at IS
'When the row was last written. Trigger vehicles_update_timestamp (simple_vehicle_update_trigger) sets now() on every UPDATE, so any writer moves it, derived-column maintenance included; it is not a source event time. Unit: timestamptz (UTC). Grain: one vehicle. Clock: ingest (last write).';
COMMENT ON COLUMN public.vehicles.auction_source IS
'Platform slug of the row origin: bat, mecum, facebook_marketplace, barrett-jackson, classic-driver, cars_and_bids, conceptcarz most common (2026-10-06 sample). Unit: none. Source: the inserting writer; trigger trigger_auto_set_auction_source (auto_set_auction_source) resolves it from the discovery_url or listing_url host when it is NULL or a placeholder (Unknown Source, User Submission, unknown, user-submission, other), giving unknown for an unmatched URL and user-submission when there is no URL; the same trigger copies it into source and sets origin_organization_id. 98.7% filled; 600 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.ownership_verified IS
'Whether ownership has been verified. Unit: boolean. Source: default false; the AddVehicle form whitelist; no live SQL function or edge function sets it (2026-10-06). False on every sampled row (2026-10-06). Read by compute_auction_readiness(), compute_origination_anchor(), detect_anchor_violations() and universal-search. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.ownership_verified_at IS
'When ownership was verified. Unit: timestamp without time zone. Source: none current; created with ownership_verified by the January 2025 ownership verification migrations. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: recording (verification time).';
COMMENT ON COLUMN public.vehicles.ownership_verification_id IS
'Ownership verification record behind ownership_verified: created by 20250130_ownership_verification_system as a reference to ownership_verifications.id, but prod has no FK on it. Unit: none (uuid). Source: none current; read by create_ownership_verification_notification(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_daily_driver IS
'Owner-declared use: daily driver. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every sampled row (2026-10-06), so false means not declared. Read by calculate-vehicle-scores. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_weekend_car IS
'Owner-declared use: weekend car. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every sampled row (2026-10-06), so false means not declared. Read by calculate-vehicle-scores. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_track_car IS
'Owner-declared use: track car. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every sampled row (2026-10-06), so false means not declared. Read by calculate-vehicle-scores. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_show_car IS
'Owner-declared use: show car. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every non-NULL sampled row (2026-10-06), so false means not declared. Read by calculate-vehicle-scores. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_project_car IS
'Owner-declared use: project car. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every sampled row (2026-10-06), so false means not declared. No reader outside the web app. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_garage_kept IS
'Owner-declared storage: garage kept. Unit: boolean. Source: default false; the web app forms (AddVehicle, the dashboard edit modal). False on every sampled row (2026-10-06), so false means not declared. No reader outside the web app. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.interior_color IS
'Interior color as the source states it (free text). Unit: none. Source: listing extractors at insert or gap fill (extract-bat-core, extract-cars-and-bids-core, extract-mecum and others), the BaT snapshot parsers, synthesize_color_from_form_fill(), the web app forms; shares color_source with color. 38.5% filled (2026-10-06 sample); 422 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_for_sale IS
'Whether the vehicle was offered for sale when a writer last set it. Unit: boolean. Source: default false; Facebook Marketplace importers (import-fb-marketplace, scripts/import-fb-saved.mjs) and ingest set true; trigger trigger_sync_bat_to_vehicle on bat_listings sets false when a BaT listing sells. True on 132 of 9,780 sampled rows (2026-10-06), 129 of them facebook_marketplace rows created 2026-02-03 .. 2026-04-13. sale_status and canonical_outcome carry the market state. Grain: one vehicle. Clock: n/a (as of the last write).';
COMMENT ON COLUMN public.vehicles.deleted_at IS
'Soft-delete time: set when the row was retired, NULL on live rows; most readers filter deleted_at IS NULL. Unit: timestamptz (UTC). Source: merge_into_primary() and dedupe_vehicles_batch() (with status duplicate) set now(); most values come from a bulk cleanup on 2026-03-10 that also set status archived or inactive and has no writer in the repo. 31.0% of sampled rows (2026-10-06), dated 2026-02-05 .. 2026-03-23. Grain: one vehicle. Clock: recording (when the row was retired, not a source event).';
COMMENT ON COLUMN public.vehicles.confidence_score IS
'Unknown meaning beyond a 0-100 record confidence (CHECK vehicles_confidence_score_check). Unit: score 0-100. Source: default 50; no writer of this column found (the confidence_score keys in extractor code belong to other tables), and all 9,780 sampled rows hold 50 (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.source IS
'Platform slug of the row origin: bat, mecum, facebook_marketplace, barrett-jackson, classic-driver, cars_and_bids, conceptcarz, classiccars-com most common (2026-10-06 sample). Unit: none. Source: the inserting writer; trigger trigger_auto_set_auction_source copies auction_source into it when it is NULL or ''User Submission''. First input to canonical_platform (trg_resolve_canonical_columns). Equals auction_source on 94% of sampled rows. 99.9% filled. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.import_metadata IS
'Importer payload as JSON. extract-cars-and-bids-core stores its full Cars and Bids extraction here (auction_status, lot number, content sections such as dougs_take and highlights, counts, bid history, extracted_at); scripts/extract-cab-vehicles-playwright.mjs and other loaders write their own shapes. vehicle_sale_basis() reads import_metadata->>auction_status as the Cars and Bids sale marker for rows created before 2026-09-27. Unit: none. 3.5% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-07-27. Grain: one vehicle. Clock: n/a (as of the extraction).';
COMMENT ON COLUMN public.vehicles.uploaded_at IS
'Insert time without time zone, a legacy twin of created_at: equal to created_at in UTC on 9,777 of 9,782 sampled rows (2026-10-06). Unit: timestamp(0) without time zone (UTC wall clock). Source: default now(). Grain: one vehicle. Clock: ingest.';
COMMENT ON COLUMN public.vehicles.owner_shop_id IS
'Shop that owns the vehicle, FK to shops_archived_20260129.id (the shops table archived when shops were consolidated into organizations on 2026-01-29). Legacy. Unit: none (uuid). Source: none current; last code change naming it 2025-11-10. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';

-- ── Scores and grades ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.value_score IS
'Profile engagement and completeness score, not a price: compute_vehicle_value() adds points for approved images (log scale), image tags, timeline events in the last 30 days, the receipts total, the public flag and a 7-field completeness share. Unit: points. Source: compute_vehicle_value(), called by triggers on vehicle_images, image_tags and ownership_verifications only when the acting user is a validated actor for the vehicle (is_validated_vehicle_actor), and by the value recompute queue, whose drain is off (drain_vehicle_derived_queues runs with p_include_value false). Default 0; above 0 on 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (as of value_breakdown computed_at).';
COMMENT ON COLUMN public.vehicles.value_breakdown IS
'Inputs behind value_score as JSON: approved_images, tags, recent_events_30d, receipts_total, verified_owner, contributors, public, completeness, computed_at. Unit: none. Source: compute_vehicle_value(). Default {}; non-empty on 1 of 9,780 sampled rows, computed 2026-05-17 (2026-10-06). Grain: one vehicle. Clock: derived (computed_at inside).';
COMMENT ON COLUMN public.vehicles.owner_id IS
'Owning user, FK to auth.users.id (vehicles_owner_id_fkey) and to profiles.id (fk_vehicles_owner_id), both ON DELETE SET NULL. Distinct from user_id (primary owner) and uploaded_by (creator). Unit: none (uuid). Source: api-v1-vehicles, api-v1-batch and api-v1-observations set the calling user when they create a vehicle. Read by access checks (user_can_edit_vehicle, vehicle_build_log_public, get_vehicle_build_ledger). 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.investment_grade IS
'Copy of the vehicle grade (vehicle_grades.grade) stored as text; equal to quality_grade on all 3,048 sampled rows that have it (2026-10-06). Not an investment rating despite its name. Unit: grade points as text (3.9, 5.5, 4.0 most common). Source: persist_vehicle_grade() (compute_vehicle_grade), fired by triggers trg_regrade_on_image, trg_regrade_on_timeline, trg_regrade_on_service and trg_regrade_on_transfer. 31.2% filled; 576 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (as of vehicle_grades.calculated_at).';
COMMENT ON COLUMN public.vehicles.investment_confidence IS
'Confidence of the grade in investment_grade, mapped from vehicle_grades.confidence: high 90, medium 60, low 30, insufficient 5, else 0. Unit: score 0-100. Source: persist_vehicle_grade(). 90 on 1,295, 30 on 783, 5 on 687, 60 on 287 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (as of vehicle_grades.calculated_at).';
COMMENT ON COLUMN public.vehicles.quality_last_assessed IS
'When the profile quality was last assessed. Retired: its last writer, auto-quality-inspector, was archived and then removed from the repo on 2026-03-07 (9ab2fd4b7). Unit: timestamptz. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: derived (assessment run time).';

-- ── Trim, color and location ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.trim IS
'Trim level as the source states it (free text). Unit: none. Source: listing extractors (Barrett-Jackson, BaT, Cars and Bids and others), enrichment and VIN-decode paths, the web app forms; trim_source and trim_confidence are never stamped. 9.9% filled (2026-10-06 sample); rows carrying it were created 2025-11-02 .. 2026-05-29, so current inserts do not set it. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.color_primary IS
'Primary exterior color, a two-tone companion to color (free text). Unit: none. Source: extract-jamesedition, batch-extract-snapshots, enrich-vehicle-profile-ai, synthesize_color_from_form_fill(), the dealer bulk editor. 34 of 9,780 sampled rows (2026-10-06), created 2025-12-11 .. 2026-04-12. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.color_secondary IS
'Secondary exterior color (two-tone); duplicates the concept of the described secondary_color. Unit: none. Source: the dashboard edit modal only; added with the paint code columns on 2025-11-02. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.paint_code IS
'OEM exterior paint code. Unit: none. Source: trigger trigger_verify_vehicle_from_spid_enhanced on vehicle_spid_data fills it from a GM Service Parts Identification label when NULL (vehicle_spid_data holds 1 row, 2026-10-06); the dashboard edit modal. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.paint_code_secondary IS
'Secondary OEM paint code (two-tone). Unit: none. Source: the dashboard edit modal only; added 2025-11-02. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.city IS
'City of the vehicle location as its listing gives it. For auction-event sources the geocode functions write the event venue (geocode_bj_events_batch sets the Barrett-Jackson event city with listing_location_source bj_event), not where the car is kept. Unit: none. Source: extract-bat-core (parsed BaT location), the BaT snapshot parsers, enrich-bulk (from vehicle_events location metadata), geocode_from_cache_batch(), geocode_bj_events_batch(), backfill_classiccars_location_from_slug(), correct_fabricated_location_stamp() and other extractors. Not keyed to a geography entity; marketplace_metro_pulse rolls up by it. 39.1% filled (2026-10-06 sample); 431 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a (as of listing_location_observed_at).';
COMMENT ON COLUMN public.vehicles.state IS
'State or region of the vehicle location as its listing gives it (two-letter uppercase codes on 3,733 of 3,799 sampled values; some full names). For auction-event sources the geocode functions write the event venue state, not where the car is kept. Distinct from registration_state. Unit: none. Source: extract-bat-core (parsed BaT location), the BaT snapshot parsers, enrich-bulk (from vehicle_events location metadata), geocode_from_cache_batch(), geocode_bj_events_batch(), backfill_classiccars_location_from_slug(), correct_fabricated_location_stamp() and other extractors. Not keyed to a geography entity. 38.8% filled (2026-10-06 sample); 412 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a (as of listing_location_observed_at).';
COMMENT ON COLUMN public.vehicles.country IS
'Country of the vehicle location. Unit: none (USA, GB, NO, FR seen). Source: default ''USA''; extract-bonhams-typesense, sync-live-auctions and apply_description_discoveries() write other values. 9,776 of 9,780 sampled rows hold USA (2026-10-06), mostly the default, so USA does not establish location. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.primary_image_url IS
'Hero image URL for the vehicle. Unit: none (URL). Source: extractors set the first gallery image at insert (extract-bat-core, extract-cars-and-bids-core and others); triggers trg_sync_vehicle_primary_image and trg_sync_vehicle_primary_image_insert_stmt on vehicle_images recompute it through recompute_vehicle_primary_image() (the best confirmed and analysed frame first, then the latest confirmed frame, and so on). 56.0% filled (2026-10-06 sample); 577 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.title IS
'Display title of the vehicle or its listing (free text). Unit: none. Source: older importers (Mecum, Barrett-Jackson and BaT loaders), the BaT snapshot parsers and many extractors; current BaT inserts write listing_title instead (35 of 600 rows created in the last 30 days carry title). Equals listing_title on 1,778 of the 3,307 sampled rows that have both. 69.6% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a.';

-- ── Quality flags and field provenance ──────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.quality_issues IS
'Issues the shared extraction quality gate raised when it flagged the extraction for review, as a text array. Unit: none. Source: extract-bonhams and extract-cars-and-bids-core on a flag_for_review result. Default {}; non-empty on 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a (as of the extraction).';
COMMENT ON COLUMN public.vehicles.requires_improvement IS
'Set true by extract-bonhams when the shared quality gate flags the extraction for review (with quality_issues). Unit: boolean. Source: extract-bonhams; default false. False on every sampled row (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.last_quality_check IS
'When a quality check last ran on the row. Unit: timestamptz. Source: unknown: no writer in the repo or its history; the dashboard edit modal reads it. 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (check run time).';
COMMENT ON COLUMN public.vehicles.year_source IS
'Provenance label for year, stamped only when a gap-filling writer sets it: facebook_saved_title_parse, user_input and a dealer-inventory ingest label seen (2026-10-06 sample). Unit: none. Source: the shared provenance write layer _shared/batUpsertWithProvenance.ts (gap fill), scripts/import-fb-saved.mjs, scripts/ingest-collective-auto-full.js. 8 of 9,780 sampled rows; NULL means not stamped. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.make_source IS
'Provenance label for make: cleanup_unknown_make_v3 and craigslist_cleanup_v1 (make cleanup passes, which also set make_confidence 0; scripts/fix-craigslist-data.js writes the second, the first has no writer in the repo), facebook_saved_title_parse (scripts/import-fb-saved.mjs), a dealer-inventory ingest label. Unit: none. Source: those scripts and the shared provenance write layer _shared/batUpsertWithProvenance.ts. 93 of 9,780 sampled rows (2026-10-06); NULL means not stamped. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.model_source IS
'Provenance label for model: facebook_saved_title_parse, observation-writer:1.0.0, user_input and a dealer-inventory ingest label seen (2026-10-06 sample). Unit: none. Source: scripts/import-fb-saved.mjs, the shared provenance write layer (_shared/batUpsertWithProvenance.ts, _shared/observationWriter.ts), scripts/ingest-collective-auto-full.js. 9 of 9,780 sampled rows; NULL means not stamped. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.mileage_source IS
'Provenance label for mileage: bring a trailer (extract-bat-core when it fills or replaces mileage on an existing row), batParser:1.0.0 and a dealer-inventory ingest label seen (2026-10-06 sample); extract-mecum computes odometer_field, subtitle and highlights labels, none seen in the sample. Unit: none. Source: extract-bat-core, the shared provenance write layer _shared/batUpsertWithProvenance.ts, extract-mecum. 12.4% filled; 33 of 600 rows created in the last 30 days (BaT inserts do not stamp it). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission_source IS
'Provenance label for transmission: bring a trailer (extract-bat-core when it fills or replaces transmission on an existing row), batParser:1.0.0, spid (verify_vehicle_from_spid). Unit: none. Source: extract-bat-core, the shared provenance write layer, the SPID trigger. 3.8% filled (2026-10-06 sample); 34 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.color_source IS
'Provenance label shared by color and interior_color: bring a trailer (extract-bat-core), batParser:1.0.0 and observation-writer:1.0.0 seen (2026-10-06 sample); spid (verify_vehicle_from_spid) and nuke_projection:claims (project_vehicle_color) are also written. Unit: none. Source: extract-bat-core, the shared provenance write layer, the SPID trigger, project_vehicle_color(). 4.0% filled; 35 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.year_confidence IS
'Confidence in year, 0-100. Unit: score. Source: default 50; scripts/import-fb-saved.mjs writes 90 for titles it parsed. 50 on all but 5 of 9,780 sampled rows (2026-10-06), so 50 means not assessed. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.make_confidence IS
'Confidence in make, 0-100. Unit: score. Source: default 50; 0 where a make cleanup pass marked the make unknown (make_source cleanup_unknown_make_v3 or craigslist_cleanup_v1, 87 sampled rows); 90 from scripts/import-fb-saved.mjs and a dealer-inventory ingest; scripts/yono-batch-classify.mjs can write a classifier confidence. 50 on 9,690 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.model_confidence IS
'Confidence of the canonical model match, 0-100, not of the source. Unit: score. Source: trigger trg_auto_normalize_model (auto_normalize_vehicle_model) writes the normalize_vehicle_model() match confidence on insert and on change of make, model or year when a canonical match exists; default 50 otherwise. 50 on 4,890, 100 on 1,981, 80 on 1,868, 75 on 1,033 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (as of the last make/model/year write).';

-- ── Series, trim detail and model normalization ─────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.series IS
'Model series or chassis code as a source states it or as recalled (enrich-factory-specs asks for codes such as E46, C5, 996). Unit: none. Source: listing extractors and loaders (BaT and Mecum rows), enrich-factory-specs (LLM recall, 2026-02-15), enrich_vehicle_from_nhtsa(), process-cl-queue, the web app forms. normalized_series is the canonical form set by trigger. 3.6% filled (2026-10-06 sample); rows carrying it were created 2025-11-02 .. 2026-04-14. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.series_source IS
'Provenance label for series, stamped only by the shared provenance write layer (_shared/batUpsertWithProvenance.ts) on a gap fill. Unit: none. Added 2025-11-22 (20251122_add_submodel_series_to_vehicles). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.series_confidence IS
'Confidence in series, 0-100 by name. Unit: score. Source: none found; added 2025-11-22 (20251122_add_submodel_series_to_vehicles); read by get_inventory_completeness_metrics(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.trim_source IS
'Provenance label for trim, stamped only by the shared provenance write layer (_shared/batUpsertWithProvenance.ts) on a gap fill. Unit: none. Added 2025-11-22 (20251122_add_submodel_series_to_vehicles). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.trim_confidence IS
'Confidence in trim, 0-100 by name. Unit: score. Source: none found; added 2025-11-22 (20251122_add_submodel_series_to_vehicles); read by get_inventory_completeness_metrics(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.model_series IS
'Body series designation (C10, C20, K10, K20 and the like, per 20251122_vehicle_data_structure_fix, whose comments never reached prod); overlaps series and normalized_series. Unit: none. Source: none: no writer in the repo. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.cab_config IS
'Truck cab configuration (Regular, Extended, Crew, per 20251122_vehicle_data_structure_fix). Unit: none. Source: none current; the photo album scripts and the web app vehicle data and vision clients name it. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.trim_level IS
'Factory trim package (Silverado, Cheyenne, Custom and the like, per 20251122_vehicle_data_structure_fix); overlaps trim. Unit: none. Source: none writes this column (oem_vehicle_specs has its own trim_level, which auto_populate_vehicle_specs() matches on). Read by get_field_value_intelligence() and my_vehicles(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission_model IS
'Transmission model designation, added 2025-12-01 (20251201_add_transmission_model). Unit: none. Source: EditVehicle and the dashboard edit modal only; read by get_field_value_intelligence(). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission_type IS
'Normalized transmission, "N-speed manual" or "N-speed automatic" (3-speed automatic, 4-speed automatic, 4-speed manual, 5-speed manual most common; capitalization varies). Unit: none. Source: mostly model-level: scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15); regex backfill scripts read the vehicle description. 11.1% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-04-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission_code IS
'OEM transmission code by name. Unit: none. Source: none found writing this column: verify_vehicle_from_spid() copies the SPID transmission code into transmission (transmission_source spid), not here; scripts/promote-discoveries-to-observations.mjs names it. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.merged_into_vehicle_id IS
'Surviving vehicle this row was merged into (a vehicles.id; no FK). Unit: none (uuid). Source: merge_into_primary(), merge_duplicate_vehicles(), merge_vehicle_into_primary_by_url(), merge_craigslist_duplicates_by_image_signature(); unmerge_vehicle() clears it. 14 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.selling_organization_id IS
'Organization that sold the vehicle, FK to organizations_archived_20260129.id: the FK still points at the pre-2026-01-29 archive, so an organizations.id created since then fails it. Legacy; origin_organization_id and vehicle_events.source_organization_id carry the current links. Unit: none (uuid). Source: extract-gaa-classics; scripts/link-vehicles-to-org.ts and extract-one-per-org.ts. 9 of 9,780 sampled rows, all created 2026-01-25 (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.normalized_model IS
'Canonical model name from canonical_models for the make, model and year. Unit: none. Source: trigger trg_auto_normalize_model (auto_normalize_vehicle_model calling normalize_vehicle_model()) on insert and on change of make, model or year, written only when a canonical match exists. Read by the model market readers (get_model_market_stats, get_model_price_history, get_make_market_stats). 63.0% filled (2026-10-06 sample); 411 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (as of the last make/model/year write).';
COMMENT ON COLUMN public.vehicles.normalized_series IS
'Canonical model family from the same match (Corvette, Mustang, 911, Camaro, SL-Class, F-Series most common). Unit: none. Source: trigger trg_auto_normalize_model. 47.3% filled (2026-10-06 sample); 386 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (as of the last make/model/year write).';
COMMENT ON COLUMN public.vehicles.generation IS
'Model generation name from the same canonical match (Squarebody and OBS in the sample). Unit: none. Source: trigger trg_auto_normalize_model when the canonical_models match carries a generation; identify-vehicle-from-image also names it. 1.5% filled (2026-10-06 sample). Grain: one vehicle. Clock: derived (as of the last make/model/year write).';
COMMENT ON COLUMN public.vehicles.vin_source_image_id IS
'Image the VIN was read from: created 2025-12-08 as a reference to vehicle_images.id, but prod has no FK on it. Unit: none (uuid). Source: none: no writer in the repo. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.location IS
'Free-text vehicle location; one of several overlapping location columns (listing_location, bat_location, city, state, zip_code, gps_latitude, gps_longitude). Equals listing_location on 1,765 and bat_location on 1,111 of the 2,770 sampled rows that have it. Unit: none. Source: process-cl-queue (Craigslist location), parse_bat_archive_fill() and older BaT and Cars and Bids loaders. Not keyed to a geography entity. 28.3% filled (2026-10-06 sample); 119 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.is_streaming IS
'Unknown meaning; no writer in the repo or its history; read only by the vehicle card and the dashboard edit modal in the web app. Unit: boolean. Default false; false on every sampled row (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.image_url IS
'Legacy single image URL; primary_image_url is the maintained hero image. Equals primary_image_url on 1,879 of the 1,995 sampled rows that have it. Unit: none (URL). Source: older importers; rows carrying it were created 2025-11-02 .. 2026-02-16 (2026-10-06 sample). 20.4% filled. Grain: one vehicle. Clock: n/a.';

-- ── Listing fields ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.listing_url IS
'URL of the listing the row was built from (the canonical lot URL for BaT). Not always fetchable: 2,700 of the 8,186 sampled values are conceptcarz:// pseudo-URLs. Unit: none (URL). Source: the inserting extractor; extract-bat-core keeps an existing value. Read by trigger_auto_set_auction_source, trg_flag_sale_date_ingest_stamp and vehicle_sale_basis(); platform_source is backfilled from its host. 83.7% filled (2026-10-06 sample); 599 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.listing_source IS
'Label of the platform or writer that supplied the listing: a mix of platform slugs (bat, craigslist, barrett-jackson) and writer names (drain-no-ai, bat_simple_extract, extract-cars-and-bids-core, mecum-checkpoint-discover, mecum-fast-discover), 2026-10-06 sample. Unit: none. Source: the inserting writer. Second input to canonical_platform after source (trg_resolve_canonical_columns). 45.1% filled; 597 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.listing_posted_at IS
'When the listing was first posted on the source (Craigslist posting time). Unit: timestamptz (UTC). Source: process-cl-queue and the ingest Craigslist capture. vehicle_price_facts() dates an ask by COALESCE(listing_updated_at, listing_posted_at). 3 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: event (source posting time).';
COMMENT ON COLUMN public.vehicles.listing_updated_at IS
'When the listing was last updated on the source (Craigslist update time). Unit: timestamptz (UTC). Source: process-cl-queue and the ingest Craigslist capture. vehicle_price_facts() dates an ask by COALESCE(listing_updated_at, listing_posted_at). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: event (source update time).';
COMMENT ON COLUMN public.vehicles.listing_title IS
'Listing headline as published (BaT lot title, Craigslist title and so on). Unit: none. Source: extract-bat-core at insert, process-cl-queue, the BaT snapshot parsers, extract-bonhams-typesense, extract-jamesedition and other importers. 43.8% filled (2026-10-06 sample); 456 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.listing_location IS
'Cleaned listing location text, usually City, ST (the parseLocation clean form). For auction-event sources the geocode functions write the event venue (geocode_bj_events_batch writes the Barrett-Jackson venue with listing_location_source bj_event), not where the car is kept. Unit: none. Source: extract-bat-core, extract-cars-and-bids-core, process-cl-queue and the BaT snapshot parsers at extraction; geocode_bj_events_batch(), geocode_mecum_from_snapshots(), geocode_gooding_from_snapshots(), geocode_broad_arrow_from_urls(), geocode_from_cache_batch(). Provenance in listing_location_source, read time in listing_location_observed_at. 44.1% filled (2026-10-06 sample); 430 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a (as of listing_location_observed_at).';
COMMENT ON COLUMN public.vehicles.listing_location_raw IS
'Location text exactly as the listing showed it, before parsing (the parseLocation raw form). Unit: none. Source: extract-bat-core, extract-cars-and-bids-core and other extractors. 17.5% filled (2026-10-06 sample); 431 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.listing_location_observed_at IS
'When the writer read the listing location. Unit: timestamptz (UTC). Source: the writer clock at extraction (extract-bat-core, extract-cars-and-bids-core and other location writers). 23.0% filled (2026-10-06 sample), 2026-01-24 .. 2026-10-06; 456 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: ingest (read time).';
COMMENT ON COLUMN public.vehicles.listing_location_source IS
'Who supplied listing_location: bat, geocoding_cache, bat_snapshot_parser, bj_event, carsandbids, city_geocode_lookup, location_agent_backfill, mecum_event most common (2026-10-06 sample). Unit: none. Source: the same writers as listing_location. 25.0% filled; 456 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.listing_location_confidence IS
'Writer confidence in the parsed location, 0 to 1 (0.6 .. 0.9 seen; the bj_event geocode writes 0.85). Unit: fraction. Source: the parseLocation result in extract-bat-core and extract-cars-and-bids-core; the geocode functions. 20.9% filled (2026-10-06 sample); 430 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a.';

-- ── Taxonomy (trigger-maintained) ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.canonical_vehicle_type IS
'Normalized vehicle type: CAR, TRUCK, SUV, VAN, MOTORCYCLE, MINIVAN, BOAT, TRAILER and others (2026-10-06 sample). Unit: none. Source: trigger trg_set_vehicle_canonical_taxonomy (set_vehicle_canonical_taxonomy) on insert and on change of vin or body_style: the canonical_body_styles mapping of canonical_body_style, else normalize_vehicle_type() of the VIN-decoded type or body_style. Search readers filter on it (search_vehicles_*, the web app non-auto exclusion). 69.3% filled; 258 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (as of the last vin/body_style write).';
COMMENT ON COLUMN public.vehicles.canonical_body_style IS
'Normalized body style: COUPE, CONVERTIBLE, PICKUP, SEDAN, SUV, WAGON, ROADSTER, HATCHBACK most common (2026-10-06 sample). Unit: none. Source: trigger trg_set_vehicle_canonical_taxonomy: normalize_body_style() of body_style, else of the vin_decoded_data body or vehicle type. 47.4% filled; 258 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (as of the last vin/body_style write).';
COMMENT ON COLUMN public.vehicles.listing_kind IS
'Whether the row is a vehicle or a non-vehicle lot (parts, memorabilia and the like): vehicle or non_vehicle_item (CHECK vehicles_listing_kind_check). NOT NULL, default vehicle. Unit: none. Source: extract-bat-core marks non-vehicle BaT lots and never downgrades; the 2026-01-20 migration backfilled from BaT URL slugs; repair_junk_make_vehicles(), normalize_all_makes_batch() and correct_vehicle_sale_provenance_batch(). non_vehicle_item on 33 of 9,780 sampled rows (2026-10-06); market readers skip those rows. Grain: one vehicle (or one non-vehicle lot). Clock: n/a.';
COMMENT ON COLUMN public.vehicles.segment_id IS
'Market segment, FK to vehicle_segments.id. Unit: none (uuid). Source: trigger trigger_auto_classify_vehicle (auto_classify_vehicle) when segment_id is NULL, from a fixed make/model/year rule list (jdm, air-cooled-porsche, muscle-car, truck, off-road, corvette and others); set once, not re-resolved. Read by refresh_segment_stats_cache() and the market segment pages. A different classification from segment_slug. 28.3% filled (2026-10-06 sample); 277 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (at first classification).';
COMMENT ON COLUMN public.vehicles.canonical_make_id IS
'Make as FK to canonical_makes.id. Unit: none (uuid). Source: trigger trigger_auto_classify_vehicle when NULL (match on canonical_name, display_name or aliases), repair_junk_make_vehicles(); set once, so a later make change does not re-resolve it. Read by price and market readers (clean_vehicle_prices, market_pulse_live, compute_market_trend_aggregates). 91.1% filled (2026-10-06 sample); 575 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: derived (at first classification).';
COMMENT ON COLUMN public.vehicles.source_listing_category IS
'Category the source filed the listing under: BaT category names on BaT rows (Convertibles, Truck & 4x4, Race Cars, Electric Vehicles, Station Wagons) and Facebook vehicle types (boat, motorcycle, other), 2026-10-06 sample. Unit: none. Source: the BaT writer of early 2026 is not in origin/main (rows created 2026-01-23 .. 2026-03-19); scripts/enrich-fb-batch.mjs and enrich-fb-ollama.mjs for Facebook rows. Added 2026-01-20 with listing_kind. 0.9% filled. Grain: one vehicle. Clock: n/a.';

-- ── Listing narrative sections ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.dougs_take IS
'Cars and Bids "Doug''s Take" commentary text as published. Unit: none. Source: scripts/extract-cab-vehicles-playwright.mjs; extract-cars-and-bids-core keeps it inside import_metadata instead. 2 of 9,780 sampled rows (2026-10-06), created 2026-01-25. Grain: one vehicle. Clock: n/a (as published).';
COMMENT ON COLUMN public.vehicles.highlights IS
'Listing highlights section text as published. Unit: none. Source: listing loaders of December 2025 to February 2026 on BaT and Mecum rows (rows created 2025-12-11 .. 2026-02-26); the writer that filled the sampled rows is not established (code naming it includes scripts/mecum-proper-extract.js, scripts/deep-resolve-vehicle.mjs and the bulk extraction scripts). extract-cars-and-bids-core and extract-gaa-classics keep highlights inside import_metadata and origin_metadata. 3.4% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a (as published).';
COMMENT ON COLUMN public.vehicles.equipment IS
'Listing equipment section text as published (factory and aftermarket equipment). Unit: none. Source: listing loaders of December 2025 to February 2026 (rows created 2025-12-11 .. 2026-02-26); the writer that filled the sampled rows is not established (code naming it includes scripts/mecum-proper-extract.js, scripts/deep-resolve-vehicle.mjs, scripts/overnight-enrichment.mjs). extract-cars-and-bids-core keeps it inside import_metadata. 3.3% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a (as published).';
COMMENT ON COLUMN public.vehicles.modifications IS
'Listing modifications section text as published, or extracted from a description. Unit: none. Source: rows created 2025-12-11 .. 2026-02-12; the writer that filled the sampled rows is not established (code naming it includes scripts/extract-descriptions.mjs, scripts/deep-resolve-vehicle.mjs, scripts/overnight-enrichment.mjs, synthesize_profile_from_vision()). The owner-entered twin is modification_details. 2.1% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.known_flaws IS
'Disclosed flaws section text, from a listing or extracted from a description. Unit: none. Source: rows created 2025-12-11 .. 2026-02-12; the writer that filled the sampled rows is not established (code naming it includes scripts/deep-resolve-vehicle.mjs, scripts/overnight-enrichment.mjs, synthesize_profile_from_vision()). Read by compute_auction_readiness() and persist_realization_plan(). 1.6% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.recent_service_history IS
'Recent service history section text from a listing. Unit: none. Source: rows created 2025-12-11 .. 2026-02-12; no writer of this column found in origin/main (extract-cars-and-bids-core keeps it inside import_metadata). Read by calculate-vehicle-scores (provenance credit), mcp-connector and generate-listing-package. 1.7% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.title_status IS
'Title brand as published, not normalized: clean in any case or state-qualified (Clean (CA)) on 674 of 692 sampled values; bill of sale, exempt, registered, salvage, rebuilt, bonded and others on the rest (2026-10-06 sample). Unit: none. Source: extract-cars-and-bids-core, process-cl-queue, refine-fb-listing, ingest, acquire-vehicle and description extraction scripts. calculate-vehicle-scores credits only the exact value clean. 7.1% filled; 127 of 600 rows created in the last 30 days. Grain: one vehicle. Clock: n/a (as published).';
COMMENT ON COLUMN public.vehicles.comment_count IS
'Comment count on the listing as a BaT parser read it; BaT counts are also in bat_comments. Unit: count. Source: parse_bat_snapshots_bulk(), drain_bat_queue_from_snapshots(), drain_bat_queue_from_metadata() (each keeps the larger count) and sync_bat_live_auction_status(); no pg_cron job calls them (2026-10-06), and extract-bat-core keeps its count in vehicle_events.metadata. Equals bat_comments on 515 of the 1,325 sampled rows that have it. 13.5% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-04-14. Grain: one vehicle. Clock: n/a (as of an unrecorded read).';
COMMENT ON COLUMN public.vehicles.rennlist_url IS
'Rennlist marketplace listing URL. Retired: written by extract-rennlist, added 2026-02-01 (97d54d608) and deleted 2026-03-29 (bcfe94c81). Unit: none (URL). 2 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.rennlist_listing_id IS
'Rennlist listing id. Retired: written by extract-rennlist, added 2026-02-01 and deleted 2026-03-29 (bcfe94c81). Unit: none. 2 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.documents_on_hand IS
'Documents available for the vehicle as JSON; no writer fixes its shape. Unit: none. Source: none: no writer in the repo; read by mcp-connector and generate-listing-package; first named in code 2026-03-20. Default {}; empty on every sampled row (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.price_is_outlier IS
'Whether the price was judged an outlier; clean_vehicle_prices and the 2026-09-27 sale-rule feed readers skip true rows. Unit: boolean. Source: added 2026-02-06; the job that set the statistical flags (price_outlier_reason iqr and iqr_<MAKE>) is not in origin/main. Default false; true on 179 of 9,780 sampled rows (2026-10-06), created 2025-12-30 .. 2026-02-06. Grain: one vehicle. Clock: derived (as of the flagging run).';
COMMENT ON COLUMN public.vehicles.price_outlier_reason IS
'Why a price was flagged or cleaned: financing_artifact_cleanup_20260616 (an asking price under 1,000, or under 3,000 on a 2015 or newer vehicle, nulled by the 2026-06-16 cleanup and clean_price_contamination_batch(), which do not set price_is_outlier), iqr and iqr_<MAKE> (statistical outlier flags of early 2026). Unit: none. 3.2% filled (2026-10-06 sample). Grain: one vehicle. Clock: n/a.';

-- ── Performance specs (model-level reference values) ────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.zero_to_sixty IS
'Factory 0-60 mph time. Model-level reference value, not measured on this vehicle. Unit: seconds (CHECK chk_zero_to_sixty: above 0, below 60). Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15, stamped in origin_metadata.factory_specs_*). Read by calculate-vehicle-scores (perf_acceleration_score). 3.4% filled (2026-10-06 sample), 2.3 .. 12.3. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.quarter_mile IS
'Factory quarter-mile elapsed time. Model-level reference value. Unit: seconds. Source: enrich-factory-specs only (LLM recall, 2026-02-15, fills NULLs). 9 of 9,780 sampled rows (2026-10-06), 13.4 .. 16.8. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.quarter_mile_speed IS
'Quarter-mile trap speed. Unit: mph by name. Source: none; read by calculate-vehicle-scores and the vehicle performance card. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.top_speed_mph IS
'Factory top speed. Model-level reference value. Unit: mph (CHECK chk_top_speed: above 0, below 400). Source (each fills only when NULL): scripts/derive-specs-from-ymm.py (median of the same year/make/model), enrich-factory-specs (LLM recall, 2026-02-15). 4.5% filled (2026-10-06 sample), 59 .. 211. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.braking_60_0_ft IS
'Factory 60-0 mph braking distance. Model-level reference value. Unit: feet. Source: enrich-factory-specs only (LLM recall, 2026-02-15). Read by calculate-vehicle-scores (perf_braking_score). 2 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.lateral_g IS
'Factory skidpad lateral acceleration. Model-level reference value. Unit: g. Source: enrich-factory-specs only (LLM recall, 2026-02-15). Read by calculate-vehicle-scores (perf_handling_score). 2 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.redline_rpm IS
'Factory engine redline. Model-level reference value. Unit: rpm. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 41 of 9,780 sampled rows (2026-10-06), 5,000 .. 9,000. Grain: one vehicle. Clock: n/a.';

-- ── Chassis specs and condition inputs ──────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.suspension_front IS
'Factory front suspension design (MacPherson strut, Double wishbone, Independent coil spring most common). Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15); scripts/schema-guided-extract.mjs reads descriptions. Read by calculate-vehicle-scores. 9.3% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.suspension_rear IS
'Factory rear suspension design. Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model; triggers off, no per-row stamp), enrich-factory-specs (LLM recall, 2026-02-15); scripts/schema-guided-extract.mjs reads descriptions. Read by calculate-vehicle-scores. 9.4% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.brake_type_front IS
'Factory front brake type (Ventilated disc, Disc, Drum most common). Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model), enrich-factory-specs (LLM recall, 2026-02-15). Read by calculate-vehicle-scores. 9.0% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.brake_type_rear IS
'Factory rear brake type. Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model), enrich-factory-specs (LLM recall, 2026-02-15). Read by calculate-vehicle-scores. 9.3% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.wheel_diameter_front IS
'Front wheel diameter. Unit: inches by name (integer). Source: none; read by calculate-vehicle-scores and the vehicle performance card. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.wheel_diameter_rear IS
'Rear wheel diameter. Unit: inches by name (integer). Source: none; read by calculate-vehicle-scores and the vehicle performance card. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.tire_spec_front IS
'Factory front tire size (for example 225/45R17). Model-level reference value. Unit: none. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 35 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.tire_spec_rear IS
'Factory rear tire size. Model-level reference value. Unit: none. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 35 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.tire_condition_score IS
'Tire condition, 0-100 (the scale calculate-vehicle-scores assumes; no CHECK). Unit: score. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.brake_condition_score IS
'Brake condition, 0-100 (the scale calculate-vehicle-scores assumes; no CHECK). Unit: score. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.suspension_condition_score IS
'Suspension condition, 0-100 (the scale calculate-vehicle-scores assumes; no CHECK). Unit: score. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.perf_comfort_score IS
'Comfort and livability score, 0-100. Do not write directly. Unit: score. Source: calculate-vehicle-scores (pipeline_registry owner), from the daily-driver flag, power steering and other inputs. 1 of 9,780 sampled rows (2026-10-06); ANALYZE statistics about 0.04%. Grain: one vehicle. Clock: derived (as of perf_scores_updated_at).';
COMMENT ON COLUMN public.vehicles.perf_scores_updated_at IS
'When calculate-vehicle-scores last scored the row; its batch mode selects rows where this is NULL. Unit: timestamptz (UTC). Source: calculate-vehicle-scores. 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (scoring run time).';
COMMENT ON COLUMN public.vehicles.social_positioning_breakdown IS
'Per-audience appeal scores behind social_positioning_score as JSON: enthusiast_appeal, luxury_collector, investment_grade, weekend_cruiser, show_circuit, youth_appeal, heritage_prestige, overall. Unit: none (0-100 scores inside). Source: calculate-vehicle-scores. 1 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: derived (as of perf_scores_updated_at).';
COMMENT ON COLUMN public.vehicles.leakdown_test_pct IS
'Per-cylinder leakdown test results as JSON by name (sibling of compression_test_psi); no writer fixes the shape. Unit: percent leakage by name. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';

-- ── Engine and driveline specs ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.timing_type IS
'Unknown meaning (the name could mean valve-timing drive or ignition timing). UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.intake_type IS
'Factory induction system (Multi-port fuel injection, Carburetor, Single carburetor most common). Model-level reference value. Unit: none. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 65 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.distributor_type IS
'Ignition distributor type by name. UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.exhaust_type IS
'Factory exhaust layout (Dual exhaust, Single exhaust). Model-level reference value. Unit: none. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 45 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.exhaust_diameter IS
'Exhaust pipe diameter by name, stored as text with no declared unit. UNUSED: no writer and no reader outside the generated web types. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.manifold_type IS
'Unknown meaning (whether intake or exhaust manifold is not stated). UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.oil_type IS
'Recommended engine oil type by name. UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.coolant_type IS
'Engine coolant type by name. UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.rear_axle_ratio IS
'Factory final-drive ratio (for example 3.73). Model-level reference value. Unit: ratio. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 30 of 9,780 sampled rows (2026-10-06), 2.73 .. 4.30. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.rear_axle_type IS
'Factory rear axle design (Live axle, Independent, Semi-trailing arm and others). Model-level reference value. Unit: none. Source: enrich-factory-specs only (LLM recall, 2026-02-15). 75 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transfer_case IS
'Transfer case model or type on 4WD and AWD vehicles (for example Dana 20). Model-level reference value. Unit: none. Source: enrich-factory-specs (LLM recall, 2026-02-15). 3 of 9,780 sampled rows (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.clutch_type IS
'Clutch type by name. UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.driveshaft_type IS
'Driveshaft type by name. UNUSED: no writer and no reader outside the generated web types. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.transmission_speeds IS
'Number of forward gears. Unit: count. Source: scripts/derive-specs-from-ymm.py (median of the same year/make/model) and batch-vin-decode name it; read by the admin field-fill functions (admin_qi_field_fill). Empty in the 2026-10-06 sample and in ANALYZE statistics. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.steering_type IS
'Factory steering system (Rack and pinion, power-assisted; Recirculating ball; Rack and pinion most common). Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model), enrich-factory-specs (LLM recall, 2026-02-15). Read by calculate-vehicle-scores (power steering credit). 8.9% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.steering_pump IS
'Power steering pump type by name; calculate-vehicle-scores treats text containing power as power steering. Unit: none. Source: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.steering_condition_score IS
'Steering condition, 0-100 (CHECK chk_steering_cond). Unit: score. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.frame_type IS
'Body construction (Body-on-frame, Unibody, Space frame, Monocoque most common). Model-level reference value. Unit: none. Source (each fills only when NULL): scripts/derive-specs-from-ymm.py and derive-specs-text-fields.py (mode of the same year/make/model), enrich-factory-specs (LLM recall, 2026-02-15). 10.3% filled (2026-10-06 sample); rows carrying it were created 2025-12-11 .. 2026-02-13. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.brake_booster_type IS
'Brake booster type by name; calculate-vehicle-scores credits text containing hydroboost. Unit: none. Source: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.front_rotor_size IS
'Front brake rotor size by name, stored as text with no declared unit. UNUSED: no writer and no reader outside the generated web types. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.rear_rotor_size IS
'Rear brake rotor size by name, stored as text with no declared unit. UNUSED: no writer and no reader outside the generated web types. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.abs_equipped IS
'Whether the vehicle has anti-lock brakes per its factory spec. Model-level reference value. Unit: boolean. Source: enrich-factory-specs (LLM recall, 2026-02-15); read by calculate-vehicle-scores. NULL means not recalled: set on 91 of 9,780 sampled rows, 39 of them true (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.drag_coefficient IS
'Aerodynamic drag coefficient (Cd). Unit: ratio. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.frontal_area_sqft IS
'Frontal area. Unit: square feet. UNUSED: no writer and no reader outside the generated web types. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.ground_clearance_inches IS
'Ground clearance. Unit: inches. UNUSED on vehicles: no writer (the dealer and OEM spec tables carry their own ground clearance). Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.ride_height_inches IS
'Ride height. Unit: inches. UNUSED: no writer and no reader outside the generated web types. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.has_spoiler IS
'Whether the vehicle has a spoiler. Unit: boolean. Source: none; read by calculate-vehicle-scores (aero credit). NULL on every sampled row (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.has_air_dam IS
'Whether the vehicle has a front air dam. Unit: boolean. Source: none; read by calculate-vehicle-scores (aero credit). NULL on every sampled row (2026-10-06). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.lift_inches IS
'Suspension lift height. Unit: inches. Source: none; read by calculate-vehicle-scores. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.last_inspection_date IS
'Unknown meaning beyond the name (which inspection is not defined). UNUSED: no writer and no reader outside the generated web types. Unit: date. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: event (inspection date, by name).';
COMMENT ON COLUMN public.vehicles.inspection_type IS
'Unknown meaning beyond the name (inspection kinds are not defined). UNUSED: no writer on vehicles; the inspection_type columns in migrations belong to other tables. Unit: none. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.inspection_passed IS
'Unknown meaning beyond the name (which inspection is not defined). UNUSED: no writer and no reader outside the generated web types. Unit: boolean. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicles.smog_exempt IS
'Whether the vehicle is exempt from smog (emissions) inspection, by name. UNUSED: no writer and no reader outside the generated web types. Unit: boolean. Empty in the 2026-10-06 sample. Grain: one vehicle. Clock: n/a.';

-- ── Segment, color family, photos ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.segment_slug IS
'Market segment slug, FK to vehicle_segments.slug, from a classification separate from segment_id: muscle-cars, german-engineering, sports-cars, convertibles, off-road-trucks, luxury-gt, vintage-prewar, british-classics most common (2026-10-06 sample). Unit: none. Source: scripts/backfill-segments.sql and scripts/backfill-vehicle-segments.ts; no trigger keeps it current. Read by the treemap views and get_ranked_offers(). 29.1% filled; rows carrying it were created 2025-12-11 .. 2026-02-12. Grain: one vehicle. Clock: derived (as of the backfill).';
COMMENT ON COLUMN public.vehicles.color_family IS
'Color family of color: Red, Black, White, Silver/Gray, Blue, Green, Multi/Two-Tone, Yellow most common (2026-10-06 sample). Unit: none. Source: scripts/normalize-colors.py (OEM paint-name mapping with keyword fallback; in the repo since 2026-02-15) and project_vehicle_color() (from projection_event color claims; called by project_vehicle_canonical()); no trigger keeps it current. 21.4% filled; rows carrying it were created 2025-11-02 .. 2026-03-21. Grain: one vehicle. Clock: derived (as of the last projection or normalization).';
COMMENT ON COLUMN public.vehicles.has_photos IS
'Whether any vehicle_images row points at the vehicle, duplicates and superseded images included (image_count excludes them). Unit: boolean. Source: triggers trg_maintain_has_photos_insert, trg_maintain_has_photos_update and trg_maintain_has_photos_delete on vehicle_images (maintain_vehicle_has_photos). Default false; true on 52.7% of sampled rows (2026-10-06). 208 sampled rows have image_count above 0 with has_photos false, so the two drift. Read by feed-query and the feed refresh. Grain: one vehicle. Clock: derived (as of the last image write).';

-- ── Corrected existing comment ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicles.era IS
'Era bucket computed from year: pre-war (before 1946), post-war (before 1960), classic (before 1973), malaise (before 1985), modern-classic (before 2000), modern (before 2015), contemporary; CHECK vehicles_era_check allows only these seven. Source: trigger trigger_auto_classify_vehicle (auto_classify_vehicle) when era is NULL; set once, so a later year change does not recompute it. Unit: none. Grain: one vehicle. Clock: derived (at first classification).';

-- A column added between this PR and its deploy must not block the deploy: report, never raise.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicles'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicles: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicles columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
