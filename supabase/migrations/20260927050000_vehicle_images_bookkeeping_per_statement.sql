-- vehicle_images: vehicle-level bookkeeping runs once per INSERT statement, not once per row.
--
-- WHY (measured 2026-09-27 16:41–16:54Z, session cb179857): 10 BaT lots written by the deployed
-- extract-bat-core v4 took 25–100 s each (75.6 s average); the time correlates with the lot's image
-- count (r = 0.77, ≈ 0.45 s per vehicle_images row). The reader inserts a lot's gallery in ONE
-- statement (78–241 link rows), and four AFTER INSERT ... FOR EACH ROW triggers then do VEHICLE-level
-- work for every row:
--   trg_vehicle_images_count      update_vehicle_image_count()   → UPDATE vehicles (38 vehicle triggers) per row
--   trg_ars_on_image_insert       trigger_ars_on_image()         → recompute_ars_dimension(vehicle,'photos') per row
--   trg_regrade_on_image          trigger_regrade_vehicle()      → persist_vehicle_grade(vehicle): compute + INSERT vehicle_grades per row
--   trg_sync_vehicle_primary_image sync_vehicle_primary_image()  → recompute_vehicle_primary_image(vehicle) per row
-- A 150-image lot therefore updates its vehicles row ~300 times and writes ~150 vehicle_grades rows.
-- The 66,527 lots prod never had carry ~7M images: at 0.45 s per row that is weeks of database time
-- for bookkeeping whose answer is the same after the first row of the statement.
--
-- WHAT CHANGES: the INSERT leg of those four triggers becomes FOR EACH STATEMENT with the transition
-- table (REFERENCING NEW TABLE), doing the same work once per distinct vehicle in the statement.
-- Single-row inserts (the app, the camera) behave exactly as before — one row, one vehicle, one pass.
-- The DELETE / UPDATE legs keep their row triggers and functions unchanged. The row functions stay
-- defined for any other caller. Nothing is dropped that holds data.
--
-- SCHEMA_LAW: §1 the organs exist (same functions, same targets); §4 nothing overwritten — the
-- derived columns (image_count, has_photos, primary image, grade, ARS) are recomputed from the same
-- rows; §5 invariants unchanged; §7 CI-applied. Verify after apply with the query at the bottom.

-- ── statement-level variants ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_vehicle_image_count_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE vehicles v
     SET image_count = (SELECT count(*) FROM vehicle_images i
                         WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE v.id IN (SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_ars_on_image_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL LOOP
    BEGIN
      PERFORM recompute_ars_dimension(v, 'photos');
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- as the row trigger: never block the insert
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_regrade_vehicle_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL LOOP
    BEGIN
      PERFORM persist_vehicle_grade(v);
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- as the row trigger: grading never blocks the insert
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vehicle_primary_image_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- same self-recursion stop as the row trigger
  FOR v IN SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL LOOP
    PERFORM recompute_vehicle_primary_image(v);
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── re-point the INSERT legs (DELETE / UPDATE legs unchanged) ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_vehicle_images_count ON public.vehicle_images;
CREATE TRIGGER trg_vehicle_images_count
  AFTER DELETE OR UPDATE OF vehicle_id, is_duplicate ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.update_vehicle_image_count();
CREATE TRIGGER trg_vehicle_images_count_insert_stmt
  AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.update_vehicle_image_count_stmt();

DROP TRIGGER IF EXISTS trg_ars_on_image_insert ON public.vehicle_images;
CREATE TRIGGER trg_ars_on_image_insert
  AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trigger_ars_on_image_stmt();

DROP TRIGGER IF EXISTS trg_regrade_on_image ON public.vehicle_images;
CREATE TRIGGER trg_regrade_on_image
  AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trigger_regrade_vehicle_stmt();

DROP TRIGGER IF EXISTS trg_sync_vehicle_primary_image ON public.vehicle_images;
CREATE TRIGGER trg_sync_vehicle_primary_image
  AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_primary_image();
CREATE TRIGGER trg_sync_vehicle_primary_image_insert_stmt
  AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_vehicle_primary_image_stmt();

COMMENT ON FUNCTION public.update_vehicle_image_count_stmt() IS
  'Statement-level twin of update_vehicle_image_count() for INSERT: one vehicles UPDATE per distinct vehicle in the statement (2026-09-27; a 150-row gallery insert updated its vehicle 150 times).';
COMMENT ON FUNCTION public.trigger_regrade_vehicle_stmt() IS
  'Statement-level twin of trigger_regrade_vehicle() for INSERT: persist_vehicle_grade once per distinct vehicle in the statement (2026-09-27).';
COMMENT ON FUNCTION public.trigger_ars_on_image_stmt() IS
  'Statement-level twin of trigger_ars_on_image() for INSERT: recompute_ars_dimension(vehicle, photos) once per distinct vehicle in the statement (2026-09-27).';
COMMENT ON FUNCTION public.sync_vehicle_primary_image_stmt() IS
  'Statement-level twin of sync_vehicle_primary_image() for INSERT: recompute_vehicle_primary_image once per distinct vehicle in the statement (2026-09-27).';

-- Live verification (after apply):
--   select tgname, tgtype & 1 = 0 as per_statement from pg_trigger
--    where tgrelid = 'public.vehicle_images'::regclass and tgname like 'trg_%' order by 1;
--   -- one lot through extract-bat-core: image_count = gallery size, has_photos true, primary_image_url set,
--   -- one vehicle_grades row (not one per image); per-call time well under 10 s on a 150-image lot.
