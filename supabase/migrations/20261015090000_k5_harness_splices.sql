-- RSI pass 16 on the harness model: the design's splices become rows, the net fold joins through them, and every pin
-- that holds several wires is checked against them. Case ledger 13.12.3.
--
-- The registry designs 37 splices (k5_registry.json "splices"): 21 "splice at pin" groups, where several wires meet in
-- a Raychem stub splice beside an ECU or PDM pin (e.g. M130-B B16: two D-609-05 group splices and a third that takes
-- their leads into the pin), and 16 splice nodes on the route (SPL-*: 15 M81824/1 butt splices, most joining a PDM
-- 20 A output's two pin pigtails to its load wire, and one D-609-05 stub). The loader dropped all of them. The model
-- saw 29 pin cavities holding several wire ends (RSI pass 14) and could not tell a designed splice from two wires
-- crowded into one contact, which is how pass 14 found PDM30 OUT17 and OUT18 paralleled on the floor dimmer's feed.
--
-- This pass:
--   1. harness_splices (one splice part, where it sits, which part) and harness_splice_members (one conductor into it:
--      a live wire, or a lead the design names only in words, with its side on a butt splice). Supersede, never edit.
--   2. load_harness_splices(vehicle, rows, source): writes the registry's rows (the loader passes reg["splices"] after
--      every run). A changed splice is superseded and re-inserted; a splice the rows stop naming is retired. It
--      re-runs the net fold and refuses the whole load if any net then joins a supply to ground.
--   3. refold_harness_nets also joins the decided wires that share a live splice.
--   4. v_harness_pin_occupancy names the splices at each pin and how many of its wires they hold.
--   5. v_harness_splice_check: per splice side, the conductors' combined area in circular mils against the part's crimp
--      range (catalog_parts range_awg, the ProWire 3137CT cavity colours, converted by the AWG formula). At-pin splices
--      also need the lead that goes into the pin; the registry names one only at M130-B B16 ("pin lead").
--   6. The scoreboard: splice members keyed to a live wire; pin cavities shared by several wires with no splice the
--      design names (must be 0); spliced pins whose lead into the pin the design names; splice sides outside the part's
--      crimp range (must be 0); splice sides the fill check cannot settle yet (no part, a gauge unknown, or no lead).
-- The rows arrive by the loader's call, not in this migration: the registry is the design's record and the loader its
-- writer.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_pdm_settings(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 15 (20261015043000) has not run';
  END IF;
  IF to_regclass('public.harness_splices') IS NOT NULL THEN
    RAISE EXCEPTION 'harness_splices already exists';
  END IF;
END $guard$;

-- 1. Splices and what goes into them.
CREATE TABLE public.harness_splices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  splice_code text NOT NULL,
  placement text NOT NULL CHECK (placement IN ('at_pin', 'in_line', 'stub')),
  at_label text NOT NULL,
  endpoint_id uuid REFERENCES public.harness_endpoints(id),
  cavity text,
  part_number text,
  part_id uuid REFERENCES public.catalog_parts(id),
  design_equiv_awg numeric[],
  fingerprint text NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  is_superseded boolean NOT NULL DEFAULT false,
  superseded_by uuid REFERENCES public.harness_splices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (placement <> 'at_pin' OR cavity IS NOT NULL));
CREATE UNIQUE INDEX harness_splices_live_code ON public.harness_splices (vehicle_id, splice_code) WHERE NOT is_superseded;
CREATE INDEX harness_splices_pin ON public.harness_splices (endpoint_id, cavity) WHERE NOT is_superseded;
COMMENT ON TABLE public.harness_splices IS 'Grain: one splice part in one vehicle''s harness design: where it sits (beside a pin, or a splice node on the route), which part, and the design''s own gauge sum. Its conductors are harness_splice_members. Written by load_harness_splices from the registry; a changed splice is superseded (superseded_by), never edited. RSI pass 16, case ledger 13.12.3.';
COMMENT ON COLUMN public.harness_splices.splice_code IS 'Stable name: plug, cavity and the splice''s number at that pin for a splice at a pin (M130-B B16 #2); the splice node''s code otherwise (SPL-PDM30-OUT7).';
COMMENT ON COLUMN public.harness_splices.placement IS 'at_pin: a stub splice beside one pin or terminal of a plug or device (the design''s "at" is the plug code, then the cavity), joining several wires and a lead into it; in_line: a butt splice with two sides; stub: a stub splice on the route (the "at" is a splice node''s code).';
COMMENT ON COLUMN public.harness_splices.at_label IS 'Where the design puts it, verbatim (registry "at").';
COMMENT ON COLUMN public.harness_splices.endpoint_id IS 'The plug (at_pin) or the splice node (in_line, stub); null when the design names a plug the model does not hold.';
COMMENT ON COLUMN public.harness_splices.cavity IS 'For at_pin: the pin or terminal as the design names it after the plug code (B16, or words on a device: 10 feed cavity), normalised like v_harness_pin_occupancy (leading zeros and an underscore dropped; case kept).';
COMMENT ON COLUMN public.harness_splices.part_number IS 'The splice part the design names (D-609-05, M81824/1-3).';
COMMENT ON COLUMN public.harness_splices.part_id IS 'The catalog_parts row for part_number, when exactly one row has it (RSI pass 6 rule).';
COMMENT ON COLUMN public.harness_splices.design_equiv_awg IS 'The design''s own equivalent gauge for the splice (one per side on a butt splice): testimony, kept to compare; v_harness_splice_check computes its own.';
COMMENT ON COLUMN public.harness_splices.fingerprint IS 'md5 of everything the design says about the splice and its conductors; a new fingerprint under the same code supersedes the row.';
COMMENT ON COLUMN public.harness_splices.source IS 'Where the row came from, e.g. k5_registry.json splices @ <commit>.';

