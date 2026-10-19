-- ingest_bat_live_events: a relisted lot folds into the vehicle that holds its events.
--
-- WHY (ingest-failures, 2026-10-14; edge function logs and read-only probes of production, 04:45-05:15Z):
--   ingest-observation answered 37,460 of 95,751 calls (39.1%) with a non-200 in the 24 h to 04:45Z, and 37,389 of those
--   were 500s from the BaT closing stream (mode bat_live_events_v1). 36,411 console error lines that day read 'canonical
--   vehicle auction event missing' (255,415 in the 7 days to 04:45Z). It is a deterministic retry storm by four lots, not an
--   auth or validation failure: extract-bat-core's collector re-sends a rejected lot's frames every second from each
--   overlapping 115-second worker, and this function rolls the whole batch back each time.
--   The refusal is the last statement of the frame loop: the vehicle_events UPDATE matched no row under the MONITOR's
--   vehicle. 12 of 12 live BaT monitors whose vehicle holds no event are relisted cars. sync-live-auctions made a stub
--   vehicle for the new listing URL (origin_metadata.source bat_auctions_page, no VIN) and the monitor binds it, but
--   extract-bat-core resolves the lot page by bat_auction_url or VIN to the car's original vehicle and files
--   vehicle_events and auction_events there. By lot slug exactly one other vehicle holds each of the 12 lots' events.
--   Four of the lots ended 2026-10-07 to 10-13 with a sourced result on that vehicle, yet their monitors stay is_live
--   because bat_live_pull_run looks for the result under the stub; eight more close 2026-10-14 to 10-21 and will start the
--   same storm in their closing window. get_live_auction_health already reports closing_stream failed (4 eligible, 0
--   covered, 4 missing at 05:00Z).
--
-- WHAT:
--   1. fold_vehicle. When the monitor's vehicle has no vehicle_events row for the lot URL, the lot's events belong to the
--      one live vehicle that holds a bat event with the same lot slug (the key idx_vehicle_events_bat_lot_slug serves, and
--      the key create_missing_bat_auction_events, 20261006131500, defines as one lot). No such vehicle, or several:
--      unchanged, the admission still stops at 'canonical vehicle auction event missing' and writes nothing.
--   2. Every read and write of the lot's rows uses fold_vehicle: the raw frame, the auction_events row, the native comment
--      dedupe and insert, the vehicle_events update and the final-read request. preserve_bat_live_projection accepts a
--      same-transaction receipt only when the observation's vehicle is the event's vehicle, so the frame must be filed
--      there. The source, post and parent binding checks stay on the monitor's vehicle.
--   3. A folded frame records monitor_vehicle_id and binding_resolved_by 'lot_slug' in vehicle_match_signals.
-- Unchanged: lock order, binding and raw-proof checks, dedupe key, clocks, comment identity, terminal rules, grants.
-- Diff against 20261005004554, the last definition (whitespace-insensitively identical to production on 2026-10-14 05:0xZ;
-- md5 of pg_get_functiondef bacc9a2e3b9dc994f6fae4e9be7e6e84): a declaration line, the resolution block, one conditional
-- in the signals, and eight m.vehicle_id -> fold_vehicle.
--
-- MEASURED on production before this change (read-only, EXPLAIN ANALYZE, 2026-10-14 05:1xZ): the slug lookup the block adds,
-- run only when the monitor's vehicle has no event, is a bitmap scan of idx_vehicle_events_bat_lot_slug plus one vehicles
-- primary-key read, 17 ms cold. The own-vehicle check is the predicate the final UPDATE already uses, 3.9 ms.
-- EXPECTED: the backlog of the four ended lots (363 frames pending at 05:00Z) admits on the next worker, each lot's sourced
-- terminal comment retires its monitor, and the 36,411 lines a day stop; closing_stream passes once no eligible lot is
-- missing. The eight later relisted lots admit from their first frame (about 125 rows an hour per subscribed lot, measured
-- 00:45-04:45Z on five lots). The canonical rows of the four ended lots read 2026-10-14 00:00:00+00 as their end (a reader
-- placeholder); the replay writes each lot's own end from its monitor: 10-07 21:23, 10-11 17:31, 10-12 19:06 and
-- 10-13 20:21:44 UTC.
-- Contract test: supabase/sql/test_bat_live_relisted_lot_fold.sql (PostgreSQL 17, offline).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.ingest_bat_live_events(p_frames jsonb, p_heartbeats jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  f jsonb; h jsonb; raw jsonb; c jsonb; m public.monitored_auctions; v public.vehicles;
  fold_vehicle uuid; lot_vehicles integer;
  v_source_id uuid; observation_id uuid; auction_id uuid; identity_id uuid;
  frame_time timestamptz; last_metadata_time timestamptz; last_stats_time timestamptz; new_end timestamptz;
  prior_outcome text; prior_winning_bid numeric; final_request_id bigint;
  recorded integer := 0; duplicates integer := 0; n integer; stream jsonb; sessions jsonb;
  frame_outcome text; terminal boolean;
BEGIN
  IF jsonb_typeof(p_frames) IS DISTINCT FROM 'array' OR jsonb_array_length(p_frames)>50
    OR jsonb_typeof(p_heartbeats) IS DISTINCT FROM 'array' OR jsonb_array_length(p_heartbeats)>200 THEN
    RAISE EXCEPTION 'invalid live admission size';
  END IF;
  SELECT id INTO STRICT v_source_id FROM public.observation_sources WHERE slug='bat';
  -- Fixed lock ordering across overlapping workers; entire admission is atomic.
  PERFORM 1 FROM public.monitored_auctions
    WHERE id IN (SELECT (x->>'monitored_auction_id')::uuid FROM jsonb_array_elements(p_frames||p_heartbeats) x)
    ORDER BY id FOR UPDATE;

  FOR f IN SELECT x FROM jsonb_array_elements(p_frames) WITH ORDINALITY a(x,i)
    ORDER BY x->>'monitored_auction_id', (x->>'received_at')::timestamptz, i
  LOOP
    SELECT * INTO STRICT m FROM public.monitored_auctions WHERE id=(f->>'monitored_auction_id')::uuid;
    SELECT * INTO STRICT v FROM public.vehicles WHERE id=m.vehicle_id AND deleted_at IS NULL;
    IF NOT EXISTS(SELECT 1 FROM public.live_auction_sources WHERE id=m.source_id AND slug='bat')
      OR v.origin_metadata->>'source' IS DISTINCT FROM 'bat_auctions_page'
      OR v.origin_metadata->>'external_id' IS DISTINCT FROM f->>'post_id'
      OR m.vehicle_id IS DISTINCT FROM (f->>'vehicle_id')::uuid
      OR rtrim(m.external_auction_url,'/') IS DISTINCT FROM f->>'source_url'
      OR rtrim(v.listing_url,'/') IS DISTINCT FROM f->>'source_url'
      OR f->>'event' !~ '^[a-z][a-z0-9-]{0,80}$' OR f->>'content_hash' !~ '^[0-9a-f]{64}$'
      OR f->>'transport' NOT IN ('public_pusher','missed_comments','direct_html') THEN
      RAISE EXCEPTION 'live source/parent binding mismatch';
    END IF;
    raw := (f->>'raw_frame_json')::jsonb;
    IF raw->>'event' IS DISTINCT FROM f->>'event'
      OR coalesce(raw#>>'{data,post_id}',raw#>>'{data,comment,post}',f->>'post_id') IS DISTINCT FROM f->>'post_id' THEN
      RAISE EXCEPTION 'live raw frame mismatch';
    END IF;
    frame_time := (f->>'received_at')::timestamptz;
    IF frame_time > clock_timestamp()+interval '30 seconds' THEN RAISE EXCEPTION 'future live receipt'; END IF;
    frame_outcome := nullif(f->>'outcome','');
    IF frame_outcome IS NOT NULL AND (f->>'event'<>'comment-added'
      OR raw#>>'{data,comment,type}' NOT IN ('bat-bid-reserve','bat-rnm-accepted')
      OR frame_outcome NOT IN ('sold','reserve_not_met')) THEN RAISE EXCEPTION 'unqualified live result'; END IF;

    -- Which vehicle holds this lot's events. Normally the monitor's own. A relisted car keeps its first vehicle row:
    -- extract-bat-core files the lot under it (bat_auction_url / VIN), while the monitor binds the stub that
    -- sync-live-auctions made for the new URL. One lot is one BaT slug (idx_vehicle_events_bat_lot_slug), so when the
    -- monitor's vehicle has no event for the URL, the lot belongs to the one live vehicle that does. None or several:
    -- unchanged, the admission still stops at 'canonical vehicle auction event missing' below and writes nothing.
    fold_vehicle:=m.vehicle_id;
    IF NOT EXISTS(SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id=m.vehicle_id AND e.source_platform='bat'
      AND rtrim(e.source_url,'/')=f->>'source_url') THEN
      SELECT (array_agg(DISTINCT e.vehicle_id))[1],count(DISTINCT e.vehicle_id) INTO fold_vehicle,lot_vehicles
        FROM public.vehicle_events e JOIN public.vehicles cv ON cv.id=e.vehicle_id AND cv.deleted_at IS NULL
        WHERE e.source_platform='bat'
          AND lower(substring(e.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))
            =lower(substring(f->>'source_url' FROM 'bringatrailer\.com/listing/([^/?#]+)'));
      IF lot_vehicles IS DISTINCT FROM 1 THEN fold_vehicle:=m.vehicle_id; END IF;
    END IF;

    INSERT INTO public.vehicle_observations
      (vehicle_id,vehicle_match_confidence,vehicle_match_signals,source_id,source_url,source_identifier,kind,observed_at,content_text,content_hash,
       structured_data,extraction_method,raw_source_ref,extraction_metadata,confidence,confidence_score)
    VALUES (fold_vehicle,0.95,jsonb_build_object('source_url_match',true,'native_post_id',f->>'post_id','binding','bat_auctions_page')
      ||CASE WHEN fold_vehicle IS DISTINCT FROM m.vehicle_id
        THEN jsonb_build_object('monitor_vehicle_id',m.vehicle_id,'binding_resolved_by','lot_slug') ELSE '{}'::jsonb END,
      v_source_id,f->>'source_url',f->>'source_identifier',(f->>'kind')::public.observation_kind,
      (f->>'observed_at')::timestamptz,f->>'content_text',f->>'content_hash',
      jsonb_build_object('public_live_frame',raw,'native_post_id',(f->>'post_id')::bigint,
        'received_at',f->>'received_at','transport',f->>'transport','clock_basis',f->>'clock_basis',
        'previous_scheduled_end',m.auction_end_time,'projection_error',f->>'projection_error'),
      'bat_public_live_v1','bat:public-live:post:'||(f->>'post_id'),
      jsonb_build_object('producer','extract-bat-core','schema','bat_public_live_v1','paid_model_calls',0), 'high',0.9)
    ON CONFLICT (source_id,source_identifier,kind,content_hash) DO NOTHING RETURNING id INTO observation_id;
    IF observation_id IS NULL THEN duplicates:=duplicates+1; CONTINUE; END IF;
    recorded:=recorded+1;
    stream:=m.stream_state;
    IF f->>'projection_error' IS NOT NULL THEN
      stream:=stream||jsonb_build_object('unqualified_frames',coalesce((stream->>'unqualified_frames')::integer,0)+1,
        'last_projection_error',f->>'projection_error','unqualified_observation_id',observation_id);
    END IF;
    new_end:=greatest(m.auction_end_time,(f->>'end_at')::timestamptz);
    SELECT id INTO auction_id FROM public.auction_events
      WHERE vehicle_id=fold_vehicle AND rtrim(source_url,'/')=f->>'source_url'
      ORDER BY updated_at DESC LIMIT 1;
    IF auction_id IS NULL THEN
      INSERT INTO public.auction_events(vehicle_id,source,source_url,outcome,auction_end_date)
        VALUES(fold_vehicle,'bat',f->>'source_url','live',new_end) RETURNING id INTO auction_id;
    END IF;
    -- The same-transaction immutable receipt authorizes all steps of this fold;
    -- an older HTML caller cannot borrow a previously committed receipt.
    UPDATE public.auction_events SET raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('live_stream',
      jsonb_build_object('observation_id',observation_id,'received_at',f->>'received_at',
        'last_frame_received_at',greatest((raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz,
          (raw_data#>>'{live_stream,received_at}')::timestamptz,(stream->>'last_frame_received_at')::timestamptz,frame_time),
        'admitted_at',clock_timestamp(),'clock_basis',f->>'clock_basis'))
      WHERE id=auction_id;
    c:=f->'comment_row';
    IF jsonb_typeof(c)='object' THEN
      IF c->>'bat_comment_id' IS DISTINCT FROM raw#>>'{data,comment,id}'
        OR c->>'posted_at' IS DISTINCT FROM f->>'observed_at' THEN RAISE EXCEPTION 'native comment proof mismatch'; END IF;
      -- Native source identity dedupe BEFORE INSERT/profile fold. Existing core
      -- comments are preserved; every raw stream version still enters the log.
      IF NOT EXISTS(SELECT 1 FROM public.auction_comments WHERE vehicle_id=fold_vehicle AND platform='bat'
        AND bat_comment_id=(c->>'bat_comment_id')::bigint) THEN
        identity_id:=NULL;
        IF c->>'author_username' NOT IN ('','Unknown') AND
          (lower(c->>'author_username')<>'anonymous' OR coalesce((c->>'bat_author_id')::bigint,0)>0) THEN
          INSERT INTO public.external_identities(platform,handle,profile_url)
            VALUES('bat',c->>'author_username',f->>'author_profile_url')
            ON CONFLICT (platform,handle) DO NOTHING;
          SELECT id INTO identity_id FROM public.external_identities WHERE platform='bat' AND handle=c->>'author_username';
        END IF;
        INSERT INTO public.auction_comments(auction_event_id,vehicle_id,platform,source_url,content_hash,
          sequence_number,posted_at,hours_until_close,author_username,is_seller,comment_type,comment_text,
          word_count,has_question,has_media,media_urls,bid_amount,comment_likes,bat_author_id,bat_comment_id,
          bat_author_likes,author_total_likes,likers_count,external_identity_id)
        SELECT auction_id,fold_vehicle,'bat',f->>'source_url',c->>'content_hash',
          (SELECT coalesce(max(sequence_number),0)+1 FROM public.auction_comments WHERE vehicle_id=fold_vehicle),
          (c->>'posted_at')::timestamptz,(c->>'hours_until_close')::numeric,
          c->>'author_username',(c->>'is_seller')::boolean,c->>'comment_type',c->>'comment_text',
          (c->>'word_count')::integer,(c->>'has_question')::boolean,(c->>'has_media')::boolean,
          CASE WHEN jsonb_typeof(c->'media_urls')='array' THEN ARRAY(SELECT jsonb_array_elements_text(c->'media_urls')) END,
          (c->>'bid_amount')::numeric,(c->>'comment_likes')::integer,(c->>'bat_author_id')::bigint,(c->>'bat_comment_id')::bigint,
          (c->>'bat_author_likes')::integer,(c->>'author_total_likes')::integer,(c->>'likers_count')::integer,identity_id
        ON CONFLICT (vehicle_id,content_hash) DO NOTHING;
      END IF;
      stream:=stream||jsonb_build_object('last_comment_id',greatest(coalesce((stream->>'last_comment_id')::bigint,0),(f->>'native_comment_id')::bigint));
      stream:=stream||jsonb_build_object('last_comment_at',greatest((stream->>'last_comment_at')::timestamptz,(f->>'observed_at')::timestamptz));
      IF f->>'kind'='bid' THEN
        stream:=stream||jsonb_build_object('last_bid_at',greatest((stream->>'last_bid_at')::timestamptz,(f->>'observed_at')::timestamptz));
      END IF;
    END IF;
    last_metadata_time:=(stream->>'last_metadata_received_at')::timestamptz;
    -- Metadata is the authoritative current bid, including cancellations.
    -- Historic catch-up bid comments never overwrite a newer live bid.
    IF f->>'event'='metadata-updated' AND (last_metadata_time IS NULL OR frame_time>=last_metadata_time) THEN
      UPDATE public.monitored_auctions SET current_bid_cents=coalesce(((f->>'current_bid')::numeric*100)::bigint,current_bid_cents),
        bid_count=coalesce((f->>'bid_count')::integer,bid_count),high_bidder_username=coalesce(f->>'high_bidder',high_bidder_username)
        WHERE id=m.id;
      UPDATE public.auction_events SET high_bid=coalesce((f->>'current_bid')::numeric,high_bid),
        total_bids=coalesce((f->>'bid_count')::integer,total_bids) WHERE id=auction_id;
      stream:=stream||jsonb_build_object('last_metadata_received_at',f->>'received_at');
    END IF;
    SELECT outcome IN ('sold','reserve_not_met','cancelled'),outcome,winning_bid INTO terminal,prior_outcome,prior_winning_bid
      FROM public.auction_events WHERE id=auction_id;
    -- A replayed RNM cannot downgrade a later accepted sale. Conflicting sold
    -- amounts remain testimony and require the existing sale correction path.
    IF frame_outcome IS NOT NULL THEN
      -- One fresh canonical final read on a new native result or a conflicting
      -- sold record. Existing provenance/correction writer owns vehicle sale
      -- caches. Never fall back to tomorrow's catalog settlement sweep.
      IF prior_outcome IS DISTINCT FROM frame_outcome OR
        (frame_outcome='sold' AND prior_winning_bid IS DISTINCT FROM (f->>'sale_amount')::numeric) THEN
        final_request_id:=net.http_post(url:=public.get_service_url()||'/functions/v1/extract-bat-core',
          headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
          body:=jsonb_build_object('url',f->>'source_url','vehicle_id',fold_vehicle,'prefer_snapshot',false),timeout_milliseconds:=150000);
        stream:=stream||jsonb_build_object('final_read_request_id',final_request_id,'final_read_requested_at',clock_timestamp());
      END IF;
      UPDATE public.auction_events SET outcome=frame_outcome,
        winning_bid=CASE WHEN frame_outcome='sold' THEN (f->>'sale_amount')::numeric ELSE winning_bid END,
        winning_bidder=CASE WHEN frame_outcome='sold' THEN f->>'buyer' ELSE winning_bidder END
      WHERE id=auction_id AND (outcome<>'sold' OR (frame_outcome='sold' AND winning_bid=(f->>'sale_amount')::numeric));
      terminal:=true;
      stream:=stream||jsonb_build_object('terminal_observation_id',observation_id,
        'terminal_received_at',coalesce(stream->>'terminal_received_at',f->>'received_at'));
    END IF;
    stream:=stream||jsonb_build_object('last_frame_received_at',greatest((stream->>'last_frame_received_at')::timestamptz,frame_time),
      'last_admitted_at',clock_timestamp(),'last_observation_id',observation_id);
    UPDATE public.monitored_auctions SET auction_end_time=new_end, is_live=NOT coalesce(terminal,false),
      extension_count=coalesce(extension_count,0)+CASE WHEN new_end>m.auction_end_time THEN 1 ELSE 0 END,
      last_extension_at=CASE WHEN new_end>m.auction_end_time THEN frame_time ELSE last_extension_at END,
      is_in_soft_close=NOT coalesce(terminal,false) AND new_end<=clock_timestamp()+interval '2 minutes',
      stream_state=stream WHERE id=m.id;
    last_stats_time:=(stream->>'last_stats_received_at')::timestamptz;
    IF f->>'event'='stats-updated' AND (last_stats_time IS NULL OR frame_time>=last_stats_time) THEN
      stream:=stream||jsonb_build_object('last_stats_received_at',f->>'received_at');
      UPDATE public.monitored_auctions SET stream_state=stream WHERE id=m.id;
    END IF;
    UPDATE public.auction_events SET auction_end_date=new_end,updated_at=clock_timestamp(),
      page_views=CASE WHEN last_stats_time IS NULL OR frame_time>=last_stats_time THEN coalesce((f->>'views')::integer,page_views) ELSE page_views END,
      watchers=CASE WHEN last_stats_time IS NULL OR frame_time>=last_stats_time THEN coalesce((f->>'watchers')::integer,watchers) ELSE watchers END,
      comments_count=coalesce((f->>'comment_count')::integer,comments_count),
      raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('live_stream',jsonb_build_object(
        'observation_id',observation_id,'received_at',f->>'received_at',
        'last_frame_received_at',greatest((raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz,
          (raw_data#>>'{live_stream,received_at}')::timestamptz,(stream->>'last_frame_received_at')::timestamptz,frame_time),
        'admitted_at',clock_timestamp(),'clock_basis',f->>'clock_basis'))
      WHERE id=auction_id;
    -- Current vehicle event fold is source-qualified. Sale cache columns on
    -- vehicles remain owned by the existing provenance/correction writer.
    UPDATE public.vehicle_events e SET ended_at=new_end,
      current_price=CASE WHEN f->>'event'='metadata-updated' AND (last_metadata_time IS NULL OR frame_time>=last_metadata_time)
        THEN coalesce((f->>'current_bid')::numeric,e.current_price) ELSE e.current_price END,
      bid_count=CASE WHEN f->>'event'='metadata-updated' AND (last_metadata_time IS NULL OR frame_time>=last_metadata_time)
        THEN coalesce((f->>'bid_count')::integer,e.bid_count) ELSE e.bid_count END,
      view_count=CASE WHEN last_stats_time IS NULL OR frame_time>=last_stats_time THEN coalesce((f->>'views')::integer,e.view_count) ELSE e.view_count END,
      watcher_count=CASE WHEN last_stats_time IS NULL OR frame_time>=last_stats_time THEN coalesce((f->>'watchers')::integer,e.watcher_count) ELSE e.watcher_count END,
      event_status=CASE WHEN frame_outcome='sold' THEN 'sold' WHEN frame_outcome='reserve_not_met' AND e.event_status<>'sold' THEN 'ended'
        WHEN NOT coalesce(terminal,false) THEN 'active' ELSE e.event_status END,
      final_price=CASE WHEN frame_outcome='sold' AND (e.final_price IS NULL OR e.final_price=(f->>'sale_amount')::numeric)
        THEN (f->>'sale_amount')::numeric ELSE e.final_price END,
      sold_at=CASE WHEN frame_outcome='sold' AND (e.final_price IS NULL OR e.final_price=(f->>'sale_amount')::numeric)
        THEN (f->>'sale_at')::timestamptz ELSE e.sold_at END,
      metadata=coalesce(e.metadata,'{}'::jsonb)||jsonb_build_object('live_stream',stream)
        ||CASE WHEN f->>'comment_count' IS NOT NULL THEN jsonb_build_object('comment_count',(f->>'comment_count')::integer) ELSE '{}'::jsonb END
        ||CASE WHEN frame_outcome='sold' THEN jsonb_build_object('buyer_username',f->>'buyer','sale_time_basis','native_system_comment_timestamp') ELSE '{}'::jsonb END,
      updated_at=clock_timestamp()
    WHERE e.vehicle_id=fold_vehicle AND e.source_platform='bat' AND rtrim(e.source_url,'/')=f->>'source_url';
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n=0 THEN RAISE EXCEPTION 'canonical vehicle auction event missing'; END IF;
  END LOOP;

  FOR h IN SELECT x FROM jsonb_array_elements(p_heartbeats) x ORDER BY x->>'monitored_auction_id' LOOP
    SELECT * INTO STRICT m FROM public.monitored_auctions WHERE id=(h->>'monitored_auction_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.live_auction_sources WHERE id=m.source_id AND slug='bat')
      OR (h->>'at')::timestamptz>clock_timestamp()+interval '30 seconds' THEN RAISE EXCEPTION 'invalid stream heartbeat'; END IF;
    SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO sessions FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb))
      WHERE (value->>'at')::timestamptz>clock_timestamp()-interval '2 minutes';
    sessions:=sessions||jsonb_build_object(h->>'session_id',h-'monitored_auction_id'-'session_id');
    UPDATE public.monitored_auctions SET stream_state=m.stream_state||jsonb_build_object('sessions',sessions) WHERE id=m.id;
  END LOOP;
  RETURN jsonb_build_object('recorded',recorded,'duplicates',duplicates,'heartbeats',jsonb_array_length(p_heartbeats));
END;
$fn$;
REVOKE ALL ON FUNCTION public.ingest_bat_live_events(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_bat_live_events(jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.ingest_bat_live_events(jsonb,jsonb) IS
  'Private atomic native BaT stream admission/fold, only through service-authenticated ingest-observation bat_live_events_v1. Locks existing monitors in order, verifies source/post/parent, deduplicates immutable raw frames, preserves source/receipt/admission clocks, projects native comments before profile triggers, and folds sourced bids/extensions/results. A relisted lot whose monitor vehicle holds no event folds into the one vehicle that holds the lot by BaT slug. No deadline-only closure or sale-cache correction. Health control sessions are distinct from source testimony.';

COMMIT;
