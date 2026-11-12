BEGIN;
-- 2/5 evidence sweeps (generalize beyond one car): plate codes + subject filter, platform precedence, sold-price sync, derived refresh.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._pf_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9.]', '', 'g')) $$;

CREATE OR REPLACE FUNCTION public.engine_displacement_ci(p text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p ~* '(\d{2,3}(?:\.\d)?)\s*(?:ci|cid|cu\.?\s*in|cubic\s*inch)' THEN (regexp_match(p, '(\d{2,3}(?:\.\d)?)\s*(?:ci|cid|cu\.?\s*in|cubic\s*inch)', 'i'))[1]::numeric
    WHEN p ~* '(\d\.\d)\s*(?:l|litre|liter)\M' THEN round(((regexp_match(p, '(\d\.\d)\s*(?:l|litre|liter)\M', 'i'))[1]::numeric) / 0.016387)
    WHEN p ~ '^\s*\d{3}\s*$' THEN btrim(p)::numeric
  END $$;

-- How a lower-trust claim relates to the platform-verified one: same | restates (same displacement, other wording) | refines (platform is more specific) | conflicts
CREATE OR REPLACE FUNCTION public._pf_rel(p_field text, p_plat text, p_other text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a text := public._pf_norm(p_plat); b text := public._pf_norm(p_other); ca numeric; cb numeric;
BEGIN
  IF a = b THEN RETURN 'same'; END IF;
  IF p_field IN ('mileage','sale_price') THEN
    IF regexp_replace(p_plat,'[^0-9.]','','g') ~ '^[0-9.]+$' AND regexp_replace(p_other,'[^0-9.]','','g') ~ '^[0-9.]+$'
       AND regexp_replace(p_plat,'[^0-9.]','','g')::numeric = regexp_replace(p_other,'[^0-9.]','','g')::numeric THEN RETURN 'same'; END IF;
    RETURN 'conflicts';
  END IF;
  IF p_field = 'engine_size' THEN
    ca := public.engine_displacement_ci(p_plat); cb := public.engine_displacement_ci(p_other);
    IF ca IS NOT NULL AND cb IS NOT NULL AND abs(ca - cb) / ca <= 0.03 THEN RETURN 'restates'; END IF;
    RETURN 'conflicts';
  END IF;
  IF p_field IN ('transmission','interior_color') AND b <> '' AND position(b in a) > 0 THEN RETURN 'refines'; END IF;
  RETURN 'conflicts';
END $$;

CREATE OR REPLACE FUNCTION public._pf_note(p_cs jsonb, p_note jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_cs) = 'array' THEN p_cs || jsonb_build_array(p_note) ELSE coalesce(p_cs, '{}'::jsonb) || p_note END $$;

-- Rule A: data-plate codes are identifiers, not attributes; evidence about another vehicle / non-body parts / an unfiled photo is not evidence about this car.
CREATE OR REPLACE FUNCTION public.profile_fix_evidence_sweep_v1(p_vehicle uuid, p_dry boolean DEFAULT true, p_run uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE fe record; pk record; acts jsonb := '[]'::jsonb; a jsonb; reason text; descr text; imgv uuid; photo uuid; curval text; supported boolean; ev jsonb; n_ident int := 0; r record;
BEGIN
  FOR fe IN SELECT * FROM public.field_evidence WHERE vehicle_id = p_vehicle AND source_type = 'ai_visual' AND status <> 'superseded'
              AND extraction_context ~* 'plate\s+(text\s+)?''' ORDER BY created_at LOOP
    SELECT * INTO pk FROM public.photo_plate_code_kind(fe.extraction_context);
    CONTINUE WHEN pk.kind IS NULL;
    photo := CASE WHEN fe.raw_extraction_data->>'photo_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (fe.raw_extraction_data->>'photo_id')::uuid END;
    ev := jsonb_build_object('identifier_kind', pk.kind, 'code', pk.code, 'quote', fe.extraction_context, 'photo_id', photo);
    IF NOT p_dry THEN
      PERFORM public.land_identifier_claims(p_vehicle, jsonb_build_object('identifiers', jsonb_build_array(jsonb_build_object(
        'kind', pk.kind, 'value', pk.code, 'quote', left(fe.extraction_context, 400), 'confidence', fe.source_confidence / 100.0))),
        null, 'plate_code_sweep_v1', 'photo', photo, p_run);
    END IF;
    a := public._pf_update(p_run, 'plate_code_not_attribute', 'field_evidence', fe.id, 'status', '"superseded"', p_vehicle, ev, p_dry);
    IF a IS NOT NULL THEN acts := acts || a;
      a := public._pf_update(p_run, 'plate_code_not_attribute', 'field_evidence', fe.id, 'contradicting_signals',
             public._pf_note(fe.contradicting_signals, jsonb_build_object('reason', 'plate_code_not_attribute', 'run_id', p_run, 'identifier_kind', pk.kind)), p_vehicle, ev, p_dry);
    END IF;
    IF pk.col IS NOT NULL THEN
      EXECUTE format('SELECT %I::text FROM public.vehicles WHERE id = $1', pk.col) INTO curval USING p_vehicle;
      IF curval IS NOT NULL AND lower(btrim(curval)) = lower(btrim(pk.code)) THEN
        SELECT EXISTS (SELECT 1 FROM public.field_evidence o WHERE o.vehicle_id = p_vehicle AND public.cited_evidence_column(o.field_name) = pk.col
                        AND o.status IN ('accepted','pending') AND o.source_type <> 'system_update'
                        AND o.extraction_context IS DISTINCT FROM fe.extraction_context
                        AND NOT (coalesce(o.extraction_context,'') ~* 'plate\s+(text\s+)?''')
                        AND lower(btrim(o.proposed_value)) = lower(btrim(pk.code))) INTO supported;
        IF NOT supported THEN
          a := public._pf_update(p_run, 'plate_code_not_attribute', 'vehicles', p_vehicle, pk.col, 'null'::jsonb, p_vehicle, ev, p_dry);
          IF a IS NOT NULL THEN acts := acts || a; END IF;
          FOR r IN SELECT id, contradicting_signals FROM public.field_evidence o WHERE o.vehicle_id = p_vehicle AND o.source_type = 'system_update'
                     AND public.cited_evidence_column(o.field_name) = pk.col AND o.status <> 'superseded' AND lower(btrim(o.proposed_value)) = lower(btrim(pk.code)) LOOP
            a := public._pf_update(p_run, 'plate_code_not_attribute', 'field_evidence', r.id, 'status', '"superseded"', p_vehicle, ev || '{"echo_of_plate_code":true}', p_dry);
            IF a IS NOT NULL THEN acts := acts || a; END IF;
          END LOOP;
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF NOT p_dry THEN
    FOR r IN SELECT id FROM public.vehicle_identifiers WHERE vehicle_id = p_vehicle AND run_id = p_run AND kind LIKE 'plate\_%' LOOP
      UPDATE public.vehicle_identifiers SET evidence_class = 'plate_stamping' WHERE id = r.id AND evidence_class IS NULL;
      INSERT INTO public.profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, op, after)
        VALUES (p_run, 'plate_code_not_attribute', p_vehicle, 'vehicle_identifiers', r.id, 'insert', (SELECT to_jsonb(i) FROM public.vehicle_identifiers i WHERE i.id = r.id));
      n_ident := n_ident + 1;
    END LOOP;
  END IF;

  -- evidence from a photo no longer filed to this vehicle, or about another vehicle / a non-body part
  FOR fe IN SELECT * FROM public.field_evidence WHERE vehicle_id = p_vehicle AND source_type = 'ai_visual' AND status IN ('pending','conflicted')
              AND raw_extraction_data->>'photo_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LOOP
    photo := (fe.raw_extraction_data->>'photo_id')::uuid;
    SELECT vi.vehicle_id INTO imgv FROM public.vehicle_images vi WHERE vi.id = photo;
    SELECT d.description INTO descr FROM public.image_descriptions d WHERE d.image_id = photo ORDER BY (d.description_type = 'classifier_v2') DESC LIMIT 1;
    reason := CASE WHEN imgv IS DISTINCT FROM p_vehicle THEN 'photo_not_filed_to_vehicle'
                   ELSE public.photo_field_not_about_vehicle(fe.field_name, fe.proposed_value, coalesce(fe.raw_extraction_data->>'quote', fe.extraction_context), descr) END;
    CONTINUE WHEN reason IS NULL;
    ev := jsonb_build_object('reason', reason, 'photo_id', photo, 'photo_vehicle_id', imgv, 'quote', fe.raw_extraction_data->>'quote');
    a := public._pf_update(p_run, 'evidence_subject_' || reason, 'field_evidence', fe.id, 'status', '"superseded"', p_vehicle, ev, p_dry);
    IF a IS NOT NULL THEN acts := acts || a;
      a := public._pf_update(p_run, 'evidence_subject_' || reason, 'field_evidence', fe.id, 'contradicting_signals',
             public._pf_note(fe.contradicting_signals, jsonb_build_object('reason', reason, 'run_id', p_run)), p_vehicle, ev, p_dry);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry_run', p_dry, 'vehicle_id', p_vehicle, 'identifiers_created', n_ident, 'changes', acts);
END $$;

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

-- Rule C: a sold vehicle's headline price column is its recorded sale price; an ask-role event is priced as an ask.
CREATE OR REPLACE FUNCTION public.profile_fix_sold_price_sync_v1(p_vehicle uuid, p_dry boolean DEFAULT true, p_run uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v record; e record; acts jsonb := '[]'::jsonb; a jsonb;
BEGIN
  SELECT id, sale_status, sale_price, price INTO v FROM public.vehicles WHERE id = p_vehicle;
  IF v.sale_status = 'sold' AND v.sale_price > 0 AND v.price IS DISTINCT FROM v.sale_price THEN
    a := public._pf_update(p_run, 'sold_price_sync', 'vehicles', p_vehicle, 'price', to_jsonb(v.sale_price), p_vehicle, jsonb_build_object('sale_price', v.sale_price), p_dry);
    IF a IS NOT NULL THEN acts := acts || a; END IF;
  END IF;
  IF v.sale_status = 'sold' THEN
    FOR e IN SELECT x.id FROM public.vehicle_events x WHERE x.vehicle_id = p_vehicle AND x.sale_truth_role = 'ask' AND x.price_kind IS NULL AND x.duplicate_of_event_id IS NULL
               AND EXISTS (SELECT 1 FROM public.vehicle_events s WHERE s.vehicle_id = p_vehicle AND s.id <> x.id AND s.event_status = 'sold' AND s.source_url IS NOT NULL
                             AND coalesce(s.hammer_price, s.final_price) = v.sale_price) LOOP
      a := public._pf_update(p_run, 'ask_event_priced_as_ask', 'vehicle_events', e.id, 'price_kind', '"asking"', p_vehicle, jsonb_build_object('sale_price', v.sale_price), p_dry);
      IF a IS NOT NULL THEN acts := acts || a; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry_run', p_dry, 'vehicle_id', p_vehicle, 'changes', acts);
END $$;

REVOKE EXECUTE ON FUNCTION public._pf_update(uuid,text,text,uuid,text,jsonb,uuid,jsonb,boolean), public.profile_fix_revert(uuid),
  public.profile_fix_evidence_sweep_v1(uuid,boolean,uuid), public.profile_fix_platform_precedence_v1(uuid,boolean,uuid), public.profile_fix_sold_price_sync_v1(uuid,boolean,uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
