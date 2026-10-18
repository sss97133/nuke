-- Describe photo_sync_items: the 31 columns without a comment, a corrected comment on classification_verified (2 of 33
-- had one before; catalog count on prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 2,214 rows on 2026-10-07 15:55Z by exact count (equal
-- to the atlas estimate), no write since the statistics counters began; the newest row was detected in 2026-04.
-- The table tracks the private Apple Photos library of the owner: these comments give shapes and counts only.
--
-- METHOD (read 2026-10-07 15:54-16:35Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; views and foreign keys in from pg_depend
--   and pg_constraint (none). The row count, the fills of every column, the counts by status, category, verifier, match
--   method, file extension and month of the pipeline clocks, the cross-tabulation of status, classification, match and
--   verification, the jsonb keys, the identifier and URL shapes, the clock orderings, and the agreement with the linked
--   vehicle_images rows, vehicles and storage.objects are exact counts over the whole table (1.3 MB heap, read only). What
--   anon and authenticated can read comes from counts under SET LOCAL ROLE in read-only transactions. "Filled" means
--   non-NULL.
--   Writers and readers from code at origin/main 3df579ef7 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history): the creating migration
--   supabase/migrations/20260211100000_photo_auto_sync_system.sql; prod migration 20260413020416
--   add_classification_verification_to_photo_sync (the four verification columns and the two existing column comments;
--   read from supabase_migrations.schema_migrations, not in the repo); 20261006073000_table_purpose_live_tables.sql (the
--   table comment); scripts/photo-auto-sync-daemon.py (record_sync_item, the Ollama classification and the hash check;
--   the capture-date change of b6f1857e4, 2026-07-06) and scripts/ollama-classify-photo.py; the edge function
--   supabase/functions/daily-report (deployed version 71, 2026-09-27 15:56Z; deployed function list, 328 functions, read
--   through the management API); the body, read with pg_get_functiondef, of the one live function whose body names the
--   table (get_photo_library_stats) with its EXECUTE grants; cron.job (daily-nuke-report, jobid 172, inactive; no job
--   names the daemon or the classifier); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is
--   added here); storage.buckets; the launchd jobs on the laptop (com.nuke.photo-auto-sync disabled, ag.nuke.photo-sync
--   does not name the table).
-- LIMITS:
--   Who wrote the match and verification fields is not recorded: no code in the repo sets them. The UTC offset of
--   classified_at is inferred from its lead over detected_at and the local-time formatting in both classifiers, not read
--   from a stored zone. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). Private data: no
--   file name, path, album name, Photos identifier, device, place, photo date, vehicle hint value, user id or vehicle id
--   is quoted; pipeline clocks are given by month only.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Per-photo Apple Photos sync tracking: one row per Photos library item (photos_uuid) with dates,
--   hashes, automotive classification and sync status (grain: one library photo). Created by
--   20260211100000_photo_auto_sync_system; written by scripts/photo-auto-sync-daemon.py and ollama-classify-photo.py.
--   Event time = photos_date_taken; photos_date_added = library add time." That stays as the opening. Added: the counts,
--   the liveness, the classifier, the hand-written matches and audits, that photos_date_taken is the Photos asset date
--   rather than the capture time on these rows, the clock mislabel, the readers, the access and the drift.
--   Column classification_verified: it said "False = Ollama proposal only (47% accuracy). True = confirmed by second-pass
--   audit, album match, or user review." That text stays first. Corrected: false also marks the 691 rows that were never
--   classified, so it does not mean a proposal exists; every true row was verified by claude_audit, none by album match or
--   user review; the 47% has no recorded sample.
--   Column verified_category: unchanged.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.photo_sync_items IS
'Per-photo Apple Photos sync tracking: one row per Photos library item (photos_uuid) with dates, hashes, automotive classification and sync status (grain: one library photo). Created by 20260211100000_photo_auto_sync_system; written by scripts/photo-auto-sync-daemon.py and ollama-classify-photo.py. Event time = photos_date_taken; photos_date_added = library add time. 2,214 rows on 2026-10-07, all for one account (the owner), detected in 2026-02 (62) and 2026-04 (2,152); nothing has been written since 2026-04 (pg_stat_user_tables: 0 inserts, updates and deletes since the server last started, 2026-09-29 09:20Z; read 15:54Z). The daemon ran on the laptop as the launchd job com.nuke.photo-auto-sync, now disabled; the current photo sync (ag.nuke.photo-sync) does not write this table, and no cron job names it. By sync_status: pending_clarification 909, uploaded 686, ignored 562, matched 57. Every row has a vehicle_images row (source photo_auto_sync, the same file hash) and a storage object. The classification (is_automotive, classification_category, classification_confidence, vehicle_hints, classified_at) is a proposal of a local llama3.2-vision:11b model run through Ollama; 102 rows were audited (verified_by claude_audit). Vehicle matches exist on 57 rows, all one vehicle; no code in the repo writes the match or verification fields. classified_at holds the local laptop clock labelled as UTC, so it reads hours early (see that column). On every row photos_date_taken is the Photos asset date, which Apple resets on iCloud restore, AirDrop or shared-album import, not the EXIF capture time (the daemon prefers EXIF only since commit b6f1857e4, 2026-07-06). Never filled: perceptual_hash, difference_hash, error_message, last_retry_at, exported_at, uploaded_at and completed_at; retry_count is 0 on every row. Readers: get_photo_library_stats(uuid) (SECURITY DEFINER, refuses any caller but the owner or service_role) counts the reviewed classifications; the edge function daily-report (deployed; its cron job daily-nuke-report, jobid 172, is inactive) counts rows by sync_status for its report; the daemon reads file_hash_sha256 to skip files already uploaded; ollama-classify-photo.py reads uploaded rows to classify them. The view photo_sync_dashboard of the creating migration does not exist on prod. Access: RLS is on with two policies, Users can manage own sync items (every command, every role, user_id = auth.uid()) and Service role full access to photo_sync_items (service_role). anon, and authenticated without the owner session, read 0 rows (counted under SET LOCAL ROLE, 2026-10-07); anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, but the policy admits only rows of the caller. No triggers, no write receipts, no pipeline_registry row. Schema drift: the creating migration declares a foreign key from matched_vehicle_id to vehicles and the indexes idx_photo_sync_items_status, idx_photo_sync_items_hash and idx_photo_sync_items_date; prod has none of them, only the unique key (user_id, photos_uuid) and idx_photo_sync_items_vehicle. The rows describe the private photo library of the owner: comments give shapes and counts only, no file name, path, album, device, place or photo date.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.id IS
'Surrogate key of the sync row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 2,214 values (2026-10-07). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.user_id IS
'Account whose Photos library the row tracks: an auth.users id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), the first column of UNIQUE (user_id, photos_uuid); the owner policy keys on it. One account on all 2,214 rows (2026-10-07); no id is quoted. Unit: none (uuid). Source: the daemon configuration. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.photos_uuid IS
'Apple Photos identifier of the library item, text NOT NULL, the second column of UNIQUE (user_id, photos_uuid). A 36-character upper-case UUID on all 2,214 rows, all distinct (2026-10-07); none is quoted. Unit: none (text id). Source: the Photos library, read by the daemon. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.photos_filename IS
'Original file name of the library item, text, nullable, filled on every row (2026-10-07). By extension: jpg 1,522, heic 686, jpeg 4, png 2. Private: no name is quoted. Unit: none (text). Source: the Photos library (original file name). Grain: one library photo. Clock: n/a.';

