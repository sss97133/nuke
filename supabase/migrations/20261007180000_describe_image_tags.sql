-- Describe image_tags: the 59 columns with no COMMENT ON COLUMN (17 of 76 described before, catalog count on prod,
-- 2026-10-07 08:31Z) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-07 08:31-08:36Z UTC):
--   Columns, defaults, constraints, indexes and triggers from information_schema, pg_constraint, pg_indexes and
--   pg_trigger; fill per column counted on the whole table (3,263 rows); value shapes from pg_stats. Trigger bodies
--   (enrich_image_tag, recompute_value_from_tags, update_timeline_tags_trigger, update_tag_verification_timestamp) read
--   from pg_proc.
--   Writer of every live row: the edge function analyze-image, deleted from the repo on 2026-03-07 (commit 43b72deae);
--   read at 43b72deae^:supabase/functions/analyze-image/index.ts, functions generateTagsFromAppraiser() and
--   insertAutomatedTags(). It upserted one row per tag derived from its vision "appraiser" result, keyed on the unique
--   index (image_url, tag_name, x_position, y_position), with created_by = the all-zero uuid and no source_type.
--   Writers still on main that insert user tags: nuke_frontend/src/services/tagService.ts and
--   nuke_frontend/src/components/image/EnhancedImageTagger.tsx; neither has a row on prod.
--   Readers on main: supabase/functions/universal-search, generate-vehicle-description, calculate-profile-completeness,
--   extract-bat-parts-brands (reads tags by vehicle and tag_name; its link table image_tag_bat_references does not exist
--   on prod), and the frontend taggers and ProImageViewer.
-- Rows (2026-10-07 08:31Z): 3,263 rows on 22 vehicles and 461 image URLs (3,254 on Nuke storage, 9 on bringatrailer.com),
--   created 2026-02-25 12:18Z .. 2026-02-28 19:43Z; nothing written or updated since. By derivation field: visible_component
--   1,147, secondary_subject 838, subject 463, category 461, condition_notes 346, visible_damage 8.
-- LIMITS:
--   Whether each image_url still resolves to a vehicle_images row is Unknown: the join on image_url exceeded the 55 s read
--   bound twice. Columns that no writer on main sets and that are empty on every row are described from their creating
--   migration; their intended meaning is the migration's, not an observed use.
--   CHECKs in the repo that are not on prod (2026-10-07): condition and install_difficulty (20251025000001) and the
--   0..100 range on x_position / y_position (20251011). The prod column types also differ from the repo's CREATE TABLE in
--   20251011_code_db_sync_fixes.sql, which is a no-op on prod (IF NOT EXISTS).
-- CHANGED EXISTING COMMENTS:
--   Table comment: it said "Stores both AI-generated and human-created image tags with full validation tracking for
--   training data". Every live row is machine-generated, none is validated, and every row carries source_type 'manual'
--   because the writer did not set it and the default and trigger enrich_image_tag fill 'manual'. It now says so.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_tags IS
'Labels placed on a vehicle image: a tag name and type, a box on the image, and validation and commerce fields that were never used. 3,263 rows (2026-10-07), all written 2026-02-25 .. 2026-02-28 by the deleted edge function analyze-image, which turned its vision appraiser result (category, subject, secondary subjects, visible components, condition notes) into tags; idle since. Every live row is machine output: created_by is the all-zero uuid, ai_detection_data names the appraiser field it came from, and source_type reads ''manual'' only because the writer did not set it (default and trigger enrich_image_tag). None is verified. The frontend taggers (tagService.ts, EnhancedImageTagger.tsx) can insert human tags; none exists. Grain: one tag per (image_url, tag_name, x_position, y_position) (unique index). Clock: created_at and inserted_at are write time; there is no observation time of the image.';

