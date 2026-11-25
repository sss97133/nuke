-- Disposable PG17: vehicle_labor_appraisal reads the shared line and photo-phase reads (labor_reader_fast_v1) and
-- returns exactly what it returned through vehicle_build_reconstruction. Reuses the labor appraisal fixture; the
-- reconstruction stub's systems[] are mirrored as receipt lines (paper) and reviewed phase frames (stages), the
-- appraisal is read, the patch applied twice, the reconstruction dropped, and the appraisal read again.
-- receipt_line_work_kind and build_phase_system are copies of the live definitions (20261124190000, read 2026-11-24).
-- Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal.sql
RESET ROLE;

CREATE FUNCTION public.receipt_line_work_kind(p_line_kind text, p_part_number text, p_description text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
  SELECT CASE WHEN p_line_kind = 'part' AND p_part_number IS NULL AND lower(p_description) ~
                   '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
              THEN 'service' ELSE p_line_kind END
$fn$;
CREATE FUNCTION public.build_phase_system(p_phase text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
  SELECT CASE p_phase WHEN 'teardown' THEN 'teardown' WHEN 'metalwork' THEN 'body'
                      WHEN 'paint_prep' THEN 'paint' WHEN 'paint_application' THEN 'paint' END
$fn$;
CREATE TABLE public._fixture_phase_frames (vehicle_id uuid, image_id uuid, taken_at timestamptz, phase text);
CREATE FUNCTION public.vehicle_reviewed_phase_frames(p_vehicle_id uuid)
RETURNS TABLE (image_id uuid, image_url text, taken_at timestamptz, phase text, scene text, paint_state text, is_print boolean)
LANGUAGE sql STABLE AS $fn$
  SELECT f.image_id, 'https://example.test/img.jpg', f.taken_at, f.phase, NULL::text, NULL::text, false
    FROM public._fixture_phase_frames f WHERE f.vehicle_id = p_vehicle_id
$fn$;

-- Mirror vehicle 1's reconstruction stub: machining paper 3 lines / 53.75 h (20 + 10 on file, + 23.75 here), paint_prep
-- photographed twice (one frame is not in vehicle_images, so it can never be cited), paint_application once.
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description, printed_hours) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000017', 'labor', 'hone cylinders', 23.75);
INSERT INTO _fixture_phase_frames VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-01-01 10:00+00', 'paint_prep'),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', '2026-01-01 11:00+00', 'paint_prep'),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-01-02 10:00+00', 'paint_application'),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', '2026-01-03 10:00+00', 'final_assembly');

SET test.auth_role = 'anon';
CREATE TABLE public._before AS
SELECT v.id, public.vehicle_labor_appraisal(v.id) AS j FROM vehicles v;

\ir ../migrations/20261124191000_labor_reader_fast.sql
\ir ../migrations/20261124191000_labor_reader_fast.sql
DROP FUNCTION public.vehicle_build_reconstruction(uuid);

DO $$
DECLARE d text; r record; n int := 0; a jsonb; eng jsonb; paint jsonb;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  PERFORM public.assert((length(d) - length(replace(d, 'labor_reader_fast_v1:', ''))) / length('labor_reader_fast_v1:') = 2,
    'patched once (two markers)');
  PERFORM public.assert(position('vehicle_build_reconstruction(' IN d) = 0, 'the reconstruction is not called');
  FOR r IN SELECT * FROM public._before LOOP
    a := public.vehicle_labor_appraisal(r.id);
    PERFORM public.assert((a IS NULL) = (r.j IS NULL), format('visibility unchanged for %s', r.id));
    CONTINUE WHEN a IS NULL;
    PERFORM public.assert((a - 'as_of' - 'logic_version') = (r.j - 'as_of' - 'logic_version'),
      format('vehicle %s changed: before %s after %s', r.id, r.j, a));
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261124191000.1', 'logic version');
    n := n + 1;
  END LOOP;
  PERFORM public.assert(n >= 3, format('compared %s public vehicles', n));

  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  SELECT s INTO eng FROM jsonb_array_elements(a->'segments') s WHERE s->>'segment' = 'engine';
  PERFORM public.assert((eng->>'paper_hours')::numeric = 53.75, format('machining paper hours from lines: %s', eng));
  SELECT s INTO paint FROM jsonb_array_elements(a->'segments') s WHERE s->>'segment' = 'paint';
  PERFORM public.assert(paint->>'status' = 'ok' AND (paint->>'hours_typical')::numeric = 21, format('paint: %s', paint));
  PERFORM public.assert(NOT (paint->'evidence_ids' ? 'a0000000-0000-0000-0000-000000000003'), 'uncitable frame not cited');
  PERFORM public.assert(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000002') IS NULL, 'private car hidden');
END $$;
\echo vehicle_labor_appraisal_fast: ok
