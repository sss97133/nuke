-- Describe image_analysis_records: all 27 columns (0 of 27 had a COMMENT ON COLUMN before; catalog count on prod,
-- 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 9,774 rows on 2026-10-07 15:40Z by exact count (the
-- atlas estimate of 9,559 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row
-- was created 2026-08-02 00:28Z.
--
-- METHOD (read 2026-10-07 15:38-16:05Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in from pg_constraint
--   (component_identifications.analysis_record_id) and views from pg_depend (none). The row count, the counts by tier,
--   model, month and day, the fills of every column, the jsonb types, object keys and array lengths, the counter and
--   array agreement, the supersession links, the clock comparisons, the image sources and the vehicle agreement with
--   vehicle_images, the orphan images and vehicles and the public-vehicle split are exact counts over the whole table
--   (6.5 MB heap, read only). What anon and authenticated can read comes from counts under SET LOCAL ROLE in read-only
--   transactions. "Filled" means non-NULL.
--   Writers and readers from code at origin/main ea08c086a (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writers): the creating migration
--   supabase/migrations/20251202_component_knowledge_base.sql; prod migration 20260614013027
--   capture_photo_analysis_enablement (drops NOT NULL on vehicle_id; read from supabase_migrations.schema_migrations, not
--   in the repo); scripts/deep-image-analysis-byok.mjs (landEntityPage, called by its ingest and entities modes; entity
--   layer added by 1aa8e5f43, 2026-07-02), run by scripts/daily-receipt/byok-image-batch.sh and byok-fleet-batch.sh;
--   scripts/daily-receipt/analyze-capture-photos.mjs (its code comments on the earlier version that wrote this table;
--   that version was never committed); the edge function supabase/functions/analyze-image-tier2 (added by 6b5d86455,
--   2025-12-02; archived by 851a638b9, 2026-02-01; deleted by 43b72deae, 2026-03-08; read at 6b5d86455; not in the
--   deployed function list, 328 functions, read through the management API); the bodies, read with pg_get_functiondef,
--   of the 3 live functions whose body names the table (get_photo_library_stats, get_image_component_targets,
--   get_user_capture_stats, the last only in a comment) with their EXECUTE grants; cron.job (no job names the table or
--   its writers); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here); the
--   launchd job com.nuke.byok-image-analysis (defined, not loaded, 2026-10-07). Reader code:
--   nuke_frontend/src/services/personalPhotoLibraryService.ts (get_photo_library_stats); no frontend page, edge function
--   or mcp-server tool reads the table directly.
-- LIMITS:
--   Which agent model produced a BYOK verdict is the label the verdict carries, not a recorded API call. The version of
--   analyze-capture-photos.mjs that wrote the tier-1 rows is inferred from its code comments, the capture_relay_ios
--   images and the vehicle_id NULL rows, not read. How the 5 gpt-4o rows lost their image and vehicle is not recorded.
--   pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z), and which callers made its scans is
--   not recorded. The rows describe the owner's own photos and receipts: quoted values are tier, model, source, reason,
--   basis and prompt-version codes, column, key and function names and counts only; no part number, receipt id, label,
--   narrative, note, place, image id or vehicle id.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Full analysis records with epistemic tracking (confirmed/inferred/unknown)" (from the creating
--   migration). That stays as the opening; the new comment adds the grain, the three writers and their shapes, the
--   liveness, the readers, the access, the schema drift and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_analysis_records IS
'Full analysis records with epistemic tracking (confirmed/inferred/unknown): one row per analysis pass of one image (grain: image x pass; a newer pass of the same writer chains the older one through supersedes and superseded_by and never deletes it). 9,774 rows on 2026-10-07 (the atlas estimate of 9,559 is a stale reltuples) for 9,570 images, from three writers with three different shapes. (1) scripts/deep-image-analysis-byok.mjs (its ingest mode, run by scripts/daily-receipt/byok-image-batch.sh, and its entities backfill; added by commit 1aa8e5f43 on 2026-07-02): 9,551 tier-2 rows created 2026-07-02 .. 2026-08-02 00:28Z (7,529 on 2026-07-02) on 71 vehicles, one per frame whose BYOK vision verdict named components. It keeps the verdict itself in vehicle_images.ai_scan_metadata.byok_deep_analysis, lands each component as a component_identifications row (analysis_record_id, ON DELETE CASCADE) and matches components to the PN-bearing receipt items of the vehicle (confirmed_findings) or not (inferred_findings). (2) A version of scripts/daily-receipt/analyze-capture-photos.mjs that was never committed (its code comments say it wrote this table until 2026-06-14; the current script writes vehicle_images.ai_scan_metadata): 218 tier-1 rows created 2026-06-14 01:43Z .. 16:43Z for 178 iOS capture photos, vehicle_id NULL (prod migration 20260614013027 capture_photo_analysis_enablement dropped NOT NULL for them), each carrying the whole verdict as objects in confirmed_findings and inferred_findings. (3) The edge function analyze-image-tier2 (added by commit 6b5d86455 on 2025-12-02, deleted by 43b72deae on 2026-03-08, not deployed now): 5 gpt-4o tier-2 rows on 2025-12-02 for 3 images of 1 vehicle; those images and that vehicle no longer exist in vehicle_images and vehicles, although both foreign keys are ON DELETE CASCADE and validated. Liveness: no row since 2026-08-02 00:28Z; pg_stat_user_tables counts 0 inserts, updates and deletes, 16 sequential and 37,631 index scans since the server last started (2026-09-29 09:20Z; read 15:38Z). The launchd job com.nuke.byok-image-analysis, which ran byok-fleet-batch.sh every 300 s, is defined on the laptop but not loaded (2026-10-07); no cron job names the table. Readers: get_photo_library_stats(uuid) (SECURITY DEFINER, refuses any caller but the owner or service_role) counts records, current, cited and method-less records per image for the photo library (nuke_frontend/src/services/personalPhotoLibraryService.ts); get_image_component_targets(uuid) (SECURITY DEFINER, EXECUTE granted to anon and authenticated, rows only for images the caller uploaded; no caller in the repo) joins the current record for provenance; deep-image-analysis-byok.mjs reads its own current records to decide whether to land a newer pass. get_user_capture_stats names the table only in a comment. Access: RLS is on. analysis_records_read (SELECT, every role) admits rows whose vehicle is public or belongs to the caller (vehicles.user_id = auth.uid()): anon reads 9,549 rows on 70 public vehicles (counted under SET LOCAL ROLE anon, 2026-10-07), among them all 126 rows whose confirmed_findings carry part numbers and receipt item ids matched from the receipts of the owner; the tier-1 rows (vehicle NULL) reach no API role. analysis_records_create (INSERT, authenticated, WITH CHECK true, from the creating migration): any signed-in account can insert a row for any image and vehicle, and such a row on a public vehicle reads as an analysis to everyone. anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE; no policy admits an UPDATE or DELETE. No triggers (updated_at is never maintained), no write receipts, no pipeline_registry row. Schema drift: the creating migration supabase/migrations/20251202_component_knowledge_base.sql declares vehicle_id NOT NULL (dropped on prod 2026-06-14), self-referencing foreign keys on supersedes and superseded_by and the indexes idx_analysis_records_image, idx_analysis_records_tier and idx_analysis_records_current; prod has none of these, only the primary key and idx_image_analysis_records_vid, so lookups by image_id (the writer, get_image_component_targets, get_photo_library_stats) have no index to use. Clocks: analyzed_at is when the vision verdict was produced (the agent clock) on BYOK rows and the insert time on the others; created_at is when the row was landed (on BYOK rows a median 17.9 days after the verdict); superseded_at is when a newer pass replaced the row; updated_at equals created_at on every row.';

