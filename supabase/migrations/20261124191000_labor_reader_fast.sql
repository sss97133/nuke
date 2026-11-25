-- labor_reader_fast_v1: vehicle_labor_appraisal reads the shared line and photo-phase reads instead of two whole readers.
--
-- WHY. Measured 2026-11-24 logged out on the proof vehicle: 5.2-7.3 s per call, one 15 s timeout. Server clock:
-- vehicle_build_reconstruction 4-5 s, receipt_work_lines 0.85-1.1 s (and the reconstruction calls it again). The reader
-- used only each line's kind and words, each system's shop-paper lines and hours, and the build phases photographed.
--
-- WHAT CHANGES (no output changes except logic_version).
--   * Lines come from receipt_work_lines(vehicle, 90, 0), the line-only read (labor_shared_reads_v1), once.
--   * The two reconstruction lenses the rules read (systems[].paper lines/hours, systems[].stages images/sample) are
--     built here from the same shared reads the reconstruction uses: receipt_line_work_kind (shop work billed without
--     hours) and vehicle_reviewed_phase_frames (reviewed photo phase). Same filters, same sample order.
--   * vehicle_build_reconstruction is no longer called. Visibility is still checked first (unchanged).
-- Proven in pg_temp against live before merge (2026-11-24): output minus as_of/logic_version md5-identical on 14 vehicles.
-- Test: supabase/sql/test_vehicle_labor_appraisal_fast.sql (PG17).
--
-- REVERT. Restore the anchors below (the reconstruction call, the two-argument receipt_work_lines call, the version).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261122203000.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124191000.1';
$r$;
  a_recon text := $a$  recon := public.vehicle_build_reconstruction(p_vehicle_id);
  IF recon IS NULL THEN
    RETURN NULL;
  END IF;
$a$;
  r_recon text := $r$  -- labor_reader_fast_v1: the reconstruction lenses this reader uses are built below, after the lines are read.
$r$;
  a_dk text := $a$           'dk', md5(coalesce(nullif(btrim(w.part_number), ''), lower(btrim(coalesce(w.description, '')))))
         )), '[]'::jsonb)
    INTO lines
    FROM public.receipt_work_lines(p_vehicle_id) w
   WHERE w.item_id IS NOT NULL;
$a$;
  r_dk text := $r$           'dk', md5(coalesce(nullif(btrim(w.part_number), ''), lower(btrim(coalesce(w.description, ''))))),
           'h', w.printed_hours,
           'wk', public.receipt_line_work_kind(w.line_kind, w.part_number, w.description)
         )), '[]'::jsonb)
    INTO lines
    FROM public.receipt_work_lines(p_vehicle_id, 90, 0) w
   WHERE w.item_id IS NOT NULL;

  -- labor_reader_fast_v1: shop paper per system and the build phases photographed, from the same shared reads
  -- vehicle_build_reconstruction uses (receipt_line_work_kind, vehicle_reviewed_phase_frames), shaped as its systems[].
  WITH f AS (
    SELECT public.build_phase_system(x.phase) AS system_key, x.phase, x.image_id, x.taken_at
      FROM public.vehicle_reviewed_phase_frames(p_vehicle_id) x
     WHERE public.build_phase_system(x.phase) IS NOT NULL),
  st AS (
    SELECT q.system_key, jsonb_agg(jsonb_build_object('phase', q.phase, 'images', q.images, 'sample', q.sample) ORDER BY q.phase) AS stages
      FROM (SELECT f.system_key, f.phase, count(*) AS images,
                   (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id) ORDER BY t.taken_at, t.image_id)
                      FROM (SELECT g.image_id, g.taken_at FROM f g WHERE g.phase = f.phase
                             ORDER BY g.taken_at, g.image_id LIMIT 6) t) AS sample
              FROM f GROUP BY f.system_key, f.phase) q
     GROUP BY q.system_key),
  pp AS (
    SELECT coalesce(l->>'system', 'unplaced') AS system_key,
           count(*) FILTER (WHERE l->>'wk' IN ('labor', 'note', 'service')) AS paper_lines,
           sum((l->>'h')::numeric) AS paper_hours
      FROM jsonb_array_elements(lines) l
     WHERE l->>'line_kind' IN ('part', 'labor', 'note', 'backordered', 'kit_component')
     GROUP BY 1)
  SELECT jsonb_build_object('systems', coalesce(jsonb_agg(jsonb_build_object(
           'system_key', coalesce(pp.system_key, st.system_key),
           'paper', jsonb_build_object('lines', coalesce(pp.paper_lines, 0), 'hours', pp.paper_hours),
           'stages', st.stages)), '[]'::jsonb))
    INTO recon
    FROM pp FULL JOIN st ON st.system_key = pp.system_key;
$r$;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_reader_fast_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a_ver, a_recon, a_dk]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'labor reader fast anchor drifted: % matches', n; END IF;
  END LOOP;
  EXECUTE replace(replace(replace(d, a_ver, r_ver), a_recon, r_recon), a_dk, r_dk);
END $patch$;
