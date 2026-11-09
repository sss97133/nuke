-- Disposable PG17: same public contract before/after, preserving privacy and caller budgets.
\set ON_ERROR_STOP on
\ir test_auction_source_delivery_lag.sql
\ir ../migrations/20261109024500_auction_queue_reader_cost.sql
\ir ../migrations/20261109024500_auction_queue_reader_cost.sql
INSERT INTO system_state VALUES ('ebay_auction_snapshot_replay_v1',jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry())),now()-interval '1 minute');
DO $$ DECLARE r jsonb:=live_bid_tape(5); q jsonb:=pg_temp.queue(); BEGIN
 IF q->>'queued_receipts'<>'1' OR q->>'state'<>'recorded' OR (q->>'oldest_source_read_at')::timestamptz NOT BETWEEN now()-interval '121 minutes' AND now()-interval '119 minutes' THEN RAISE EXCEPTION 'Queue receipt measurement lost: %',q; END IF;
 IF q->>'measured_at'=q->>'state_updated_at' THEN RAISE EXCEPTION 'Measurement and state clocks conflated'; END IF;
 IF r::text LIKE '%SECRET%' OR r::text LIKE '%123456789012%' OR r::text LIKE '%snapshotId%' THEN RAISE EXCEPTION 'Raw queue/config leaked'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='purplewave' AND s->>'native_poll_minutes'='120') THEN RAISE EXCEPTION 'Native feed cadence missing'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='ebay-motors' AND s->>'collection_state'='scheduled') THEN RAISE EXCEPTION 'Native scheduled path missing'; END IF;
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Caller budgets changed'; END IF;
END $$;
DO $$ DECLARE bad jsonb; BEGIN
 FOR bad IN SELECT x FROM jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('version',1,'entries','bad'),
   jsonb_build_object('version','1','entries',jsonb_build_array(pg_temp.entry())),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||'{"readAt":"garbage"}')),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||'{"readAt":"yesterday"}')),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||jsonb_build_object('readAt',now()+interval '1 hour'))),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry(),pg_temp.entry()))
 )) x LOOP
  UPDATE system_state SET value=bad;
  IF pg_temp.queue()->>'state'<>'invalid' OR pg_temp.queue() ? 'queued_receipts' THEN RAISE EXCEPTION 'Malformed queue became measured zero/count'; END IF;
 END LOOP;
 UPDATE system_state SET value=jsonb_build_object('version',1,'entries',(
   SELECT jsonb_agg(pg_temp.entry()||jsonb_build_object('key',(100000000000+g)::text,
     'url','https://ebay.com/itm/'||(100000000000+g)::text)) FROM generate_series(1,1000) g));
 IF pg_temp.queue()->>'queued_receipts'<>'1000' OR pg_temp.queue()->>'state'<>'recorded' THEN RAISE EXCEPTION 'Valid queue ceiling lost'; END IF;
 UPDATE system_state SET value=jsonb_set(value,'{entries}',(value->'entries')||jsonb_build_array(pg_temp.entry()));
 IF pg_temp.queue()->>'state'<>'invalid' OR pg_temp.queue() ? 'queued_receipts' THEN RAISE EXCEPTION 'Oversized queue became a partial count'; END IF;
 UPDATE system_state SET value=jsonb_build_object('version',1,'entries','[]'::jsonb),updated_at=now()+interval '1 minute';
 IF pg_temp.queue()->>'state'<>'invalid' THEN RAISE EXCEPTION 'Future queue clock admitted'; END IF;
 UPDATE system_state SET updated_at=now()-interval '1 minute';
 IF pg_temp.queue()->>'queued_receipts'<>'0' THEN RAISE EXCEPTION 'Measured empty queue lost'; END IF;
 DELETE FROM system_state;
 IF pg_temp.queue()->>'state'<>'unrecorded' OR pg_temp.queue() ? 'queued_receipts' THEN RAISE EXCEPTION 'Absent queue became zero'; END IF;
END $$;
SET ROLE anon;
DO $$ DECLARE r jsonb:=public.live_bid_tape(5); BEGIN
 IF NOT r->'sources' ? 'purplewave' THEN RAISE EXCEPTION 'Anonymous public contract lost'; END IF;
 BEGIN PERFORM value FROM public.system_state; RAISE EXCEPTION 'Raw queue became public'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ DECLARE body text:=pg_get_functiondef('public.live_bid_tape(integer)'::regprocedure); BEGIN
 IF body LIKE '%GROUP BY s.updated_at,s.value%' OR body NOT LIKE '%CROSS JOIN LATERAL (%' THEN
  RAISE EXCEPTION 'Wide queue grouping regression';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='public.live_bid_tape(integer)'::regprocedure
   AND prosecdef AND 'statement_timeout=5s'=ANY(proconfig)) THEN RAISE EXCEPTION 'Reader security/budget changed'; END IF;
END $$;
