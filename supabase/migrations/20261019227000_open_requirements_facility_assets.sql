-- open_requirements_read: the facility input reads declared facility assets (declare_facility_asset) and confirmed
-- reservations instead of organization membership alone. Owner: "always have a Plan B to fill missing spaces".
--
--   open_requirement_facility_input(p_viewer_orgs, p_requirement, p_job_org, p_candidates, p_work_order_id):
--     * reachable facilities: organizations the viewer owns or belongs to, the job's shop, and facilities proposed by the
--       requirement's candidates (offers / fulfillments with facility_organization_id);
--     * matching kinds from the requirement text (lift, bay, paint/booth, compressor/air, parking/space); a facility
--       requirement naming none matches bay, lift or other; an equipment requirement naming none is not a facility asset;
--     * window: the job's scheduled window, else the facility candidates' stated window, else none;
--     * pass when a reachable facility has a declared, in-service matching asset with a free capacity slot in the window
--       (or any such asset when no window is known, availability not assessed); fail with plan_b_supplier_needed when every
--       matching asset is booked; otherwise unknown with plan_b_supplier_needed. Assets and organizations are listed by
--       open labels; no job details.
--   The live open_requirements_read facility CASE expression is replaced by one call (start/end markers each once).
-- Contract: supabase/sql/test_open_requirements_facility_assets.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.open_requirement_facility_input(p_viewer_orgs uuid[], p_requirement jsonb, p_job_org uuid, p_candidates jsonb, p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  rkind text := p_requirement->>'requirement_kind';
  txt text := lower(COALESCE(p_requirement->>'description', ''));
  kinds text[] := '{}';
  reach uuid[];
  w_from timestamptz;
  w_until timestamptz;
  w_basis text;
  matching jsonb;
  free jsonb;
BEGIN
  IF rkind IS NULL OR rkind NOT IN ('facility','equipment') THEN
    RETURN jsonb_build_object('input', 'facility', 'result', 'pass', 'reason', 'not required for a ' || COALESCE(rkind, 'unknown') || ' requirement');
  END IF;
  IF txt ~ 'lift' THEN kinds := kinds || 'lift'::text; END IF;
  IF txt ~ '\mbays?\M' THEN kinds := kinds || 'bay'::text; END IF;
  IF txt ~ '(paint|booth)' THEN kinds := kinds || 'paint_booth'::text; END IF;
  IF txt ~ '(compressor|\mair\M)' THEN kinds := kinds || 'compressor'::text; END IF;
  IF txt ~ '(parking|\mspaces?\M|\mpark\M)' THEN kinds := kinds || 'parking'::text; END IF;
  IF cardinality(kinds) = 0 THEN
    IF rkind = 'equipment' THEN
      RETURN jsonb_build_object('input', 'facility', 'result', 'unknown', 'next', 'plan_b_supplier_needed',
        'reason', 'this equipment is not a declared facility asset kind (bay, lift, paint booth, compressor, parking)');
    END IF;
    kinds := ARRAY['bay','lift','other'];
  END IF;
  SELECT array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL) INTO reach FROM (
    SELECT unnest(COALESCE(p_viewer_orgs, '{}'::uuid[])) x UNION ALL SELECT p_job_org
    UNION ALL SELECT (f->>'facility_organization_id')::uuid FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) f) r;
  SELECT w.scheduled_start, w.scheduled_end INTO w_from, w_until FROM public.work_orders w WHERE w.id = p_work_order_id;
  IF w_from IS NOT NULL AND w_until IS NOT NULL AND w_from < w_until THEN
    w_basis := 'job schedule';
  ELSE
    SELECT min((f->>'available_from')::timestamptz), max((f->>'available_until')::timestamptz) INTO w_from, w_until
      FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) f WHERE f->>'facility_organization_id' IS NOT NULL;
    w_basis := CASE WHEN w_from IS NOT NULL AND w_until IS NOT NULL AND w_from < w_until THEN 'stated by facility candidates' END;
    IF w_basis IS NULL THEN w_from := NULL; w_until := NULL; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('asset_id', e.id, 'kind', e.asset_kind, 'label', e.name, 'capacity', e.capacity,
      'organization', public.platform_organization_label(e.shop_id),
      'free_in_window', CASE WHEN w_basis IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM generate_series(1, e.capacity) sl
        WHERE NOT EXISTS (SELECT 1 FROM public.facility_asset_occupancy oc WHERE oc.asset_id = e.id AND oc.slot = sl AND oc.released_at IS NULL
          AND oc.occupied && tstzrange(w_from, w_until, '[)'))) END) ORDER BY e.asset_kind, e.name, e.id)
  INTO matching FROM public.equipment e
  WHERE e.shop_id = ANY (COALESCE(reach, '{}'::uuid[])) AND e.source = 'member_declaration' AND e.status = 'in_service' AND e.asset_kind = ANY (kinds);
  IF matching IS NULL THEN
    RETURN jsonb_build_object('input', 'facility', 'result', 'unknown', 'next', 'plan_b_supplier_needed', 'kinds', to_jsonb(kinds),
      'reachable_facilities', COALESCE(cardinality(reach), 0),
      'reason', 'no declared ' || array_to_string(kinds, '/') || ' at a reachable facility (your organizations, the job''s shop or a proposed facility)');
  END IF;
  IF w_basis IS NULL THEN
    RETURN jsonb_build_object('input', 'facility', 'result', 'pass', 'kinds', to_jsonb(kinds), 'assets', matching,
      'reason', 'declared matching asset at a reachable facility; no job window, availability not assessed');
  END IF;
  SELECT jsonb_agg(m) INTO free FROM jsonb_array_elements(matching) m WHERE (m->>'free_in_window')::boolean;
  IF free IS NOT NULL THEN
    RETURN jsonb_build_object('input', 'facility', 'result', 'pass', 'kinds', to_jsonb(kinds), 'assets', free,
      'window', jsonb_build_object('from', w_from, 'until', w_until, 'basis', w_basis),
      'reason', 'declared matching asset with a free slot in the window at a reachable facility');
  END IF;
  RETURN jsonb_build_object('input', 'facility', 'result', 'fail', 'next', 'plan_b_supplier_needed', 'kinds', to_jsonb(kinds),
    'window', jsonb_build_object('from', w_from, 'until', w_until, 'basis', w_basis),
    'reason', 'every declared matching asset at reachable facilities is booked in the window');
