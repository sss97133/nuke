-- GENERATES a reversible split plan (text). Read-only: one SELECT, nothing is executed or changed.
-- Use when one vehicle row mixes two cars: the listed images move to a NEW vehicle row.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -v source=<uuid> -v image_ids='<uuid>,<uuid>' \
--        -v year=1984 -v make=Chevrolet -v model=Suburban -f scripts/garage/split-plan.sql > plan.sql
-- Steps: back up the listed images and the source row into schema backup_garage_split_<source>_<date>;
-- insert the new vehicle (new id fixed at generation time, owner copied from the source, not public); move the images.
-- Adjust the INSERT if vehicles has NOT NULL columns without defaults. The INVERSE is emitted commented out:
-- it returns the images from the backup and retires the new row with deleted_at (rows are never deleted).
-- Refuses when any listed image is not currently on the source vehicle.
-- Afterwards rerun derive_vehicle_relationships for the affected accounts.
WITH p AS (
  SELECT :'source'::uuid AS s, string_to_array(:'image_ids', ',')::uuid[] AS ids, gen_random_uuid() AS nv,
         :'year'::int AS yr, :'make'::text AS mk, :'model'::text AS md,
         'backup_garage_split_' || substr(replace(:'source', '-', ''), 1, 12) || '_' || to_char(now(), 'YYYYMMDD') AS bk
), chk AS (
  SELECT p.*, CASE
      WHEN NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p.s AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL)
        THEN 'source is missing, deleted or merged'
      WHEN cardinality(p.ids) = 0 THEN 'no image ids listed'
      WHEN (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY (p.ids) AND vi.vehicle_id = p.s) <> cardinality(p.ids)
        THEN 'some listed images are not on the source vehicle'
    END AS problem
  FROM p
)
SELECT s.stmt FROM chk CROSS JOIN LATERAL (
  SELECT 0 AS ord, '-- REFUSED: ' || chk.problem AS stmt WHERE chk.problem IS NOT NULL
  UNION ALL SELECT o, t FROM (VALUES
    (1, format('-- split plan: %s images of %s move to new vehicle %s (%s %s %s); generated %s (not executed)', cardinality(chk.ids), chk.s, chk.nv, chk.yr, chk.mk, chk.md, now())),
    (2, 'BEGIN;'),
    (3, 'SET LOCAL lock_timeout = ''5s''; SET LOCAL statement_timeout = ''60s'';'),
    (4, format('CREATE SCHEMA %I;', chk.bk)),
    (5, format('CREATE TABLE %I.vehicle_images AS SELECT * FROM public.vehicle_images WHERE id = ANY (%L::uuid[]);', chk.bk, chk.ids::text)),
    (6, format('CREATE TABLE %I.vehicles AS SELECT * FROM public.vehicles WHERE id = %L;', chk.bk, chk.s)),
    (7, format('INSERT INTO public.vehicles (id, year, make, model, user_id, is_public) SELECT %L, %s, %L, %L, v.user_id, false FROM public.vehicles v WHERE v.id = %L;', chk.nv, chk.yr, chk.mk, chk.md, chk.s)),
    (8, format('UPDATE public.vehicle_images SET vehicle_id = %L WHERE id IN (SELECT id FROM %I.vehicle_images) AND vehicle_id = %L;', chk.nv, chk.bk, chk.s)),
    (9, format('-- verify (expect %s): SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = %L;', cardinality(chk.ids), chk.nv)),
    (10, 'COMMIT;'),
    (11, '-- ===== INVERSE: uncomment and run in one transaction to undo ====='),
    (12, '-- BEGIN;'),
    (13, format('-- UPDATE public.vehicle_images vi SET vehicle_id = b.vehicle_id FROM %I.vehicle_images b WHERE vi.id = b.id;', chk.bk)),
    (14, format('-- UPDATE public.vehicles SET deleted_at = now() WHERE id = %L;', chk.nv)),
    (15, '-- COMMIT;')
  ) x(o, t) WHERE chk.problem IS NULL
) s(ord, stmt)
ORDER BY s.ord;