-- ── Identity and subject ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.id IS
'Surrogate key of the tag. Unit: none (uuid). Source: gen_random_uuid() default. Referenced in code by parent_tag_id (no foreign key) and by the absent table image_tag_bat_references. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.vehicle_id IS
'Vehicle the tagged image belongs to. Unit: none (uuid, foreign key to vehicles, ON DELETE CASCADE). Source: the caller of analyze-image passed it; enrich_image_tag fills it from vehicle_images when image_id is set. Filled on all 3,263 rows, 22 distinct vehicles (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.image_url IS
'URL of the tagged image; the image key the live rows use instead of image_id. Unit: none (URL). Source: the image_url analyze-image was called with; enrich_image_tag copies vehicle_images.image_url when only image_id is given. Filled on all 3,263 rows: 461 distinct URLs, 3,254 rows on Nuke storage and 9 on bringatrailer.com (2026-10-07). Part of the unique index (image_url, tag_name, x_position, y_position). Whether each URL still matches a vehicle_images row: Unknown (join too slow to read). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.timeline_event_id IS
'Timeline event the tagged image belongs to. Unit: none (uuid, foreign key to timeline_events, ON DELETE CASCADE). Source: optional argument of analyze-image and the frontend taggers; trigger update_timeline_tags_trigger copies the event''s distinct tag names into timeline_events.manual_tags. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';

-- ── The tag ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.tag_name IS
'The label text. Unit: none (free text). Source: analyze-image derived it from the appraiser result: the category capitalised (Exterior, Engine, Document ...), the most specific segment of a dotted subject path (door from exterior.panel.door.front.driver), a visible component, or a damage keyword from the condition notes (Rust, Wear, Dent ...). 149 distinct values in the pg_stats sample; most common Wear 151, Bay 144, Exterior 137 (2026-10-07). An inference by a vision model about the image, not an observation of the vehicle. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.tag_type IS
'Kind of label. Unit: enumerated text, no CHECK on prod. Source: analyze-image sets part (subject, secondary subject, visible component), custom (category) or issue (damage keyword); the frontend type also allows tool, brand and process. Live values: part 2,448, custom 461, issue 354 (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.text IS
'Legacy label text; EnhancedImageTagger reads tag_name and falls back to text. Unit: none (text). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.confidence IS
'Confidence the writer assigned to the label. Unit: integer percent, 0..100 (universal-search divides by 100). Source: analyze-image uses a fixed value per derivation field, not a model score: category 90, subject 85, condition_notes 80, visible_component 75, secondary_subject 70, visible_damage 70; default 100 and enrich_image_tag sets 100 when null. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.automated_confidence IS
'Model confidence for an AI tag, shown by EnhancedImageTagger as "AI: n%". Unit: percent (double precision). Source: no writer on main sets it. Filled on 0 of 3,263 rows (2026-10-07); a partial index covers the non-null rows. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.trust_score IS
'Trust weight of the tag. Unit: integer, scale Unknown (no writer documents it). Source: default 10, and enrich_image_tag sets 10 when null; every live row is 10 (2026-10-07). No writer on main sets another value. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.metadata IS
'Free-form extra data for the tag. Unit: jsonb object. Source: default {}; no writer on main fills it. Empty on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';

-- ── Box on the image ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.x_position IS
'Left edge of the tag box. Unit: percent of the image width, 0..100 (EnhancedImageTagger renders it as CSS left %; tagService stores round(fraction * 100)); no range CHECK on prod. Source: the tagger click; analyze-image wrote a fixed 50 on every row, a placeholder with no location meaning. Part of the unique index. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.y_position IS
'Top edge of the tag box. Unit: percent of the image height, 0..100 (rendered as CSS top %); no range CHECK on prod. Source: the tagger click; analyze-image wrote a fixed 50 on every row, a placeholder. Part of the unique index. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.width IS
'Width of the tag box. Unit: percent of the image width (rendered as CSS width %). Source: the tagger; analyze-image wrote a fixed 20 on every row, a placeholder. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.height IS
'Height of the tag box. Unit: percent of the image height (rendered as CSS height %). Source: the tagger; analyze-image wrote a fixed 20 on every row, a placeholder. Grain: one tag. Clock: n/a.';