CREATE TABLE public.harness_splice_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  splice_id uuid NOT NULL REFERENCES public.harness_splices(id),
  ordinal int NOT NULL CHECK (ordinal > 0),
  member_label text NOT NULL,
  circuit_id uuid REFERENCES public.vehicle_custom_circuits(id),
  side smallint CHECK (side IN (1, 2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (splice_id, ordinal));
CREATE INDEX harness_splice_members_circuit ON public.harness_splice_members (circuit_id);
COMMENT ON TABLE public.harness_splice_members IS 'Grain: one conductor into one splice (harness_splices): a live wire of the design, or a lead the design names only in words (circuit_id null, e.g. "20 AWG lead"). Append-only: a changed splice gets new members under its new row. RSI pass 16.';
COMMENT ON COLUMN public.harness_splice_members.member_label IS 'The conductor as the design names it, verbatim: a wire code, or words for a lead.';
COMMENT ON COLUMN public.harness_splice_members.circuit_id IS 'The live vehicle_custom_circuits row with that wire code when the splice was loaded; null for a lead named in words or a code the model does not hold.';
COMMENT ON COLUMN public.harness_splice_members.side IS 'For a butt splice, the side the conductor enters (1 or 2, the design''s order); null when every conductor enters one end.';
CREATE TRIGGER harness_splice_members_append_only BEFORE UPDATE OR DELETE ON public.harness_splice_members
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

ALTER TABLE public.harness_splices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for public vehicles" ON public.harness_splices FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_splices.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.harness_splices FROM anon, authenticated;
GRANT SELECT ON public.harness_splices TO anon, authenticated;
ALTER TABLE public.harness_splice_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for public vehicles" ON public.harness_splice_members FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.harness_splices h JOIN public.vehicles v ON v.id = h.vehicle_id WHERE h.id = harness_splice_members.splice_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.harness_splice_members FROM anon, authenticated;
GRANT SELECT ON public.harness_splice_members TO anon, authenticated;

-- 2. The writer.
CREATE FUNCTION public.load_harness_splices(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
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
                     FROM load_splice_member m WHERE m.splice_code = l.splice_code), '-')));
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
COMMENT ON FUNCTION public.load_harness_splices(uuid, jsonb, text) IS 'Writes the design''s splices (k5_registry.json "splices" rows: at, wires, splice, type, sides, equiv_awg) as harness_splices + harness_splice_members: a changed splice is superseded and re-inserted, one the rows stop naming is retired. Re-runs the net fold and refuses the whole load if a net then joins a supply to ground. Idempotent; returns counts. The registry loader calls it after every run. RSI pass 16, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.load_harness_splices(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_harness_splices(uuid, jsonb, text) TO service_role;