-- ── Photos library dates and albums ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.photos_date_added IS
'When the item was added to the Photos library, timestamptz, nullable, filled on every row and never after detected_at (2026-10-07). No value is quoted. Unit: timestamptz. Source: the Photos library. Grain: one library photo. Clock: library add time.';
COMMENT ON COLUMN public.photo_sync_items.photos_date_taken IS
'Capture time as the Photos library reported it, timestamptz, nullable, filled on every row (2026-10-07). Every row was written before commit b6f1857e4 (2026-07-06) made the daemon prefer the EXIF DateTimeOriginal, so here it is the Photos asset date, which Apple resets on iCloud restore, AirDrop or shared-album import and which can be later than the true capture; on 1 row it is after photos_date_added. No value is quoted. Unit: timestamptz. Source: the Photos library (asset date). Grain: one library photo. Clock: event time as recorded by Photos, not the EXIF capture time.';
COMMENT ON COLUMN public.photo_sync_items.photos_album_names IS
'Photos albums that held the item when it was synced, text[], nullable. An array on every row, non-empty on 458, at most 3 per row, 15 distinct album names (2026-10-07). The daemon parses album names of the form year make model to look for a vehicle. Private labels: none is quoted. Unit: none (text array). Source: the Photos library. Grain: one library photo. Clock: as of detected_at.';

