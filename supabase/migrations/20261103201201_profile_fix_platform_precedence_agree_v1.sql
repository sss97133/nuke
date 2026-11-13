BEGIN;
SET LOCAL lock_timeout = '5s';
-- Rule B: platform-verified evidence outranks unverified listing / echo claims for the same field when its weighted group wins.
CREATE OR REPLACE FUNCTION public.profile_fix_platform_precedence_v1(p_vehicle uuid, p_dry boolean DEFAULT true, p_run uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  plat text[] := ARRAY['bat','cars_and_bids','pcarmarket','mecum','barrett_jackson','rm_sothebys','gooding','bonhams'];
  f text; col text; p1 record; o record; plat_score numeric; alt_score numeric; acts jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; a jsonb;
  cur text; matches_loser boolean; newval jsonb; ev jsonb; ci numeric; base text; cp text; colval text;
BEGIN
  FOREACH f IN ARRAY ARRAY['mileage','color','interior_color','engine_size','sale_price','transmission','body_style'] LOOP
    col := f;
    SELECT * INTO p1 FROM public.field_evidence WHERE vehicle_id = p_vehicle AND field_name = f AND source_type = ANY(plat) AND status IN ('pending','accepted')
      ORDER BY source_confidence DESC, created_at DESC LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    IF EXISTS (SELECT 1 FROM public.field_evidence q WHERE q.vehicle_id = p_vehicle AND q.field_name = f AND q.source_type = ANY(plat) AND q.status IN ('pending','accepted')
                 AND q.id <> p1.id AND public._pf_rel(f, p1.proposed_value, q.proposed_value) = 'conflicts') THEN
      skipped := skipped || jsonb_build_object('field', f, 'why', 'platform_rows_disagree'); CONTINUE;
    END IF;
    WITH rws AS (
      SELECT o2.id, o2.source_type, o2.proposed_value, public._pf_rel(f, p1.proposed_value, o2.proposed_value) rel,
             (CASE o2.source_type WHEN 'bat' THEN 1.0 WHEN 'cars_and_bids' THEN 1.0 WHEN 'pcarmarket' THEN 1.0 WHEN 'mecum' THEN 1.0 WHEN 'ai_visual' THEN 0.6
                                  WHEN 'user-submission_listing' THEN 0.5 WHEN 'system_update' THEN 0.3 ELSE 0.5 END) * o2.source_confidence / 100.0 w
        FROM public.field_evidence o2 WHERE o2.vehicle_id = p_vehicle AND o2.field_name = f AND o2.status IN ('accepted','pending','conflicted'))
    SELECT (SELECT sum(m) FROM (SELECT max(w) m FROM rws WHERE id = p1.id OR rel <> 'conflicts' GROUP BY source_type) x),
           coalesce((SELECT max(s) FROM (SELECT sum(m) s FROM (SELECT lower(btrim(proposed_value)) k, source_type, max(w) m FROM rws WHERE id <> p1.id AND rel = 'conflicts' GROUP BY 1, 2) y GROUP BY k) z), 0)
      INTO plat_score, alt_score;
    IF plat_score < alt_score THEN skipped := skipped || jsonb_build_object('field', f, 'why', 'platform_outweighed', 'platform', plat_score, 'alt', alt_score); CONTINUE; END IF;
    ev := jsonb_build_object('field', f, 'winner_evidence_id', p1.id, 'winner_value', p1.proposed_value, 'winner_source', p1.source_type, 'platform_score', plat_score, 'alt_score', alt_score);
    a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', p1.id, 'status', '"accepted"', p_vehicle, ev, p_dry);
    IF a IS NOT NULL THEN acts := acts || a; END IF;
    matches_loser := false;
    FOR o IN SELECT e.*, public._pf_rel(f, p1.proposed_value, e.proposed_value) rel FROM public.field_evidence e
              WHERE e.vehicle_id = p_vehicle AND e.field_name = f AND e.id <> p1.id AND e.status IN ('accepted','pending','conflicted') LOOP
      IF o.rel = 'same' THEN
        IF o.status <> 'accepted' THEN a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'status', '"accepted"', p_vehicle, ev, p_dry); IF a IS NOT NULL THEN acts := acts || a; END IF; END IF;
      ELSIF o.source_type IN ('user-submission_listing','system_update') THEN
        a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'status', '"superseded"', p_vehicle, ev || jsonb_build_object('relation', o.rel, 'value', o.proposed_value), p_dry);
        IF a IS NOT NULL THEN acts := acts || a;
          a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'contradicting_signals',
                 public._pf_note(o.contradicting_signals, jsonb_build_object('reason', 'platform_precedence_' || o.rel, 'winner', p1.id, 'run_id', p_run)), p_vehicle, ev, p_dry);
        END IF;
        EXECUTE format('SELECT %I::text FROM public.vehicles WHERE id = $1', col) INTO cur USING p_vehicle;
        IF cur IS NOT NULL AND public._pf_rel(f, p1.proposed_value, cur) <> 'same' AND public._pf_rel(f, o.proposed_value, cur) = 'same' THEN matches_loser := true; END IF;
      ELSIF o.source_type = 'ai_visual' AND o.rel IN ('restates','refines') AND o.status = 'conflicted' THEN
        a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'status', '"accepted"', p_vehicle, ev, p_dry); IF a IS NOT NULL THEN acts := acts || a; END IF;
      END IF;
    END LOOP;
    EXECUTE format('SELECT %I::text FROM public.vehicles WHERE id = $1', col) INTO cur USING p_vehicle;
    IF (cur IS NULL OR matches_loser) AND (cur IS NULL OR public._pf_rel(f, p1.proposed_value, cur) <> 'same') THEN
      newval := CASE WHEN f IN ('mileage','sale_price') THEN to_jsonb(regexp_replace(p1.proposed_value, '[^0-9.]', '', 'g')::numeric::bigint) ELSE to_jsonb(p1.proposed_value) END;
      a := public._pf_update(p_run, 'platform_precedence', 'vehicles', p_vehicle, col, newval, p_vehicle, ev, p_dry);
      IF a IS NOT NULL THEN acts := acts || a; END IF;
    ELSIF cur IS NOT NULL AND public._pf_rel(f, p1.proposed_value, cur) <> 'same' THEN
      skipped := skipped || jsonb_build_object('field', f, 'why', 'column_not_from_a_superseded_claim', 'column_value', cur);
    END IF;
    IF f = 'engine_size' THEN
      ci := public.engine_displacement_ci(p1.proposed_value);
      FOR o IN SELECT e.* FROM public.field_evidence e WHERE e.vehicle_id = p_vehicle AND e.field_name IN ('engine_type','displacement') AND e.source_type = 'ai_visual'
                 AND e.status IN ('pending','conflicted') LOOP
        IF public.engine_displacement_ci(o.proposed_value) IS NOT NULL AND ci IS NOT NULL AND abs(public.engine_displacement_ci(o.proposed_value) - ci) / ci <= 0.03 THEN
          a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'status', '"accepted"', p_vehicle, ev || '{"relation":"same_displacement"}', p_dry);
          IF a IS NOT NULL THEN acts := acts || a; END IF;
        END IF;
      END LOOP;
    END IF;
    IF f = 'color' THEN
      SELECT color, color_primary INTO colval, cp FROM public.vehicles WHERE id = p_vehicle;
      IF p_dry AND (colval IS NULL OR matches_loser) THEN colval := p1.proposed_value; END IF;
      base := (regexp_match(lower(coalesce(colval, '')), '(black|white|silver|gr[ae]y|red|blue|green|yellow|orange|brown|tan|beige|gold|purple|maroon|burgundy|bronze)'))[1];
      IF base IS NOT NULL AND cp IS NOT NULL AND lower(cp) <> base AND position(lower(cp) in lower(coalesce(colval, ''))) = 0 THEN
        a := public._pf_update(p_run, 'color_primary_follows_color', 'vehicles', p_vehicle, 'color_primary', to_jsonb(initcap(base)), p_vehicle, ev, p_dry);
        IF a IS NOT NULL THEN acts := acts || a; END IF;
      END IF;
    END IF;
  END LOOP;
  -- platform rows that simply agree with the vehicle's identity columns are accepted as corroboration
  FOR o IN SELECT e.* FROM public.field_evidence e JOIN public.vehicles v ON v.id = e.vehicle_id
            WHERE e.vehicle_id = p_vehicle AND e.source_type = ANY(plat) AND e.status = 'pending' AND e.field_name IN ('make','year','vin','high_bid')
              AND public._pf_norm(e.proposed_value) = public._pf_norm(CASE e.field_name WHEN 'make' THEN v.make WHEN 'year' THEN v.year::text WHEN 'vin' THEN v.vin WHEN 'high_bid' THEN v.high_bid::text END) LOOP
    a := public._pf_update(p_run, 'platform_precedence', 'field_evidence', o.id, 'status', '"accepted"', p_vehicle, jsonb_build_object('field', o.field_name, 'relation', 'agrees_with_column'), p_dry);
    IF a IS NOT NULL THEN acts := acts || a; END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry_run', p_dry, 'vehicle_id', p_vehicle, 'changes', acts, 'skipped', skipped);
END $$;


COMMIT;