-- ── Identity and subject ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.id IS
'Surrogate key of the analysis pass, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 9,774 values (2026-10-07). component_identifications.analysis_record_id references it (ON DELETE CASCADE), and supersedes and superseded_by of other rows hold it (no foreign key on prod). Unit: none (uuid). Source: column default. Grain: one analysis pass. Clock: n/a.';
COMMENT ON COLUMN public.image_analysis_records.image_id IS
'Image analyzed: a vehicle_images.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), not indexed (the creating migration declared idx_analysis_records_image; prod lacks it). 9,570 distinct values on 9,774 rows (2026-10-07). 9,574 rows are current (superseded_by NULL), so 3 images hold more than one current row: one image 3 gpt-4o rows, two images a tier-1 and a tier-2 row. The 3 images of the 5 gpt-4o rows no longer exist in vehicle_images despite the cascading key; how is not recorded. By vehicle_images.source of the 9,769 rows whose image exists: iphoto 3,609, user_upload 2,161, ssd_blast 1,453, hd_archive 943, drop-folder 340, bat_import 278, bat_import_mirrored 250, capture_relay_ios 226, library_recovery 220, 12 other sources 289. Unit: none (uuid). Source: the writer (the image of the verdict). Grain: one analysis pass. Clock: n/a.';
COMMENT ON COLUMN public.image_analysis_records.vehicle_id IS
'Vehicle the image belonged to when the pass was landed: a vehicles.id, uuid, nullable (NOT NULL in the creating migration; prod migration 20260614013027 dropped it for vehicle-less capture photos), foreign key ON DELETE CASCADE (validated), indexed (idx_image_analysis_records_vid); the read policy keys on it. Filled on 9,556 rows (97.8%, 2026-10-07) for 72 vehicles; NULL on the 218 tier-1 rows. A copy that is not kept in step: of the 9,551 BYOK rows, 9,388 match the current vehicle_images.vehicle_id of their image, 152 differ and 11 point at an image that now has no vehicle; 23 of the tier-1 images have since been attributed to a vehicle while their rows still say NULL. The vehicle of the 5 gpt-4o rows no longer exists. Unit: none (uuid). Source: the writer (the vehicle of the work list). Grain: one analysis pass. Clock: as of created_at.';