-- ── Hashes ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.file_hash_sha256 IS
'SHA-256 of the exported file, text, nullable, filled on every row, all 2,214 distinct (2026-10-07), equal to vehicle_images.file_hash of the linked image on every row. The daemon looks it up (and vehicle_images.file_hash) to skip files already uploaded, and names the storage object by its first 12 characters. Not indexed (idx_photo_sync_items_hash of the creating migration is absent on prod). Unit: none (hex digest). Source: the daemon. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.perceptual_hash IS
'Intended perceptual hash for near-duplicate detection (creating migration), text, nullable. NULL on all 2,214 rows (2026-10-07); no writer sets it. Unit: none. Source: none (never written). Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.difference_hash IS
'Intended difference hash for near-duplicate detection (creating migration), text, nullable. NULL on all 2,214 rows (2026-10-07); no writer sets it. Unit: none. Source: none (never written). Grain: one library photo. Clock: n/a.';

-- ── Pipeline status ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.sync_status IS
'Stage of the item in the sync pipeline, text, nullable, default detected, CHECK in (detected, exporting, exported, uploading, uploaded, classifying, classified, matching, matched, pending_clarification, ignored, complete, error, duplicate); not indexed (idx_photo_sync_items_status of the creating migration is absent on prod). 4 values occur (2026-10-07): pending_clarification 909 (classified automotive, awaiting a vehicle; 3 of them since audited as not automotive), uploaded 686 (uploaded and never classified), ignored 562 (classified not automotive; 5 of them without a classification) and matched 57 (assigned to a vehicle by writes outside the repo code); complete, error, duplicate and the in-flight stages never occur. The daemon writes the first status on insert and both classifiers set pending_clarification or ignored. daily-report and get_photo_library_stats count by it. Unit: none (text code). Source: the daemon, the classifiers and manual writes. Grain: one library photo. Clock: as of the latest stage clock.';

