-- C2/C3: public closing-auction stream -> canonical intake -> immutable log
-- -> current auction projections. No historical testimony edits, new tables,
-- source accounts, paid services or new cron. Requires reviewed rollout.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.monitored_auctions ADD COLUMN stream_state jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.monitored_auctions.stream_state IS
  'Derived public BaT collector control/fold state, keyed by existing monitored auction. Session heartbeat is collector receipt time, not source publication. last_comment_id is acknowledged native source identity; last_frame_received_at and last_admitted_at distinguish capture/admission. Source frames remain immutable vehicle_observations through ingest-observation. No historical or gap-free coverage claim.';

-- Protect the atomic live fold from an HTML read that started earlier but
-- finishes later. Neither current auction cache has an existing write guard.
CREATE FUNCTION public.preserve_bat_live_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$
DECLARE old_data jsonb; new_data jsonb; old_live jsonb; new_live jsonb; old_at timestamptz; new_at timestamptz;
BEGIN
  old_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(OLD)->'metadata' ELSE to_jsonb(OLD)->'raw_data' END;
  new_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(NEW)->'metadata' ELSE to_jsonb(NEW)->'raw_data' END;
  old_live:=old_data->'live_stream'; new_live:=new_data->'live_stream';
  IF old_live IS NULL THEN RETURN NEW; END IF;
  -- Organization/image metadata maintenance does not rewrite an auction fact.
  IF old_live IS NOT DISTINCT FROM new_live AND
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    IS NOT DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_observations o WHERE o.id=coalesce(new_live->>'last_observation_id',new_live->>'observation_id')::uuid
      AND o.vehicle_id=NEW.vehicle_id AND o.extraction_method='bat_public_live_v1'
      AND o.xmin=(pg_current_xact_id()::text::bigint % 4294967296)::text::xid) THEN RETURN NEW; END IF;
  old_at:=coalesce(old_live->>'last_frame_received_at',old_live->>'received_at')::timestamptz;
  new_at:=(new_data#>>'{source_read,at}')::timestamptz;
  IF new_at IS NULL OR (old_at IS NOT NULL AND new_at<=old_at) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='vehicle_events' THEN NEW.metadata:=NEW.metadata||jsonb_build_object('live_stream',old_live);
  ELSE NEW.raw_data:=NEW.raw_data||jsonb_build_object('live_stream',old_live); END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.preserve_bat_live_projection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_bat_live_projection();
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_bat_live_projection();
COMMENT ON FUNCTION public.preserve_bat_live_projection() IS
  'Current BaT auction cache stale-read guard. An admitted same-vehicle native observation advances the fold; legacy HTML reads must carry a capture clock newer than the last public stream receipt. Protects later-finishing earlier reads; does not edit the immutable log or qualify a sale.';

-- Capability preflight: update_auction_state logs receipt-time bids to the
-- parallel bid_events table and retires on scheduled end. It cannot atomically
-- admit native frames/records. This private RPC belongs to ingest-observation;
-- the collector never calls it or writes testimony/projections directly.
CREATE OR REPLACE FUNCTION public.ingest_bat_live_events(p_frames jsonb, p_heartbeats jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  f jsonb; h jsonb; raw jsonb; c jsonb; m public.monitored_auctions; v public.vehicles;
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

    INSERT INTO public.vehicle_observations
      (vehicle_id,vehicle_match_confidence,vehicle_match_signals,source_id,source_url,source_identifier,kind,observed_at,content_text,content_hash,
       structured_data,extraction_method,raw_source_ref,extraction_metadata,confidence,confidence_score)
    VALUES (m.vehicle_id,0.95,jsonb_build_object('source_url_match',true,'native_post_id',f->>'post_id','binding','bat_auctions_page'),
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
      WHERE vehicle_id=m.vehicle_id AND rtrim(source_url,'/')=f->>'source_url'
      ORDER BY updated_at DESC LIMIT 1;
    IF auction_id IS NULL THEN
      INSERT INTO public.auction_events(vehicle_id,source,source_url,outcome,auction_end_date)
        VALUES(m.vehicle_id,'bat',f->>'source_url','live',new_end) RETURNING id INTO auction_id;
    END IF;
    -- The same-transaction immutable receipt authorizes all steps of this fold;
    -- an older HTML caller cannot borrow a previously committed receipt.
    UPDATE public.auction_events SET raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('live_stream',
      jsonb_build_object('observation_id',observation_id,'received_at',f->>'received_at','admitted_at',clock_timestamp(),'clock_basis',f->>'clock_basis'))
      WHERE id=auction_id;
    c:=f->'comment_row';
    IF jsonb_typeof(c)='object' THEN
      IF c->>'bat_comment_id' IS DISTINCT FROM raw#>>'{data,comment,id}'
        OR c->>'posted_at' IS DISTINCT FROM f->>'observed_at' THEN RAISE EXCEPTION 'native comment proof mismatch'; END IF;
      -- Native source identity dedupe BEFORE INSERT/profile fold. Existing core
      -- comments are preserved; every raw stream version still enters the log.
      IF NOT EXISTS(SELECT 1 FROM public.auction_comments WHERE vehicle_id=m.vehicle_id AND platform='bat'
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
        SELECT auction_id,m.vehicle_id,'bat',f->>'source_url',c->>'content_hash',
          (SELECT coalesce(max(sequence_number),0)+1 FROM public.auction_comments WHERE vehicle_id=m.vehicle_id),
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
          body:=jsonb_build_object('url',f->>'source_url','vehicle_id',m.vehicle_id,'prefer_snapshot',false),timeout_milliseconds:=150000);
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
        'observation_id',observation_id,'received_at',f->>'received_at','admitted_at',clock_timestamp(),'clock_basis',f->>'clock_basis'))
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
    WHERE e.vehicle_id=m.vehicle_id AND e.source_platform='bat' AND rtrim(e.source_url,'/')=f->>'source_url';
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
  'Private atomic native BaT stream admission/fold, only through service-authenticated ingest-observation bat_live_events_v1. Locks existing monitors in order, verifies source/post/parent, deduplicates immutable raw frames, preserves source/receipt/admission clocks, projects native comments before profile triggers, and folds sourced bids/extensions/results. No deadline-only closure or sale-cache correction. Health control sessions are distinct from source testimony.';

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES('monitored_auctions','stream_state','ingest-observation','Public BaT closing stream control state and immutable observation lineage.',true,'ingest-observation bat_live_events_v1 -> ingest_bat_live_events')
ON CONFLICT(table_name,column_name) DO NOTHING;
CREATE OR REPLACE FUNCTION public.bat_live_pull_run(p_lots integer DEFAULT 3, p_force_sync boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_src      uuid;
  v_cfg      jsonb;
  v_last     jsonb;
  v_now      timestamptz := now();
  v_probes   jsonb;
  v_lat      numeric[];
  v_p50      numeric;
  v_pause_ms integer;
  v_window   interval;
  v_skip     text := NULL;
  v_paused_since timestamptz;
  v_acc      integer := 0;
  v_read     integer := 0;
  v_failed   integer := 0;
  v_rows     bigint := 0;
  v_sent     integer := 0;
  v_n        bigint;
  v_req      bigint;
  v_key      text := get_service_role_key_for_cron();
  v_base     text := get_service_url();
  v_cad      interval;
  v_reserve  integer;
  v_first    integer := 0;
  v_stream_req bigint;
  v_stream_lots integer;
  r          record;
BEGIN
  SELECT id, coalesce(scraping_config -> 'live_pull', '{}'::jsonb) INTO v_src, v_cfg
  FROM live_auction_sources WHERE slug = 'bat';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'bat_live_pull_run: live_auction_sources has no bat row';
  END IF;
  v_pause_ms := coalesce((v_cfg ->> 'pause_rest_p50_ms')::integer, 2000);
  v_window   := make_interval(hours => coalesce((v_cfg ->> 'priority_window_hours')::integer, 48));
  v_last     := coalesce(v_cfg -> 'last_run', '{}'::jsonb);
  -- C1: slots per run held for lots never dispatched (next_poll_at IS NULL), so lots beyond the priority window
  -- get their first read instead of waiting for the window to have fewer than p_lots due lots (it never does at peak).
  v_reserve  := least(coalesce((v_cfg ->> 'reserve_first_read')::integer, 1), greatest(coalesce(p_lots, 0), 0));

  -- 1. Account the previous passes. The reader upserts the lot's auction_events row on every read.
  FOR r IN
    SELECT m.id, m.vehicle_id, m.last_synced_at, m.last_comment_count,
           e.updated_at AS read_at, e.auction_end_date AS read_end, e.outcome AS read_outcome
    FROM monitored_auctions m
    LEFT JOIN LATERAL (
      SELECT a.updated_at, a.auction_end_date, a.outcome FROM auction_events a
      WHERE a.vehicle_id = m.vehicle_id
        AND rtrim(a.source_url, '/') = rtrim(m.external_auction_url, '/')
      ORDER BY a.updated_at DESC LIMIT 1
    ) e ON true
    WHERE m.source_id = v_src
      AND m.vehicle_id IS NOT NULL
      AND m.last_synced_at > v_now - interval '6 hours'
      AND (m.last_comment_synced_at IS NULL OR m.last_comment_synced_at < m.last_synced_at)
  LOOP
    IF r.read_at >= r.last_synced_at THEN
      SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.vehicle_id;
      UPDATE monitored_auctions
      SET auction_end_time       = greatest(r.read_end, auction_end_time),
          is_live                = CASE WHEN r.read_outcome IN ('sold', 'reserve_not_met') THEN false ELSE is_live END,
          last_comment_count     = v_n,
          last_comment_synced_at = v_now,
          sync_latency_ms        = (extract(epoch FROM (r.read_at - r.last_synced_at)) * 1000)::integer
      WHERE id = r.id;
      v_acc  := v_acc + 1;
      v_read := v_read + 1;
      v_rows := v_rows + greatest(v_n - coalesce(r.last_comment_count, 0), 0);
    ELSIF r.last_synced_at < v_now - interval '10 minutes' THEN
      -- no read 10 min after dispatch: a failed read; accounted, retried in 30 min
      UPDATE monitored_auctions
      SET last_comment_synced_at = v_now,
          sync_latency_ms        = NULL,
          next_poll_at           = v_now + interval '30 minutes'
      WHERE id = r.id;
      v_acc    := v_acc + 1;
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  -- 2a. One pass at a time: a lot dispatched in the last 150 s (the reader's gateway limit) and not yet read.
  IF EXISTS (
    SELECT 1 FROM monitored_auctions m
    WHERE m.source_id = v_src
      AND m.last_synced_at > v_now - interval '150 seconds'
      AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                        AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                        AND e.updated_at >= m.last_synced_at)
  ) THEN
    v_skip := 'previous pass in flight';
  END IF;

  -- 2b. The pause rule, as the BaT loader's: REST p50 over the last 10 probes. A probe's latency is the gap
  --     from its dispatch to its response row; a timed-out or failed probe counts as 15 s.
  v_probes := coalesce(v_cfg -> 'rest_probes', '[]'::jsonb);
  SELECT array_agg(lat ORDER BY lat) INTO v_lat
  FROM (
    SELECT CASE WHEN h.timed_out OR h.status_code IS NULL OR h.status_code >= 500 THEN 15000
                ELSE greatest(extract(epoch FROM h.created) * 1000 - (p ->> 1)::numeric, 0) END AS lat
    FROM jsonb_array_elements(v_probes) p
    JOIN net._http_response h ON h.id = (p ->> 0)::bigint
  ) x;
  IF coalesce(array_length(v_lat, 1), 0) >= 3 THEN
    v_p50 := v_lat[(array_length(v_lat, 1) + 1) / 2];
    IF v_p50 > v_pause_ms THEN
      v_skip := coalesce(v_skip || '; ', '') || format('paused: REST p50 %s ms over the last %s probes', round(v_p50), array_length(v_lat, 1));
    END IF;
  END IF;
  -- A clock is never a terminal source event. Retire only qualified same-lot outcomes.
  UPDATE monitored_auctions m SET is_live=false
  WHERE m.source_id=v_src AND m.is_live AND EXISTS (
    SELECT 1 FROM auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/')
      AND a.outcome IN ('sold','reserve_not_met','cancelled'));

  IF v_skip IS NULL AND (p_force_sync OR extract(minute FROM v_now)::integer % 5 = 0
                         OR NOT EXISTS (SELECT 1 FROM monitored_auctions m WHERE m.source_id = v_src AND m.is_live)) THEN
    -- 3b. Every 5th minute: the schedule follows the live board, every live BaT row with a readable end time
    --     (new lots, end-time changes, the 48 h priority), and lots withdrawn or settled early leave it.
    INSERT INTO monitored_auctions AS m
      (source_id, external_auction_id, external_auction_url, vehicle_id, auction_end_time, is_live, current_bid_cents, priority)
    SELECT v_src, l.slug, 'https://bringatrailer.com/listing/' || l.slug, l.id, l.ends, true,
           (l.high_bid * 100)::bigint, CASE WHEN l.ends <= v_now + v_window THEN 1 ELSE 2 END
    FROM (
      SELECT v.id, v.high_bid,
             CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END AS ends,
             regexp_replace(regexp_replace(v.listing_url, '^https?://(www\.)?bringatrailer\.com/listing/', ''), '[/?#].*$', '') AS slug
      FROM vehicles v
      WHERE v.sale_status = 'auction_live'
        AND v.platform_source = 'bringatrailer'
        AND v.deleted_at IS NULL
        AND CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END > v_now - interval '24 hours'
        AND v.listing_url ~ '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+'
        AND NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = v.id
                        AND rtrim(a.source_url, '/') = rtrim(v.listing_url, '/')
                        AND a.outcome IN ('sold', 'reserve_not_met'))
    ) l
    ON CONFLICT (source_id, external_auction_id) DO UPDATE
    SET is_live = true, vehicle_id = EXCLUDED.vehicle_id, auction_end_time = greatest(m.auction_end_time, EXCLUDED.auction_end_time),
        external_auction_url = EXCLUDED.external_auction_url, priority = EXCLUDED.priority
    WHERE (m.is_live, m.vehicle_id, m.auction_end_time, m.priority)
          IS DISTINCT FROM (true, EXCLUDED.vehicle_id, greatest(m.auction_end_time, EXCLUDED.auction_end_time), EXCLUDED.priority);

  END IF;

  -- Independent continuous coverage: one multiplexed public connection per minute,
  -- overlapping workers, EVERY closing lot, no p_lots or HTML in-flight bottleneck.
  SELECT count(*) INTO v_stream_lots FROM monitored_auctions
    WHERE source_id=v_src AND (is_live OR (stream_state->>'terminal_received_at')::timestamptz>v_now-interval '2 minutes')
      AND auction_end_time<=v_now+interval '15 minutes';
  IF v_stream_lots>0 THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream'),timeout_milliseconds:=150000);
  END IF;

  IF v_skip IS NULL THEN
    -- Closing-window lots take the existing slots first, oldest read first for fairness.
    -- Remaining slots preserve C1's first-read reserve and the existing hourly/daily cadences.
    FOR r IN
      WITH due AS (
        SELECT m.id, m.external_auction_url, m.auction_end_time, m.next_poll_at, m.last_synced_at
        FROM monitored_auctions m
        WHERE m.source_id = v_src AND m.is_live
          AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
            WHERE (session.value->>'connected')::boolean AND (session.value->>'at')::timestamptz>v_now-interval '3 seconds')
          AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               OR (m.auction_end_time <= v_now + interval '10 minutes'
                   AND (m.last_synced_at IS NULL OR m.last_synced_at <= v_now - interval '1 minute')))
      ), closing AS (
        SELECT d.id FROM due d WHERE d.auction_end_time <= v_now + interval '10 minutes'
        ORDER BY d.last_synced_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(coalesce(p_lots, 0), 0)
      ), fresh AS (
        SELECT d.id FROM due d WHERE d.next_poll_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM closing c WHERE c.id = d.id)
        ORDER BY d.auction_end_time
        LIMIT least(v_reserve, greatest(coalesce(p_lots, 0) - (SELECT count(*) FROM closing), 0))
      ), rest AS (
        SELECT d.id FROM due d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id)
          AND NOT EXISTS (SELECT 1 FROM closing c WHERE c.id = d.id)
        ORDER BY (d.auction_end_time <= v_now + v_window) DESC, d.next_poll_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(greatest(coalesce(p_lots, 0), 0) - (SELECT count(*) FROM fresh) - (SELECT count(*) FROM closing), 0)
      )
      SELECT d.id, d.external_auction_url, d.auction_end_time, (d.next_poll_at IS NULL) AS first_read
      FROM due d
      WHERE d.id IN (SELECT id FROM closing UNION ALL SELECT id FROM fresh UNION ALL SELECT id FROM rest)
      ORDER BY d.auction_end_time
    LOOP
      IF r.first_read THEN v_first := v_first + 1; END IF;
      v_cad := CASE
        WHEN r.auction_end_time <= v_now + interval '10 minutes' THEN interval '1 minute'
        WHEN r.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,under_12h}')::integer, 60))
        WHEN r.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,h12_to_48}')::integer, 360))
        ELSE make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,over_48h}')::integer, 1440))
      END;
      PERFORM net.http_post(
        url := v_base || '/functions/v1/extract-bat-core',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('url', r.external_auction_url, 'prefer_snapshot', false),
        timeout_milliseconds := 150000);
      UPDATE monitored_auctions
      SET last_synced_at   = v_now,
          next_poll_at     = v_now + v_cad,
          poll_interval_ms = (extract(epoch FROM v_cad) * 1000)::integer
      WHERE id = r.id;
      v_sent := v_sent + 1;
    END LOOP;
  END IF;

  IF v_skip LIKE '%paused:%' THEN
    v_paused_since := coalesce((v_last ->> 'paused_since')::timestamptz, v_now);
  END IF;

  -- A new REST probe every run, fired last so its measured latency leaves out the rest of this transaction
  -- (pg_net sends it after commit; the latency is the gap to its response row).
  v_req := net.http_get(
    url := v_base || '/rest/v1/vehicles?select=id&limit=1',
    headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 15000);
  v_probes := v_probes || jsonb_build_array(jsonb_build_array(v_req, (extract(epoch FROM clock_timestamp()) * 1000)::bigint));
  SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_probes
  FROM jsonb_array_elements(v_probes) WITH ORDINALITY t(e, o)
  WHERE o > jsonb_array_length(v_probes) - 10;

  UPDATE live_auction_sources
  SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}', v_cfg || jsonb_build_object(
        'rest_probes', v_probes,
        'last_run', jsonb_build_object(
          'at', v_now, 'accounted', v_acc, 'read', v_read, 'failed', v_failed,
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'first_read_dispatched', v_first,
          'stream_lots',v_stream_lots,'stream_request_id',v_stream_req,'rest_p50_ms', round(v_p50),
          'skipped', v_skip, 'paused_since', v_paused_since))),
      last_successful_sync = CASE WHEN v_read > 0 THEN v_now ELSE last_successful_sync END,
      consecutive_failures = CASE WHEN v_read > 0 THEN 0 WHEN v_failed > 0 THEN consecutive_failures + 1 ELSE consecutive_failures END,
      health_status = CASE WHEN v_skip LIKE '%paused:%' THEN 'degraded'
                           WHEN v_failed > 0 AND v_read = 0 THEN 'unhealthy'
                           WHEN v_failed > 0 THEN 'degraded'
                           WHEN v_read > 0 THEN 'healthy'
                           ELSE health_status END,
      last_sync_error = CASE WHEN v_skip LIKE '%paused:%' THEN v_skip
                             WHEN v_failed > 0 THEN format('%s of %s dispatched lots not read within 10 min', v_failed, v_acc)
                             WHEN v_read > 0 THEN NULL
                             ELSE last_sync_error END
  WHERE id = v_src;

  RETURN jsonb_build_object('accounted', v_acc, 'read', v_read, 'failed', v_failed, 'comment_rows_landed', v_rows,
                            'dispatched', v_sent, 'first_read_dispatched', v_first,'stream_lots',v_stream_lots,'stream_request_id',v_stream_req, 'rest_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$fn$;
COMMENT ON FUNCTION public.bat_live_pull_run(integer,boolean) IS
  'Existing hourly reader and first-read reserve plus minute dispatch of overlapping public WebSocket workers for every closing BaT lot. p_lots caps HTML fallback only. Native source outcomes retire lots; scheduled ends do not. Healthy stream sessions suppress redundant HTML. Coverage and admission lag are measured separately from cron exit status.';
-- Extend the existing health reader; execution success is insufficient evidence.
CREATE OR REPLACE FUNCTION public.get_live_auction_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog,public
AS $health$
WITH closing AS MATERIALIZED (
  SELECT m.*, EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
    WHERE (session.value->>'connected')::boolean
      AND session.value->>'error' IS NULL
      AND (session.value->>'at')::timestamptz>now()-interval '3 seconds'
      AND NOT ((session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds')) AS covered,
    EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
      WHERE (session.value->>'at')::timestamptz>now()-interval '3 seconds'
        AND (session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds') AS admission_overdue
  FROM public.monitored_auctions m JOIN public.live_auction_sources source ON source.id=m.source_id AND source.slug='bat'
  WHERE m.auction_end_time<=now()+interval '15 minutes' AND m.auction_end_time>now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM public.auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled'))
), stream AS (
  SELECT jsonb_build_object('status',CASE WHEN count(*)=0 THEN 'idle'
    WHEN count(*) FILTER(WHERE NOT is_live OR NOT covered OR admission_overdue OR coalesce((stream_state->>'unqualified_frames')::integer,0)>0)>0 THEN 'failed' ELSE 'passed' END,
    'eligible_lots',count(*),'covered_lots',count(*) FILTER(WHERE is_live AND covered),
    'missing_lots',count(*) FILTER(WHERE NOT is_live OR NOT covered),
    'admission_overdue_lots',count(*) FILTER(WHERE admission_overdue),
    'unqualified_lots',count(*) FILTER(WHERE coalesce((stream_state->>'unqualified_frames')::integer,0)>0),
    'receipt_to_admission_slo_seconds',2,'heartbeat_stale_after_seconds',3,
    'source_publication_lag','unknown unless native comment timestamp is present',
    'coverage_scope','current subscriptions and acknowledgement queues; outages can lose non-replayable extension/stat events',
    'checked_at',now()) AS reading FROM closing
)
SELECT jsonb_build_object(
  'total_monitored',(SELECT count(*) FROM public.monitored_auctions WHERE is_live),
  'soft_close_count',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND is_in_soft_close),
  'overdue_sync',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND next_poll_at<now()-interval '2 minutes'),
  'avg_bid_dollars',(SELECT round(avg(current_bid_cents)::numeric/100,2) FROM public.monitored_auctions WHERE is_live AND current_bid_cents>0),
  'total_bids',(SELECT sum(bid_count) FROM public.monitored_auctions WHERE is_live),
  'platforms',(SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'active_auctions',s.active_count,'health_status',s.health_status))
    FROM (SELECT source.slug,source.health_status,count(m.id) AS active_count FROM public.live_auction_sources source
      LEFT JOIN public.monitored_auctions m ON m.source_id=source.id AND m.is_live WHERE source.is_active
      GROUP BY source.id,source.slug,source.health_status) s),
  'cron_status',(SELECT jsonb_build_object('job_id',j.jobid,'last_run',d.start_time,'last_status',d.status)
    FROM cron.job j LEFT JOIN LATERAL(SELECT start_time,status FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY start_time DESC LIMIT 1)d ON true
    WHERE j.jobname='bat-live-pull'),
  'last_sync',(SELECT max(updated_at) FROM public.monitored_auctions WHERE is_live),
  'closing_stream',(SELECT reading FROM stream),'checked_at',now());
