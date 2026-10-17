-- Describe production_files: all 22 columns (none had a comment) and a table comment (it had none; the atlas purpose
-- was null). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Ranked by (n_cols - n_cols_described) * ln(greatest(est_rows,0) + 1) over
-- v_schema_atlas at 2026-10-11 08:30Z: score 253.4, est_rows 100,579; 100,579 rows by exact count at 08:36Z.
--
-- METHOD (read 2026-10-11 08:36-08:40Z UTC, read-only):
--   Columns, types, defaults, NOT NULL and pg_stats (null_frac, n_distinct) from pg_attribute, pg_attrdef and pg_stats;
--   constraints, indexes, triggers, policies, row security and anon/authenticated SELECT privilege from pg_constraint,
--   pg_indexes, pg_trigger, pg_policy, pg_class and has_table_privilege; the v_schema_atlas row; exact counts over all
--   rows by file_type (hashed, role, publication fills, size range) and by source_type and created day (indexed_at
--   range, path form, 64-character hashes).
--   Writers from code at origin/main 3d9c76346: tools/publishing/scan_archive.py (walks two local folders into a local
--   SQLite production_files table: stat, filename parse, optional hash pass) and tools/publishing/ingest_publishing_data.py
--   (ingest_production_files: copies the SQLite rows into this table once, with the home prefix stripped from paths;
--   skips when the table already has rows). tools/publishing/publishing_migration.py adds owner_id if missing. No
--   migration in supabase/migrations creates the table, and no edge function or frontend file in the repo reads it; on
--   prod no public function body and no view names it (pg_proc.prosrc, pg_views, 08:40Z).
-- LIMITS:
--   The CREATE TABLE is not in the repo (drift), so who chose the uuid columns issue_id, story_id, image_identity_id and
--   source_drive, and which tables they were meant to reference, is not recorded. Directory, path, filename and
--   parsed_story values carry private names; no value is quoted here.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

comment on table public.production_files is
  'File index of a magazine publishing archive (one row per file found on a local disk scan, grain: file path). Written '
  'once on 2026-04-14 by tools/publishing/ingest_publishing_data.py from the local SQLite index built by '
  'tools/publishing/scan_archive.py on 2026-04-09; no writer since (atlas: read-only, no last_write). Metadata only: '
  'no file bytes are stored. Row security is on with no policy, so only the service role reads it; paths and names are '
  'private. No foreign keys in or out; no reader in the repo.';

comment on column public.production_files.id is
  'Row key (uuid, gen_random_uuid()), minted at insert into Postgres. Not the local SQLite integer id.';

comment on column public.production_files.file_path is
  'Path of the file relative to the scanned home folder (text, NOT NULL): ingest_publishing_data.py strips the local home '
  'prefix (relativize_path); every row starts with Documents/ or DUPLICATES (0 absolute paths, 08:38Z). Distinct per row '
  '(pg_stats n_distinct -1) but no unique constraint. Private: folder names carry people''s and companies'' names.';

comment on column public.production_files.filename is
  'File name with extension, as found on disk (text, NOT NULL). About 40% distinct (pg_stats n_distinct -0.40): the '
  'same name recurs across folders and across the two scanned roots.';

comment on column public.production_files.directory is
  'Containing folder of the file, relative to the home folder like file_path (text). 6,008 distinct folders (pg_stats). '
  'Private for the same reason as file_path.';

comment on column public.production_files.file_extension is
  'File extension including the dot, lower-cased at scan (text: .jpg, .pdf, .emlx, .otf, .indd); the empty string when '
  'the name has none. 76 distinct (pg_stats). file_type is derived from it.';

comment on column public.production_files.file_size_bytes is
  'File size in bytes from os.stat at the scan of 2026-04-09 (bigint). Files under 1,024 bytes were skipped by the '
  'scanner, so the minimum is 1,027. Over 52,428,800 bytes (50 MiB) the file was tagged large and never hashed.';

comment on column public.production_files.content_hash_sha256 is
  'Hex SHA-256 from scan_archive.py --hash (text; UNIQUE production_files_content_hash_sha256_key). Filled on 2,289 of '
  '100,579 rows (2.3%): the hash pass covered few files. Not always a whole-content hash: for files over 10 MiB the '
  'scanner hashes the first MiB, the size and the last MiB. Null when not hashed, timed out (10 s) or large. The ingest '
  'deduplicates on it (ON CONFLICT DO NOTHING), which removes only hashed duplicates.';