-- 3. The net fold joins through the design's splices too (pass 14's function, one link rule added).
CREATE OR REPLACE FUNCTION public.refold_harness_nets(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_comp int; n_changed int; n_old int; n_new int; n_seg int; prot jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS refold_w (id uuid PRIMARY KEY, circuit_code text, circuit_name text, fuse_rating_amps numeric,
    source text, observed_at timestamptz, from_endpoint_id uuid, to_endpoint_id uuid, design_status text, created_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_link (wire_id uuid, node text, label text, is_bus boolean, is_ground boolean, is_stud boolean) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_comp (wire_id uuid PRIMARY KEY, comp uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_now (wire_id uuid, net_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_changed (comp uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_net (comp uuid PRIMARY KEY, net_code text, name text, fuse_a numeric, source text,
    observed_at timestamptz, is_ground boolean, is_stud boolean, net_id uuid, signal_id uuid) ON COMMIT DROP;
  TRUNCATE refold_w, refold_link, refold_comp, refold_now, refold_changed, refold_net;

  INSERT INTO refold_w
  SELECT DISTINCT ON (c.id) c.id, c.circuit_code, c.circuit_name, c.fuse_rating_amps, c.source, c.observed_at,
         c.from_endpoint_id, c.to_endpoint_id, c.design_status, c.created_at
  FROM public.vehicle_custom_circuits c
  JOIN public.harness_segments s ON s.vehicle_custom_circuit_id = c.id AND NOT s.is_superseded AND s.design_status <> 'candidate'
  WHERE s.vehicle_id = p_vehicle_id;

  -- Bus plugs: every end on one is one node (net fold v2's rule).
  INSERT INTO refold_link
  SELECT DISTINCT w.id, 'bus:' || e.id, e.code, true, e.endpoint_type = 'ground', e.code LIKE '%-STUD'
  FROM refold_w w JOIN public.harness_endpoints e ON e.id IN (w.from_endpoint_id, w.to_endpoint_id)
  WHERE NOT coalesce(e.is_superseded, false) AND e.node_kind = 'bus'
  UNION
  SELECT DISTINCT w.id, 'bus:' || e.id, e.code, true, e.endpoint_type = 'ground', e.code LIKE '%-STUD'
  FROM refold_w w JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'bus';
  -- Shared pins: decided wires whose live ends land in the same cavity of a terminals plug.
  INSERT INTO refold_link
  SELECT x.wire_id, x.node, x.label, false, false, false
  FROM (SELECT DISTINCT w.id AS wire_id,
               'pin:' || e.id || ':' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS node,
               e.code || ' ' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS label
        FROM refold_w w
        JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
        JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'terminals'
        WHERE w.design_status = 'decided' AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
          AND EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = w.id AND NOT s.is_superseded
                        AND t.id IN (s.from_termination_id, s.to_termination_id))) x
  WHERE x.node IN (SELECT node FROM (SELECT DISTINCT w.id, 'pin:' || e.id || ':' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS node
                                    FROM refold_w w
                                    JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
                                    JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'terminals'
                                    WHERE w.design_status = 'decided' AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
                                      AND EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = w.id AND NOT s.is_superseded
                                                    AND t.id IN (s.from_termination_id, s.to_termination_id))) y
                   GROUP BY node HAVING count(*) > 1);

  -- The design's splices (RSI pass 16): decided wires that share a live splice are one node.
  INSERT INTO refold_link
  SELECT DISTINCT w.id, 'splice:' || h.id, h.splice_code, false, false, false
  FROM public.harness_splices h
  JOIN public.harness_splice_members m ON m.splice_id = h.id
  JOIN refold_w w ON w.id = m.circuit_id AND w.design_status = 'decided'
  WHERE h.vehicle_id = p_vehicle_id AND NOT h.is_superseded
    AND (SELECT count(DISTINCT m2.circuit_id) FROM public.harness_splice_members m2
         JOIN refold_w w2 ON w2.id = m2.circuit_id AND w2.design_status = 'decided' WHERE m2.splice_id = h.id) > 1;

  INSERT INTO refold_comp
  WITH RECURSIVE pairs AS (SELECT DISTINCT a.wire_id AS x, b.wire_id AS y FROM refold_link a JOIN refold_link b ON a.node = b.node),
  reach(root, wire) AS (SELECT id, id FROM refold_w UNION SELECT r.root, p.y FROM reach r JOIN pairs p ON p.x = r.wire)
  SELECT wire, min(root::text)::uuid FROM reach GROUP BY wire;
  SELECT count(DISTINCT comp) INTO n_comp FROM refold_comp;

  INSERT INTO refold_now
  SELECT DISTINCT s.vehicle_custom_circuit_id, s.net_id FROM public.harness_segments s JOIN refold_w w ON w.id = s.vehicle_custom_circuit_id
  WHERE NOT s.is_superseded AND s.design_status <> 'candidate';

  -- A component changes when its wires sit on more than one net, or its net also holds wires outside it.
  INSERT INTO refold_changed
  SELECT k.comp FROM refold_comp k JOIN refold_now n ON n.wire_id = k.wire_id
  GROUP BY k.comp
  HAVING count(DISTINCT n.net_id) <> 1
      OR count(DISTINCT k.wire_id) <> (SELECT count(DISTINCT n2.wire_id) FROM refold_now n2 WHERE n2.net_id = min(n.net_id::text)::uuid);
  SELECT count(*) INTO n_changed FROM refold_changed;
  IF n_changed = 0 THEN
    prot := public.fold_harness_net_protection(p_vehicle_id);
    RETURN jsonb_build_object('nodes', n_comp, 'nets_superseded', 0, 'nets_created', 0, 'segments_repointed', 0, 'protection', prot);
  END IF;

  INSERT INTO refold_net
  SELECT k.comp,
         coalesce(min(l.label) FILTER (WHERE l.is_bus), min(l.label) FILTER (WHERE NOT l.is_bus), min(w.circuit_code)),
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.circuit_name)
              ELSE coalesce(min(l.label) FILTER (WHERE l.is_bus), min(l.label) FILTER (WHERE NOT l.is_bus), min(w.circuit_name)) END,
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.fuse_rating_amps) END,
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN coalesce(min(w.source), 'vehicle_custom_circuits ' || min(w.circuit_code))
              ELSE 'vehicle_custom_circuits (' || count(DISTINCT k.wire_id) || ' wires)' END,
         coalesce(min(w.observed_at), min(w.created_at)), coalesce(bool_or(l.is_ground), false), coalesce(bool_or(l.is_stud), false),
         gen_random_uuid(), gen_random_uuid()
  FROM refold_comp k JOIN refold_changed c ON c.comp = k.comp JOIN refold_w w ON w.id = k.wire_id
  LEFT JOIN refold_link l ON l.wire_id = k.wire_id
  GROUP BY k.comp;

  -- Supersede first (live codes are unique), then insert, then link each old net to the net its wires moved to.
  UPDATE public.harness_signals g SET is_superseded = true
  FROM public.harness_nets n
  WHERE n.id IN (SELECT DISTINCT x.net_id FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id JOIN refold_changed c ON c.comp = k.comp)
    AND g.id = n.signal_id AND NOT g.is_superseded;
  UPDATE public.harness_nets n SET is_superseded = true,
         method = n.method || '; superseded by the net refold (RSI pass 14): its wires now fold into '
                  || (SELECT count(DISTINCT k.comp) FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id WHERE x.net_id = n.id) || ' net(s)'
  WHERE n.id IN (SELECT DISTINCT x.net_id FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id JOIN refold_changed c ON c.comp = k.comp)
    AND NOT n.is_superseded;
  GET DIAGNOSTICS n_old = ROW_COUNT;

  INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
  SELECT r.signal_id, p_vehicle_id, r.net_code, r.name, CASE WHEN r.is_ground THEN 'ground' WHEN r.is_stud THEN 'power' END,
         r.source, 'net refold (RSI pass 14) from vehicle_custom_circuits; one signal per net', r.observed_at, 'T3'
  FROM refold_net r;
  INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, protection_setting_a, source, method, observed_at, trust)
  SELECT r.net_id, p_vehicle_id, r.net_code, r.signal_id, r.name, r.fuse_a, r.source,
         'net refold (RSI pass 16): wires joined through bus plugs, shared pin cavities and the design''s splices', r.observed_at, 'T3'
  FROM refold_net r;
  GET DIAGNOSTICS n_new = ROW_COUNT;

  UPDATE public.harness_nets o SET superseded_by = m.net_id
  FROM (SELECT x.net_id AS old_id, min(r.net_id::text)::uuid AS net_id, count(DISTINCT r.net_id) AS k
        FROM refold_now x JOIN refold_comp c ON c.wire_id = x.wire_id JOIN refold_net r ON r.comp = c.comp GROUP BY x.net_id) m
  WHERE o.id = m.old_id AND m.k = 1 AND o.superseded_by IS NULL AND o.is_superseded;
  UPDATE public.harness_signals g SET superseded_by = nn.signal_id
  FROM public.harness_nets o JOIN public.harness_nets nn ON nn.id = o.superseded_by
  WHERE g.id = o.signal_id AND g.superseded_by IS NULL AND g.is_superseded AND nn.id IN (SELECT net_id FROM refold_net);

  UPDATE public.harness_segments s SET net_id = r.net_id
  FROM refold_comp k JOIN refold_net r ON r.comp = k.comp
  WHERE s.vehicle_custom_circuit_id = k.wire_id AND NOT s.is_superseded AND s.design_status <> 'candidate' AND s.net_id IS DISTINCT FROM r.net_id;
  GET DIAGNOSTICS n_seg = ROW_COUNT;

  -- Loads from the physics sizing on the wires (net fold v2's rule), on the new nets.
  UPDATE public.harness_nets n
  SET nominal_current_a = x.load_a, peak_current_a = x.peak_a,
      method = n.method || '; load: the largest physics-sized design load among its wires (' || x.wires || '; vehicle_custom_circuits notes, cable_sizing_v5.py)'
  FROM (SELECT s.net_id, max(substring(c.notes FROM 'load ([0-9.]+) A')::numeric) AS load_a,
               max(substring(c.notes FROM 'cranking ([0-9.]+) A')::numeric) AS peak_a,
               string_agg(DISTINCT c.circuit_code || ' ' || substring(c.notes FROM 'load ([0-9.]+) A') || ' A', ', ') AS wires
        FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
        WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND c.notes ~ '^sized from physics [0-9-]+: load [0-9.]+ A'
          AND s.net_id IN (SELECT net_id FROM refold_net)
        GROUP BY s.net_id) x
  WHERE n.id = x.net_id;

  prot := public.fold_harness_net_protection(p_vehicle_id);
  RETURN jsonb_build_object('nodes', n_comp, 'nets_superseded', n_old, 'nets_created', n_new, 'segments_repointed', n_seg, 'protection', prot);
END $fn$;

COMMENT ON FUNCTION public.refold_harness_nets(uuid) IS 'The harness net fold for a vehicle, re-runnable: wires on live non-candidate segments join through bus plugs (node_kind bus), through pin cavities shared by decided wires (case-sensitive labels; stud, lug and post cavities excluded) and through the design''s live splices (decided members). Changed nets are superseded with their signals, new nets and signals inserted, segments re-pointed, loads re-read from the physics sizing and protection re-folded. Idempotent; returns counts. Called by the registry loader and by load_harness_splices. RSI passes 14 and 16, case ledger 13.12.3.';

-- 4. Each pin names the splices beside it and how many of its wires they hold.
CREATE OR REPLACE VIEW public.v_harness_pin_occupancy AS
WITH occ AS (
  SELECT s.vehicle_id, e.id AS endpoint_id, e.code AS plug,
         regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS cavity,
         count(DISTINCT c.id) AS wires,
         string_agg(DISTINCT c.circuit_code, ', ') AS wire_codes,
         array_agg(DISTINCT c.id) AS wire_ids
  FROM public.harness_segments s
  JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE
  JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id AND c.design_status = 'decided' AND NOT coalesce(c.is_superseded, false)
  JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id) AND NOT coalesce(t.is_superseded, false)
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND e.node_kind = 'terminals'
  WHERE NOT s.is_superseded AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
  GROUP BY s.vehicle_id, e.id, e.code, regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2'))
SELECT o.vehicle_id, o.endpoint_id, o.plug, o.cavity, o.wires, o.wire_codes,
       sp.splices, coalesce(sp.wires_in_a_splice, 0) AS wires_in_a_splice
FROM occ o
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT h.splice_code, ', ') AS splices,
         count(DISTINCT m.circuit_id) FILTER (WHERE m.circuit_id = ANY (o.wire_ids)) AS wires_in_a_splice
  FROM public.harness_splices h LEFT JOIN public.harness_splice_members m ON m.splice_id = h.id
  WHERE h.endpoint_id = o.endpoint_id AND h.cavity = o.cavity AND h.placement = 'at_pin' AND NOT h.is_superseded
  HAVING count(*) > 0) sp ON true;
