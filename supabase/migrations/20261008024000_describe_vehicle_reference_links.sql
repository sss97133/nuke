-- Describe vehicle_reference_links: all 7 columns, none had a COMMENT ON COLUMN (0 of 7 described before, catalog count on
-- prod, 2026-10-07), and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Taken in place of image_coverage_by_vehicle, which is fully described (20 of 20).
-- Read-only table in the atlas: 567,325 rows on 2026-10-07 14:24Z by exact count (the atlas estimate of 618,190 is a
-- stale pg_class.reltuples), no write since the statistics counters began; the newest row is from 2026-04-25 06:03Z.
--
-- METHOD (read 2026-10-07 14:24-14:29Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, grants
--   (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint,
--   pg_indexes, pg_trigger, pg_policy and pg_description; the view that reads the table from pg_depend, with its owner,
--   options and grants. Fill, distinct, link_type, match_reason, confidence and linked_at counts (by month, and by day
--   from 2026-03-25) are exact counts over the whole table (88 MB heap, 184 MB in all, read only), as are the count of
--   reference_libraries without a link and of vehicles inserted 2026-04-15 .. 04-24. The joins to vehicles and
--   reference_libraries (orphans, soft-deleted vehicles, whether the library still matches the vehicle, the lag from
--   vehicles.created_at to linked_at) come from a 1% block
--   sample of this table (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 5,141 rows), and the share of vehicles with a
--   link and the vehicle inserts by day in 2026-04 from a 1% block sample of vehicles (9,813 rows), because whole-table
--   joins against vehicles do not fit the 10 s timeout. "Filled" means non-NULL.
--   Writers and readers from code at origin/main bc1b0a4fb (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): 20251122_reference_library_system.sql (this shape, the
--   function get_or_create_library_for_vehicle, the trigger trg_auto_link_vehicle_library on vehicles, two policies and
--   a backfill), 20251122_user_reference_library.sql (drops the table, the function and the trigger),
--   20251203_multi_source_reference_system.sql (another table of the same name, created IF NOT EXISTS, and the table
--   comment found on prod), 20260927170000_p0_4_close_rpc_write_door.sql; the logged migration 20260314031411
--   rls_lockdown_internal_tables (not in the repo; revokes grants, drops no policy); the live bodies, read with pg_get_functiondef, of
--   get_or_create_library_for_vehicle (the only function whose body names the table) and trigger_auto_link_vehicle_library
--   (now a stub); the reader scripts scripts/discovery/configuration-catalog-relations.sql (and its -test copy) and
--   scripts/database-deep-audit.ts; cron.job (no command names the table, the libraries or the function); pg_depend (the
--   view reference_library_stats); pg_trigger (no trigger on this table); write_receipts (no rows); pg_stat_user_tables;
--   pipeline_registry (no row; none is added here).
-- LIMITS:
--   The join facts come from block samples and can miss rare cases. When and by whom trigger_auto_link_vehicle_library
--   was reduced to a stub is not recorded in the repo or the prod migration log; the last link is from 2026-04-25 06:03Z.
--   How 9% of the sampled links lost their vehicle under a validated cascading key is not recorded. Quoted values are
--   link and match codes, column, function and migration names and counts only; no vehicle or library id.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Links vehicles to authoritative reference sources (NHTSA, GM Heritage, JDM, etc.)",
--   the comment of the multi-source table of 20251203_multi_source_reference_system.sql, which never replaced this one.
--   That text stays as the opening, marked as not describing these rows; the new comment says what the rows are (one
--   year, make, series and body library per vehicle), that the writer is stubbed, the orphans, the drift and the access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_reference_links IS
'Links vehicles to authoritative reference sources (NHTSA, GM Heritage, JDM, etc.): that text, from 20251203_multi_source_reference_system.sql, describes another table of the same name that never replaced this one; these rows link a vehicle to nothing from NHTSA or a manufacturer. In fact: the link of one vehicle to one reference_libraries row, the library of its year, make, series and body style that holds contributed manuals, brochures and specs (grain: one vehicle and library pair, PRIMARY KEY (vehicle_id, library_id); in practice one row per vehicle, 567,325 distinct vehicle ids on 567,325 rows, 2026-10-07; the atlas estimate of 618,190 is a stale reltuples). 47,836 of the 48,907 libraries have a link. Shape of 20251122_reference_library_system.sql. Writer: get_or_create_library_for_vehicle(uuid), called by the trigger trg_auto_link_vehicle_library (AFTER INSERT on vehicles, through trigger_auto_link_vehicle_library when year and make are set), found the library with the same year, make (case-insensitive), series and body style or created one, and inserted the link (link_type auto, ON CONFLICT DO NOTHING) in the insert transaction of the vehicle: linked_at equals vehicles.created_at within 5 s on 4,660 of 4,662 sampled links. Links 2025-11-28 .. 2026-04-25 06:03Z, following vehicle inserts (2026-03-26 alone 110,908). Stopped: on prod trigger_auto_link_vehicle_library is now a stub (BEGIN RETURN NEW; END), applied outside the repo and the prod migration log, so the trigger still fires and links nothing; in a 1% block sample of vehicles none of the 1,377 live vehicles created after 2026-04-25 06:03Z has a link, and 4,259 of the 5,263 live vehicles created before with a year and make have one (80.9%). get_or_create_library_for_vehicle has no other caller (no cron job, function or code) and no EXECUTE for anon or authenticated. Not maintained: the link is a snapshot of the vehicle at insert. In a 1% block sample (5,141 links): 479 (9.3%, linked 2026-01-24 .. 03-15) point at a vehicle id that is not in vehicles, despite the validated ON DELETE CASCADE key; 867 (16.9%) at a soft-deleted vehicle (deleted_at set); and of the 4,662 whose vehicle exists, the library year and make still equal the current vehicle on 4,388 (94.1%; the make differs on 257, the year on 3) and year, make, series and body style all on 2,150 (46.1%), although all four matched when the link was made. pg_stat_user_tables since the server last started (2026-09-29 09:20Z; read 14:24Z): 0 inserts, updates and deletes, 0 sequential and 25 index scans. Readers: the view reference_library_stats (vehicle_count per library); scripts/discovery/configuration-catalog-relations.sql and its -test copy; scripts/database-deep-audit.ts lists it. No frontend page, edge function or cron job reads it. Access: RLS is on with no policy (the two policies of 20251122 are absent) and anon and authenticated hold no privilege (revoked by the logged migration 20260314031411 rls_lockdown_internal_tables). The one path around that: reference_library_stats (owner postgres, not security_invoker, SELECT granted to anon and authenticated) returns the per-library link counts, aggregates only. Prod also differs from the repo in its indexes: idx_ref_links_vehicle comes from 20251203 and duplicates the leading column of the primary key, and idx_vehicle_ref_links_vehicle of 20251122 is absent; the drop in 20251122_user_reference_library.sql is not reflected on prod. No pipeline_registry row and no write receipts. Clocks: linked_at is the insert time of the vehicle; nothing records the year, make, series or body style the link was made from.';

-- ── Key ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_reference_links.vehicle_id IS
'Vehicle that was linked: a vehicles.id, NOT NULL, foreign key ON DELETE CASCADE (validated), the leading column of the PRIMARY KEY (vehicle_id, library_id) and also indexed alone (idx_ref_links_vehicle, redundant with the key). 567,325 distinct values on 567,325 rows (2026-10-07): every vehicle has at most one link. In a 1% block sample, 479 of 5,141 values (9.3%, linked 2026-01-24 .. 03-15) are not in vehicles and 867 (16.9%) belong to soft-deleted vehicles; how the cascade was skipped is not recorded. Unit: none (uuid). Source: the vehicle insert that fired trg_auto_link_vehicle_library. Grain: one vehicle and library pair. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_reference_links.library_id IS
'Reference library the vehicle was linked to: a reference_libraries.id (one library per year, make, model, series and body style), NOT NULL, foreign key ON DELETE CASCADE (validated), part of the PRIMARY KEY, indexed (idx_vehicle_ref_links_library). 47,836 distinct values (2026-10-07); 1,071 of the 48,907 libraries have no link. get_or_create_library_for_vehicle chose the library whose year, make (ILIKE), series and body style equalled the vehicle, NULL matching NULL, or created one from the vehicle. In a 1% block sample of links whose vehicle exists, the library year and make still equal the vehicle on 94.1% and all four fields on 46.1%: later edits to the vehicle are not carried here. Read by reference_library_stats (vehicle_count). Unit: none (uuid). Source: get_or_create_library_for_vehicle. Grain: one vehicle and library pair. Clock: as of linked_at.';

-- ── Link facts ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_reference_links.link_type IS
'How the link was made, text, nullable, default auto (the creating migration names auto, manual and suggested). auto on all 567,325 rows (2026-10-07): no link was made by a person. Unit: none (text code). Source: get_or_create_library_for_vehicle (constant auto). Grain: one vehicle and library pair. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_reference_links.confidence IS
'Intended confidence of the link, integer, nullable, default 100. 100 on all 567,325 rows (2026-10-07): the writer never sets it, so the value is the default and carries no information. Unit: none (score, never computed). Source: column default. Grain: one vehicle and library pair. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_reference_links.match_reason IS
'Why the library was chosen, text, nullable. 2 values (2026-10-07): year_make_match 566,795 and exact_series_match 530. Set by get_or_create_library_for_vehicle from the vehicle alone: exact_series_match when the vehicle had a series at link time, else year_make_match; in both cases the library also matched the series (NULL to NULL) and body style, so the code names whether a series was present, not how loose the match was. Unit: none (text code). Source: get_or_create_library_for_vehicle. Grain: one vehicle and library pair. Clock: as of linked_at.';
COMMENT ON COLUMN public.vehicle_reference_links.linked_at IS
'When the link was made, timestamptz, nullable, default now(): the transaction clock of the vehicle insert that fired the trigger, equal to vehicles.created_at within 5 s on 4,660 of 4,662 sampled links (2026-10-07). Filled on every row: 2025-11-28 13:25Z .. 2026-04-25 06:03Z; by month 2025-11 15, 2025-12 5,771, 2026-01 189,974, 2026-02 155,632, 2026-03 181,649, 2026-04 34,284 (none from 2026-04-15 to 04-24, when no vehicle was inserted, by exact count, and none after 2026-04-25 06:03Z, when the trigger function was stubbed). Unit: timestamptz. Source: column default. Grain: one vehicle and library pair. Clock: ingest time of the vehicle.';
COMMENT ON COLUMN public.vehicle_reference_links.linked_by IS
'Account that made a manual link: an auth.users id, nullable, foreign key without ON DELETE action (validated). NULL on all 567,325 rows (2026-10-07): every link is automatic. Unit: none (uuid). Source: none (never written). Grain: one vehicle and library pair. Clock: n/a.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_reference_links'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_reference_links: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_reference_links columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