-- ── Pass context ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.analysis_tier IS
'Depth of the pass (creating migration: 1, 2, 3 and so on), integer NOT NULL, no CHECK, no index (idx_analysis_records_tier of the creating migration is absent on prod). 2 on 9,556 rows (the BYOK entity landing and the gpt-4o rows), 1 on the 218 capture-photo rows of 2026-06-14 (2026-10-07). Each writer sets a constant, so the tiers are labels of the writers, not one scale of depth: the tier-1 rows hold the whole verdict, the tier-2 BYOK rows only its components. Unit: none (integer code). Source: the writer (constant). Grain: one analysis pass. Clock: n/a.';
COMMENT ON COLUMN public.image_analysis_records.analyzed_at IS
'When the analysis was produced, timestamptz, nullable, default now(). Filled on every row (2026-10-07). On the 9,551 BYOK rows it is the analyzed_at of the vision verdict (equal to reference_coverage_snapshot.verdict_analyzed_at on all of them), the clock of the agent that wrote it, 2026-05-23 22:19Z .. 2026-08-02 00:28Z; those rows were landed a median 17.9 days (at most 39.4 days) later. On the tier-1 and gpt-4o rows it equals created_at. get_image_component_targets returns it as provenance and get_photo_library_stats reports its maximum per image. Unit: timestamptz. Source: the verdict (BYOK) or the insert. Grain: one analysis pass. Clock: event time of the analysis (agent clock) on BYOK rows, ingest time on the others.';
COMMENT ON COLUMN public.image_analysis_records.analyzed_by_model IS
'Model that produced the analysis, as the writer recorded it, text, nullable (creating migration: claude-3-haiku, gpt-4o and the like). Filled on every row (2026-10-07): claude-opus-4-8 8,338, byok_claude_print 1,211, claude-sonnet-4-6 219 (218 tier-1, 1 tier-2), gpt-4o 5, claude-fable-5 1. On BYOK rows it is the agent_model field of the verdict, written by the agent itself and not checked against the call that ran it; byok_claude_print is the fallback of deep-image-analysis-byok.mjs for verdicts without that field (verdicts of 2026-05-23 .. 2026-06-10) and names the harness (claude --print), not a model. gpt-4o is a constant of analyze-image-tier2. get_image_component_targets returns it; get_photo_library_stats counts rows without it as missing their method. Unit: none (text label). Source: the verdict or a writer constant. Grain: one analysis pass. Clock: n/a.';

-- ── References consulted ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.references_available IS
'library_documents indexed for the vehicle when the pass ran (creating migration), uuid[], nullable. An empty array on the 5 gpt-4o rows of 2025-12-02, NULL on the other 9,769 (2026-10-07); the BYOK and capture writers do not set it. Unit: none (uuid array). Source: analyze-image-tier2. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.references_used IS
'library_documents the analysis cited (creating migration: which docs were actually consulted), uuid[], nullable. An empty array on the 5 gpt-4o rows, NULL on the other 9,769 (2026-10-07). The receipt citations of the BYOK rows live in confirmed_findings instead. Unit: none (uuid array). Source: analyze-image-tier2. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.references_missing IS
'References the analysis needed but did not have (creating migration), text[], nullable. An empty array on the 5 gpt-4o rows, NULL on the other 9,769 (2026-10-07). Unit: none (text array). Source: analyze-image-tier2. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.reference_coverage_snapshot IS
'Context of the pass, jsonb, nullable; meant as the reference coverage of the vehicle at analysis time (creating migration). On the 9,551 BYOK rows an object with verdict_analyzed_at (equal to analyzed_at), prompt_version (byok_v3_camera_pose_2026-05-23 9,378, byok_v4_bbox_teacher_2026-07-11 167, byok_v2_bbox_2026-05-23 4, byok_v1_2026-05-23 2), roster_size (0 .. 96 PN-bearing receipt items of the vehicle the components were matched against) and, on 13 rows, day_context_anchor_key (the same-day receipt anchor that triggered a re-landing). The writer compares verdict_analyzed_at and day_context_anchor_key of the current record to decide whether to land a newer pass. An empty array on the 5 gpt-4o rows, NULL on the 218 tier-1 rows (2026-10-07). Unit: none (jsonb). Source: the writer. Grain: one analysis pass. Clock: as of created_at.';