-- ── Classification (a model proposal) ──────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.is_automotive IS
'Whether the classifier judged the photo automotive, boolean, nullable. true 963, false 565, NULL 686 (never classified) (2026-10-07). Set with the category by the Ollama classifier (llama3.2-vision:11b on the laptop); the daemon forces true for the categories of its ALWAYS_AUTOMOTIVE set. A proposal (see classification_verified); 3 pending_clarification rows say false after the audit. Unit: none (boolean). Source: the classifier. Grain: one library photo. Clock: as of classified_at.';
COMMENT ON COLUMN public.photo_sync_items.classification_category IS
'Category the classifier proposed, text, nullable, no CHECK. The prompt offers vehicle_exterior, vehicle_interior, engine_bay, undercarriage, detail_shot, parts, receipt, documentation, shop_environment, progress_shot and not_automotive. Filled on 1,523 rows (68.8%, 2026-10-07): vehicle_exterior 584, not_automotive 546, vehicle_interior 151, shop_environment 116, engine_bay 43, documentation 18, receipt 16, parts 10, and 39 values off the list: 29 pipe-joined strings that echo the prompt list (such as vehicle_exterior|vehicle_interior), 8 misspellings of not_automotive (not_automative 4, not_automobile, not_automircraft, not_automotional, not_automotiv) and document 2. A model proposal; verified_category holds the audited value on 102 rows. Unit: none (text code). Source: the Ollama classifier (llama3.2-vision:11b). Grain: one library photo. Clock: as of classified_at.';
COMMENT ON COLUMN public.photo_sync_items.classification_confidence IS
'Confidence the classifier reported for its category, 0 to 1, real, nullable. Filled with the category (1,523 rows, 2026-10-07): 0 .. 1, median 0.9. Self-reported by the model and not calibrated; prod migration 20260413020416 put the accuracy of these proposals at 47% without a recorded sample. Unit: probability (0 to 1, self-reported). Source: the classifier. Grain: one library photo. Clock: as of classified_at.';
COMMENT ON COLUMN public.photo_sync_items.vehicle_hints IS
'What the classifier guessed about the vehicle in the photo, jsonb, nullable. An object on 1,501 rows (2026-10-07): make, model, year_range and color on 1,405, body_style on 1,404, an empty object on 96; NULL on 713. The values are model guesses and are not quoted. ollama-classify-photo.py also copies year_range, make and model into vehicle_images.ai_detected_vehicle. Unit: none (jsonb). Source: the classifier. Grain: one library photo. Clock: as of classified_at.';
COMMENT ON COLUMN public.photo_sync_items.classified_at IS
'When the classifier ran, timestamptz, nullable, whole seconds. Filled on 1,468 rows (2026-10-07): 2 in 2026-02, 1,466 in 2026-04. Mislabelled clock: both classifiers format the local wall clock of the laptop with a UTC label (photo-auto-sync-daemon.py with time.strftime and +00:00, ollama-classify-photo.py with time.strftime and .000Z), so the stored instant is early by the local UTC offset. On all 1,466 rows of 2026-04 it precedes detected_at by 5 h 23 min to just under 7 h (median 6 h 38 min), consistent with Pacific daylight time (UTC-7). daily-report selects the rows classified in its window by it, so that window is shifted by the same offset. Unit: timestamptz (local wall time labelled UTC). Source: the classifier clock. Grain: one library photo. Clock: recording (classification), early by the local UTC offset.';

-- ── Vehicle match (written outside the repo code) ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.matched_vehicle_id IS
'Vehicle the photo was assigned to: a vehicles.id, uuid, nullable, no foreign key on prod (the creating migration declared one, ON DELETE SET NULL), indexed (idx_photo_sync_items_vehicle, partial). Filled on 57 rows, all one vehicle that exists, each equal to vehicle_images.vehicle_id of the linked image (2026-10-07); 4 more linked images carry a vehicle without a match here. No code in the repo sets it; the rows carry match_method manual_review (55) or manual_assignment (2). Unit: none (uuid). Source: writes outside the repo code. Grain: one library photo. Clock: as of matched_at.';
COMMENT ON COLUMN public.photo_sync_items.match_confidence IS
'Confidence of the vehicle match, real, nullable. 0.95 on the 57 matched rows, NULL elsewhere (2026-10-07). Unit: probability (0 to 1). Source: writes outside the repo code. Grain: one library photo. Clock: as of matched_at.';
COMMENT ON COLUMN public.photo_sync_items.match_method IS
'How the vehicle match or the audit was made, text, nullable, no CHECK. Filled on 75 rows (2026-10-07): manual_review 55 and manual_assignment 2 (the 57 matched rows), claude_audit_r2 9 and claude_audit_r1 7 (audited, no vehicle), and album followed by an album label 2 (no vehicle; the label is not quoted). Prod migration 20260413020416 verified rows by the prefixes claude_audit and album. Unit: none (text code). Source: writes outside the repo code. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.matched_at IS
'When the vehicle match was recorded, timestamptz, nullable. Filled on the 57 matched rows, 3 distinct values, all in 2026-02 (2026-10-07). Unit: timestamptz. Source: writes outside the repo code. Grain: one library photo. Clock: recording (match).';

