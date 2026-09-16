-- Phase 4 — the finite-asset wiki.
--
-- A readable, fully-sourced page for one physical VIN. Every field is the weighted
-- consensus of evidence-cited claims (project_attribute), carrying its citation, evidence
-- class, confidence, contributors, and any conflict. The canonical header is the
-- denormalized cache; cited_fields are the live projection — the actual truth the page renders.
-- A Wikipedia for one physical object, maintained by agents, every line cited.

CREATE OR REPLACE FUNCTION public.vehicle_wiki(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_header jsonb; v_fields jsonb;
BEGIN
  SELECT to_jsonb(t) INTO v_header FROM (
    SELECT id, year, make, model, vin, body_style,
           color, color_family, color_source,
           horsepower, torque, displacement, seats,
           canonical_outcome, is_for_sale, status
    FROM vehicles WHERE id = p_vehicle_id
  ) t;

  SELECT jsonb_agg(public.project_attribute(p_vehicle_id, attr) ORDER BY attr) INTO v_fields
  FROM (
    SELECT DISTINCT request_envelope->>'attribute' AS attr
    FROM projection_event
    WHERE request_envelope->>'subject_id' = p_vehicle_id::text
      AND retracted_at IS NULL
  ) a;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'canonical', v_header,
    'cited_fields', COALESCE(v_fields, '[]'::jsonb),
    'field_count', COALESCE(jsonb_array_length(v_fields), 0),
    'note', 'Each cited field is the weighted consensus of evidence-cited claims (evidence_class × contributor reputation × confidence × recency). Conflicts are surfaced inline, never silently resolved. Canonical header is the denormalized cache.'
  );
END;
$$;

COMMENT ON FUNCTION public.vehicle_wiki(uuid) IS
  'Phase 4 finite-asset wiki: full claim graph for one VIN as a readable, sourced page. Each field = project_attribute consensus with citation + confidence + contributors + conflict. Backs the get_vehicle_wiki MCP tool and the public wiki page.';

-- Generic canonical projector: sync the denormalized spec columns FROM the claim consensus,
-- with provenance. Only writes a column when a NON-CONFLICTED consensus claim backs it. This
-- makes the canonical row a materialized projection of the claim set — never a hand-overwrite,
-- which is the anti-pattern that produced color_family='Red' in the first place. Color routes
-- through its dedicated projector (current/original/refinish + family).
CREATE OR REPLACE FUNCTION public.project_vehicle_canonical(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record; applied jsonb := '[]'::jsonb; m jsonb; v text; conflict boolean;
  col_map jsonb := '{"vehicle.horsepower":"horsepower","vehicle.torque":"torque","vehicle.displacement":"displacement","vehicle.seat_count":"seats"}';
  col text;
BEGIN
  PERFORM public.project_vehicle_color(p_vehicle_id);

  FOR r IN SELECT key AS attr, value::text AS column_name FROM jsonb_each_text(col_map) LOOP
    m := public.project_attribute(p_vehicle_id, r.attr);
    IF m->>'consensus' IS NULL THEN CONTINUE; END IF;
    conflict := COALESCE((m->>'conflict')::boolean, false);
    IF conflict THEN
      applied := applied || jsonb_build_object('attribute', r.attr, 'skipped', 'conflict');
      CONTINUE;
    END IF;
    v := m->>'consensus';
    col := r.column_name;
    IF col IN ('horsepower','torque','seats') THEN
      EXECUTE format('UPDATE vehicles SET %I = $1::int WHERE id = $2', col) USING v, p_vehicle_id;
    ELSE
      EXECUTE format('UPDATE vehicles SET %I = $1 WHERE id = $2', col) USING v, p_vehicle_id;
    END IF;
    applied := applied || jsonb_build_object('attribute', r.attr, 'column', col, 'value', v);
  END LOOP;

  -- Market disposition maps one enum claim onto two canonical columns. A title/possession-backed
  -- 'owner_retained'/'in_restoration' clears a contaminated auction-scrape 'sold'.
  m := public.project_attribute(p_vehicle_id, 'vehicle.sale_disposition');
  IF m->>'consensus' IS NOT NULL AND NOT COALESCE((m->>'conflict')::boolean, false) THEN
    v := m->>'consensus';
    UPDATE vehicles SET
      canonical_outcome = CASE v WHEN 'sold' THEN 'sold' WHEN 'withdrawn' THEN 'withdrawn'
                                 WHEN 'owner_retained' THEN 'owner_retained' WHEN 'in_restoration' THEN 'owner_retained'
                                 ELSE canonical_outcome END,
      is_for_sale = CASE v WHEN 'for_sale' THEN true WHEN 'sold' THEN false
                           WHEN 'owner_retained' THEN false WHEN 'in_restoration' THEN false
                           ELSE is_for_sale END
    WHERE id = p_vehicle_id;
    applied := applied || jsonb_build_object('attribute', 'vehicle.sale_disposition', 'disposition', v);
  END IF;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'applied', applied);
END;
$$;

COMMENT ON FUNCTION public.project_vehicle_canonical(uuid) IS
  'Phase 4: materializes the denormalized vehicles spec columns (hp/torque/displacement/seats + color via project_vehicle_color) from the non-conflicted claim consensus, with provenance. Canonical = projection of claims, not hand-overwrite. Skips conflicted fields.';