COMMENT ON VIEW public.v_harness_pin_occupancy IS 'Per pin cavity of a public vehicle''s plugs (node_kind terminals; stud, lug and post cavities excluded): how many decided wires land there, the design''s splices beside that pin (harness_splices, at_pin) and how many of the pin''s wires they hold. A pin with several wires and fewer of them in a splice is two conductors crowded into one contact, or a design error. Cavity labels are case-sensitive (D38999 F and f differ). RSI passes 14 and 16, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_pin_occupancy FROM anon, authenticated;
GRANT SELECT ON public.v_harness_pin_occupancy TO anon, authenticated;

-- 5. Splice fill: the conductors' combined area against the part's crimp range, per side.
CREATE VIEW public.v_harness_splice_check AS
WITH m AS (
  SELECT h.vehicle_id, h.id AS splice_id, h.splice_code, h.placement, h.part_number, h.part_id, h.endpoint_id, h.cavity,
         coalesce(mm.side, 0) AS side, mm.ordinal, mm.member_label,
         coalesce(c.wire_gauge_awg::numeric, substring(mm.member_label FROM '^([0-9]+) AWG')::numeric) AS awg
  FROM public.harness_splices h
  JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
  JOIN public.harness_splice_members mm ON mm.splice_id = h.id
  LEFT JOIN public.vehicle_custom_circuits c ON c.id = mm.circuit_id
  WHERE NOT h.is_superseded),