-- ── Upload ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.vehicle_image_id IS
'The vehicle_images row created for the upload, uuid, nullable, foreign key ON DELETE SET NULL (validated), not indexed. Filled on every row (2026-10-07); every linked image has source photo_auto_sync and the same file hash, 61 of them now carry a vehicle_id and 2,153 none. Both classifiers find the row to update by it. Unit: none (uuid). Source: the daemon. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.storage_url IS
'Object URL of the uploaded file, text, nullable, filled on every row (2026-10-07): a public object URL of the storage bucket vehicle-data under a per-user auto-sync folder, named by the first 12 characters of file_hash_sha256; every object exists in storage.objects. No path is quoted. Unit: none (URL). Source: the daemon. Grain: one library photo. Clock: n/a.';

-- ── Errors and retries (never used) ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.error_message IS
'Intended last error of the item, text, nullable. NULL on all 2,214 rows and the status error never occurs (2026-10-07); no writer sets it. Unit: none (text). Source: none (never written). Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.retry_count IS
'Intended number of retries, integer, nullable, default 0. 0 on all 2,214 rows (2026-10-07); no writer increments it. Unit: count of retries. Source: column default. Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.last_retry_at IS
'Intended time of the last retry, timestamptz, nullable. NULL on all 2,214 rows (2026-10-07); no writer sets it. Unit: timestamptz. Source: none (never written). Grain: one library photo. Clock: n/a.';

-- ── Stage clocks ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.detected_at IS
'When the daemon first recorded the item: default now(), the database clock of the insert (the daemon does not send it), timestamptz. Filled on every row (2026-10-07): 62 rows in 2026-02 and 2,152 in 2026-04, none since. The ollama-classify-photo.py work list is ordered by it. Unit: timestamptz. Source: column default. Grain: one library photo. Clock: ingest time (database clock).';
COMMENT ON COLUMN public.photo_sync_items.exported_at IS
'Intended time the file was exported from Photos, timestamptz, nullable. NULL on all 2,214 rows (2026-10-07); no writer sets it. Unit: timestamptz. Source: none (never written). Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.uploaded_at IS
'Intended time the file was uploaded, timestamptz, nullable. NULL on all 2,214 rows (2026-10-07), although every file was uploaded; no writer sets it. Unit: timestamptz. Source: none (never written). Grain: one library photo. Clock: n/a.';
COMMENT ON COLUMN public.photo_sync_items.completed_at IS
'Intended time the item finished the pipeline, timestamptz, nullable. NULL on all 2,214 rows and the status complete never occurs (2026-10-07). Unit: timestamptz. Source: none (never written). Grain: one library photo. Clock: n/a.';

-- ── Verification ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.photo_sync_items.classification_verified IS
'False = Ollama proposal only (47% accuracy). True = confirmed by second-pass audit, album match, or user review. (Text of prod migration 20260413020416; its 47% has no recorded sample.) boolean, nullable, default false. true on 102 rows, false on 2,112 (2026-10-07). false also marks the 691 rows that were never classified, so false alone does not mean a proposal exists. All 102 true rows carry verified_by claude_audit: no row has been verified by album match or user review (the migration verified album rows only when they had a vehicle, and none had). 10 of the 102 audits changed the category (see verified_category). get_photo_library_stats counts verified, agreeing and differing rows. Unit: none (boolean). Source: prod migration 20260413020416 and later audit writes outside the repo code. Grain: one library photo. Clock: as of verified_at.';
COMMENT ON COLUMN public.photo_sync_items.verified_by IS
'Who verified the classification, text, nullable, no CHECK (the verification migration lists claude_audit, user, album_match and gps_match). claude_audit on all 102 verified rows, NULL elsewhere (2026-10-07). Unit: none (text code). Source: the verification writes. Grain: one library photo. Clock: as of verified_at.';
COMMENT ON COLUMN public.photo_sync_items.verified_at IS
'When the classification was verified, timestamptz, nullable. Filled on the 102 verified rows, 10 distinct values, all in 2026-04 (2026-10-07). Unit: timestamptz. Source: the verification writes. Grain: one library photo. Clock: recording (verification).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.photo_sync_items'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'photo_sync_items: every column has a comment';
  ELSE
    RAISE NOTICE 'photo_sync_items columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