-- ── Who and when ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.created_by IS
'Who created the tag. Unit: text holding a uuid (varchar, no foreign key). Source: tagService writes the signed-in user id; analyze-image wrote the all-zero uuid, its marker for a machine-written row, on all 3,263 rows (2026-10-07). recompute_value_from_tags uses it as the actor. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.created_at IS
'When the row was written. Unit: timestamptz. Source: now() default. 2026-02-25 12:18Z .. 2026-02-28 19:43Z on the live rows (2026-10-07). Grain: one tag. Clock: database write time; not when the image was taken.';
COMMENT ON COLUMN public.image_tags.inserted_at IS
'When the row was written, as a second clock beside created_at. Unit: timestamp without time zone, in UTC, whole seconds. Source: now() default, and enrich_image_tag sets now() when null; within 0.5 s of created_at on every row (2026-10-07). EnhancedImageTagger orders by it. Grain: one tag. Clock: database write time.';
COMMENT ON COLUMN public.image_tags.updated_at IS
'When the row was last written. Unit: timestamp without time zone, in UTC. Source: enrich_image_tag sets now() on every insert and update. Latest value 2026-02-28 19:43Z (2026-10-07). Grain: one tag. Clock: database write time.';
COMMENT ON COLUMN public.image_tags.exif_data IS
'EXIF block of the tagged image, copied for the tag. Unit: jsonb object. Source: enrich_image_tag copies vehicle_images.exif_data when image_id is set and this is empty. Empty on all 3,263 rows, because none has image_id (2026-10-07). Grain: one tag. Clock: n/a (the EXIF capture time inside it is the image''s clock).';
COMMENT ON COLUMN public.image_tags.gps_coordinates IS
'Location of the tagged image, copied for the tag. Unit: jsonb {latitude, longitude} in decimal degrees. Source: enrich_image_tag copies vehicle_images.latitude and longitude when image_id is set and this is empty. Empty on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';

-- ── Verification ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.verification_status IS
'Older review state of the tag, beside validation_status. Unit: text, no CHECK on prod. Source: default pending; no writer on main sets another value. pending on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.verified_by IS
'Who verified the tag. Unit: text (varchar, no foreign key). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.verified_at IS
'When the tag was verified. Unit: timestamp without time zone. Source: trigger update_tag_verification_timestamp sets now() when verified turns from false to true. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: database write time of the verification.';
COMMENT ON COLUMN public.image_tags.needs_human_verification IS
'Flag that the tag waits for a person to confirm it. Unit: boolean, default false. Source: no writer on main sets true. false on all 3,263 rows, though every row is machine output (2026-10-07). Grain: one tag. Clock: n/a.';

-- ── Service and work fields (never used) ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_tags.product_id IS
'Product the tag points at. Unit: none (uuid, no foreign key). Source: Unknown; no writer or creating migration on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.product_relation IS
'How the tagged item relates to product_id. Unit: text; allowed values Unknown. Source: Unknown; no writer or creating migration on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.service_id IS
'Service the tag points at. Unit: none (uuid, no foreign key). Source: Unknown; no writer or creating migration on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.service_status IS
'Status of that service. Unit: text; allowed values Unknown. Source: Unknown; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.technician_id IS
'Technician who did the tagged work. Unit: none (uuid, foreign key to technicians). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.shop_id IS
'Shop that did the tagged work. Unit: none (uuid, foreign key to shops_archived_20260129, the archived shops table). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.service_date IS
'Date of the tagged service. Unit: timestamp without time zone. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: would be the event time of the service; never set.';
COMMENT ON COLUMN public.image_tags.service_cost_cents IS
'Cost of the tagged service. Unit: integer cents; currency not recorded. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.service_warranty_expires IS
'When the service warranty ends. Unit: timestamp without time zone. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: a future date claimed by the warranty; never set.';
COMMENT ON COLUMN public.image_tags.condition_before IS
'Condition of the tagged item before the work. Unit: text; allowed values Unknown. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.condition_after IS
'Condition of the tagged item after the work. Unit: text; allowed values Unknown. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.severity_level IS
'Severity of a tagged issue. Unit: text; allowed values Unknown. Source: no writer on main; analyze-image issue tags did not set it. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.estimated_cost_cents IS
'Estimated cost to address the tagged item. Unit: integer cents; currency not recorded. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.insurance_claim_number IS
'Insurance claim the tagged damage belongs to. Unit: none (identifier text). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.work_order_number IS
'Work order the tagged work belongs to, as text (no key to work_orders). Unit: none (identifier text). Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.work_started_at IS
'When the tagged work started. Unit: timestamp without time zone. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: would be event time; never set.';
COMMENT ON COLUMN public.image_tags.work_completed_at IS
'When the tagged work finished. Unit: timestamp without time zone. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: would be event time; never set.';
COMMENT ON COLUMN public.image_tags.estimated_completion IS
'When the tagged work was expected to finish. Unit: timestamp without time zone. Source: no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: a forecast date; never set.';