END $$;
REVOKE ALL ON FUNCTION public.open_requirement_facility_input(uuid[],jsonb,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_requirement_facility_input(uuid[],jsonb,uuid,jsonb,uuid) TO service_role;
COMMENT ON FUNCTION public.open_requirement_facility_input(uuid[],jsonb,uuid,jsonb,uuid) IS 'Facility input of open_requirements_read: declared, in-service matching assets at reachable facilities with a free capacity slot in the job window; plan_b_supplier_needed otherwise.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  s_mark constant text := $a$CASE WHEN b.q->>'requirement_kind' NOT IN ('facility','equipment') THEN$a$;
  e_mark constant text := $a$'reason', 'no organization membership or ownership') END,$a$;
  s_pos integer;
  e_pos integer;
BEGIN
  IF position('open_requirement_facility_input' IN def) > 0 THEN RAISE EXCEPTION 'open_requirements_read already uses declared facility assets'; END IF;
  IF (length(def) - length(replace(def, s_mark, ''))) / length(s_mark) <> 1 OR (length(def) - length(replace(def, e_mark, ''))) / length(e_mark) <> 1 THEN
    RAISE EXCEPTION 'open_requirements_read facility markers not found once';
  END IF;
  s_pos := position(s_mark IN def);
  e_pos := position(e_mark IN def) + length(e_mark);
  IF e_pos <= s_pos THEN RAISE EXCEPTION 'open_requirements_read facility markers out of order'; END IF;
  EXECUTE substr(def, 1, s_pos - 1) || 'public.open_requirement_facility_input(v_orgs, b.q, b.organization_id, b.cands, b.work_order_id),' || substr(def, e_pos);
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
