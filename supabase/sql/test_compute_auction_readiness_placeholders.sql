-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- compute_auction_readiness() counted a failed analysis run as an analysis signal in the market dimension. The frozen live
-- 2026-10-07 body (pg_get_functiondef on prod) reproduces the installed function and its fingerprint and shows the defect; the
-- migration file itself is then applied and the contract is checked: a placeholder row (score IS NULL AND value_json ? 'error')
-- adds nothing, a row with a score still counts, severity warning and critical still never count, a vehicle with only
-- placeholders scores exactly like one with no rows, one statement of the body changed, and attributes and grants are unchanged.
-- Also checked: a drifted body is refused, a second run is a no-op, and a database without the function gets it created.
-- Execute in an empty dm_readiness_placeholder_rows_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'dm_readiness_placeholder_rows_ci'
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='60s';
SET lock_timeout='3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Only the columns the function reads. Types as on prod 2026-10-07 (vehicle_observations.kind is an enum there; the
-- function compares it with three string literals, which a text column answers the same way).
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year integer, vin text, color text, mileage integer,
 transmission text, condition_rating integer, sale_price integer, ownership_verified boolean, interior_color text,
 description text, title text, engine_type text, sold_price integer, highlights text, equipment text, modifications text,
 known_flaws text, title_status text, deal_score numeric(5,2), heat_score numeric(5,2), price_confidence text,
 canonical_sold_price numeric);
CREATE TABLE public.vehicle_images(vehicle_id uuid, ai_processing_status text, vehicle_zone text);
CREATE TABLE public.vehicle_documents(vehicle_id uuid);
CREATE TABLE public.timeline_events(vehicle_id uuid, event_type text);
CREATE TABLE public.vehicle_observations(vehicle_id uuid, kind text, content_text text);
CREATE TABLE public.nuke_estimates(vehicle_id uuid, estimated_value numeric(12,2), confidence_score integer,
 deal_score numeric(5,2), heat_score numeric(5,2), input_count integer, calculated_at timestamptz);
-- The columns the coordinator writes and the function reads, with prod's CHECK on severity and UNIQUE (vehicle_id, widget_slug).
CREATE TABLE public.analysis_signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
 widget_slug text NOT NULL, score numeric(5,2), label text,
 severity text CHECK (severity IN ('info','ok','warning','critical')),
 value_json jsonb NOT NULL DEFAULT '{}'::jsonb, reasons text[] DEFAULT '{}'::text[],
 computed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (vehicle_id, widget_slug));

-- Frozen live body of the helper (pg_get_functiondef on prod, 2026-10-07)
CREATE OR REPLACE FUNCTION public.check_mvps_zone_coverage(p_zones text[])
 RETURNS TABLE(mvps_complete boolean, zones_missing text[])
 LANGUAGE sql
 STABLE
AS $function$
  -- Each MVPS requirement maps to one or more YONO zone names.
  -- A requirement is satisfied if ANY of its aliases appear in the input zones.
  WITH requirements(mvps_zone, yono_aliases) AS (
    VALUES
      ('engine_bay',        ARRAY['mech_engine_bay']),
      ('exterior_front_34', ARRAY['ext_front_driver', 'ext_front', 'ext_front_passenger']),
      ('exterior_rear_34',  ARRAY['ext_rear_passenger', 'ext_rear', 'ext_rear_driver']),
      ('interior_full',     ARRAY['int_dashboard', 'int_front_seats']),
      ('trunk',             ARRAY['int_cargo', 'panel_trunk']),
      ('wheels',            ARRAY['wheel_fl', 'wheel_fr']),
      ('undercarriage',     ARRAY['ext_undercarriage']),
      ('vin_plate',         ARRAY['detail_vin', 'detail_odometer'])
  ),
  missing AS (
    SELECT mvps_zone
    FROM requirements r
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(r.yono_aliases) alias
      WHERE alias = ANY(p_zones)
    )
  )
  SELECT
    (SELECT count(*) = 0 FROM missing),
    COALESCE(array_agg(mvps_zone) FILTER (WHERE mvps_zone IS NOT NULL), ARRAY[]::text[])
  FROM missing;
$function$;
SELECT pg_temp.ok('frozen helper body reproduces the prod fingerprint',
 md5(pg_get_functiondef('public.check_mvps_zone_coverage(text[])'::regprocedure)) = 'ffdd62c977654c62d24dd7cc3f99920b'); -- gitleaks:allow (function-definition fingerprint, not a secret)

