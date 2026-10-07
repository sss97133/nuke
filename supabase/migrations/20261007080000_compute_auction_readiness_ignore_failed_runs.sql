-- compute_auction_readiness(): a failed analysis run no longer counts as an analysis signal in the market dimension.
-- The market dimension adds 5 points for 3 or more analysis_signals rows of a vehicle with severity ok or info, and 5 more for
-- 6 or more. The analysis engine stores a failed widget run as a placeholder row (severity info, score NULL, value_json holding
-- only the error), so the rule counted failures as analyses. One statement changes: the signal count now skips the rows where
--   score IS NULL AND value_json ? 'error'
-- The rest of the function (body, SECURITY DEFINER, statement_timeout 30s, owner, grants, jsonb result) is as read from prod.
-- This file is also the first committed definition of the function: until now it existed only in the live database.
-- get_day_card_context() is not changed here; see the pull request for why its four-slug read is not an obvious fix.
-- No row is written. auction_readiness keeps the value it holds for a vehicle until persist_auction_readiness() runs again.
--
-- WHAT A PLACEHOLDER IS (exact counts over the whole table, read-only, prod, 2026-10-07 03:16 UTC; 1,254,910 rows):
--   score IS NULL                                  692,510 rows
--   value_json ? 'error'                           692,510 rows, the same rows (the two cues disagree on 0 rows)
--   both = placeholder                             692,510 rows (55.2%): all severity info, value_json holds only the key error
--     reason 'Widget <slug> computation failed' or 'Widget <slug> failed: ...'   690,554 rows, the 10 widgets that never produced a result
--     reason 'SQL execution failed for <slug>'                                      1,956 rows, 6 widgets that also have real rows
--   any other reason                               0 rows
--   kept as genuine                                562,400 rows, every one has a score; none lacks a score or has an error key
--   The predicate is the coordinator's own failure envelope (supabase/functions/analysis-engine-coordinator computeWidget:
--   score null, severity info, value_json {error}), so a future failed run is skipped too. A row with a score counts even if
--   its value_json holds an error key; a row with no score and no error key counts.
--   Rows counted by the function: 1,141,014 before (692,510 of them placeholders), 448,504 after.
--
-- EFFECT (per vehicle, exact over the whole table; 70,014 vehicles have signal rows and every one has placeholders):
--   vehicles with 3 or more counted rows   69,338 before, 68,179 after;  with 6 or more   69,134 before, 53,780 after
--   market points lost: 15,558 vehicles = 14,399 go from +10 to +5, 955 from +10 to +0, 204 from +5 to +0
--   15,354 vehicles had the second +5 only through placeholders; 1,159 had the first +5 only through them
--   12,555 of the 15,558 have a row in auction_readiness (378,598 rows in all), which will change when persisted again
-- SAMPLE (the live function on prod, composite = round of the weighted dimensions, market weight 0.20):
--   2,000 random vehicles with an auction_readiness row: 288 have signal rows, 63 change (62 by 1 composite point, 1 by 2),
--   1 changes tier. 1,000 random of the 12,555 affected: composite -1 on 947, -2 on 53; 64 change tier
--   (38 TIER_3_VIABLE to TIER_4_INCOMPLETE, 13 TIER_2_COMPETITIVE to TIER_3_VIABLE, 13 TIER_4_INCOMPLETE to DISCOVERY_ONLY).
--   The score after the change was recomputed from the six dimension scores the live function returned, with the market
--   dimension reduced by the lost points; the same recomputation of today's score matched the live composite and tier on
--   1,063 of 1,063 vehicles.
-- COST of the changed statement (EXPLAIN ANALYZE, prod, a vehicle with 14 signal rows, 10 of them placeholders): 0.17 ms
--   warm and 0.79 ms cold as an index-only scan before; 0.21 ms warm and 11.4 ms cold as an index scan with heap reads after.
--   No index is added.
--
-- LIMITS: the counts are one read on 2026-10-07. The latest computed_at in analysis_signals is 2026-04-14 and both coordinator
-- crons (analysis-engine-sweep, analysis-widget-backfill) are inactive, so the counts move only if the coordinator runs again;
-- its failed runs would then be skipped by this rule.
-- Contract: supabase/sql/test_compute_auction_readiness_placeholders.sql (PostgreSQL 17, CI job metric-fold-health-contract).
-- Verify after the deploy: the probe in the pull request description.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE m text;
BEGIN
  IF to_regprocedure('public.compute_auction_readiness(uuid)') IS NULL THEN
    RAISE NOTICE 'compute_auction_readiness(uuid) does not exist in this database; creating it from this migration';
    RETURN;
  END IF;
  m := md5(pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure));
  -- the prod body as read 2026-10-07, or this migration's own body (a second run changes nothing); refuse any other
  IF m NOT IN ('a1811bed649d2786ffb98d83026e8d9b', 'c4b1118849ae81e2e58b588644320494') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
    RAISE EXCEPTION 'compute_auction_readiness drifted from the reviewed body (md5 %); review before replacement', m;
  END IF;
END $guard$;
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
  -- Count only signals a widget produced. A failed run is stored as a placeholder row (severity info, no score, value_json holding
  -- only the error); it is not an analysis and does not count: score IS NULL AND value_json ? 'error'.
  SELECT count(*) INTO signal_cnt FROM analysis_signals WHERE vehicle_id = p_vehicle_id AND severity IN ('ok', 'info')
    AND NOT (score IS NULL AND value_json ? 'error');
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

COMMENT ON FUNCTION public.compute_auction_readiness(uuid) IS
'Auction readiness of one vehicle, computed live and returned as jsonb; it writes nothing. Six dimension scores, 0 to 100 (identity 0.15, photo 0.20, docs 0.15, description 0.10, market 0.20, condition 0.20), a composite (the rounded weighted sum, 0 to 100), a tier (TIER_1_EXCEPTIONAL 85 or more, TIER_2_COMPETITIVE 70, TIER_3_VIABLE 50, TIER_4_INCOMPLETE 30, else DISCOVERY_ONLY), the gaps and the coaching plan. SECURITY DEFINER and executable by anon. persist_auction_readiness() and recompute_ars_dimension() store the result in auction_readiness, which keeps the value computed last until it is persisted again. Signal rule of the market dimension: rows of analysis_signals with severity ok or info are analysis signals (3 or more add 5 points, 6 or more add 5 more), except failed-run placeholders. A placeholder is a row with score IS NULL AND value_json ? ''error'': the failure envelope the analysis-engine-coordinator writes (severity info, no score, value_json holding only the error). Before this change the rule counted them: on 2026-10-07 692,510 of 1,254,910 rows (55.2%) were placeholders, 690,554 from 10 widgets that never produced a result and 1,956 from 6 that did; the 562,400 rows with a score all stay counted. Effect measured 2026-10-07 on prod: of 70,014 vehicles with signal rows, 15,558 lose 5 or 10 market points (15,354 lose the second +5, 1,159 the first), which is 1 or 2 composite points; 12,555 of them have a stored auction_readiness row; in a random sample of 1,000 of those, 64 change tier.';

DO $check$
DECLARE d text := pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure);
BEGIN
  IF position('AND NOT (score IS NULL AND value_json ? ''error'')' IN d) = 0 THEN
    RAISE EXCEPTION 'placeholder predicate missing after replacement';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['statement_timeout=30s']
            FROM pg_proc WHERE oid = 'public.compute_auction_readiness(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'compute_auction_readiness lost SECURITY DEFINER or its statement_timeout';
  END IF;
END $check$;
COMMIT;