sides AS (
  SELECT m.vehicle_id, m.splice_id, m.splice_code, m.placement, m.part_number, m.part_id, m.endpoint_id, m.cavity, m.side,
         count(*) AS conductors, count(*) FILTER (WHERE m.awg IS NULL) AS gauges_unknown,
         string_agg(m.member_label || CASE WHEN m.awg IS NOT NULL AND m.member_label !~ '^[0-9]+ AWG' THEN ' (' || m.awg || ' AWG)' ELSE '' END, ', '
                    ORDER BY m.ordinal) AS conductors_named,
         round(sum(power(5 * power(92::numeric, (36 - m.awg) / 39), 2))) AS circular_mils
  FROM m GROUP BY m.vehicle_id, m.splice_id, m.splice_code, m.placement, m.part_number, m.part_id, m.endpoint_id, m.cavity, m.side),
rng AS (
  SELECT p.id,
         round(power(5 * power(92::numeric, (36 - greatest((p.application_data->'range_awg'->>0)::numeric, (p.application_data->'range_awg'->>1)::numeric)) / 39), 2)) AS min_cm,
         round(power(5 * power(92::numeric, (36 - least((p.application_data->'range_awg'->>0)::numeric, (p.application_data->'range_awg'->>1)::numeric)) / 39), 2)) AS max_cm
  FROM public.catalog_parts p
  WHERE jsonb_typeof(p.application_data->'range_awg') = 'array' AND jsonb_array_length(p.application_data->'range_awg') = 2),