-- Frozen live body (pg_get_functiondef on prod, 2026-10-07)
CREATE OR REPLACE FUNCTION public.compute_auction_readiness(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v RECORD; ne RECORD;
  d_identity smallint := 0; d_photo smallint := 0; d_doc smallint := 0;
  d_desc smallint := 0; d_market smallint := 0; d_condition smallint := 0;
  composite numeric; tier text;
  gaps jsonb := '[]'::jsonb; coaching jsonb := '[]'::jsonb;
  cnt int; signal_cnt int;
  photo_zones_present text[] := '{}'; photo_zones_missing text[] := '{}';
  mvps_complete boolean := false; penalties jsonb := '[]'::jsonb;
  mvps_result RECORD;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'vehicle_not_found'); END IF;

  -- DIM 1: IDENTITY (0.15)
  IF v.year IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing year','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.make IS NOT NULL AND length(v.make) > 0 THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing make','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.model IS NOT NULL AND length(v.model) > 0 THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing model','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.vin IS NOT NULL AND length(v.vin) >= 11 THEN d_identity := d_identity + 20;
  ELSIF v.vin IS NOT NULL AND length(v.vin) > 0 THEN d_identity := d_identity + 10; gaps := gaps || jsonb_build_object('dimension','identity','gap','Partial VIN','points',10,'action','DATA_SUPPLY');
  ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No VIN','points',20,'action','DATA_SUPPLY'); END IF;
  IF v.title IS NOT NULL AND length(v.title) > 10 THEN d_identity := d_identity + 10; END IF;
  IF v.color IS NOT NULL THEN d_identity := d_identity + 5; END IF;
  IF v.interior_color IS NOT NULL THEN d_identity := d_identity + 5; END IF;
  IF v.engine_type IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No engine info','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.transmission IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No transmission info','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.mileage IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No mileage','points',10,'action','DATA_SUPPLY'); END IF;
  d_identity := LEAST(d_identity, 100);

  -- DIM 2: PHOTO (0.20)
  SELECT count(*) INTO cnt FROM vehicle_images WHERE vehicle_id = p_vehicle_id AND (ai_processing_status IS NULL OR ai_processing_status != 'failed');
  IF cnt = 0 THEN d_photo := 0; gaps := gaps || jsonb_build_object('dimension','photo','gap','No photos','points',100,'action','PHOTO_UPLOAD','coaching_prompt','Start with exterior 3/4 front view in good light');
  ELSIF cnt < 5 THEN d_photo := 15; gaps := gaps || jsonb_build_object('dimension','photo','gap','Only '||cnt||' photos','points',60,'action','PHOTO_UPLOAD');
  ELSIF cnt < 20 THEN d_photo := 35; gaps := gaps || jsonb_build_object('dimension','photo','gap',cnt||' photos — 40+ is competitive','points',30,'action','PHOTO_UPLOAD');
  ELSIF cnt < 40 THEN d_photo := 55; ELSIF cnt < 80 THEN d_photo := 75; ELSE d_photo := 90; END IF;

  -- Collect actual zones present
  SELECT array_agg(DISTINCT vehicle_zone) INTO photo_zones_present
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id AND vi.vehicle_zone IS NOT NULL;
  photo_zones_present := COALESCE(photo_zones_present, '{}');

  -- MVPS check using proper zone alias mapping
  SELECT * INTO mvps_result FROM check_mvps_zone_coverage(photo_zones_present);
  mvps_complete := mvps_result.mvps_complete;
  photo_zones_missing := mvps_result.zones_missing;

  IF mvps_complete THEN d_photo := GREATEST(d_photo, 70); END IF;
  IF array_length(photo_zones_present, 1) IS NOT NULL AND array_length(photo_zones_present, 1) >= 12 THEN d_photo := GREATEST(d_photo, 85); END IF;

  -- Add gap for each missing MVPS zone
  IF NOT mvps_complete AND array_length(photo_zones_missing, 1) > 0 THEN
    FOR cnt IN 1..LEAST(array_length(photo_zones_missing, 1), 3) LOOP
      gaps := gaps || jsonb_build_object(
        'dimension', 'photo',
        'gap', 'Missing required zone: ' || photo_zones_missing[cnt],
        'points', 8,
        'action', 'PHOTO_UPLOAD'
      );
    END LOOP;
  END IF;

  d_photo := LEAST(d_photo, 100);

  -- DIM 3: DOCS (0.15)
  SELECT count(*) INTO cnt FROM vehicle_documents WHERE vehicle_id = p_vehicle_id;
  IF cnt = 0 THEN d_doc := 5; gaps := gaps || jsonb_build_object('dimension','doc','gap','No documents uploaded','points',60,'action','DOC_UPLOAD');
  ELSIF cnt < 3 THEN d_doc := 25; ELSIF cnt < 6 THEN d_doc := 50; ELSE d_doc := 70; END IF;
  SELECT count(*) INTO cnt FROM timeline_events WHERE vehicle_id = p_vehicle_id AND event_type IN ('service','maintenance','repair');
  IF cnt = 0 THEN gaps := gaps || jsonb_build_object('dimension','doc','gap','No maintenance history','points',30,'action','DATA_SUPPLY');
  ELSIF cnt < 5 THEN d_doc := d_doc + 10; ELSE d_doc := d_doc + 25; END IF;
  -- Title status bonus
  IF v.title_status IS NOT NULL AND length(v.title_status) > 0 THEN
    d_doc := d_doc + 15;
    IF lower(v.title_status) = 'clean' THEN d_doc := d_doc + 5; END IF;
  ELSE
    gaps := gaps || jsonb_build_object('dimension','doc','gap','Title status unknown','points',15,'action','DATA_SUPPLY');
  END IF;
  d_doc := LEAST(d_doc, 100);

  -- DIM 4: DESCRIPTION (0.10)
  IF v.description IS NOT NULL AND length(v.description) > 500 THEN d_desc := 40;
  ELSIF v.description IS NOT NULL AND length(v.description) > 100 THEN d_desc := 20; gaps := gaps || jsonb_build_object('dimension','desc','gap','Description under 500 chars','points',20,'action','NARRATIVE_WRITE');
  ELSE d_desc := 5; gaps := gaps || jsonb_build_object('dimension','desc','gap','No or very short description','points',35,'action','NARRATIVE_WRITE'); END IF;
  IF v.highlights IS NOT NULL AND length(v.highlights) > 2 THEN d_desc := d_desc + 15; ELSE gaps := gaps || jsonb_build_object('dimension','desc','gap','No highlights listed','points',15,'action','DATA_SUPPLY'); END IF;
  IF v.known_flaws IS NOT NULL AND length(v.known_flaws) > 2 THEN d_desc := d_desc + 10; ELSE gaps := gaps || jsonb_build_object('dimension','desc','gap','Known flaws not disclosed','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.equipment IS NOT NULL AND length(v.equipment) > 2 THEN d_desc := d_desc + 10; END IF;
  IF v.modifications IS NOT NULL AND length(v.modifications) > 2 THEN d_desc := d_desc + 10; END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'comment';
  IF cnt >= 20 THEN d_desc := d_desc + 15; ELSIF cnt >= 5 THEN d_desc := d_desc + 8; END IF;
  d_desc := LEAST(d_desc, 100);

  -- DIM 5: MARKET (0.20)
  SELECT * INTO ne FROM nuke_estimates WHERE vehicle_id = p_vehicle_id ORDER BY calculated_at DESC LIMIT 1;
  IF ne.estimated_value IS NOT NULL THEN d_market := d_market + 10;
    IF ne.confidence_score >= 50 THEN d_market := d_market + 10; END IF;
    IF ne.confidence_score >= 70 THEN d_market := d_market + 5; END IF;
  ELSE gaps := gaps || jsonb_build_object('dimension','market','gap','No Nuke Estimate','points',25,'action','VERIFY_CLAIM'); END IF;
  IF ne.input_count IS NOT NULL THEN
    IF ne.input_count >= 3 THEN d_market := d_market + 15; END IF;
    IF ne.input_count >= 5 THEN d_market := d_market + 5; END IF; END IF;
  IF coalesce(v.heat_score, ne.heat_score) IS NOT NULL AND coalesce(v.heat_score, ne.heat_score) > 50 THEN d_market := d_market + 5; END IF;
  IF coalesce(v.deal_score, ne.deal_score) IS NOT NULL AND coalesce(v.deal_score, ne.deal_score) > 50 THEN d_market := d_market + 5; END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'listing'
    AND (content_text ILIKE '%no sale%' OR content_text ILIKE '%withdrawn%' OR content_text ILIKE '%reserve not met%');
  IF cnt = 0 THEN d_market := d_market + 10; ELSE d_market := d_market + 3; END IF;
  IF v.sale_price IS NOT NULL OR v.sold_price IS NOT NULL OR v.canonical_sold_price IS NOT NULL THEN d_market := d_market + 10; END IF;
  IF v.price_confidence IS NOT NULL AND v.price_confidence = 'high' THEN d_market := d_market + 5; END IF;
  SELECT count(*) INTO signal_cnt FROM analysis_signals WHERE vehicle_id = p_vehicle_id AND severity IN ('ok', 'info');
  IF signal_cnt >= 3 THEN d_market := d_market + 5; END IF;
  IF signal_cnt >= 6 THEN d_market := d_market + 5; END IF;
  d_market := LEAST(d_market, 100);

  -- DIM 6: CONDITION (0.20)
  IF v.condition_rating IS NOT NULL THEN d_condition := LEAST((v.condition_rating * 10)::smallint, 80);
    IF v.condition_rating >= 8 THEN d_condition := d_condition + 10; END IF;
  ELSE d_condition := 5; gaps := gaps || jsonb_build_object('dimension','condition','gap','No condition rating','points',70,'action','DATA_SUPPLY'); END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'condition';
  IF cnt > 0 THEN d_condition := GREATEST(d_condition, 50); d_condition := d_condition + 10; END IF;
  IF v.ownership_verified THEN d_condition := d_condition + 10; END IF;
  d_condition := LEAST(d_condition, 100);

  -- COMPOSITE
  composite := round(d_identity*0.15 + d_photo*0.20 + d_doc*0.15 + d_desc*0.10 + d_market*0.20 + d_condition*0.20);
  composite := LEAST(composite, 100);
  IF composite >= 85 THEN tier := 'TIER_1_EXCEPTIONAL';
  ELSIF composite >= 70 THEN tier := 'TIER_2_COMPETITIVE';
  ELSIF composite >= 50 THEN tier := 'TIER_3_VIABLE';
  ELSIF composite >= 30 THEN tier := 'TIER_4_INCOMPLETE';
  ELSE tier := 'DISCOVERY_ONLY'; END IF;

  SELECT jsonb_agg(g ORDER BY (g->>'points')::int DESC) INTO coaching FROM jsonb_array_elements(gaps) AS g;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'composite_score', composite::smallint, 'tier', tier,
    'identity_score', d_identity, 'photo_score', d_photo, 'doc_score', d_doc,
    'desc_score', d_desc, 'market_score', d_market, 'condition_score', d_condition,
    'top_gaps', COALESCE(coaching,'[]'::jsonb), 'coaching_plan', COALESCE(coaching,'[]'::jsonb),
    'photo_zones_present', to_jsonb(photo_zones_present), 'photo_zones_missing', to_jsonb(photo_zones_missing),
    'mvps_complete', mvps_complete, 'rejection_penalties', penalties
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.compute_auction_readiness(uuid) TO anon, authenticated, service_role; -- the grants prod holds
SELECT pg_temp.ok('frozen body reproduces the prod fingerprint',
 md5(pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure)) = 'a1811bed649d2786ffb98d83026e8d9b'); -- gitleaks:allow (function-definition fingerprint, not a secret)
