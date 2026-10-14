-- Uncalled owner-run functions: no longer executable by anon or authenticated callers.
--
-- On 2026-10-14, 34 SECURITY DEFINER functions in public that contain INSERT, UPDATE or DELETE and are not triggers
-- were executable by anon through the API; 33 check no identity. Supabase grants EXECUTE on new public functions to
-- anon and authenticated by default, so batch writers became public endpoints without anyone choosing it. Anyone
-- holding the public anon key could, among others:
--   end_live_auctions_absent(text, text[])     mark every live auction of a platform ended (pass an empty list)
--   claim_*_queue_batch                         claim pipeline work items and stall the extraction and analysis queues
--   enrich_*, *backfill*, rescore, quality      rewrite vehicles in batches, as often as they like, on a nano instance
--   sync_edge_secrets_to_db()                   rewrite the secrets table (not readable by anon; still not theirs)
-- Two owner-run readers with no caller are closed too (found by the reviewer's sweep, read in their source):
--   get_fleet_documented_investment()           per-vehicle investment dollars, returned to anyone
--   find_vehicles_near(...)                     year, make, model, sale price, image, city, state and distance for
--                                               any vehicle with GPS, private ones included
-- This revokes EXECUTE from PUBLIC, anon and authenticated on 31 functions and grants it to service_role explicitly.
-- Their callers keep working: edge functions analysis-engine-coordinator, process-bat-extraction-queue,
-- sync-live-auctions and photo-pipeline-orchestrator use the service role; cron job photo-pipeline-reset-stuck runs as
-- postgres, the owner. No web or phone code calls any of the 31 (main, 2026-10-14; the web's find_vehicles_near_gps is
-- a different function and is already closed to anon).
-- Kept, reviewed: register_make_model_subject (the phone, the web and universal-search call it),
-- validate_data_room_access_code (a public form), confirm_photo_intent (checks the caller),
-- analyze_organization_data_signals (the web calls it; it writes a cache of signals).
-- A function dropped and created again gets the default grants back; the probe battery's P9 watches for that.
-- A signature that no longer exists is skipped with a notice. No row changes.
-- Contract: supabase/sql/test_revoke_anon_writer_functions.sql (CI job writer-functions-contract).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $revoke$
DECLARE
  sigs constant text[] := ARRAY[
    'public.backfill_photo_analysis(integer)',
    'public.backfill_sold_vehicles_comprehensive()',
    'public.backfill_vehicle_data_from_bat_listings()',
    'public.calculate_platform_revenue()',
    'public.claim_analysis_queue_batch(integer,text)',
    'public.claim_bat_extraction_queue_batch(integer,integer,text,integer)',
    'public.end_live_auctions_absent(text,text[])',
    'public.enrich_body_from_model(integer)',
    'public.enrich_body_from_model(integer,text)',
    'public.enrich_country_from_make(integer)',
    'public.enrich_country_from_make(integer,text)',
    'public.enrich_cross_ref_bat_price(integer)',
    'public.enrich_mine_mileage(integer)',
    'public.enrich_mine_mileage(integer,text)',
    'public.enrich_mine_transmission(integer)',
    'public.enrich_mine_transmission(integer,text)',
    'public.enrich_mine_vins(integer)',
    'public.fast_backfill_quality_scores(integer)',
    'public.normalize_org_vehicle_relationships(uuid)',
    'public.promote_businesses_to_service_from_portfolio_evidence(integer)',
    'public.quality_backfill_shard(integer,integer,integer)',
    'public.quick_quality_backfill_fast(integer)',
    'public.refresh_bat_seller_org_metrics()',
    'public.refresh_equipment_hours()',
    'public.refresh_org_total_vehicles()',
    'public.rescore_vehicles_batch(integer)',
    'public.reset_stuck_photo_pipeline_images()',
    'public.sync_bat_live_auction_status()',
    'public.sync_edge_secrets_to_db()',
    'public.get_fleet_documented_investment()',
    'public.find_vehicles_near(double precision,double precision,integer,integer,integer,integer,text,text)'
  ];
  s text;
  done int := 0;
BEGIN
  FOREACH s IN ARRAY sigs LOOP
    IF to_regprocedure(s) IS NULL THEN
      RAISE NOTICE 'skipped, no longer exists: %', s;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', to_regprocedure(s));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', to_regprocedure(s));
    done := done + 1;
  END LOOP;

  -- Verify: none of them is executable by anon or authenticated; the service role keeps every one.
  IF EXISTS (SELECT FROM unnest(sigs) x WHERE to_regprocedure(x) IS NOT NULL
               AND (has_function_privilege('anon', to_regprocedure(x), 'EXECUTE')
                    OR has_function_privilege('authenticated', to_regprocedure(x), 'EXECUTE')
                    OR NOT has_function_privilege('service_role', to_regprocedure(x), 'EXECUTE'))) THEN
    RAISE EXCEPTION 'a revoked function is still executable by anon or authenticated, or lost the service role';
  END IF;
  RAISE NOTICE 'revoked anon and authenticated EXECUTE on % owner-run functions', done;
END
$revoke$;

RESET statement_timeout;
RESET lock_timeout;
