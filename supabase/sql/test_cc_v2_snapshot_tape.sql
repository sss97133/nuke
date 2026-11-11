-- Empty disposable database only; baseline fixture enforces its name/empty guard.
\set ON_ERROR_STOP on
\ir test_auction_source_status_catalog.sql
CREATE TEMP TABLE before_grants AS SELECT proacl FROM pg_proc WHERE oid='public.live_bid_tape(integer)'::regprocedure;
ALTER TABLE vehicle_observations RENAME TO baseline_receipts;
CREATE VIEW vehicle_observations AS SELECT * FROM baseline_receipts UNION ALL
SELECT gen_random_uuid(),('00000000-0000-4000-8000-'||lpad(vid::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000099'::uuid,'https://collectingcars.com/for-sale/porsche-928',
 'collecting-cars-snapshot:v2:'||n,now()-interval '2 seconds',now()-interval '1 second','bid',
 jsonb_build_object('amount',15000,'currency','AUD','bid_count',31,'clock','board_read','auction_id','94494','ends','2026-11-12T06:05:00Z','capture_kind',capture_kind),
 jsonb_build_object('received_at',now()-interval '2 seconds'),false,method
FROM (VALUES (1,1,'cc_typesense_board_snapshot_v2','auction_bid_snapshot'),
 (2,1,'wrong_method','auction_bid_snapshot'),(3,1,'cc_typesense_board_snapshot_v2','individual_bid'),
 (4,2,'cc_typesense_board_snapshot_v2','auction_bid_snapshot'),(5,3,'cc_typesense_board_snapshot_v2','auction_bid_snapshot')) x(n,vid,method,capture_kind);
\ir ../migrations/20261109015000_cc_v2_snapshot_tape.sql
\ir ../migrations/20261109015000_cc_v2_snapshot_tape.sql
DO $$ DECLARE r jsonb:=live_bid_tape(5); BEGIN
 IF jsonb_array_length(r->'bids')<>9 THEN RAISE EXCEPTION 'v2 admission/privacy classification failed: %',r; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'bids') b WHERE b->>'house'='collecting-cars' AND b->>'amount'='15000'
 AND b->>'currency'='AUD' AND b->>'event_kind'='bid_snapshot' AND b->>'bid_count'='31'
 AND b->>'listing_end_at'='2026-11-12T06:05:00Z' AND b->>'received_at' IS NOT NULL) THEN RAISE EXCEPTION 'v2 snapshot fields lost'; END IF;
 IF NOT (r->'sources' ? 'govdeals') OR r::text LIKE '%SECRET_%' THEN RAISE EXCEPTION 'Existing catalog/privacy regressed'; END IF;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.live_bid_tape(integer)'::regprocedure) IS DISTINCT FROM (SELECT proacl FROM before_grants) THEN RAISE EXCEPTION 'Grants changed'; END IF;
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Timeout restoration failed'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN IF jsonb_array_length(live_bid_tape(5)->'bids')<>9 THEN RAISE EXCEPTION 'Anonymous v2 snapshot unavailable'; END IF; END $$;
RESET ROLE;
-- Read-only cursor permission and bounds contract over the same synthetic view.
CREATE VIEW observation_sources AS SELECT '00000000-0000-4000-8000-000000000099'::uuid id,'collecting-cars'::text slug;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
\ir ../migrations/20261109015100_cc_latest_snapshot_states.sql
\ir ../migrations/20261109015100_cc_latest_snapshot_states.sql
GRANT SELECT ON observation_sources,vehicle_observations TO service_role;
DO $$ BEGIN
 IF has_function_privilege('anon','public.cc_latest_snapshot_states(jsonb)','execute')
 OR has_function_privilege('authenticated','public.cc_latest_snapshot_states(jsonb)','execute')
 OR NOT has_function_privilege('service_role','public.cc_latest_snapshot_states(jsonb)','execute') THEN RAISE EXCEPTION 'Cursor privilege boundary failed'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.cc_latest_snapshot_states(jsonb)'::regprocedure) THEN RAISE EXCEPTION 'Cursor must invoke existing table permissions'; END IF;
 BEGIN PERFORM cc_latest_snapshot_states((SELECT jsonb_agg(jsonb_build_object('vehicle_id','00000000-0000-4000-8000-000000000001','source_url','https://collectingcars.com/for-sale/porsche-928')) FROM generate_series(1,201))); RAISE EXCEPTION 'Cap was not enforced';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cap was not enforced' THEN RAISE; END IF; END;
END $$;
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=cc_latest_snapshot_states('[{"vehicle_id":"00000000-0000-4000-8000-000000000001","source_url":"https://collectingcars.com/for-sale/porsche-928"}]');
 IF jsonb_array_length(r)<>1 THEN RAISE EXCEPTION 'Bounded read must exclude wrong capture/method/owner: %',r; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r) o WHERE o->>'vehicle_id'<>'00000000-0000-4000-8000-000000000001' OR o->>'source_url'<>'https://collectingcars.com/for-sale/porsche-928') THEN RAISE EXCEPTION 'Foreign owner escaped'; END IF;
 IF cc_latest_snapshot_states('[{"vehicle_id":"00000000-0000-4000-8000-000000000099","source_url":"https://collectingcars.com/for-sale/porsche-928"}]')<>'[]'::jsonb THEN RAISE EXCEPTION 'Missing owner fabricated'; END IF;
END $$;
RESET ROLE;
