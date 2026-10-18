-- Describe image_identities: all 40 columns (1 of 40 had a COMMENT ON COLUMN before, content_hash_md5; catalog count on
-- prod, 2026-10-07) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 25,504 rows on 2026-10-07 11:22Z by exact count (the atlas
-- estimate of 24,300 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row is from
-- 2026-09-28 21:57Z.
--
-- METHOD (read 2026-10-07 11:20-11:45Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy,
--   information_schema and pg_description; the foreign keys that point at the table from pg_constraint and every column
--   named image_identity_id from pg_attribute. Fill, values, hash formats, the key sets of exif_data, date windows and
--   distributions are exact counts over the whole table (13 MB heap, read only). Links are exact counts too: vehicle_images
--   through its partial index on image_identity_id (23,382 rows), image_appearances, nuke_production_credits,
--   production_files and the other identity-keyed tables. What anon and authenticated can read comes from counts under
--   SET LOCAL ROLE in read-only transactions. "Filled" means non-NULL and, for jsonb and arrays, not empty where stated.
--   Writers and readers from code at origin/main 3c112e25c (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs; also git history): the three live functions whose bodies name the table,
--   read with pg_get_functiondef: ingest_image_identity_first(jsonb) (20260625000000_identity_first_image_ingestion.sql),
--   root_identity_by_content(jsonb) (20260702231500_root_identity_by_content.sql) and correct_image_provenance(...)
--   (20260625130000, last replaced by 20260928220000), all SECURITY DEFINER and not executable by anon or authenticated;
--   their callers scripts/photo-sync-daemon.mjs (launchd ag.nuke.photo-sync on the Mac) and
--   scripts/bat-corrections/fix_taken_at.sh (root_identity_by_content has no caller in the repo); scripts/dhash-backfill.mjs,
--   which writes phash_hex directly; the readers scripts/blur-nuke-reconcile-census.mjs and the view image_with_identity;
--   the iOS app (apps/nuke-capture-ios LocalStore.swift keeps a local twin table image_identity and does not call the
--   RPC); the deprecation 20260617080000 and docs/architecture/SUBSTRATE_STABILIZATION_BRIEF_2026-07-08.md (the dHash
--   backfill accounting); the prod migration log supabase_migrations.schema_migrations (6 logged versions name the table,
--   none creates it); cron.job (no command names the table, its view or its three writers); pg_depend (one view);
--   write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here). The last run time of
--   the photo-sync launchd job comes from its local log.
-- LIMITS:
--   The CREATE TABLE is in no repo file, no commit and no logged migration, so the intent of the 16 never-written columns
--   is read from their names. Three batches have no writer in the repo and are described by their content: the 9,609
--   rows inserted in one transaction at 2026-06-26 16:05:39Z, the 254 library_recovery rows and the 20
--   ssd_nukeportable_icloud_download rows. pg_stat_user_tables counters began after the last write (the reset time is not
--   recorded). The table holds personal data (capture coordinates on 10,516 rows, a photographer account and name, local
--   file paths): quoted values are categorical codes, hash formats, key names, column and function names and counts only;
--   no coordinate, id, name, file name or path.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Content-identity ROOT: one row per unique image content (perceptual phash_hex unique, exact
--   content_hash_sha256). The same picture seen from many endpoints collapses to ONE identity. Written FIRST by
--   ingest_image_identity_first()." On prod phash_hex holds a sha256 content hash, not a perceptual hash, on 12,632 rows;
--   12,599 rows (49.4%) were written by root_identity_by_content keyed on content_hash_md5, not by
--   ingest_image_identity_first; and no row carries both the md5 and the sha256 key, so one picture can hold two
--   identities. The new comment keeps the intent and says what the rows are.
--   Column content_hash_md5: it said "MD5 of the stored bytes (= single-part storage etag). Equality key for exact-content
--   joins; algorithm named by the column per hash-tagging doctrine." That text opens the new comment unchanged; fill,
--   writer and clock are added.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_identities IS
'Content-identity root of the image spine: one row per picture content under the key its writer used, so the same bytes reached through several channels can share one identity (grain: one image content per key; three keys, see below). The leaves point here: vehicle_images.image_identity_id (foreign key ON DELETE SET NULL, NOT VALID; 23,382 rows link to 20,651 identities) and image_appearances.image_identity_id (ON DELETE CASCADE; 13,328 appearances of 12,885 identities, one per endpoint sighting). 25,504 rows on 2026-10-07 (the atlas estimate of 24,300 is a stale reltuples); 4,852 (19.0%) have neither a linked image nor an appearance. By first_seen_source: storage_etag_rooting 12,599, capture_relay_ios 4,714, photo_auto_sync 2,279, user_upload 2,092, ssd_blast 1,417, iphoto 1,204, hd_archive 793, library_recovery 254, image_intake 107, daily_receipt 22, ssd_nukeportable_icloud_download 20, daily_receipt_cascade 3. Writers, all SECURITY DEFINER functions closed to anon and authenticated: (1) ingest_image_identity_first(jsonb), the identity-first chokepoint of 20260625000000, inserts with ON CONFLICT (phash_hex) and keys on the caller perceptual hash or, when none is sent, on sha256: plus the content sha256; every caller in the repo sends only the sha256, so phash_hex is an exact-content key on those rows. Its live caller is scripts/photo-sync-daemon.mjs (1,204 iphoto rows on 2026-09-28 17:53Z .. 21:57Z, and 274 conflict updates of rows it met again). (2) root_identity_by_content(jsonb) inserted 12,599 rows keyed on content_hash_md5 (the storage etag) in one run by hand on 2026-07-02 23:09Z and linked 9,540 vehicle_images rows to them; no code in the repo calls it. (3) correct_image_provenance(...) overwrites taken_at and, with a maker name, photographer_name and credit_line, from a cited correction. scripts/dhash-backfill.mjs wrote a 16-hex dHash into phash_hex where it was NULL (7,611 rows, 2026-07-07 .. 07-08). No writer in the repo made the 9,609 rows inserted in one transaction at 2026-06-26 16:05:39Z (owner uploads already in vehicle_images: capture_relay_ios 4,714, photo_auto_sync 2,279, user_upload 2,083, ssd_blast 401, image_intake 107, daily_receipt 22, daily_receipt_cascade 3), the 254 library_recovery rows or the 20 ssd_nukeportable_icloud_download rows. Keys: three content keys share the table and are never compared with each other: content_hash_md5 (12,599 rows), content_hash_sha256 (12,905) and phash_hex (20,496: sha256: prefixed on 12,632, a 16-hex dHash on 7,864). No row carries both md5 and sha256, so a picture rooted once by its storage etag and once by its file hash holds two identities (one such case is visible through vehicle_images.file_hash), and content_hash_sha256 repeats on 2 pairs. 16 of the 40 columns are never written (NULL, {} or empty on every row, 2026-10-07): phash, color_space, bit_depth, iptc_data, xmp_data, lens_info, focal_length_mm, aperture, shutter_speed, iso, copyright_notice, rights_usage_terms, ai_description, ai_tags, ai_scene_type, ai_dominant_colors. The CREATE TABLE is in no repo file, commit or logged migration: the table existed empty when 20260617080000 marked it DEPRECATED, and 20260625000000 revived it. Liveness: no write since 2026-09-28 21:57Z; pg_stat_user_tables shows 0 inserts, updates and deletes, 2 sequential and 1 index scans since its counters began (read 11:21Z, before this work scanned the table); the local log of the launchd job ag.nuke.photo-sync records its last run at 2026-09-29 00:10Z (nothing new). Readers: the view image_with_identity (security_invoker; vehicle_images left-joined to this table for identity_key, content_hash_sha256, photographer_id, identity_taken_at and observation_count; the docs/ledger audit lists it as a dead view with zero code references), scripts/blur-nuke-reconcile-census.mjs (run by hand with the service-role key) and scripts/dhash-backfill.mjs; no edge function, frontend file, cron.job command or policy reads it. docs/ledger lists the table LIVE-PROTECTED and CANONICAL. Nothing else holds a row that points here: image_garments, image_contracts, product_tags and conversion_events (foreign keys) and production_files, assets and ad_placements (an image_identity_id column without one) carry 0 such rows; nuke_production_credits carries 13. Access: RLS is on with no policy, so anon and authenticated read and write nothing (0 rows visible to each under SET LOCAL ROLE, 2026-10-07) although they hold the default table grants; the personal data here (capture coordinates, a photographer account, local file paths) stays behind that. No pipeline_registry row, no write receipts. Clocks: taken_at is the capture time the file reported; first_seen_at, created_at and updated_at are database write times.';

-- ── Identity and content keys ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.id IS
'Surrogate key of the identity, uuid, gen_random_uuid() default, the PRIMARY KEY. 25,504 values (2026-10-07). Referenced by vehicle_images.image_identity_id (foreign key ON DELETE SET NULL, NOT VALID: 23,382 rows, 20,651 identities, 81.0%) and image_appearances.image_identity_id (ON DELETE CASCADE: 13,328 rows, 12,885 identities, 50.5%); the foreign keys from image_garments, image_contracts, product_tags (ON DELETE CASCADE) and conversion_events (no action) have 0 rows behind them; nuke_production_credits carries it on 13 rows without a foreign key. 4,852 identities (19.0%) have neither a linked image nor an appearance: 4,832 storage_etag_rooting rows and the 20 ssd_nukeportable_icloud_download rows. Unit: none (uuid). Source: column default. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.phash IS
'Intended binary perceptual hash, bytea; ingest_image_identity_first would decode it from the hex payload field phash_bytes. NULL on all 25,504 rows (100%, 2026-10-07): no caller in the repo sends phash_bytes. NOT NULL was dropped by 20260702231500. Unit: none (bytes). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.phash_hex IS
'Identity key of ingest_image_identity_first: the target of its ON CONFLICT (phash_hex), backed by the UNIQUE index idx_image_identities_phash (NULLs do not collide). Despite the name it holds three kinds of value (exact, 2026-10-07). sha256: followed by the content sha256 on 12,632 rows (49.5%): the RPC falls back to it when the caller sends no perceptual hash, and every caller in the repo sends only content_sha256; it equals sha256: plus content_hash_sha256 on every such row, 12 of which carry a malformed hash (see content_hash_sha256). A 16-hex 64-bit dHash on 7,864 rows (30.8%): 7,611 storage_etag_rooting rows written by scripts/dhash-backfill.mjs on 2026-07-07 .. 07-08 (hash space dhash boxmean/area-avg 9x8 v2, written only where NULL, never overwritten) and 253 library_recovery rows in an older 16-hex space that the backfill header says must not be Hamming-matched against the first. NULL on 5,008 rows (19.6%): 4,852 with no reachable image, 120 whose image URL was dead and 36 that lost a dHash collision (2026-07-08 brief). So only the 7,611 backfilled values compare as perceptual hashes; the sha256: values are exact-content keys. NOT NULL was dropped by 20260702231500. Read by image_with_identity as identity_key. Unit: none (text). Source: ingest_image_identity_first (caller phash_hex, else the sha256 fallback) and scripts/dhash-backfill.mjs. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.content_hash_sha256 IS
'SHA-256 of the original file bytes as the caller computed it before upload (64 lower-case hex), the exact-content key of the identity-first path; the leaf vehicle_images.file_hash carries the same value on every linked image of a sha256-keyed identity (0 mismatches, 2026-10-07). Filled on 12,905 rows (50.6%): every row of the RPC and seed sources and the 20 ssd_nukeportable_icloud_download rows; NULL on all 12,599 storage_etag_rooting rows. Never set on a row that has content_hash_md5, so an md5-keyed and a sha256-keyed identity of the same picture are not merged. Indexed (idx_image_identities_content_hash) but not unique: 12,903 distinct values; two contents hold two rows each (one library_recovery pair keyed once by sha256: and once by a dHash, one ssd_nukeportable_icloud_download pair). 12 values are not a sha256: 9 user_upload rows hold 12 hex characters and 3 photo_auto_sync rows hold test labels (final_test_, notrigger2_ and usertrigoff_ followed by hex), each mirrored in phash_hex. The RPC keeps the first value on conflict (COALESCE). Read by image_with_identity and scripts/blur-nuke-reconcile-census.mjs (exact match against a local library). Unit: none (hex text). Source: caller content_sha256 (scripts/photo-sync-daemon.mjs hashes the local bytes). Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.content_hash_md5 IS
'MD5 of the stored bytes (= single-part storage etag). Equality key for exact-content joins; algorithm named by the column per hash-tagging doctrine. Added by 20260702231500 with the UNIQUE partial index idx_image_identities_md5. Filled on 12,599 rows (49.4%, 2026-10-07), all first_seen_source storage_etag_rooting, all 32 lower-case hex and distinct; NULL on every other row. Written only by root_identity_by_content(jsonb), which inserted these rows in one run by hand on 2026-07-02 (four transactions, 23:09:27Z .. 23:09:40Z; etags that contain a dash, from multipart uploads, are skipped) and linked 9,540 vehicle_images rows to them; nothing in the repo calls it again. Never set together with content_hash_sha256 or compared with it. Unit: none (hex text). Source: storage.objects etag via root_identity_by_content. Grain: one image content per key. Clock: n/a.';

-- ── First sighting ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.first_seen_at IS
'When the identity row was inserted: NOT NULL, default now() (root_identity_by_content passes now() explicitly), never updated. Equal to created_at on all 25,504 rows (2026-10-07), so it is the ingest time of the first write, not when the picture was first seen at its source. Range 2026-06-25 23:12Z .. 2026-09-28 21:57Z. Unit: timestamptz. Source: column default. Grain: one image content per key. Clock: ingest time.';
COMMENT ON COLUMN public.image_identities.first_seen_source IS
'Channel of the first write, a free-text slug with no CHECK, never updated. Filled on all 25,504 rows (2026-10-07), 12 values: storage_etag_rooting 12,599 (the constant of root_identity_by_content), capture_relay_ios 4,714, photo_auto_sync 2,279, user_upload 2,092, ssd_blast 1,417, iphoto 1,204, hd_archive 793, library_recovery 254, image_intake 107, daily_receipt 22, ssd_nukeportable_icloud_download 20, daily_receipt_cascade 3. Apart from storage_etag_rooting the values are vehicle_images.source slugs: ingest_image_identity_first copies the caller source (default user_upload), and the 2026-06-26 16:05:39Z seed copied the source of the leaf it rooted. A later sighting through another channel shows only in image_appearances. Read by scripts/blur-nuke-reconcile-census.mjs to pick the dHash space. Unit: none (text). Source: writer constant or caller source. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.first_seen_path IS
'Where the first write found the file, from the caller source_path. Filled on 7,947 rows (31.2%, 2026-10-07; 7,426 distinct): 6,723 storage object paths (capture_relay_ios 4,615 under users/<id>/capture-relay/, user_upload 2,083 under <id>/unorganized/, daily_receipt 22 under <id>/daily-receipt/, daily_receipt_cascade 3) and 1,224 file paths on the Mac that ran the sync (iphoto 1,204: a temporary export folder or the Photos library originals; ssd_nukeportable_icloud_download 20: an external volume). NULL on every storage_etag_rooting, photo_auto_sync, ssd_blast, hd_archive, library_recovery and image_intake row. Personal paths, closed to anon and authenticated; none is quoted here. Unit: none (text path). Source: caller source_path. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.original_filename IS
'File name of the original as the caller or the storage object gave it. Filled on 14,077 rows (55.2%, 2026-10-07): storage_etag_rooting 12,599 (the storage object basename passed to root_identity_by_content), iphoto 1,204 (the Photos original name sent by photo-sync-daemon), library_recovery 254, ssd_nukeportable_icloud_download 20; NULL on every seed row and every other source. The RPC writes no file name on the vehicle_images leaf it creates, so the name lives here, in image_appearances.source_filename and in exif_data.original_filename (photo-sync-daemon header). Unit: none (text). Source: caller original_filename or storage basename. Grain: one image content per key. Clock: n/a.';

-- ── File properties ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.mime_type IS
'Media type of the file. Filled on 14,870 rows (58.3%, 2026-10-07): image/jpeg 9,690, image/heic 5,057, image/png 123; NULL on 10,634 rows, every capture_relay_ios, photo_auto_sync, user_upload, ssd_blast, image_intake, daily_receipt and daily_receipt_cascade row. photo-sync-daemon derives it from the file extension; for storage_etag_rooting rows it is the storage object type. Unit: none (media type). Source: caller mime_type or storage metadata. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.file_size_bytes IS
'Size of the file. Filled on 14,616 rows (57.3%, 2026-10-07): storage_etag_rooting 12,599 (storage object size), iphoto 1,204 (local bytes), hd_archive 793, ssd_nukeportable_icloud_download 20; range 994 .. 15,760,365, median 2,515,852. NULL on every other source. Unit: bytes. Source: caller file_size_bytes or storage metadata. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.width_px IS
'Pixel width of the original. Filled on 1,478 rows (5.8%, 2026-10-07): iphoto 1,204 (osxphotos original width), library_recovery 254, ssd_nukeportable_icloud_download 20; range 576 .. 5,712. NULL on every other row, including all storage_etag_rooting rows. Unit: pixels. Source: caller width_px. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.height_px IS
'Pixel height of the original. Filled on the same 1,478 rows as width_px (5.8%, 2026-10-07); range 424 .. 5,712. Unit: pixels. Source: caller height_px. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.color_space IS
'Intended color space of the file. NULL on all 25,504 rows (100%, 2026-10-07): no writer on prod or in the repo sets it and no RPC payload field maps to it. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.bit_depth IS
'Intended bits per channel of the file. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it. Unit: bits. Source: none. Grain: one image content per key. Clock: n/a.';

-- ── Embedded metadata ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.exif_data IS
'Metadata of the file as the writer passed it, a JSON object, default {}, never NULL. Non-empty on 12,536 rows (49.2%, 2026-10-07); {} on 12,968 (every storage_etag_rooting, library_recovery and image_intake row and 8 others). The shape depends on the writer: capture_relay_ios rows carry synced_by capture-relay-ios, uuid, original_filename and, on 4,535, source_type user_library and owner_verified; iphoto rows (photo-sync-daemon) carry the osxphotos exif_info keys (camera_make, camera_model, lens_model, iso, aperture, shutter_speed, focal_length, latitude, longitude, date, tzname and others) plus uuid, original_filename, synced_by photo-sync-daemon, place_name (963 rows) and labels_source (1,131); user_upload and photo_auto_sync rows carry exif_status (complete, minimal or synced_from_photos), DateTimeOriginal, location, gps, camera and technical; hd_archive rows carry metadata_backfill, dimensions, storage_path and CreateDate; ssd_blast rows carry timezone and tz_offset. Location keys are common (location 3,223 rows, gps 2,818, latitude 1,204, place_name 963). The RPC writes the same object on the leaf it creates and does not update it here on a conflict. Unit: none (jsonb). Source: caller exif_data. Grain: one image content per key. Clock: as of created_at.';
COMMENT ON COLUMN public.image_identities.iptc_data IS
'Intended IPTC metadata of the file (caption, credit, rights), a JSON object, default {}. {} on all 25,504 rows (2026-10-07): no writer sets it. Unit: none (jsonb). Source: none (column default). Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.xmp_data IS
'Intended XMP metadata of the file, a JSON object, default {}. {} on all 25,504 rows (2026-10-07): no writer sets it. Unit: none (jsonb). Source: none (column default). Grain: one image content per key. Clock: n/a.';

-- ── Camera and capture ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.camera_make IS
'Camera maker from the file metadata. Filled on 1,602 rows (6.3%, 2026-10-07): iphoto 1,059, capture_relay_ios 269, library_recovery 254, ssd_nukeportable_icloud_download 20. The 269 capture_relay_ios values arrived on 2026-09-28, when photo-sync-daemon sent the same content again and the RPC conflict path filled the empty column (COALESCE keeps the first value). exif_data.camera_make is present on 5,764 rows, so the column is sparser than the JSON. Unit: none (text). Source: caller camera_make (osxphotos exif_info). Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.camera_model IS
'Camera model from the file metadata. Filled on the same 1,602 rows as camera_make (6.3%, 2026-10-07), written the same way (first value kept on conflict); exif_data.camera_model is present on 5,764 rows. Unit: none (text). Source: caller camera_model (osxphotos exif_info). Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.lens_info IS
'Intended lens description. NULL on all 25,504 rows (100%, 2026-10-07): the RPC has no payload field for it; the lens sits in exif_data.lens_model on 1,224 rows. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.focal_length_mm IS
'Intended focal length of the capture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it; exif_data carries focal_length on 1,224 rows and focalLength on 2,602. Unit: millimetres. Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.aperture IS
'Intended aperture of the capture, text. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it; exif_data carries aperture on 1,224 rows and fNumber on 2,602. Unit: f-number (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.shutter_speed IS
'Intended exposure time of the capture, text. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it; exif_data carries shutter_speed on 1,224 rows and exposureTime on 2,602. Unit: seconds (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.iso IS
'Intended ISO sensitivity of the capture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it; exif_data carries iso on 3,826 rows. Unit: ISO speed. Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.taken_at IS
'When the picture was taken, as its source reported it. Filled on 12,898 rows (50.6%, 2026-10-07); NULL on every storage_etag_rooting row although 9,520 of the 9,540 images linked to those rows carry a taken_at. Range 2004-12-21 .. 2026-09-26, never later than created_at; by year 2017 998, 2018 3,981, 2019 2,144, 2020 397, 2021 1,054, 2024 533, 2025 366, 2026 3,125, every other year 130 or fewer. Writers: ingest_image_identity_first from the caller taken_at, keeping the first value on conflict (photo-sync-daemon sends the EXIF DateTimeOriginal that osxphotos reads and falls back to the mutable Photos date); correct_image_provenance overwrites it with a cited correction or NULL and records the original on the linked image (vehicle_images.ai_scan_metadata.provenance_corrections). Equal to the linked vehicle_images.taken_at on 13,627 of 13,835 linked pairs where both are set (98.5%). Indexed (idx_image_identities_taken_at, partial). Read by image_with_identity as identity_taken_at. Unit: timestamptz. Source: caller taken_at or a cited correction. Grain: one image content per key. Clock: event time of capture as the device recorded it (not verified).';
COMMENT ON COLUMN public.image_identities.gps_latitude IS
'Latitude of the capture place from the file metadata, numeric(10,8). Filled on 10,516 rows (41.2%, 2026-10-07), always together with gps_longitude and never at 0,0; NULL on every storage_etag_rooting row. The RPC keeps the first value on conflict. Personal location data: RLS gives anon and authenticated no access, and no coordinate is quoted here. Unit: decimal degrees. Source: caller gps_latitude (file EXIF via osxphotos or the uploader). Grain: one image content per key. Clock: as of taken_at.';
COMMENT ON COLUMN public.image_identities.gps_longitude IS
'Longitude of the capture place from the file metadata, numeric(11,8). Filled on the same 10,516 rows as gps_latitude (41.2%, 2026-10-07), written the same way. Personal location data, closed to anon and authenticated. Unit: decimal degrees. Source: caller gps_longitude. Grain: one image content per key. Clock: as of taken_at.';

-- ── Authorship and rights ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.photographer_name IS
'Name of the maker of the picture, written by correct_image_provenance when a cited correction names one (p_maker_name); the same call writes credit_line and a nuke_production_credits row. Filled on 13 rows (0.05%, 2026-10-07), one distinct value, each with a matching nuke_production_credits row. Personal data: not quoted here, closed to anon and authenticated. Unit: none (text). Source: correct_image_provenance. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.photographer_id IS
'Account that captured the picture, set only when the endpoint is the owner own library: ingest_image_identity_first stores the caller (auth.uid() or the payload user_id) when source_type is camera_capture, direct_upload or local_filesystem and owner_verified is not false, and keeps the first value on conflict; no foreign key. Filled on 3,565 rows (14.0%, 2026-10-07), one distinct auth.users account: iphoto 1,204, ssd_blast 1,016, hd_archive 793, capture_relay_ios 269 (filled on 2026-09-28 by the conflict path), library_recovery 254, ssd_nukeportable_icloud_download 20, user_upload 9; NULL on the other seed rows and every storage_etag_rooting row. Read by image_with_identity. Unit: none (uuid). Source: ingest_image_identity_first. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.copyright_notice IS
'Intended copyright notice of the picture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.credit_line IS
'Credit for the picture, written by correct_image_provenance as the correction kind, the word by and the maker name (kind defaults to work). Filled on the same 13 rows as photographer_name (0.05%, 2026-10-07), all of kind render. Personal data: not quoted here. Unit: none (text). Source: correct_image_provenance. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.rights_usage_terms IS
'Intended usage terms of the picture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';

-- ── AI description (never written) ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.ai_description IS
'Intended AI caption of the picture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it; image analysis results live on vehicle_images and its analysis tables. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.ai_tags IS
'Intended AI tags of the picture, text array, default empty, with a GIN index (idx_image_identities_tags). Empty on all 25,504 rows (non-NULL, 2026-10-07): no writer sets it. Unit: none (text array). Source: none (column default). Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.ai_scene_type IS
'Intended AI scene label of the picture. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it. Unit: none (text). Source: none. Grain: one image content per key. Clock: n/a.';
COMMENT ON COLUMN public.image_identities.ai_dominant_colors IS
'Intended dominant colors of the picture, jsonb. NULL on all 25,504 rows (100%, 2026-10-07): no writer sets it. Unit: none (jsonb). Source: none. Grain: one image content per key. Clock: n/a.';

-- ── Counter and row clocks ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_identities.observation_count IS
'Times ingest_image_identity_first met content it already had: each ON CONFLICT (phash_hex) adds 1; integer, default 0, nullable but filled on every row. Its starting value depends on the writer, so it is not a sighting count (2026-10-07): rows first written by the RPC start at 0 and hold their appearance count minus one (hd_archive 793 of 793, iphoto 1,203 of 1,204, ssd_blast 939 of its 1,016 early rows); the 9,609 rows of the 2026-06-26 16:05:39Z seed started at 1 and equal their appearance count (all 9,609); storage_etag_rooting and ssd_nukeportable_icloud_download rows have no appearance and hold 0. Distribution: 0 on 15,813 rows, 1 on 9,366, 2 on 288, 3 on 24, 4 on 13. Count image_appearances rows for sightings. Read by image_with_identity. Unit: count. Source: ingest_image_identity_first. Grain: one image content per key. Clock: as of updated_at.';
COMMENT ON COLUMN public.image_identities.created_at IS
'When the row was inserted: NOT NULL, default now(), equal to first_seen_at on every row. Range 2026-06-25 23:12Z .. 2026-09-28 21:57Z on 25,504 rows (2026-10-07), 1,470 distinct instants; by day 2026-06-25 25, 06-26 11,573 (9,609 in one transaction at 16:05:39Z, the seed with no writer in the repo, and 1,793 in five transactions at 00:02 .. 00:03Z), 07-02 12,682 (12,599 in four transactions at 23:09Z by root_identity_by_content), 07-07 20, 09-28 1,204 (photo-sync-daemon); nothing since. Unit: timestamptz. Source: column default. Grain: one image content per key. Clock: ingest time.';
COMMENT ON COLUMN public.image_identities.updated_at IS
'When the row was last written: NOT NULL, default now(); no trigger, so it moves only when a writer sets it (the RPC conflict path, correct_image_provenance and scripts/dhash-backfill.mjs). Later than created_at on 8,395 rows (32.9%, 2026-10-07): 2026-06-26 90 (ssd_blast 77 through the RPC conflict path; user_upload 9 and hd_archive 4, each with a taken_at correction recorded on the linked image), 2026-07-02 420 (capture_relay_ios, 18:46 .. 18:48Z, one instant per row; 48 match a taken_at correction recorded on the linked image, and the writer of the other 372 is not recorded), 2026-07-07 4,107 and 07-08 3,504 (dhash-backfill.mjs filling phash_hex on storage_etag_rooting rows), 2026-09-28 274 (the RPC conflict path: capture_relay_ios 269, iphoto 5). Latest 2026-09-28 21:37Z. Unit: timestamptz. Source: the writers named. Grain: one image content per key. Clock: ingest time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.image_identities'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'image_identities: every column has a comment';
  ELSE
    RAISE NOTICE 'image_identities columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