pin_lead AS (
  SELECT DISTINCT h.endpoint_id, h.cavity
  FROM public.harness_splices h JOIN public.harness_splice_members mm ON mm.splice_id = h.id
  WHERE NOT h.is_superseded AND h.placement = 'at_pin' AND mm.circuit_id IS NULL AND mm.member_label ~* '\mpin lead\M')
SELECT s.vehicle_id, s.splice_id, s.splice_code, s.placement, s.part_number, s.side, s.conductors, s.conductors_named, s.gauges_unknown,
       s.circular_mils, r.min_cm AS part_min_circular_mils, r.max_cm AS part_max_circular_mils,
       CASE WHEN r.id IS NULL THEN 'part range unknown'
            WHEN s.circular_mils > r.max_cm * 1.005 THEN 'over the crimp range'
            WHEN s.gauges_unknown > 0 THEN 'gauge unknown'
            WHEN s.placement = 'at_pin' AND pl.endpoint_id IS NULL THEN 'lead into the pin not named'
            WHEN s.circular_mils < r.min_cm * 0.995 THEN 'under the crimp range'
            ELSE 'fits' END AS status
FROM sides s
LEFT JOIN rng r ON r.id = s.part_id
LEFT JOIN pin_lead pl ON pl.endpoint_id = s.endpoint_id AND pl.cavity = s.cavity;
COMMENT ON VIEW public.v_harness_splice_check IS 'Per side of each live splice of a public vehicle (side 0: every conductor enters one end): its conductors with their gauge (the wire''s, or the gauge a lead''s words state), their combined area in circular mils (AWG formula) and the splice part''s crimp range (catalog_parts range_awg, ProWire 3137CT cavity colours). status: fits; over or under the crimp range; gauge unknown; part range unknown; or, for a splice beside a pin, lead into the pin not named (no splice at that pin names a "pin lead", so the conductor into the contact is missing from the design). Over is reported even when a gauge is unknown: the known conductors alone exceed it. RSI pass 16, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_splice_check FROM anon, authenticated;
GRANT SELECT ON public.v_harness_splice_check TO anon, authenticated;