comment on column public.production_files.file_type is
  'File class derived from file_extension by scan_archive.py EXT_MAP (text): image_processed, image_raw, pdf, font, '
  'indesign, photoshop, illustrator, document, spreadsheet, video, else other; the suffix '' (large, no hash)'' marks '
  'files over 50 MiB. 19 distinct values (08:37Z). Derived, not read from file contents.';

comment on column public.production_files.production_role is
  'Production role inferred from the upper-cased path by scan_archive.py classify_production_role (text): bat (proof '
  'for approval), layout, source (retouching), print_ready, final, ad_creative, brand_asset (media kit) or reference '
  '(flatplan); null when no rule matches (85.4%, pg_stats). A path heuristic, not a recorded role.';

comment on column public.production_files.issue_id is
  'uuid meant to link the file to a magazine issue. Unused: null on all rows, set by no writer in the repo, and no '
  'foreign key names its table (index idx_production_files_issue exists). Target table Unknown.';

comment on column public.production_files.story_id is
  'uuid meant to link the file to a story. Unused: null on all rows, set by no writer in the repo, no foreign key. '
  'Target table Unknown.';

comment on column public.production_files.image_identity_id is
  'uuid meant to link an image file to an image identity. Unused: null on all rows, set by no writer in the repo, no '
  'foreign key. The image_identities table comment (migration 20261007220000) lists it among unkeyed image_identity_id '
  'columns; that it was meant to reference image_identities is a reading of the name, not a recorded fact.';

comment on column public.production_files.source_drive is
  'Name of the drive the file was found on (text). Unused: null on all rows; the ingest does not send it.';

comment on column public.production_files.source_type is
  'Which scanned root the file came from (text, default ''local'', never used): archives (the Documents/Archives '
  'folder, 59,548 rows) or duplicates_ssd (the DUPLICATES_FOR_SSD folder, 41,031 rows). The ingest copies '
  'the scanner''s source_directory label into it.';

comment on column public.production_files.parsed_publication is
  'Publication code matched in the full path by scan_archive.py (text, upper-cased): LOFFICIEL, LOFSBH, LOFRIV, LOSBH or '
  'OFSBH. Filled on 28.7% (pg_stats). A filename heuristic; a code in a folder name tags every file below it.';

comment on column public.production_files.parsed_issue_number is
  'Issue number: the digits right after the publication code in the path, as text without leading zeros (88 distinct). '
  'Filled on 2.3% (pg_stats). A filename heuristic, not checked against any issue list.';

comment on column public.production_files.parsed_story is
  'Story label: the words after the publication code and issue digits in the file name, with version and stage '
  'suffixes removed (text, 230 distinct). Filled on 2.1% (pg_stats). Often a person''s name: private. A heuristic, not a '
  'story key.';

comment on column public.production_files.parsed_version is
  'Version token from the file name, as written (text): vN, edit N, FINAL, SR or last, first match. Case is not '
  'normalized (v1 and V1 both occur; 77 distinct). Filled on 2.4% (pg_stats).';

comment on column public.production_files.parsed_stage is
  'Production stage keyword from the full path, upper-cased (text): BAT (proof for approval), MAQUETTE (layout), '
  'RETOUCHE (retouching), PRINT, PROOF, CDF (flatplan) or PUB (advertisement). Filled on 11.1% (pg_stats).';

comment on column public.production_files.indexed_at is
  'Scan clock: when scan_archive.py recorded the file in the local SQLite index (timestamptz, NOT NULL; SQLite '
  'datetime(''now''), UTC). All rows fall on 2026-04-09 between 11:05:37 and 11:21:18 UTC. Not the file''s own '
  'modification time, which the scanner kept locally (file_modified_at) and the ingest did not copy.';

comment on column public.production_files.created_at is
  'Ingest clock: when the row was inserted into Postgres (timestamptz, NOT NULL, default now()). All rows on 2026-04-14 '
  '(UTC), five days after indexed_at.';

comment on column public.production_files.owner_id is
  'Owner scope (uuid). One value on every row: the fixed operator placeholder uuid set by ingest_publishing_data.py '
  '(OWNER_ID; the script says these ids "will link to auth accounts later"). It matches no auth.users row (read '
  '2026-10-11 08:40Z) and has no foreign key. No policy reads it: row security is on with no policy, so access is '
  'service role only.';

commit;
