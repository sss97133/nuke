-- GENERATES a reversible merge plan (text). Read-only: one SELECT, nothing is executed or changed.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -v winner=<uuid> -v loser=<uuid> -f scripts/garage/merge-plan.sql > plan.sql
-- Review plan.sql, then run it yourself in a migration/transaction. The sanctioned whole-record merge is
-- merge_into_primary (it also carries permissions, receipts, organization links); this plan is the image-level,
-- fully reversible variant for review of a suspected duplicate. It:
--   1 backs up the loser's images and both vehicle rows into schema backup_garage_merge_<loser>_<date>
--   2 moves the images to the winner, recording merged_from_vehicle_id = loser
--   3 sets vehicles.merged_into_vehicle_id = winner on the loser (the row is kept)
-- The INVERSE statements are emitted commented out, so piping the whole file never undoes the merge.
-- If vehicle_image_filing_gate is enabled, step 2 may file contradicting images as 'mismatch'; that is intended.
-- After either direction, rerun derive_vehicle_relationships for the affected accounts.
WITH p AS (
  SELECT :'winner'::uuid AS w, :'loser'::uuid AS l,
         'backup_garage_merge_' || substr(replace(:'loser', '-', ''), 1, 12) || '_' || to_char(now(), 'YYYYMMDD') AS bk
), chk AS (
  SELECT p.*, CASE
      WHEN p.w = p.l THEN 'winner and loser are the same vehicle'
      WHEN NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p.w AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL)
        THEN 'winner is missing, deleted or itself merged'
      WHEN NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p.l AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL)
        THEN 'loser is missing, deleted or already merged'
    END AS problem,
    (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = p.l) AS n_images
  FROM p
)
SELECT s.stmt FROM chk CROSS JOIN LATERAL (
  SELECT 0 AS ord, '-- REFUSED: ' || chk.problem AS stmt WHERE chk.problem IS NOT NULL
  UNION ALL SELECT o, t FROM (VALUES
    (1, format('-- merge plan: loser %s into winner %s; %s images to move; generated %s (not executed)', chk.l, chk.w, chk.n_images, now())),
    (2, 'BEGIN;'),
    (3, 'SET LOCAL lock_timeout = ''5s''; SET LOCAL statement_timeout = ''60s'';'),
    (4, format('CREATE SCHEMA %I;', chk.bk)),
    (5, format('CREATE TABLE %I.vehicle_images AS SELECT * FROM public.vehicle_images WHERE vehicle_id = %L;', chk.bk, chk.l)),
    (6, format('CREATE TABLE %I.vehicles AS SELECT * FROM public.vehicles WHERE id IN (%L, %L);', chk.bk, chk.w, chk.l)),
    (7, format('UPDATE public.vehicle_images SET vehicle_id = %L, merged_from_vehicle_id = %L WHERE id IN (SELECT id FROM %I.vehicle_images);', chk.w, chk.l, chk.bk)),
    (8, format('UPDATE public.vehicles SET merged_into_vehicle_id = %L WHERE id = %L AND merged_into_vehicle_id IS NULL;', chk.w, chk.l)),
    (9, format('-- verify (expect 0): SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = %L;', chk.l)),
    (10, 'COMMIT;'),
    (11, '-- ===== INVERSE: uncomment and run in one transaction to undo =====' ),
    (12, '-- BEGIN;'),
    (13, format('-- UPDATE public.vehicle_images vi SET vehicle_id = b.vehicle_id, merged_from_vehicle_id = b.merged_from_vehicle_id FROM %I.vehicle_images b WHERE vi.id = b.id;', chk.bk)),
    (14, format('-- UPDATE public.vehicles SET merged_into_vehicle_id = NULL WHERE id = %L;', chk.l)),
    (15, '-- COMMIT;')
  ) x(o, t) WHERE chk.problem IS NULL
) s(ord, stmt)
ORDER BY s.ord;
