-- labor_shared_reads_v1: the labor appraisal's two inputs become shared reads instead of whole readers.
--
-- WHY. Measured 2026-11-24 (server clock, proof vehicle): vehicle_labor_appraisal took 5-7 s logged out and timed out once
-- at 15 s. vehicle_build_reconstruction cost 4-5 s of it and receipt_work_lines about 1 s (called twice: by the reader and
-- by the reconstruction), yet the reader uses only three things from them: each receipt line's kind and words, each
-- system's shop-paper lines and hours, and the paint build phases photographed. The line read with both classifiers
-- costs 21 ms; the photo-phase read 164 ms. The cost is photo matching per line and the reconstruction's other lenses.
--
-- WHAT CHANGES (no reader output changes for any existing caller).
--   * receipt_work_lines(vehicle, window, 0): max_images = 0 is the line read only. No frame is matched, and each part
--     line's conclusion says photos_not_read instead of a photo finding. No stored question context uses 0 (checked
--     live: 292 contexts say 8, 482 carry none). Other values are unchanged.
--   * receipt_line_work_kind(kind, part_number, description): the reconstruction's rule that a priced line with no part
--     number whose words are work is shop work ('service'), moved out of the reconstruction into one function.
--   * vehicle_reviewed_phase_frames(vehicle): the reconstruction's current reviewed reading of each photo a visitor may
--     see (build phase, scene, paint state, print or not), moved into one function. No visibility check of its own: the
--     caller checks the vehicle. EXECUTE is revoked from anon and authenticated.
--   * vehicle_build_reconstruction reads both instead of carrying its own copies.
-- vehicle_labor_appraisal adopts them in the next migration (labor_reader_fast_v1).
--
-- REVERT. Restore the anchors below in place of the calls; drop the two functions; remove the p_max_images lines.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.receipt_line_work_kind(p_line_kind text, p_part_number text, p_description text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  -- a priced line with no part number whose words are work, not a product: shop work billed without hours
  SELECT CASE WHEN p_line_kind = 'part' AND p_part_number IS NULL AND lower(p_description) ~
                   '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
              THEN 'service' ELSE p_line_kind END
$fn$;
COMMENT ON FUNCTION public.receipt_line_work_kind(text, text, text) IS
  'labor_shared_reads_v1: receipt_line_kind with shop work billed without hours read as service. One copy, used by vehicle_build_reconstruction and vehicle_labor_appraisal.';

CREATE OR REPLACE FUNCTION public.vehicle_reviewed_phase_frames(p_vehicle_id uuid)
RETURNS TABLE (image_id uuid, image_url text, taken_at timestamptz, phase text, scene text, paint_state text, is_print boolean)
LANGUAGE sql STABLE
SET search_path TO 'pg_catalog', 'public'
AS $fn$
  -- the current reviewed reading of each photo a visitor may see: its build phase, and whether the photo is of a print
  SELECT DISTINCT ON (i.id) i.id, i.image_url, i.taken_at, o.structured_data ->> 'build_phase_guess',
         o.structured_data ->> 'scene_type', o.structured_data #>> '{state_observations,paint_state}',
         public.photo_reading_is_print(o.structured_data)
    FROM public.vehicle_observations o
    JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = p_vehicle_id
   WHERE o.vehicle_id = p_vehicle_id
     AND o.extraction_method = 'reviewed_image_analysis_v1' AND o.is_superseded IS NOT TRUE
     AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
     AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false
   ORDER BY i.id, o.id
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_reviewed_phase_frames(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_reviewed_phase_frames(uuid) TO service_role;
COMMENT ON FUNCTION public.vehicle_reviewed_phase_frames(uuid) IS
  'labor_shared_reads_v1: current reviewed_image_analysis_v1 reading per gallery-eligible, non-sensitive photo of a vehicle. No visibility check: callers (SECURITY DEFINER readers) check the vehicle first.';

DO $patch$
DECLARE
  d text;
  n integer;
  a_svc text := $a$                   CASE WHEN w.line_kind = 'part' AND w.part_number IS NULL AND lower(w.description) ~
                          '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
                        THEN 'service' ELSE w.line_kind END AS line_kind
$a$;
  r_svc text := $r$                   public.receipt_line_work_kind(w.line_kind, w.part_number, w.description) AS line_kind  /* labor_shared_reads_v1 */
$r$;
  a_rd text := $a$    -- the current reviewed reading of each photo a visitor may see: its build phase, and whether the photo is of a print
    SELECT DISTINCT ON (i.id) i.id AS image_id, i.image_url, i.taken_at, o.structured_data ->> 'build_phase_guess' AS phase,
           o.structured_data ->> 'scene_type' AS scene, o.structured_data #>> '{state_observations,paint_state}' AS paint_state,
           public.photo_reading_is_print(o.structured_data) AS is_print
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'reviewed_image_analysis_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false
     ORDER BY i.id, o.id),
$a$;
  r_rd text := $r$    -- the current reviewed reading of each photo a visitor may see (labor_shared_reads_v1: one shared read)
    SELECT f.image_id, f.image_url, f.taken_at, f.phase, f.scene, f.paint_state, f.is_print
      FROM v CROSS JOIN LATERAL public.vehicle_reviewed_phase_frames(v.id) f),
$r$;
  a_img text := $a$     WHERE x.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(x)
$a$;
  r_img text := $r$     WHERE x.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(x)
       AND p_max_images > 0  -- labor_shared_reads_v1: 0 = the line read only, no frame matching
$r$;
  a_und text := $a$             WHEN ln.anchor IS NULL THEN 'undated_line'
$a$;
  r_und text := $r$             WHEN ln.anchor IS NULL THEN 'undated_line'
             WHEN p_max_images = 0 THEN 'photos_not_read'  -- labor_shared_reads_v1
$r$;
BEGIN
  d := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  IF position('labor_shared_reads_v1' IN d) = 0 THEN
    FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a_svc, a_rd]) a LOOP
      IF n <> 1 THEN RAISE EXCEPTION 'vehicle_build_reconstruction anchor drifted: % matches', n; END IF;
    END LOOP;
    EXECUTE replace(replace(d, a_svc, r_svc), a_rd, r_rd);
  END IF;

  d := pg_get_functiondef('public.receipt_work_lines(uuid,integer,integer)'::regprocedure);
  IF position('labor_shared_reads_v1' IN d) = 0 THEN
    FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a_img, a_und]) a LOOP
      IF n <> 1 THEN RAISE EXCEPTION 'receipt_work_lines anchor drifted: % matches', n; END IF;
    END LOOP;
    EXECUTE replace(replace(d, a_img, r_img), a_und, r_und);
  END IF;
END $patch$;