CREATE TEMP TABLE before_def AS SELECT pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure) d;
CREATE TEMP TABLE before_pg AS SELECT p.proacl, p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.prorettype, p.prolang,
 p.proargtypes::text AS argtypes, p.proargnames, p.proparallel, p.proleakproof, p.proisstrict
 FROM pg_proc p WHERE p.oid='public.compute_auction_readiness(uuid)'::regprocedure;
SELECT pg_temp.ok('the frozen function is security definer with statement_timeout 30s and anon, authenticated and service_role may execute it',
 (SELECT prosecdef AND proconfig = ARRAY['statement_timeout=30s'] FROM before_pg)
 AND has_function_privilege('anon','public.compute_auction_readiness(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public.compute_auction_readiness(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.compute_auction_readiness(uuid)','EXECUTE'));

-- Vehicles: identical but for the id, so the signal rows are the only difference between them.
CREATE FUNCTION pg_temp.mk(n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := ('00000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO public.vehicles(id, make, model, year, vin, color, mileage, transmission, condition_rating, description, title,
                              engine_type, title_status)
  VALUES (v, 'Fixture', 'Model', 1972, 'FIXTUREVIN0000001', 'red', 61000, 'manual', 7, repeat('x', 120), 'Fixture vehicle title',
          'v8', 'clean');
  INSERT INTO public.nuke_estimates(vehicle_id, estimated_value, confidence_score, input_count, calculated_at)
  VALUES (v, 25000, 60, 4, '2026-10-01 00:00+00');
  INSERT INTO public.vehicle_images(vehicle_id, ai_processing_status, vehicle_zone)
  SELECT v, 'completed', z FROM unnest(ARRAY['ext_front','ext_rear','int_dashboard','mech_engine_bay','wheel_fl']) z;
  RETURN v;
END $$;
-- One signal row: slug, severity, score, value_json, first reason.
CREATE FUNCTION pg_temp.sig(v uuid, slug text, sev text, sc numeric, vj jsonb, reason text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.analysis_signals(vehicle_id, widget_slug, severity, score, value_json, reasons)
  VALUES (v, slug, sev, sc, vj, ARRAY[reason]) $$;
-- A genuine output of a real widget (has a score), and a failed run exactly as the coordinator writes it.
CREATE FUNCTION pg_temp.genuine(v uuid, slug text, sev text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.sig(v, slug, sev, 70, jsonb_build_object('score', 70, 'detail', slug), slug || ' analysed') $$;
CREATE FUNCTION pg_temp.failed_widget(v uuid, slug text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.sig(v, slug, 'info', NULL, '{"error": "Widget function returned 500"}', 'Widget ' || slug || ' computation failed') $$;
CREATE FUNCTION pg_temp.failed_rate(v uuid, slug text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.sig(v, slug, 'info', NULL, '{"error": "Rate limit exceeded for function"}',
                     'Widget ' || slug || ' failed: Rate limit exceeded for function') $$;
CREATE FUNCTION pg_temp.failed_sql(v uuid, slug text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.sig(v, slug, 'info', NULL, '{"error": "canceling statement due to statement timeout"}',
                     'SQL execution failed for ' || slug) $$;

DO $$
DECLARE
  v uuid;
  s text;
BEGIN
  PERFORM pg_temp.mk(1);                               -- V01 no signal rows at all (the reference)
  v := pg_temp.mk(2);                                  -- V02 only placeholders: 10 widgets that never produced a result
  FOREACH s IN ARRAY ARRAY['broker-exposure','buyer-qualification','commission-optimizer','completion-discount','deal-readiness'] LOOP PERFORM pg_temp.failed_widget(v, s); END LOOP;
  FOREACH s IN ARRAY ARRAY['geographic-arbitrage','presentation-roi','rerun-decay','sell-through-cliff','time-kills-deals'] LOOP PERFORM pg_temp.failed_rate(v, s); END LOOP;
  v := pg_temp.mk(3);                                  -- V03 six genuine rows, ok and info, all with a score
  PERFORM pg_temp.genuine(v, 'data-quality', 'ok');          PERFORM pg_temp.genuine(v, 'identity-confidence', 'ok');
  PERFORM pg_temp.genuine(v, 'photo-coverage', 'info');      PERFORM pg_temp.genuine(v, 'price-position', 'info');
  PERFORM pg_temp.genuine(v, 'comp-freshness', 'ok');        PERFORM pg_temp.genuine(v, 'market-velocity', 'info');
  v := pg_temp.mk(4);                                  -- V04 three genuine rows and seven placeholders
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence','photo-coverage'] LOOP PERFORM pg_temp.genuine(v, s, 'ok'); END LOOP;
  FOREACH s IN ARRAY ARRAY['broker-exposure','buyer-qualification','commission-optimizer','completion-discount'] LOOP PERFORM pg_temp.failed_widget(v, s); END LOOP;
  FOREACH s IN ARRAY ARRAY['geographic-arbitrage','presentation-roi','rerun-decay'] LOOP PERFORM pg_temp.failed_rate(v, s); END LOOP;
  v := pg_temp.mk(5);                                  -- V05 two genuine rows and four placeholders
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence'] LOOP PERFORM pg_temp.genuine(v, s, 'info'); END LOOP;
  FOREACH s IN ARRAY ARRAY['broker-exposure','buyer-qualification','commission-optimizer','completion-discount'] LOOP PERFORM pg_temp.failed_widget(v, s); END LOOP;
  v := pg_temp.mk(6);                                  -- V06 five genuine rows and one placeholder (the 5 to 6 threshold)
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence','photo-coverage','price-position','comp-freshness'] LOOP PERFORM pg_temp.genuine(v, s, 'ok'); END LOOP;
  PERFORM pg_temp.failed_rate(v, 'rerun-decay');
  v := pg_temp.mk(7);                                  -- V07 six genuine rows and four placeholders (stays at +10)
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence','photo-coverage','price-position','comp-freshness','market-velocity'] LOOP PERFORM pg_temp.genuine(v, s, 'ok'); END LOOP;
  FOREACH s IN ARRAY ARRAY['broker-exposure','buyer-qualification','commission-optimizer','completion-discount'] LOOP PERFORM pg_temp.failed_widget(v, s); END LOOP;
  v := pg_temp.mk(8);                                  -- V08 six genuine warning and critical rows (never counted) and four placeholders
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence','photo-coverage'] LOOP PERFORM pg_temp.genuine(v, s, 'warning'); END LOOP;
  FOREACH s IN ARRAY ARRAY['price-position','comp-freshness','build-progress'] LOOP PERFORM pg_temp.genuine(v, s, 'critical'); END LOOP;
  FOREACH s IN ARRAY ARRAY['broker-exposure','buyer-qualification','commission-optimizer','completion-discount'] LOOP PERFORM pg_temp.failed_widget(v, s); END LOOP;
  v := pg_temp.mk(9);                                  -- V09 failed runs of real widgets (the SQL failure envelope) next to two genuine rows
  FOREACH s IN ARRAY ARRAY['comp-freshness','market-velocity','seasonal-pricing','auction-house-optimizer'] LOOP PERFORM pg_temp.failed_sql(v, s); END LOOP;
  FOREACH s IN ARRAY ARRAY['data-quality','identity-confidence'] LOOP PERFORM pg_temp.genuine(v, s, 'ok'); END LOOP;
  v := pg_temp.mk(10);                                 -- V10 the edges of the predicate: three rows that count and one placeholder
  PERFORM pg_temp.sig(v, 'data-quality', 'ok', 70, '{"error": "partial"}', 'scored although it holds an error key');
  PERFORM pg_temp.sig(v, 'seasonal-pricing', 'info', NULL, '{}', 'no score and no error key');
  PERFORM pg_temp.genuine(v, 'price-position', 'ok');
  PERFORM pg_temp.failed_sql(v, 'comp-freshness');
END $$;

CREATE TEMP TABLE scen(n int PRIMARY KEY, counted_before int, counted_after int, market_before int, market_after int);
-- rows the function counts before and after, and the market points above the reference vehicle V01 before and after
INSERT INTO scen VALUES (2,10,0,10,0),(3,6,6,10,10),(4,10,3,10,5),(5,6,2,10,0),(6,6,5,10,5),(7,10,6,10,10),(8,4,0,5,0),(9,6,2,10,0),(10,4,3,5,5);
SELECT pg_temp.ok('fixture: every scenario holds the rows the old rule is expected to count',
 (SELECT bool_and((SELECT count(*) FROM public.analysis_signals a WHERE a.vehicle_id = ('00000000-0000-4000-8000-0000000000' || lpad(s.n::text, 2, '0'))::uuid
                    AND a.severity IN ('ok','info')) = s.counted_before) FROM scen s));
SELECT pg_temp.ok('fixture: every scenario holds the rows the new rule is expected to count',
 (SELECT bool_and((SELECT count(*) FROM public.analysis_signals a WHERE a.vehicle_id = ('00000000-0000-4000-8000-0000000000' || lpad(s.n::text, 2, '0'))::uuid
                    AND a.severity IN ('ok','info') AND NOT (a.score IS NULL AND a.value_json ? 'error')) = s.counted_after) FROM scen s));

CREATE TEMP TABLE before_scores AS
 SELECT n, public.compute_auction_readiness(('00000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid) r FROM generate_series(1,10) n;
CREATE TEMP TABLE before_missing AS SELECT public.compute_auction_readiness('00000000-0000-4000-8000-0000000000ff') r;

-- The defect on the frozen body: failed runs lift the market dimension.
SELECT pg_temp.ok('frozen body: a vehicle with only placeholders scores +10 market points and +2 composite points over a vehicle with no rows (the defect)',
 (SELECT (b2.r->>'market_score')::int - (b1.r->>'market_score')::int = 10 AND (b2.r->>'composite_score')::int - (b1.r->>'composite_score')::int = 2
    FROM before_scores b1, before_scores b2 WHERE b1.n = 1 AND b2.n = 2));
SELECT pg_temp.ok('frozen body: the reference vehicle has market 45 (estimate 10, confidence 10, three inputs 15, no withdrawn listing 10) and no signal points',
 (SELECT (r->>'market_score')::int = 45 FROM before_scores WHERE n = 1));

\ir ../migrations/20261007080000_compute_auction_readiness_ignore_failed_runs.sql

CREATE TEMP TABLE after_scores AS
 SELECT n, public.compute_auction_readiness(('00000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid) r FROM generate_series(1,10) n;

-- 1. placeholders add nothing
SELECT pg_temp.ok('a vehicle with only placeholders now scores exactly like a vehicle with no rows (whole result, every key)',
 (SELECT (a2.r - 'vehicle_id') = (a1.r - 'vehicle_id') FROM after_scores a1, after_scores a2 WHERE a1.n = 1 AND a2.n = 2));
SELECT pg_temp.ok('no signal rows: the reference vehicle scores exactly as before',
 (SELECT a.r = b.r FROM after_scores a JOIN before_scores b USING (n) WHERE n = 1));
-- 2. genuine rows still add
SELECT pg_temp.ok('six genuine rows still add +10 market points and +2 composite points over the reference vehicle, and the result is exactly as before',
 (SELECT (a3.r->>'market_score')::int - (a1.r->>'market_score')::int = 10
     AND (a3.r->>'composite_score')::int - (a1.r->>'composite_score')::int = 2 AND a3.r = b3.r
    FROM after_scores a1, after_scores a3, before_scores b3 WHERE a1.n = 1 AND a3.n = 3 AND b3.n = 3));
-- 3. the scenarios, before and after, in market points over the reference vehicle
SELECT pg_temp.ok('frozen body: every scenario gives the market points the old rule predicts',
 (SELECT bool_and((b.r->>'market_score')::int - (b1.r->>'market_score')::int = s.market_before)
    FROM scen s JOIN before_scores b ON b.n = s.n, before_scores b1 WHERE b1.n = 1));
SELECT pg_temp.ok('migrated body: every scenario gives the market points the new rule predicts',
 (SELECT bool_and((a.r->>'market_score')::int - (a1.r->>'market_score')::int = s.market_after)
    FROM scen s JOIN after_scores a ON a.n = s.n, after_scores a1 WHERE a1.n = 1));
SELECT pg_temp.ok('migrated body: the composite moves by the market points times 0.20 in every scenario (2 points per 10, 1 per 5)',
 (SELECT bool_and((a.r->>'composite_score')::int - (a1.r->>'composite_score')::int = s.market_after / 5)
    FROM scen s JOIN after_scores a ON a.n = s.n, after_scores a1 WHERE a1.n = 1));
SELECT pg_temp.ok('migrated body: the thresholds hold on genuine rows (2 rows +0, 3 rows +5, 5 rows +5, 6 rows +10)',
 (SELECT (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 5) - (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 1) = 0
     AND (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 4) - (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 1) = 5
     AND (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 6) - (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 1) = 5
     AND (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 7) - (SELECT (r->>'market_score')::int FROM after_scores WHERE n = 1) = 10));
-- 4. severity warning and critical still never count, and placeholders beside them add nothing
SELECT pg_temp.ok('six genuine warning and critical rows beside four placeholders add nothing',
 (SELECT (a.r->>'market_score') = (a1.r->>'market_score') FROM after_scores a, after_scores a1 WHERE a.n = 8 AND a1.n = 1));
-- 5. the failure envelope of a real widget is a placeholder too, and the edges of the predicate
SELECT pg_temp.ok('SQL failure rows of real widgets are placeholders: four of them beside two genuine rows count two',
 (SELECT (a.r->>'market_score') = (a1.r->>'market_score') FROM after_scores a, after_scores a1 WHERE a.n = 9 AND a1.n = 1));
SELECT pg_temp.ok('predicate edges: a row with a score counts although it holds an error key, and a row with no score and no error key counts (three rows, +5)',
 (SELECT (a.r->>'market_score')::int - (a1.r->>'market_score')::int = 5 FROM after_scores a, after_scores a1 WHERE a.n = 10 AND a1.n = 1));
-- 6. the effect: nothing scores higher, and the six scenarios that counted placeholders score lower
SELECT pg_temp.ok('migrated body: no scenario scores higher than before, and exactly the six that lost counted rows score lower',
 (SELECT bool_and((a.r->>'composite_score')::int <= (b.r->>'composite_score')::int)
     AND count(*) FILTER (WHERE (a.r->>'composite_score')::int < (b.r->>'composite_score')::int) = 6
    FROM after_scores a JOIN before_scores b USING (n)));
-- 7. everything else in the result is untouched: same keys, same dimensions other than market
SELECT pg_temp.ok('the result keys are unchanged and no dimension but market moves in any scenario',
 (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a.r) k) = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(b.r) k)
     AND a.r->'identity_score' = b.r->'identity_score' AND a.r->'photo_score' = b.r->'photo_score' AND a.r->'doc_score' = b.r->'doc_score'
     AND a.r->'desc_score' = b.r->'desc_score' AND a.r->'condition_score' = b.r->'condition_score'
     AND a.r->'photo_zones_present' = b.r->'photo_zones_present' AND a.r->'photo_zones_missing' = b.r->'photo_zones_missing'
     AND a.r->'mvps_complete' = b.r->'mvps_complete' AND a.r->'rejection_penalties' = b.r->'rejection_penalties')
    FROM after_scores a JOIN before_scores b USING (n)));
SELECT pg_temp.ok('an unknown vehicle still returns the same vehicle_not_found error',
 (SELECT public.compute_auction_readiness('00000000-0000-4000-8000-0000000000ff') = r AND r = '{"error": "vehicle_not_found"}'::jsonb FROM before_missing));

-- 8. one statement of the body changed
SELECT pg_temp.ok('only the signal-count statement changed: take the comment and the predicate out of the new body and the live body remains',
 replace(replace(pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure),
   E'  -- Count only signals a widget produced. A failed run is stored as a placeholder row (severity info, no score, value_json holding\n  -- only the error); it is not an analysis and does not count: score IS NULL AND value_json ? ''error''.\n', ''),
   E'\n    AND NOT (score IS NULL AND value_json ? ''error'');', ';') = (SELECT d FROM before_def));
SELECT pg_temp.ok('the body changed (the new definition is not the frozen one)',
 pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure) <> (SELECT d FROM before_def));
-- 9. attributes, owner and grants unchanged
SELECT pg_temp.ok('signature, result type, language, volatility, security definer, statement_timeout, owner and parallel safety unchanged',
 (SELECT p.prorettype = b.prorettype AND p.prolang = b.prolang AND p.proargtypes::text = b.argtypes AND p.proargnames IS NOT DISTINCT FROM b.proargnames
     AND p.provolatile = b.provolatile AND p.prosecdef = b.prosecdef AND p.proconfig IS NOT DISTINCT FROM b.proconfig
     AND p.proowner = b.proowner AND p.proparallel = b.proparallel AND p.proleakproof = b.proleakproof AND p.proisstrict = b.proisstrict
    FROM pg_proc p, before_pg b WHERE p.oid = 'public.compute_auction_readiness(uuid)'::regprocedure));
SELECT pg_temp.ok('the privilege list is byte for byte the same',
 (SELECT p.proacl IS NOT DISTINCT FROM b.proacl FROM pg_proc p, before_pg b WHERE p.oid = 'public.compute_auction_readiness(uuid)'::regprocedure));
SELECT pg_temp.ok('grants after: PUBLIC, anon, authenticated, service_role and the owner execute it, nobody else holds a privilege',
 (SELECT count(*) = 5 AND bool_and(x.privilege_type = 'EXECUTE' AND NOT x.is_grantable)
     AND count(*) FILTER (WHERE x.grantee = 0) = 1
     AND count(*) FILTER (WHERE r.rolname IN ('anon','authenticated','service_role')) = 3
     AND count(*) FILTER (WHERE x.grantee = p.proowner) = 1
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = 'public.compute_auction_readiness(uuid)'::regprocedure));
SELECT pg_temp.ok('the function carries a comment that states the predicate and the measured counts',
 obj_description('public.compute_auction_readiness(uuid)'::regprocedure, 'pg_proc') LIKE '%score IS NULL AND value_json ? ''error''%'
 AND obj_description('public.compute_auction_readiness(uuid)'::regprocedure, 'pg_proc') LIKE '%692,510 of 1,254,910 rows%');
-- 10. the migration guard: a second run is a no-op, a drifted body is refused, a missing function is created
CREATE TEMP TABLE once_def AS SELECT pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure) d;
\ir ../migrations/20261007080000_compute_auction_readiness_ignore_failed_runs.sql
SELECT pg_temp.ok('a second run accepts the migration''s own body: the definition is byte for byte the same and the privileges are unchanged',
 pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure) = (SELECT d FROM once_def)
 AND (SELECT proacl FROM pg_proc WHERE oid = 'public.compute_auction_readiness(uuid)'::regprocedure) IS NOT DISTINCT FROM (SELECT proacl FROM before_pg));
-- a body that drifted since it was reviewed is refused and left alone
ALTER FUNCTION public.compute_auction_readiness(uuid) SET statement_timeout TO '45s';
SELECT md5(pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure)) AS drifted_fp \gset
\echo The ERROR below is the drift guard of the migration refusing a drifted body: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261007080000_compute_auction_readiness_ignore_failed_runs.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted body: the migration refused it and left the definition untouched',
 md5(pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure)) = :'drifted_fp'
 AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.compute_auction_readiness(uuid)'::regprocedure) = ARRAY['statement_timeout=45s']);
ALTER FUNCTION public.compute_auction_readiness(uuid) SET statement_timeout TO '30s';
-- a database where the function does not exist yet gets it from the migration
DROP FUNCTION public.compute_auction_readiness(uuid);
\ir ../migrations/20261007080000_compute_auction_readiness_ignore_failed_runs.sql
SELECT pg_temp.ok('no function yet: the migration creates it, security definer with statement_timeout 30s, the same definition, and every scenario scores as with the migrated body',
 (SELECT prosecdef AND proconfig = ARRAY['statement_timeout=30s'] FROM pg_proc WHERE oid = 'public.compute_auction_readiness(uuid)'::regprocedure)
 AND pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure) = (SELECT d FROM once_def)
 AND (SELECT bool_and(public.compute_auction_readiness(('00000000-0000-4000-8000-0000000000' || lpad(a.n::text, 2, '0'))::uuid) = a.r) FROM after_scores a));