$health$;
COMMENT ON FUNCTION public.get_live_auction_health() IS
  'Existing live monitor summary plus current BaT closing-stream assay. Fails on source-unsettled lots without a current public subscription or an overdue acknowledgement queue; includes clock-retired monitors. Does not equate a successful cron exit with acquisition coverage. Idle means no eligible sample, never historical or gap-free assurance. Existing privileges preserved.';
CREATE OR REPLACE VIEW public.v_job_health AS
WITH stream_assay AS MATERIALIZED (SELECT public.get_live_auction_health()->'closing_stream' AS reading), metric_assay AS MATERIALIZED (
         SELECT assay_vehicle_metric_fold() AS reading
          WHERE (EXISTS ( SELECT 1
                   FROM cron.job
                  WHERE job.jobname = 'drain-vehicle-derived-queues'::text))
        ), runs AS (
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message,
            row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
           FROM cron.job_run_details d
          WHERE d.start_time > (now() - '7 days'::interval)
        ), first_ok AS (
         SELECT runs.jobid,
            min(runs.rn) AS rn
           FROM runs
          WHERE runs.status <> 'failed'::text
          GROUP BY runs.jobid
        ), streak AS (
         SELECT r.jobid,
            count(*) AS n
           FROM runs r
             LEFT JOIN first_ok f USING (jobid)
          WHERE r.status = 'failed'::text AND r.rn < COALESCE(f.rn, 2147483647::bigint)
          GROUP BY r.jobid
        ), day AS (
         SELECT runs.jobid,
            count(*) AS runs_24h,
            count(*) FILTER (WHERE runs.status = 'failed'::text) AS failed_24h
           FROM runs
          WHERE runs.start_time > (now() - '24:00:00'::interval)
          GROUP BY runs.jobid
        ), last_run AS (
         SELECT runs.jobid,
            runs.status AS last_status,
            runs.start_time AS last_run_at
           FROM runs
          WHERE runs.rn = 1
        ), last_err AS (
         SELECT DISTINCT ON (runs.jobid) runs.jobid,
            "left"(runs.return_message, 300) AS last_error
           FROM runs
          WHERE runs.status = 'failed'::text
          ORDER BY runs.jobid, runs.start_time DESC
        )
 SELECT j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    COALESCE(day.runs_24h, 0::bigint) AS runs_24h,
    COALESCE(day.failed_24h, 0::bigint) AS failed_24h,
    COALESCE(s.n, 0::bigint) AS consecutive_failures,
    lr.last_status,
    lr.last_run_at,
    le.last_error,
    "substring"(j.command, 'app\.writer''\s*,\s*''([^'']+)'::text) AS declared_writer,
    "left"(regexp_replace(j.command, '\s+'::text, ' '::text, 'g'::text), 200) AS command,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN (SELECT reading->>'status' FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)
            ELSE NULL::text
        END AS assay_status,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN (SELECT reading FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)
            ELSE NULL::jsonb
        END AS assay,
        CASE
            WHEN NOT j.active THEN 'paused'::text
            WHEN lr.last_status = 'failed'::text THEN 'failed'::text
            WHEN j.jobname = 'bat-live-pull'::text THEN CASE WHEN lr.last_run_at IS NULL OR lr.last_run_at<now()-interval '2 minutes' THEN 'failed' WHEN (SELECT reading->>'status' FROM stream_assay)='failed' THEN 'failed' WHEN (SELECT reading->>'status' FROM stream_assay)='passed' THEN 'passed' ELSE 'idle' END
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = ANY (ARRAY['partial'::text, 'unavailable'::text]) THEN 'unknown'::text
                WHEN lr.last_status <> 'succeeded'::text THEN 'unknown'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'passed'::text THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN lr.last_status = 'succeeded'::text THEN 'passed'::text
            ELSE 'unknown'::text
        END AS health_status
   FROM cron.job j
     LEFT JOIN day ON day.jobid = j.jobid
     LEFT JOIN streak s ON s.jobid = j.jobid
     LEFT JOIN last_run lr ON lr.jobid = j.jobid
     LEFT JOIN last_err le ON le.jobid = j.jobid;
COMMENT ON VIEW public.v_job_health IS
  'Existing execution health and metric-fold assay plus bat-live-pull current public closing-stream coverage/admission assay. A successful cron with missing coverage fails. Existing columns and grants preserved; idle has no eligible closing sample and is not historical assurance.';
-- Restore delivery to the existing auction-pulse subscriber. RLS remains the
-- already-installed public-read/service-write policy; no new access grants.
-- Publish the small current event cache, not the 18M-row comment log.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='vehicle_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_events;
  END IF;
END $$;
COMMIT;