-- 6. The scoreboard.
CREATE OR REPLACE VIEW public.v_harness_coverage AS
SELECT x.vehicle_id, x.layer, x.measure, x.numerator, x.denominator, g.grain
FROM (
  WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
               WHERE NOT s.is_superseded AND v.is_public IS TRUE),
  ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
           WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
             AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
  nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
           WHERE NOT n.is_superseded AND v.is_public IS TRUE),
  base AS (SELECT o.vehicle_id, f.* FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
           JOIN public.factory_harness_circuits f ON f.generation = o.factory_generation AND f.year_range @> v.year
           WHERE v.is_public IS TRUE),
  res AS (SELECT * FROM public.v_harness_factory_residual),
  wires AS (SELECT c.id, o.vehicle_id FROM public.vehicle_custom_circuits c
            JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id JOIN public.vehicles v ON v.id = o.vehicle_id
            WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided' AND v.is_public IS TRUE),
  pdmch AS (SELECT u.vehicle_id, ch.* FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
            JOIN public.vehicles v ON v.id = u.vehicle_id WHERE v.is_public IS TRUE AND ch.setting_status IS NOT NULL),
  endpts AS (SELECT t.vehicle_id, t.id, n.id AS node_id, n.pos_x_m FROM ends t
             LEFT JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             LEFT JOIN public.harness_topology_nodes n ON n.id = e.topology_node_id AND NOT n.is_superseded)
  SELECT vehicle_id, 'fold' AS layer, 'segments decided' AS measure, count(*) FILTER (WHERE design_status = 'decided') AS numerator, count(*) AS denominator FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'segments with both ends known', count(*) FILTER (WHERE from_termination_id IS NOT NULL AND to_termination_id IS NOT NULL), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'segments keyed to a wire part', count(wire_part_id), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'prediction', 'segments with a planned length', count(planned_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'outcome', 'segments measured as cut', count(measured_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'key', 'segments carrying an option link', count(DISTINCT l.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.wiring_decision_links l ON l.segment_id = s.id GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'dimension', 'segments routed over topology', count(DISTINCT r.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.harness_routings r ON r.segment_id = s.id AND NOT r.is_superseded GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a cavity', count(cavity_layout_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a terminal part', count(terminal_contact_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a crimp tool', count(crimp_tool_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT e.vehicle_id, 'log', 'wire ends with cited evidence', count(DISTINCT h.row_id) FILTER (WHERE h.relation = 'supports'), count(DISTINCT e.id) FROM ends e LEFT JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id = e.id GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with protection', count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL OR protection_fuse_part_id IS NOT NULL), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'baseline', 'factory circuits keyed to a GM circuit number', count(gm_circuit_number), count(*) FROM base GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'factory GM circuits carried by the build', count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status <> 'baseline gap') FROM res GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'GM circuits the build cites that the baseline cannot key', count(*) FILTER (WHERE status = 'baseline gap'), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'residual', 'nets carrying a factory circuit', count(DISTINCT n.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'GM circuits the build cites, named in the circuit dictionary', count(*) FILTER (WHERE status <> 'unassessed' AND gm_circuit_name IS NOT NULL), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'fold', 'nets that join a supply to ground (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             WHERE s.net_id = n.id AND NOT s.is_superseded
               AND (t.cavity ILIKE '+ post%' OR (e.code ~ '^PDM(15|30)-[AB]$' AND EXISTS (
                     SELECT 1 FROM public.device_pin_maps p WHERE p.device_model = split_part(e.code, '-', 1)
                       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
                       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL))))
           AND EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'dimension', 'segments with both plugs at a standing position', count(*) FILTER (WHERE g.straight_ft IS NOT NULL), count(*) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT w.vehicle_id, 'outcome', 'decided wires with a recorded build step', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.harness_build_events e WHERE e.circuit_id = w.id)), count(*) FROM wires w GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'fold', 'live segments on superseded legacy rows (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false))
           OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (s.from_termination_id, s.to_termination_id) AND coalesce(t.is_superseded, false))),
         count(*) FROM seg s GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a topology node', count(node_id), count(*) FROM endpts GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a node not yet placed', count(*) FILTER (WHERE node_id IS NOT NULL AND pos_x_m IS NULL), count(*) FROM endpts GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'PDM-fed wires not protected by the output the design names (must be 0)', count(*) FILTER (WHERE NOT agrees), count(*) FROM public.v_harness_pdm_protection_check GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'pin cavities shared by several wires', count(*) FILTER (WHERE wires > 1), count(*) FROM public.v_harness_pin_occupancy GROUP BY 1
  UNION ALL SELECT vehicle_id, 'prediction', 'PDM-fed nets with a programmed limit', count(protection_setting_a) FILTER (WHERE protection_pdm_channel_id IS NOT NULL), count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'PDM-fed nets with a load', count(nominal_current_a) FILTER (WHERE protection_pdm_channel_id IS NOT NULL), count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'log', 'PDM outputs still waiting on a cited load current', count(*) FILTER (WHERE setting_status = 'open'), count(*) FROM pdmch GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'PDM outputs whose load needs more than the output or its wire allows (must be 0)', count(*) FILTER (WHERE setting_status = 'conflict'), count(*) FROM pdmch GROUP BY 1
  UNION ALL SELECT h.vehicle_id, 'key', 'splice members keyed to a live wire', count(m.circuit_id), count(m.id)
    FROM public.harness_splices h JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
    JOIN public.harness_splice_members m ON m.splice_id = h.id WHERE NOT h.is_superseded GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'pin cavities shared by several wires with no splice the design names (must be 0)', count(*) FILTER (WHERE wires > 1 AND wires_in_a_splice < wires), count(*) FILTER (WHERE wires > 1) FROM public.v_harness_pin_occupancy GROUP BY 1
  UNION ALL SELECT h.vehicle_id, 'fold', 'spliced pins whose lead into the pin the design names',
         count(DISTINCT coalesce(h.endpoint_id::text, split_part(h.at_label, ' ', 1)) || ' ' || h.cavity) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.harness_splices h2 JOIN public.harness_splice_members m ON m.splice_id = h2.id
           WHERE NOT h2.is_superseded AND h2.placement = 'at_pin' AND h2.vehicle_id = h.vehicle_id AND h2.endpoint_id = h.endpoint_id AND h2.cavity = h.cavity
             AND m.circuit_id IS NULL AND m.member_label ~* '\mpin lead\M')),
         count(DISTINCT coalesce(h.endpoint_id::text, split_part(h.at_label, ' ', 1)) || ' ' || h.cavity)
    FROM public.harness_splices h JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
    WHERE NOT h.is_superseded AND h.placement = 'at_pin' GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'splice sides outside the part''s crimp range (must be 0)', count(*) FILTER (WHERE status IN ('over the crimp range', 'under the crimp range')), count(*) FILTER (WHERE status IN ('fits', 'over the crimp range', 'under the crimp range')) FROM public.v_harness_splice_check GROUP BY 1
  UNION ALL SELECT vehicle_id, 'log', 'splice sides the fill check cannot settle yet', count(*) FILTER (WHERE status NOT IN ('fits', 'over the crimp range', 'under the crimp range')), count(*) FROM public.v_harness_splice_check GROUP BY 1
) x
LEFT JOIN (VALUES
    ('segments decided', 'segments'),
    ('segments with both ends known', 'segments'),
    ('segments keyed to a wire part', 'segments'),
    ('segments with a planned length', 'segments'),
    ('segments measured as cut', 'segments'),
    ('segments carrying an option link', 'segments'),
    ('segments routed over topology', 'segments'),
    ('wire ends keyed to a cavity', 'wire ends'),
    ('wire ends keyed to a terminal part', 'wire ends'),
    ('wire ends keyed to a crimp tool', 'wire ends'),
    ('wire ends with cited evidence', 'wire ends'),
    ('nets with protection', 'nets'),
    ('nets with a load model', 'nets'),
    ('factory circuits keyed to a GM circuit number', 'factory circuits'),
    ('factory GM circuits carried by the build', 'GM circuits'),
    ('GM circuits the build cites that the baseline cannot key', 'GM circuits'),
    ('nets carrying a factory circuit', 'nets'),
    ('GM circuits the build cites, named in the circuit dictionary', 'GM circuits'),
    ('nets that join a supply to ground (must be 0)', 'nets'),
    ('segments with both plugs at a standing position', 'segments'),
    ('segments planned shorter than the straight line between their plugs (must be 0)', 'segments'),
    ('decided wires with a recorded build step', 'wires'),
    ('live segments on superseded legacy rows (must be 0)', 'segments'),
    ('wire ends at a topology node', 'wire ends'),
    ('wire ends at a node not yet placed', 'wire ends'),
    ('PDM-fed wires not protected by the output the design names (must be 0)', 'wires'),
    ('pin cavities shared by several wires', 'cavities'),
    ('PDM-fed nets with a programmed limit', 'nets'),
    ('PDM-fed nets with a load', 'nets'),
    ('PDM outputs still waiting on a cited load current', 'PDM outputs'),
    ('PDM outputs whose load needs more than the output or its wire allows (must be 0)', 'PDM outputs'),
    ('splice members keyed to a live wire', 'splice members'),
    ('pin cavities shared by several wires with no splice the design names (must be 0)', 'cavities'),
    ('spliced pins whose lead into the pin the design names', 'pins'),
    ('splice sides outside the part''s crimp range (must be 0)', 'splice sides'),
    ('splice sides the fill check cannot settle yet', 'splice sides')) g(measure, grain) ON g.measure = x.measure;


COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14; PDM limits and loads since pass 15; the design''s splices since pass 16.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'table', 'harness_splices', NULL, 'the design''s splices: where each sits and which part'),
  ('SH', 1, 'key', 'table', 'harness_splice_members', NULL, 'each conductor into a splice, keyed to its wire'),
  ('SH', 1, 'fold', 'function', 'load_harness_splices', NULL, 'the design''s splices written after every loader run'),
  ('SH', 1, 'residual', 'table', 'v_harness_splice_check', NULL, 'splice fill against the part''s crimp range');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 16: splices arrive with the loader''s next call to load_harness_splices';
END $check$;

COMMIT;
