-- Describe component_identifications: all 27 columns, none had a COMMENT ON COLUMN (0 of 27 described before, catalog
-- count on prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 37,605 rows on 2026-10-07 13:50Z by exact count (the
-- atlas estimate of 36,378 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row
-- is from 2026-08-02 00:28Z.
--
-- METHOD (read 2026-10-07 13:50-13:58Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description. Fill, status, component_type,
--   inference_method, confidence and creation-day counts, label lengths, bounding_box and source_references key sets,
--   scene_type and match_basis counts, the joins to image_analysis_records (record existence, tier, model, superseded
--   state, verdict time), to vehicle_images (image existence and its current vehicle_id), to vehicles (existence, owner
--   count, is_public), to receipt_items (cited items) and to vehicle_observations (cited observations) are exact counts
--   over the whole table (20 MB heap, read only); the image lookups ran as correlated primary-key probes because a hash
--   join over vehicle_images exceeded the 10 s timeout. What anon can read comes from a count under SET LOCAL ROLE anon
--   in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 86cf46e40 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history with -S): the creating migration
--   20251202_component_knowledge_base.sql (table, six indexes, the two policies); 20251202_intelligent_research_system.sql
--   (generate_repair_estimate and a repair_cost_estimates table that would have referenced this one);
--   20260702061000_get_image_component_targets.sql (the reader function); the writer scripts/deep-image-analysis-byok.mjs
--   (landEntityPage, componentFamily, bumpConfidence, dayContextBump; commit 1aa8e5f43, 2026-07-02; invoked by its
--   entities and ingest commands, the second driven by scripts/daily-receipt/byok-image-batch.sh); the former writer
--   supabase/functions/analyze-image-tier2 (commit c0c2c0371, 2025-12-02; archived by 43b72deae and deleted by
--   9ab2fd4b7, 2026-03-07; not in the deployed function list read through the management API, 328 functions,
--   2026-10-07); the bodies, read with pg_get_functiondef, of the 2 live functions whose body names the table
--   (get_image_component_targets, generate_repair_estimate; neither writes it) and their callers in pg_proc, cron.job and
--   code (none); cron.job (no command names the table, the writer or the reader functions); pg_depend (no view);
--   pg_trigger (no trigger); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added
--   here); supabase_migrations.schema_migrations (only 20260702114850 get_image_component_targets names the table); the
--   laptop launchd job com.nuke.byok-image-analysis (plist present, not loaded, launchctl list, 2026-10-07).
-- LIMITS:
--   How the 17 rows of 2025-12 kept a vehicle and 3 images that are gone, under validated ON DELETE CASCADE keys, is not
--   recorded. Who ran the BYOK entities backfill and ingest on which day is not recorded on the row (the analysis record
--   carries the model and verdict time only). The labels are free text; nothing links two rows that name the same physical
--   part. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The rows describe build
--   photos of the vehicle owners and cite receipt items of their purchases: quoted values are status, family, method and scene
--   codes, model names, key names, column and function names and counts only; no label, part number, citation, receipt
--   description, vehicle id or image id.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Per-image component identifications with confidence and sourcing". That stays as the
--   opening; the new comment adds the grain, the two writers and when each ran, the superseded records, the readers, the
--   access (anon read of 37,576 rows; the authenticated INSERT policy WITH CHECK true) and the clocks. There were no
--   column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.component_identifications IS
'Per-image component identifications with confidence and sourcing: one row per component a vision pass named in one photo (grain: one component label in one image, under one image_analysis_records row; labels are free text, so the same physical part seen in many frames has many rows and nothing links them). 37,605 rows on 2026-10-07 (the atlas estimate of 36,378 is a stale reltuples) for 9,394 images of 72 vehicle ids under 9,556 analysis records. Two writers, neither running: (1) 17 rows on 2025-12-02 from the edge function analyze-image-tier2 (model gpt-4o; deleted from the repo 2026-03-07 by commit 9ab2fd4b7 and not deployed), the only rows that fill brand, inference_basis, blocking_gaps, visible_features and condition_notes; their vehicle and their 3 images no longer exist although every foreign key here is validated with ON DELETE CASCADE, and how the cascade was skipped is not recorded. (2) 37,588 rows 2026-07-02 .. 2026-08-02 00:28Z from scripts/deep-image-analysis-byok.mjs (landEntityPage, commit 1aa8e5f43, service-role key), which lands the components_seen of the BYOK deep-analysis verdicts kept in vehicle_images.ai_scan_metadata.byok_deep_analysis: 26,949 rows on 2026-07-02 by its entities backfill (verdicts of 2026-05-23 .. 06-26, landed a median of 20 days after the verdict) and 10,639 rows by its ingest command (2026-07-02 .. 08-02, a median of 7 s after the verdict). Each landed frame gets one new tier-2 image_analysis_records row (handoff_notes start with byok_deep_analysis entity landing); a newer verdict lands new rows under a new record and marks the prior record superseded, whose rows stay as history (783 rows on 160 superseded records). Nothing has written since 2026-08-02: the laptop launchd job com.nuke.byok-image-analysis that drove the ingest is not loaded (2026-10-07), and no cron job, trigger, edge function or SQL function writes the table. By status: inferred 37,330, confirmed 261 (257 BYOK rows whose part number matched a part-numbered receipt item of the vehicle, all on one vehicle and 42 receipt items, plus 4 rows of 2025-12 without a receipt), day_context 13, unknown 1. pg_stat_user_tables since the server last started (2026-09-29 09:20Z; read 13:50Z): 0 inserts, updates and deletes, 8 sequential and 9 index scans. Readers: get_image_component_targets(uuid) (SECURITY DEFINER, fixed search_path, EXECUTE granted to anon and authenticated, scoped to images whose vehicle_images.user_id is the caller, current analysis records only; returns the boxes, labels, status and the receipt and parts_catalog evidence of one image; no caller in the repo) and generate_repair_estimate(uuid, uuid) (no EXECUTE for anon or authenticated; it inserts into repair_cost_estimates, which does not exist on prod, so it cannot complete). No view, cron job, frontend page or edge function reads the table. Prod differs from the creating migration 20251202_component_knowledge_base.sql: its six indexes (analysis record, image, vehicle, type, status, unvalidated) are absent, and one index on vehicle_id (idx_component_identifications_vid) that no migration in the repo or in the prod migration log names stands instead. Access: RLS is on. component_ids_read (SELECT, every role) shows a row when its vehicle is public or owned by the caller, so anon reads 37,576 of 37,605 rows (counted under SET LOCAL ROLE anon, 2026-10-07), receipt citations of confirmed rows included. component_ids_create (INSERT, authenticated, WITH CHECK true) lets any signed-in account insert a row for any vehicle, image and analysis record through the REST API; such a row would appear in the owner list that get_image_component_targets returns while its analysis record is current. No UPDATE or DELETE policy; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE (has_table_privilege, 2026-10-07). No pipeline_registry row and no write receipts. Clocks: created_at is the landing time; the judgment time is image_analysis_records.analyzed_at and the photo time vehicle_images.taken_at; updated_at equals created_at on every row (never updated).';

-- ── Keys and links ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.id IS
'Surrogate key of the identification row, uuid, gen_random_uuid() default, the PRIMARY KEY. 37,605 values (2026-10-07). No foreign key points at it on prod (the repair_cost_estimates table of 20251202_intelligent_research_system.sql, which would have, does not exist). get_image_component_targets returns it as target_id; generate_repair_estimate takes it as p_component_id. Unit: none (uuid). Source: column default. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.analysis_record_id IS
'Analysis pass the row belongs to: an image_analysis_records.id, NOT NULL, foreign key ON DELETE CASCADE (validated). 9,556 distinct values (2026-10-07), every one existing, tier 2 (analysis_tier = 2) and carrying the same image_id and vehicle_id as this row: 9,551 BYOK entity-landing records (analyzed_by_model claude-opus-4-8 on 32,454 rows, byok_claude_print on 5,128, the writer fallback when the verdict names no model, claude-fable-5 on 3, claude-sonnet-4-6 on 3) and 5 records of analyze-image-tier2 (gpt-4o, 17 rows). 783 rows on 160 records sit under a record that a newer verdict superseded (superseded_by set); to read the current identification of an image, join on superseded_by IS NULL, as get_image_component_targets does. The judgment time is the analyzed_at of the record. The index on this column from the creating migration is absent on prod. Unit: none (uuid). Source: the writer, which inserts the record first. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.image_id IS
'Photo the component was named in: a vehicle_images.id, NOT NULL, foreign key ON DELETE CASCADE (validated). 9,394 distinct values (2026-10-07), equal to the image_id of the analysis record on every row. 17 rows (all of 2025-12) point at 3 images that are not in vehicle_images, despite the validated cascading key; how they were removed without the cascade is not recorded. The index on this column from the creating migration is absent on prod, so a lookup by image (get_image_component_targets) reads the whole table. Unit: none (uuid). Source: the verdict image_id. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.vehicle_id IS
'Vehicle the image was attributed to when the row landed: a vehicles.id, NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_component_identifications_vid, the only secondary index). 72 distinct values (2026-10-07): 71 live vehicles (70 owned by 2 accounts, 1 with no owner; 70 public) and 1 that is not in vehicles (the 17 rows of 2025-12). 4 vehicles hold 1,000 rows or more (the largest 12,888) and the median vehicle 150. A snapshot, not maintained: for 521 rows the image now sits on another vehicle and for 38 rows on no vehicle (vehicle_images.vehicle_id, 2026-10-07). The read policy keys on this vehicle (public, or owned by the caller). Unit: none (uuid). Source: the verdict vehicle_id, the image attribution at analysis time. Grain: one component label in one image. Clock: as of created_at.';
COMMENT ON COLUMN public.component_identifications.component_definition_id IS
'Intended link to the curated component catalog component_definitions (creating migration: NULL if not in our database yet), uuid, nullable, foreign key without ON DELETE action (validated). NULL on all 37,605 rows (2026-10-07): neither writer resolves a label to a definition, and component_definitions holds 16 rows. Unit: none (uuid). Source: none (never written). Grain: one component label in one image. Clock: n/a.';

-- ── The identification ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.component_type IS
'Component family, text NOT NULL (the creating migration meant a component name such as grille, bumper or wheel). 24 values (2026-10-07). The 37,588 BYOK rows carry one of 14 families that componentFamily in scripts/deep-image-analysis-byok.mjs derives from the label (the first of 13 ordered regular expressions that matches, else unclassified): unclassified 11,105 (29.5% of all rows), body_exterior 7,776, wheel_tire 3,968, electrical 2,401, engine 2,243, suspension_steering 2,039, interior 1,979, transmission_drivetrain 1,882, brake 1,148, fastener_hardware 841, exhaust 622, fuel 560, cooling 537, fluid_consumable 487. The 17 rows of 2025-12 carry part names from the model instead: wheel 3, tire 3, fender_emblem 3, fender_front 2, and bumper, front_bumper, grille, headlights, license_plate and tailgate once each. A form of identification, not a separate observation. get_image_component_targets returns it as family. Unit: none (text code). Source: componentFamily(identification) for BYOK rows; the model for the rows of 2025-12. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.identification IS
'The component as the vision model named it, verbatim (the components_seen label of the BYOK verdict), text, nullable, filled on every row (2026-10-07). 24,417 distinct labels on 37,605 rows (24,378 ignoring case); median 29 characters, longest 118. Free text, keyed to no catalog: one part carries many spellings across frames. get_image_component_targets returns it as label. Unit: none (text). Source: the vision model (gpt-4o for the 17 rows of 2025-12, the BYOK verdict agent for the rest). Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';
COMMENT ON COLUMN public.component_identifications.part_number IS
'Part number of the receipt item the component matched, text, nullable. Filled on 257 rows (0.7%, 2026-10-07), exactly the BYOK confirmed rows: the writer sets it only on a receipt match, to the part number of the matched receipt item (42 distinct, all on one vehicle), never to the model guess, which stays in source_references.part_number_guess; day_context rows leave it NULL because no number was read in their pixels. NULL on every row of 2025-12. get_image_component_targets joins it to parts_catalog.part_number and sets can_order when it is filled and a vendor or catalog row exists. Unit: none (text). Source: receipt_items.part_number of the matched item. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.brand IS
'Brand of the component where the model named one (creating migration: if applicable, aftermarket), text, nullable. Filled on 7 rows (2026-10-07), all of 2025-12 (analyze-image-tier2); the BYOK writer never sets it. Unit: none (text). Source: the gpt-4o answer of analyze-image-tier2. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';

-- ── Epistemic status ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.status IS
'Epistemic status of the identification, text NOT NULL, no CHECK (the creating migration named confirmed, inferred and unknown). 4 values (2026-10-07): inferred 37,330 (99.3%), confirmed 261, day_context 13, unknown 1. BYOK rows (scripts/deep-image-analysis-byok.mjs): confirmed when the component matched a part-numbered receipt item of the vehicle, either because a text region attached to its box transcribes the part number (match basis ocr_text, 47 rows) or because the model part number guess equals it (part_number_guess, 210 rows); 41 of these 257 rows are on receipt_document frames, so they confirm the paper trail, not the part seen in place. day_context (13 rows) when no number matched but a receipt frame of the same day OCR-matched an item whose description shares tokens with the label. inferred otherwise. The 17 rows of 2025-12 carry the status the model returned (confirmed 4, inferred 12, unknown 1), without a receipt. get_image_component_targets lists confirmed rows first. Unit: none (text code). Source: the writer. Grain: one component label in one image. Clock: as of created_at.';
COMMENT ON COLUMN public.component_identifications.confidence IS
'Confidence in the identification, numeric, nullable, CHECK 0 .. 1. Filled on every row (2026-10-07), 37 distinct values, all multiples of 0.01: 0.85 on 7,714 rows, 0.9 on 6,037, 0.8 on 5,525, 0.7 on 4,633, 0.6 on 2,731, the rest from 0.3 to 1. BYOK rows: the confidence the model reported for the label (0.5 when it gave none), raised on a receipt match (ocr_text: at least 0.95; part_number_guess: plus 0.2, at most 0.95) or a day-context match (plus 0.1, at most 0.85), clamped to 0 .. 1 and rounded to 2 decimals (bumpConfidence, dayContextBump). Means: inferred 0.81, confirmed 0.94 (BYOK), day_context 0.85 on all 13. The rows of 2025-12 carry the gpt-4o value. A self-report of the model, not a calibrated probability. Unit: score, 0 .. 1. Source: the vision model, adjusted by the writer. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';

-- ── Sourcing ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.source_references IS
'Provenance of the row, jsonb, nullable, filled on every row (2026-10-07). The creating migration meant an array of document citations (document_id, page, excerpt); the 17 rows of 2025-12 hold an empty array. The 37,588 BYOK rows hold one object with writer (byok_deep_analysis on every one), image_id, observation_id (the vehicle_observations row the ingest command wrote for the verdict: filled on 10,639 rows, every one existing; NULL on the 26,949 rows of the entities backfill), verdict_path (vehicle_images.ai_scan_metadata.byok_deep_analysis, where the full verdict lives), part_number_guess (filled on 833) and scene_type (the scene of the frame: body_exterior 9,537, undercarriage 6,029, body_interior 5,570, shop_context 5,028, engine_bay 3,646, off_property 2,152, fabrication_in_progress 1,777, paint_booth 928, wheel_assembly 701, cross_reference 638, unknown 556, product_screenshot 333, data_plate 293, receipt_document 239 and 10 rarer values); confirmed rows add receipt_item_id (all 257 exist in receipt_items), match_basis and matched_token; day_context rows add a day_context object (receipt_image_id, receipt_item_id, matched_tokens, day). get_image_component_targets reads receipt_item_id, match_basis, matched_token, verdict_path and scene_type. Unit: none (jsonb). Source: the writer. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.citation_text IS
'Readable citation behind the status, text, nullable. Filled on 283 rows (0.8%, 2026-10-07): the 257 BYOK confirmed rows (the receipt item id, its part number and its description), the 13 day_context rows (the day, the receipt frame, the receipt item and the shared tokens) and 13 of the 17 rows of 2025-12 (the gpt-4o citation). The receipt descriptions record purchases of the vehicle owner and anon can read them on public vehicles (see the table comment); none is quoted here. Unit: none (text). Source: the writer. Grain: one component label in one image. Clock: n/a.';

-- ── Reasoning and gaps ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.inference_basis IS
'Why the model holds the identification (creating migration: reasoning for inferred rows), text, nullable. Filled on 13 rows (2026-10-07), all of 2025-12 (12 inferred, 1 confirmed); the BYOK writer never sets it, and the reasoning stays in the verdict. Unit: none (text). Source: the gpt-4o answer of analyze-image-tier2. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';
COMMENT ON COLUMN public.component_identifications.inference_method IS
'How the identification was reached, text, nullable (the creating migration named pattern_matching, cross_reference and visual_similarity; none occurs). 4 values (2026-10-07), all from the BYOK writer: byok_vision 37,318 (no receipt match), byok_vision+receipt_pn_part_number_guess 210, byok_vision+receipt_pn_ocr_text 47, byok_vision+day_context_receipt 13. NULL on the 17 rows of 2025-12. Unit: none (text code). Source: the writer. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.blocking_gaps IS
'References needed to confirm the identification (creating migration: for unknown rows), text[], nullable. Filled on 17 rows (2026-10-07), all of 2025-12, 9 of them empty arrays; the BYOK writer never sets it. Unit: none (text array). Source: the gpt-4o answer of analyze-image-tier2. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';
COMMENT ON COLUMN public.component_identifications.alternative_possibilities IS
'What else the component might be (creating migration), text[], nullable. NULL on all 37,605 rows (2026-10-07); no writer sets it. Unit: none (text array). Source: none (never written). Grain: one component label in one image. Clock: n/a.';

-- ── Visual data ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.bounding_box IS
'Where the component is in the image, jsonb, nullable. Filled on 37,438 rows (99.6%, 2026-10-07), every one an object with x1, y1, x2, y2 and scale 999: two corners of the box on a 0 .. 999 grid of the frame, the box array of the verdict as the model returned it (the creating migration meant x, y, width, height). 1 box is degenerate (x1 >= x2 or y1 >= y2). NULL on 150 BYOK rows whose verdict gave no valid box and on the 17 rows of 2025-12. get_image_component_targets returns only rows with a box. Unit: grid units, 0 .. 999 across the frame width and height. Source: the vision model, reshaped by the writer. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';
COMMENT ON COLUMN public.component_identifications.visible_features IS
'Features of the component the model saw (creating migration), text[], nullable. Filled on 17 rows (2026-10-07), all of 2025-12, at most 3 entries each; the BYOK writer never sets it. Unit: none (text array). Source: the gpt-4o answer of analyze-image-tier2. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';
COMMENT ON COLUMN public.component_identifications.condition_notes IS
'Condition of the component as the model described it, text, nullable. Filled on 17 rows (2026-10-07), all of 2025-12; the BYOK writer keeps condition in the state_observations of the verdict, not here. Unit: none (text). Source: the gpt-4o answer of analyze-image-tier2. Grain: one component label in one image. Clock: as of the analyzed_at of the analysis record.';

-- ── Human validation (never used) ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.human_validated IS
'Whether a person has checked the identification, boolean, nullable, default false. false on all 37,605 rows (2026-10-07): no row has been validated, and no code in the repo sets it. Returned in provenance by get_image_component_targets. The partial index on unvalidated rows from the creating migration is absent on prod. Unit: none (boolean). Source: column default. Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.validated_by IS
'Account that validated the row: an auth.users id, nullable, foreign key without ON DELETE action (validated). NULL on all 37,605 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.validated_at IS
'When a person validated the row, timestamptz, nullable. NULL on all 37,605 rows (2026-10-07). Unit: timestamptz. Source: none (never written). Grain: one component label in one image. Clock: validation time (none recorded).';
COMMENT ON COLUMN public.component_identifications.validation_notes IS
'Notes of the validator, text, nullable. NULL on all 37,605 rows (2026-10-07). Unit: none (text). Source: none (never written). Grain: one component label in one image. Clock: n/a.';
COMMENT ON COLUMN public.component_identifications.correction_applied IS
'The corrected identification when a person changed it (creating migration), text, nullable. NULL on all 37,605 rows (2026-10-07): no correction has been recorded. Unit: none (text). Source: none (never written). Grain: one component label in one image. Clock: n/a.';

-- ── Row clocks ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.component_identifications.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert (neither writer sends it). Filled on every row (2026-10-07). By day: 2025-12-02 17 rows, 2026-07-02 29,595, 07-03 3,698, 07-05 995, 07-06 2,087, 07-11 677, 07-20 490, and 4 more days with 1 to 22 rows, the last 2026-08-02 00:28Z. It is the landing time, not the judgment time (image_analysis_records.analyzed_at: a median of 20 days earlier for the entities backfill, 7 s for the ingest command) nor the photo time (vehicle_images.taken_at). Unit: timestamptz. Source: column default. Grain: one component label in one image. Clock: ingest time.';
COMMENT ON COLUMN public.component_identifications.updated_at IS
'When the row was last written, default now(), no update trigger. Equal to created_at on all 37,605 rows (2026-10-07): no row was ever updated (a newer verdict supersedes the analysis record and lands new rows instead). Unit: timestamptz. Source: column default. Grain: one component label in one image. Clock: ingest time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.component_identifications'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'component_identifications: every column has a comment';
  ELSE
    RAISE NOTICE 'component_identifications columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