-- ── Findings ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.confirmed_findings IS
'Findings backed by a citation (creating migration: facts backed by citations), jsonb, nullable. On the 9,551 BYOK rows an array of the components matched to a receipt item of the vehicle, each with label, part_number, receipt_item_id and basis (part_number_guess 210, ocr_text 47): 257 elements on 126 rows, an empty array on the other 9,425 (2026-10-07). On the 218 tier-1 rows an object holding the whole verdict, not confirmed findings: scene_type, components_seen, state_observations, damage_localized, workshop_signals, text_regions, camera_pose, presence (whether people or animals are visible and a place hint), intent, intent_confidence, build_phase_guess, needs_clarification, narrative_one_line, agent_notes and provenance. NULL on the 5 gpt-4o rows. anon reads the 126 cited rows through the read policy (public vehicles); no part number, receipt id or verdict value is quoted here. Unit: none (jsonb). Source: the writer, from the vision verdict and the receipt items of the vehicle. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.inferred_findings IS
'Findings without a citation (creating migration: reasonable conclusions without citations), jsonb, nullable. On the 9,551 BYOK rows an array of the components not matched to a receipt item, each with label and, on 13 elements, day_context (receipt_image_id and receipt_item_id of a same-day receipt frame whose text shares tokens with the label): 37,331 elements, 1 to 16 per row, median 4 (2026-10-07). On the 218 tier-1 rows an object with the verdict keys intent, intent_confidence, build_phase_guess, needs_clarification, narrative_one_line, agent_notes and provenance (the same keys also sit in confirmed_findings). NULL on the 5 gpt-4o rows. Unit: none (jsonb). Source: the writer, from the vision verdict. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.unknown_items IS
'What the analysis could not determine (creating migration: things that could not be determined), jsonb, nullable. On the 218 tier-1 rows an array of free-text strings: 538 strings on 197 rows, up to 4 per row, an empty array on 21 (2026-10-07); NULL on the BYOK and gpt-4o rows. unknown_count does not count them. Unit: none (jsonb array of text). Source: the capture-photo writer, from the vision verdict. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.gaps_discovered IS
'Intended knowledge_gaps ids found during the pass (creating migration), uuid[], nullable. NULL on all 9,774 rows (2026-10-07); no writer sets it (analyze-image-tier2 logged gaps through log_knowledge_gap instead). Unit: none (uuid array). Source: none (never written). Grain: one analysis pass. Clock: n/a.';

-- ── Handoff ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.research_queue IS
'Prioritized references the next pass should obtain (creating migration), jsonb, nullable. An array on the 5 gpt-4o rows (4 elements in all), NULL on the other 9,769 (2026-10-07). Unit: none (jsonb array). Source: analyze-image-tier2, from the model output. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.handoff_notes IS
'Notes for the next pass (creating migration: free-form), text, nullable. On the 9,551 BYOK rows a constant marker, byok_deep_analysis entity landing; verdict at vehicle_images.ai_scan_metadata.byok_deep_analysis, by whose prefix deep-image-analysis-byok.mjs finds its own prior records; free text from the model on the 5 gpt-4o rows (82 to 116 characters, not quoted); NULL on the 218 tier-1 rows (2026-10-07). Unit: none (text). Source: the writer. Grain: one analysis pass. Clock: n/a.';
COMMENT ON COLUMN public.image_analysis_records.reanalysis_triggers IS
'Intended conditions that should trigger a re-analysis (creating migration), text[], nullable. NULL on all 9,774 rows (2026-10-07); no writer sets it. Unit: none (text array). Source: none (never written). Grain: one analysis pass. Clock: n/a.';

