-- RSI pass 16, re-issued writer: load_harness_splices's first production call (2026-10-15 03:3xZ, from the registry
-- loader) failed with "UPDATE requires a WHERE clause". The production API refuses an UPDATE or DELETE with no WHERE,
-- also inside a function (pg-safeupdate), and the writer filled its fingerprints with an unconditioned UPDATE on its own
-- temp table. The disposable PG17 used by the contracts has no such guard. Nothing was written: the call is one
-- transaction. This re-creates the function with WHERE true on that UPDATE; the contract now checks every UPDATE and
-- DELETE in the loader's database functions for a WHERE. Case ledger 13.12.3.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_harness_splices(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 16 (20261015090000) has not run';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.load_harness_splices(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_rows int; n_written int; n_changed int; n_kept int; n_retired int; n_members int; n_keyed int;
        unkeyed text[]; unplaced text[]; nets jsonb; shorted_before int; shorted_after int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_rows must be a JSON array of registry splices rows'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS load_splice_row (ord int PRIMARY KEY, v jsonb, plug text, cavity text, splice_code text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS load_splice (splice_code text PRIMARY KEY, placement text, at_label text, endpoint_id uuid, cavity text,
    part_number text, part_id uuid, design_equiv_awg numeric[], fingerprint text, live_id uuid, new_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS load_splice_member (splice_code text, ordinal int, member_label text, circuit_id uuid, side smallint) ON COMMIT DROP;
  TRUNCATE load_splice_row, load_splice, load_splice_member;

  SELECT numerator INTO shorted_before FROM public.v_harness_coverage
  WHERE vehicle_id = p_vehicle_id AND measure = 'nets that join a supply to ground (must be 0)';

  -- One row per registry splice; a splice at a pin is numbered among the splices at that pin.
  INSERT INTO load_splice_row
  SELECT r.ord, r.v, r.plug, r.cavity,
         CASE WHEN r.cavity IS NOT NULL THEN r.plug || ' ' || r.cavity || ' #' || r.n
              WHEN r.k > 1 THEN r.plug || ' #' || r.n ELSE r.plug END
  FROM (SELECT p.*, row_number() OVER (PARTITION BY p.plug, p.cavity ORDER BY p.ord) AS n, count(*) OVER (PARTITION BY p.plug, p.cavity) AS k
        FROM (SELECT x.ord::int AS ord, x.value AS v, split_part(btrim(x.value->>'at'), ' ', 1) AS plug,
                     CASE WHEN btrim(x.value->>'at') ~ '^\S+\s+\S'
                          THEN regexp_replace(regexp_replace(btrim(x.value->>'at'), '^\S+\s+', ''), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') END AS cavity
              FROM jsonb_array_elements(p_rows) WITH ORDINALITY x(value, ord)
              WHERE btrim(coalesce(x.value->>'at', '')) <> '') p) r;

  INSERT INTO load_splice (splice_code, placement, at_label, endpoint_id, cavity, part_number, part_id, design_equiv_awg)
  SELECT r.splice_code,
         CASE WHEN r.cavity IS NOT NULL THEN 'at_pin' WHEN r.v->>'type' = 'in-line' THEN 'in_line' ELSE 'stub' END,
         btrim(r.v->>'at'),
         (SELECT e.id FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id = e.design_id
          WHERE d.vehicle_id = p_vehicle_id AND e.code = r.plug AND NOT coalesce(e.is_superseded, false) ORDER BY e.id LIMIT 1),
         r.cavity, nullif(btrim(r.v->>'splice'), ''),
         (SELECT min(p.id::text)::uuid FROM public.catalog_parts p WHERE p.part_number = btrim(r.v->>'splice') HAVING count(*) = 1),
         CASE jsonb_typeof(r.v->'equiv_awg')
              WHEN 'array' THEN ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(r.v->'equiv_awg') x)
              WHEN 'number' THEN ARRAY[(r.v->>'equiv_awg')::numeric] END
  FROM load_splice_row r;

  -- Its conductors: a live wire of the vehicle with that code (decided first), else a lead named in words.
  INSERT INTO load_splice_member
  SELECT r.splice_code, m.ord::int, btrim(m.label),
         (SELECT c.id FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
          WHERE o.vehicle_id = p_vehicle_id AND c.circuit_code = btrim(m.label) AND NOT coalesce(c.is_superseded, false)
          ORDER BY coalesce(c.design_status = 'decided', false) DESC, c.created_at DESC, c.id LIMIT 1),
         (SELECT s.ord FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.v->'sides') = 'array' THEN r.v->'sides' ELSE '[]'::jsonb END)
                 WITH ORDINALITY s(side, ord)
          WHERE s.side ? btrim(m.label) ORDER BY s.ord LIMIT 1)::smallint
  FROM load_splice_row r
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.v->'wires') = 'array' THEN r.v->'wires' ELSE '[]'::jsonb END)
       WITH ORDINALITY m(label, ord);

  UPDATE load_splice l SET fingerprint = md5(concat_ws('|', l.placement, l.at_label, coalesce(l.endpoint_id::text, '-'), coalesce(l.cavity, '-'),
           coalesce(l.part_number, '-'), coalesce(l.part_id::text, '-'), coalesce(l.design_equiv_awg::text, '-'),
           coalesce((SELECT string_agg(m.ordinal || ':' || m.member_label || ':' || coalesce(m.circuit_id::text, '-') || ':' || coalesce(m.side::text, '-'), ','
                                       ORDER BY m.ordinal)
                     FROM load_splice_member m WHERE m.splice_code = l.splice_code), '-')))
  WHERE true;  -- every row: the production API refuses an UPDATE with no WHERE (pg-safeupdate)
  UPDATE load_splice l SET live_id = h.id FROM public.harness_splices h
  WHERE h.vehicle_id = p_vehicle_id AND NOT h.is_superseded AND h.splice_code = l.splice_code;

  SELECT count(*) FILTER (WHERE h.fingerprint = l.fingerprint), count(*) FILTER (WHERE h.fingerprint <> l.fingerprint) INTO n_kept, n_changed
  FROM load_splice l JOIN public.harness_splices h ON h.id = l.live_id;
  UPDATE load_splice l SET new_id = gen_random_uuid()
  WHERE l.live_id IS NULL OR EXISTS (SELECT 1 FROM public.harness_splices h WHERE h.id = l.live_id AND h.fingerprint <> l.fingerprint);

  -- Supersede the changed and the retired first (live codes are unique), insert, then point each changed row at its successor.
  UPDATE public.harness_splices h SET is_superseded = true
  WHERE h.vehicle_id = p_vehicle_id AND NOT h.is_superseded
    AND (h.id IN (SELECT live_id FROM load_splice WHERE new_id IS NOT NULL AND live_id IS NOT NULL)
         OR h.id NOT IN (SELECT live_id FROM load_splice WHERE live_id IS NOT NULL));
  GET DIAGNOSTICS n_retired = ROW_COUNT;
  n_retired := n_retired - n_changed;
  INSERT INTO public.harness_splices (id, vehicle_id, splice_code, placement, at_label, endpoint_id, cavity, part_number, part_id,
                                      design_equiv_awg, fingerprint, source, observed_at)
  SELECT l.new_id, p_vehicle_id, l.splice_code, l.placement, l.at_label, l.endpoint_id, l.cavity, l.part_number, l.part_id,
         l.design_equiv_awg, l.fingerprint, p_source, now()
  FROM load_splice l WHERE l.new_id IS NOT NULL;
  GET DIAGNOSTICS n_written = ROW_COUNT;
  INSERT INTO public.harness_splice_members (splice_id, ordinal, member_label, circuit_id, side)
  SELECT l.new_id, m.ordinal, m.member_label, m.circuit_id, m.side
  FROM load_splice_member m JOIN load_splice l ON l.splice_code = m.splice_code WHERE l.new_id IS NOT NULL;
  UPDATE public.harness_splices h SET superseded_by = l.new_id FROM load_splice l WHERE h.id = l.live_id AND l.new_id IS NOT NULL;

  SELECT count(*), count(circuit_id), coalesce(array_agg(DISTINCT member_label ORDER BY member_label) FILTER (WHERE circuit_id IS NULL), '{}')
  INTO n_members, n_keyed, unkeyed FROM load_splice_member;
  SELECT coalesce(array_agg(at_label ORDER BY at_label), '{}') INTO unplaced FROM load_splice WHERE endpoint_id IS NULL;
  SELECT count(*) INTO n_rows FROM load_splice_row;

  -- The net fold joins through the splices; a splice that joins a supply to ground is a design error, and nothing lands.
  nets := public.refold_harness_nets(p_vehicle_id);
  SELECT numerator INTO shorted_after FROM public.v_harness_coverage
  WHERE vehicle_id = p_vehicle_id AND measure = 'nets that join a supply to ground (must be 0)';
  IF coalesce(shorted_after, 0) > coalesce(shorted_before, 0) THEN
    RAISE EXCEPTION 'the splices would join a supply to ground (% net(s), was %); nothing was written', shorted_after, coalesce(shorted_before, 0);
  END IF;
  RETURN jsonb_build_object('rows', jsonb_array_length(p_rows), 'rows_read', n_rows, 'splices_written', n_written,
                            'splices_changed', n_changed, 'splices_kept', n_kept, 'splices_retired', n_retired,
                            'members', n_members, 'members_keyed', n_keyed, 'members_not_a_wire', to_jsonb(unkeyed),
                            'places_not_in_the_model', to_jsonb(unplaced), 'nets', nets);
END $fn$;
COMMENT ON FUNCTION public.load_harness_splices(uuid, jsonb, text) IS 'Writes the design''s splices (k5_registry.json "splices" rows: at, wires, splice, type, sides, equiv_awg) as harness_splices + harness_splice_members: a changed splice is superseded and re-inserted, one the rows stop naming is retired. Re-runs the net fold and refuses the whole load if a net then joins a supply to ground. Idempotent; returns counts. The registry loader calls it after every run. RSI pass 16 (re-issued for the API''s WHERE rule), case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.load_harness_splices(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_harness_splices(uuid, jsonb, text) TO service_role;

COMMIT;