-- ── Parts marketplace fields (20251025000001_parts_marketplace.sql; never used) ──────────────────────────────────

COMMENT ON COLUMN public.image_tags.oem_part_number IS
'OEM part number of the tagged part. Unit: none (part number text). Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07); a partial index covers non-null rows. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.aftermarket_part_numbers IS
'Aftermarket part numbers for the tagged part. Unit: text[]. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.part_description IS
'Description of the tagged part. Unit: none (text). Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.fits_vehicles IS
'Vehicles the tagged part fits. Unit: text[]; element format Unknown. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.suppliers IS
'Suppliers offering the tagged part. Unit: jsonb array; element shape Unknown. Source: added by 20251025000001_parts_marketplace.sql, default []; no writer on main. Empty on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.lowest_price_cents IS
'Lowest supplier price seen for the tagged part. Unit: integer cents; currency not recorded. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: as of price_last_updated.';
COMMENT ON COLUMN public.image_tags.highest_price_cents IS
'Highest supplier price seen for the tagged part. Unit: integer cents; currency not recorded. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: as of price_last_updated.';
COMMENT ON COLUMN public.image_tags.price_last_updated IS
'When the part prices were last read. Unit: timestamptz. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: observation time of the prices.';
COMMENT ON COLUMN public.image_tags.is_shoppable IS
'Whether the tagged part can be bought through the marketplace. Unit: boolean, default false. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. false on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.affiliate_links IS
'Affiliate purchase links for the tagged part. Unit: jsonb array; element shape Unknown. Source: added by 20251025000001_parts_marketplace.sql, default []; no writer on main. Empty on all 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.condition IS
'Condition of the tagged part as sold. Unit: text; the creating migration lists new, used, remanufactured, unknown, but that CHECK is not on prod (2026-10-07). Source: 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.warranty_info IS
'Warranty terms of the tagged part. Unit: none (text). Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.install_difficulty IS
'How hard the tagged part is to install. Unit: text; the creating migration lists easy, moderate, hard, expert, but that CHECK is not on prod (2026-10-07). Source: 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows. Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.estimated_install_time_minutes IS
'Estimated time to install the tagged part. Unit: integer minutes. Source: added by 20251025000001_parts_marketplace.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.part_type IS
'Provenance class of the tagged part. Unit: text, CHECK OEM, OES, NOS, Aftermarket or Generic. Source: added by 20251229000001_tier_system_missing_infrastructure.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';
COMMENT ON COLUMN public.image_tags.labor_record_id IS
'Labor record for installing the tagged part. Unit: none (uuid, no foreign key; target table Unknown). Source: added by 20251101000010_valuation_citation_system.sql; no writer on main. Filled on 0 of 3,263 rows (2026-10-07). Grain: one tag. Clock: n/a.';

COMMIT;