-- ── Supersession ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.supersedes IS
'The earlier pass of the same image that this row replaced: an image_analysis_records.id, uuid, nullable, no foreign key on prod (the creating migration declared a self-reference). Filled on 200 rows (2026-10-07): 160 BYOK rows and 40 tier-1 rows; every one points at an existing row of the same image whose superseded_by points back. Unit: none (uuid). Source: the writer (its current prior record). Grain: one analysis pass. Clock: n/a.';
COMMENT ON COLUMN public.image_analysis_records.superseded_by IS
'The newer pass that replaced this row: an image_analysis_records.id, uuid, nullable, no foreign key on prod (the creating migration declared a self-reference). Set by the writer in an update after it inserts the newer row; filled on 200 rows, each consistent with that row''s supersedes; NULL on the 9,574 current rows (2026-10-07). get_image_component_targets keeps only rows where it is NULL; deep-image-analysis-byok.mjs looks for its prior record among them. Unit: none (uuid). Source: the writer. Grain: one analysis pass. Clock: as of superseded_at.';
COMMENT ON COLUMN public.image_analysis_records.superseded_at IS
'When a newer pass replaced the row: the clock of the writer run that landed it, timestamptz, nullable. Filled on the same 200 rows as superseded_by (2026-10-07): the 40 tier-1 rows on 2026-06-14, the 160 BYOK rows 2026-07-02 .. 2026-07-20. get_photo_library_stats counts rows where it is NULL as current. Unit: timestamptz. Source: the writer clock. Grain: one analysis pass. Clock: recording (when superseded).';
COMMENT ON COLUMN public.image_analysis_records.superseded_reason IS
'Why the row was replaced, text, nullable, a fixed phrase per writer path. Filled on the same 200 rows (2026-10-07): newer byok verdict landed 147 and day-context receipt anchor landed 13 (BYOK), reanalyzed_byok_tier1 40 (tier-1). Unit: none (text code). Source: the writer. Grain: one analysis pass. Clock: n/a.';

-- ── Quality counters ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.overall_confidence IS
'Confidence the analysis reports for itself, 0 to 1, numeric, nullable, no CHECK. Filled on every row (2026-10-07). On BYOK rows the confidence of the verdict clamped to 0 .. 1, 0.3 .. 0.97, median 0.82; on tier-1 rows 0 .. 0.97, median 0.8; on gpt-4o rows 0.75 .. 0.85. Self-reported by the model, not calibrated. get_photo_library_stats counts rows without it as missing their method. Unit: probability (0 to 1, self-reported). Source: the vision verdict. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.citation_count IS
'Number of cited findings, integer, nullable, default 0. Equal to the length of confirmed_findings on all 9,551 BYOK rows (257 in all, above 0 on 126 rows; 2026-10-07); 0 on the tier-1 and gpt-4o rows, whose findings are objects or NULL. get_photo_library_stats counts rows with it above 0 as cited. Unit: count of findings. Source: the writer. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.inference_count IS
'Number of inferred findings, integer, nullable, default 0. Equal to the length of inferred_findings on all 9,551 BYOK rows (37,331 in all, 1 to 16 per row; 2026-10-07); 0 on the tier-1 and gpt-4o rows. Unit: count of findings. Source: the writer. Grain: one analysis pass. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.image_analysis_records.unknown_count IS
'Meant as the number of unknown items, integer, nullable, default 0. 0 on all 9,774 rows (2026-10-07), although 197 tier-1 rows carry 538 unknown_items; no writer counts them. Unit: count of items. Source: column default. Grain: one analysis pass. Clock: n/a.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_analysis_records.created_at IS
'When the row was landed: default now(), the transaction clock of the insert (no writer sends it). Filled on every row, 2025-12-02 17:26Z .. 2026-08-02 00:28Z (2026-10-07); by month 2025-12 5, 2026-06 218, 2026-07 9,550 (7,529 on 2026-07-02, the backfill of the entity layer), 2026-08 1. On BYOK rows it follows analyzed_at by a median 17.9 days. Unit: timestamptz. Source: column default. Grain: one analysis pass. Clock: ingest time.';
COMMENT ON COLUMN public.image_analysis_records.updated_at IS
'Meant as the time of the last change, timestamptz, nullable, default now(). No trigger maintains it and no writer sets it, so it equals created_at on all 9,774 rows (2026-10-07), the 200 rows updated when superseded included. Unit: timestamptz. Source: column default. Grain: one analysis pass. Clock: ingest time (not the last update).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.image_analysis_records'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'image_analysis_records: every column has a comment';
  ELSE
    RAISE NOTICE 'image_analysis_records columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
