-- Owner gap (C28, data-machine-cases.md section 12): declare the writers of vehicle_observations in pipeline_registry.
--
-- WHY. public.v_residual tags vehicle_observations "owner" (rank_mrows 11.2, third, read 2026-10-09 08:39Z): its
-- table-level pipeline_registry row names ingest-observation as owner with write_via NULL, and write_receipts holds 288
-- statements from an undeclared writer in the 30 days to 2026-10-09. The two tables ranked above it
-- (vehicle_images 52.5, auction_comments 20.1) carry only residue: their last undeclared receipts are
-- 2026-10-07 00:10:58Z and 2026-10-05 17:00:12Z, from writers that send X-Nuke-Writer since (#718, #719, #651) and are
-- already named in their registry rows, so no declaration can close them; they age out on 2026-11-06 and 2026-11-04.
-- vehicle_observations is the highest-ranked owner gap with a writer still writing undeclared.
--
-- EVIDENCE (read-only, 2026-10-09 08:39-08:47Z, through scripts/data/q.sh). Each undeclared receipt was matched to the
-- observation rows inserted in the same transaction (write_receipts.at = vehicle_observations.ingested_at, both now()):
--   274 receipts 2026-10-06 12:10Z .. 2026-10-07 00:10Z: extraction_method gatsby_json_parse = extract-gooding, before
--       its X-Nuke-Writer header (#718, live 2026-10-07 01:28Z per the lane log); no undeclared receipt from it since.
--   10 receipts 2026-10-08 05:12:58Z .. 08:20:52Z: extraction_method garage_owner_correction_v1 = the SQL function
--       record_garage_owner_correction (migrations 20261008050000, 20261008080000), SECURITY DEFINER, EXECUTE granted
--       to authenticated and service_role. No caller is in the repo (the web garage and the iOS app only read through
--       get_my_garage_owner_corrections); the 10 statements came through PostgREST as db_role postgres. It inserts into
--       vehicle_observations directly and sets no app.writer, so record_write_receipt labels its statements
--       'undeclared'. Live body checked: prosrc has no app.writer (md5 ac650567069cc5a4bd61c5679a9a3a44).
--   3 receipts 2026-10-04 .. 10-05: extraction_method dom_parse; 1 receipt 2026-10-06 06:40Z through mgmt-api with no
--       observation row at the same instant. Writers not identified; both stopped.
--   Header-declared writers in write_receipts over the same 30 days: extract-bat-core, extract-cars-and-bids-core,
--   extract-gooding, import-pcarmarket-listing, ingest, ingest-observation (v_schema_atlas.writers_30d).
--
-- WHAT. One guarded UPDATE that fills the table-level row's empty write_via with those writers, in the idiom of
-- 20261007160000 (append, skip when already named). owned_by, description and do_not_write_directly are unchanged.
-- No table, column, function or testimony row is touched.
--
-- STILL OPEN AFTER THIS (a declaration cannot close it): the owner tag stays until record_garage_owner_correction
-- labels its writes (set_config('app.writer', ..., true) inside its body: a function change with its own contract,
-- left to the owning lane) and the 288 undeclared receipts age out of the 30-day window (the last on
-- 2026-10-08 08:20:52Z, so 2026-11-07 if no new ones land).
--
-- MEASURED BEFORE: write_via NULL; 7 writers in the 30-day receipts (6 header labels + the undeclared garage writer),
-- 1 of them (ingest-observation) named in the row. EXPECTED AFTER: 7 of 7 named.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

UPDATE public.pipeline_registry
SET write_via = coalesce(write_via || ' ', '') ||
      'Writers seen in write_receipts, 30 days to 2026-10-09: ingest-observation (the owner; atom writes); ingest, '
   || 'extract-bat-core, extract-cars-and-bids-core, extract-gooding and import-pcarmarket-listing (X-Nuke-Writer '
   || 'header; extract-gooding wrote undeclared until its header deployed on 2026-10-07); '
   || 'record_garage_owner_correction (migrations 20261008050000 and 20261008080000: SECURITY DEFINER SQL function, '
   || 'called over PostgREST RPC; inserts account owner corrections with extraction_method garage_owner_correction_v1 '
   || 'directly and sets no app.writer, so its receipts read undeclared).',
    updated_at = now()
WHERE table_name = 'vehicle_observations' AND column_name IS NULL
  AND coalesce(write_via, '') NOT LIKE '%record_garage_owner_correction%';

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.pipeline_registry
  WHERE table_name = 'vehicle_observations' AND column_name IS NULL
    AND write_via LIKE '%record_garage_owner_correction%';
  RAISE NOTICE 'vehicle_observations table-level registry rows naming record_garage_owner_correction: %', n;
END
$$;

COMMIT;
