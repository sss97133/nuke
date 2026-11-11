-- Opt-in existing-writer correction. Preserves duplicate events/comments and native clocks.
-- No correction is invoked by this migration. Existing service-only ACL is retained.
BEGIN;
DO $guard$ BEGIN
  PERFORM set_config('statement_timeout',least(coalesce(nullif((SELECT setting::bigint FROM pg_settings WHERE name='statement_timeout'),0),10000),10000)::text||'ms',true);
  PERFORM set_config('lock_timeout',least(coalesce(nullif((SELECT setting::bigint FROM pg_settings WHERE name='lock_timeout'),0),2000),2000)::text||'ms',true);
  IF md5(pg_get_functiondef('public.correct_auction_event_link(jsonb,text)'::regprocedure)) NOT IN
    ('b61e84bf6d7e28f698823d52959a794a','68140dc4cd08d127b9d5d9920c8cac4b') THEN
    RAISE EXCEPTION 'correct_auction_event_link drifted; review before replacement';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.correct_auction_event_link(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer   CONSTANT text := 'correct_auction_event_link';
  v_timeout  bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r          jsonb;
  v_ev       auction_events%ROWTYPE;
  v_action   text;
  v_to       uuid;
  v_dup      uuid;
  v_moved    int := 0;
  v_dups     int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
  v_held     jsonb := '[]'::jsonb;
  v_preserved int := 0;
  v_native_receipts jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout < 1 OR v_timeout > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout;
  END IF;
  PERFORM set_config('lock_timeout', least(coalesce(nullif((SELECT setting::bigint FROM pg_settings WHERE name='lock_timeout'),0),2000),2000)::text||'ms', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION '%: at most 500 rows per call (got %)', c_writer, jsonb_array_length(p_rows);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r -> 'source') IS DISTINCT FROM 'object' OR coalesce(btrim(r -> 'source' ->> 'ref'), '') = '' THEN
      RAISE EXCEPTION '%: auction event % has no cited source (source.ref)', c_writer, r ->> 'event_id';
    END IF;
    IF coalesce(length(btrim(r ->> 'reason')), 0) < 10 THEN
      RAISE EXCEPTION '%: auction event % needs a reason (at least 10 characters)', c_writer, r ->> 'event_id';
    END IF;
    v_action := r ->> 'action';

    IF v_action = 'preserve_native_duplicate' THEN
      DECLARE
        d auction_events%ROWTYPE; k auction_events%ROWTYPE; ep vehicle_events%ROWTYPE;
        src vehicles%ROWTYPE; dst vehicles%ROWTYPE; ob vehicle_observations%ROWTYPE;
        c auction_comments%ROWTYPE; n integer; duplicates integer;
        observed_ids uuid[]; comment_ids uuid[]; expected jsonb;
        native_post text; vin text; read_at timestamptz; canonical_read_at timestamptz;
        capture listing_page_snapshots%ROWTYPE; evidence jsonb; audit_reason text;
        projection boolean := false; result jsonb;
      BEGIN
        IF jsonb_array_length(p_rows) <> 1 OR v_timeout>10000 THEN
          RAISE EXCEPTION 'native duplicate correction requires one plan and caller timeout at most 10s'; END IF;
        PERFORM 1 FROM auction_events WHERE id IN ((r->>'event_id')::uuid,(r->>'canonical_event_id')::uuid) ORDER BY id FOR UPDATE;
        SELECT * INTO STRICT d FROM auction_events WHERE id=(r->>'event_id')::uuid;
        SELECT * INTO STRICT k FROM auction_events WHERE id=(r->>'canonical_event_id')::uuid;
        IF d.id=k.id OR d.vehicle_id IS DISTINCT FROM (r->>'expected_vehicle_id')::uuid
          OR k.vehicle_id IS DISTINCT FROM (r->>'to_vehicle_id')::uuid OR d.vehicle_id=k.vehicle_id THEN
          RAISE EXCEPTION 'native duplicate owner expectation changed'; END IF;
        IF d.duplicate_of=k.id THEN
          IF NOT EXISTS(SELECT 1 FROM auction_event_duplicate_mark WHERE event_id=d.id AND duplicate_of=k.id
            AND run_id=r->>'run_id' AND retired_at IS NULL) THEN RAISE EXCEPTION 'duplicate has a different correction receipt'; END IF;
          v_preserved:=v_preserved+1;
          v_native_receipts:=v_native_receipts||jsonb_build_array(jsonb_build_object('event_id',d.id,'canonical_event_id',k.id,'replay',true));
          CONTINUE;
        END IF;
        IF d.duplicate_of IS NOT NULL OR k.duplicate_of IS NOT NULL
          OR d.source IS DISTINCT FROM 'bat' OR k.source IS DISTINCT FROM d.source
          OR canonical_listing_url(d.source_url) IS DISTINCT FROM canonical_listing_url(k.source_url)
          OR d.source_url IS NULL OR d.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
          OR nullif(d.source_listing_id,'') IS NULL OR d.source_listing_id IS DISTINCT FROM k.source_listing_id
          OR d.outcome IS DISTINCT FROM 'live' OR k.outcome IS DISTINCT FROM 'live'
          OR nullif(btrim(r->>'run_id'),'') IS NULL THEN RAISE EXCEPTION 'native duplicate lot identity unavailable'; END IF;
        IF encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') IS DISTINCT FROM r->>'expected_event_sha256'
          OR encode(sha256(convert_to(to_jsonb(k)::text,'UTF8')),'hex') IS DISTINCT FROM r->>'expected_canonical_sha256' THEN
          RAISE EXCEPTION 'native duplicate event state changed'; END IF;
        PERFORM 1 FROM vehicles WHERE id IN(d.vehicle_id,k.vehicle_id) ORDER BY id FOR UPDATE;
        SELECT * INTO STRICT src FROM vehicles WHERE id=d.vehicle_id;
        SELECT * INTO STRICT dst FROM vehicles WHERE id=k.vehicle_id;
        vin:=d.raw_data#>>'{listing_details,vin}'; native_post:=src.origin_metadata->>'external_id';
        IF vin IS NULL OR vin !~ '^[A-HJ-NPR-Z0-9]{17}$' OR vin IS DISTINCT FROM dst.vin
          OR vin IS DISTINCT FROM k.raw_data#>>'{listing_details,vin}' OR nullif(btrim(src.vin),'') IS NOT NULL
          OR src.deleted_at IS NOT NULL OR dst.deleted_at IS NOT NULL
          OR src.merged_into_vehicle_id IS NOT NULL OR dst.merged_into_vehicle_id IS NOT NULL
          OR src.status='merged' OR dst.status='merged'
          OR src.origin_metadata->>'source' IS DISTINCT FROM 'bat_auctions_page'
          OR src.origin_metadata->>'platform' IS DISTINCT FROM 'bringatrailer'
          OR native_post IS NULL OR native_post !~ '^[1-9][0-9]{3,}$'
          OR canonical_listing_url(src.listing_url) IS DISTINCT FROM canonical_listing_url(d.source_url) THEN
          RAISE EXCEPTION 'native duplicate exact VIN/inventory identity unavailable'; END IF;
        read_at:=(d.raw_data#>>'{source_read,at}')::timestamptz;
        canonical_read_at:=greatest((k.raw_data#>>'{source_read,at}')::timestamptz,
          (k.raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz);
        SELECT * INTO STRICT capture FROM listing_page_snapshots WHERE id=(r->>'source_snapshot_id')::uuid;
        IF read_at IS NULL OR canonical_read_at IS NULL OR NOT isfinite(read_at) OR NOT isfinite(canonical_read_at)
          OR read_at>statement_timestamp() OR canonical_read_at>statement_timestamp()
          OR capture.platform IS DISTINCT FROM 'bat' OR capture.success IS DISTINCT FROM true OR capture.http_status IS DISTINCT FROM 200
          OR capture.fetched_at IS DISTINCT FROM read_at
          OR canonical_listing_url(capture.listing_url) IS DISTINCT FROM canonical_listing_url(d.source_url)
          OR capture.html_sha256 IS DISTINCT FROM r->>'source_sha256'
          OR capture.html_sha256 IS NULL OR capture.html_sha256 !~ '^[a-f0-9]{64}$'
          OR d.high_bid IS NULL OR d.high_bid IS DISTINCT FROM (d.raw_data#>>'{source_read,bid_amount}')::numeric THEN
          RAISE EXCEPTION 'native duplicate source receipt mismatch'; END IF;
        SELECT * INTO STRICT ep FROM vehicle_events WHERE id=(r->>'vehicle_event_id')::uuid FOR UPDATE;
        IF ep.vehicle_id IS DISTINCT FROM d.vehicle_id OR ep.source_platform IS DISTINCT FROM 'bat'
          OR ep.event_type IS DISTINCT FROM 'auction' OR ep.event_status IS NULL OR ep.event_status NOT IN('active','live') OR ep.sold_at IS NOT NULL
          OR canonical_listing_url(ep.source_url) IS DISTINCT FROM canonical_listing_url(d.source_url)
          OR ep.current_price IS DISTINCT FROM d.high_bid OR ep.bid_count IS DISTINCT FROM d.total_bids
          OR (ep.metadata#>>'{source_read,at}')::timestamptz IS DISTINCT FROM read_at
          OR encode(sha256(convert_to(to_jsonb(ep)::text,'UTF8')),'hex') IS DISTINCT FROM r->>'expected_episode_sha256'
          OR EXISTS(SELECT 1 FROM vehicle_events e WHERE e.vehicle_id=k.vehicle_id AND e.source_platform='bat'
            AND canonical_listing_url(e.source_url)=canonical_listing_url(d.source_url)) THEN
          RAISE EXCEPTION 'native duplicate current episode changed or already owned'; END IF;
        PERFORM 1 FROM auction_comments WHERE auction_event_id IN(d.id,k.id) ORDER BY id FOR UPDATE;
        SELECT count(*),array_agg(id ORDER BY id) INTO n,comment_ids FROM auction_comments WHERE auction_event_id=d.id;
        IF n IS DISTINCT FROM (r->>'expected_comments')::integer OR n<1 OR n>200 THEN RAISE EXCEPTION 'native duplicate comment boundary changed'; END IF;
        IF EXISTS(SELECT 1 FROM auction_comments WHERE auction_event_id IN(d.id,k.id)
          GROUP BY auction_event_id,bat_comment_id HAVING count(*)>1 OR bat_comment_id IS NULL) THEN RAISE EXCEPTION 'native duplicate comment identity ambiguous'; END IF;
        IF EXISTS(SELECT 1 FROM auction_comments a JOIN auction_comments b ON b.auction_event_id=k.id AND b.bat_comment_id=a.bat_comment_id
          WHERE a.auction_event_id=d.id AND ROW(a.posted_at,a.author_username,a.comment_type,a.comment_text,a.bid_amount,a.platform)
            IS DISTINCT FROM ROW(b.posted_at,b.author_username,b.comment_type,b.comment_text,b.bid_amount,b.platform)) THEN
          RAISE EXCEPTION 'native duplicate comment testimony conflicts'; END IF;
        SELECT count(*) INTO duplicates FROM auction_comments a JOIN auction_comments b ON b.auction_event_id=k.id AND b.bat_comment_id=a.bat_comment_id WHERE a.auction_event_id=d.id;
        IF duplicates IS DISTINCT FROM (r->>'expected_duplicate_comments')::integer OR n-duplicates<>1 THEN RAISE EXCEPTION 'native duplicate requires one unique native comment'; END IF;
        IF d.total_bids IS DISTINCT FROM (SELECT count(DISTINCT bat_comment_id) FROM auction_comments
          WHERE auction_event_id=d.id AND comment_type='bid' AND bid_amount>0)
          OR (read_at>canonical_read_at AND d.total_bids<k.total_bids) THEN
          RAISE EXCEPTION 'native duplicate bid population disagrees with retained state'; END IF;
        IF jsonb_typeof(r->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'observations') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'native duplicate observation plan missing or oversized'; END IF;
        SELECT array_agg((x->>'id')::uuid ORDER BY x->>'id') INTO observed_ids FROM jsonb_array_elements(r->'observations') x;
        IF cardinality(observed_ids)<>(SELECT count(DISTINCT x) FROM unnest(observed_ids) x) THEN RAISE EXCEPTION 'native duplicate repeated observation'; END IF;
        PERFORM 1 FROM vehicle_observations WHERE id=ANY(observed_ids) ORDER BY id FOR UPDATE;
        IF (SELECT count(*) FROM vehicle_observations WHERE id=ANY(observed_ids))<>cardinality(observed_ids)
          OR EXISTS(SELECT 1 FROM vehicle_observations o WHERE o.vehicle_id=d.vehicle_id
            AND o.ingested_at BETWEEN read_at AND read_at+interval '30 seconds'
            AND canonical_listing_url(o.source_url)=canonical_listing_url(d.source_url) AND NOT o.id=ANY(observed_ids)) THEN
          RAISE EXCEPTION 'native duplicate observation missing from bounded capture plan'; END IF;
        FOR expected IN SELECT x FROM jsonb_array_elements(r->'observations') x LOOP
          SELECT * INTO STRICT ob FROM vehicle_observations WHERE id=(expected->>'id')::uuid;
          IF ob.vehicle_id IS DISTINCT FROM d.vehicle_id OR canonical_listing_url(ob.source_url) IS DISTINCT FROM canonical_listing_url(d.source_url)
            OR ob.ingested_at NOT BETWEEN read_at AND read_at+interval '30 seconds'
            OR encode(sha256(convert_to(to_jsonb(ob)::text,'UTF8')),'hex') IS DISTINCT FROM expected->>'sha256'
            OR (ob.auction_event_id IS NOT NULL AND ob.auction_event_id NOT IN(d.id,k.id))
            OR (ob.source_vehicle_event_id IS NOT NULL AND ob.source_vehicle_event_id<>ep.id)
            OR (ob.structured_data ? 'auction_event_id' AND ob.structured_data->>'auction_event_id' NOT IN(d.id::text,k.id::text))
            OR (ob.structured_data ? 'source_auction_event_id' AND ob.structured_data->>'source_auction_event_id' NOT IN(d.id::text,k.id::text)) THEN
            RAISE EXCEPTION 'native duplicate observation identity/state changed'; END IF;
        END LOOP;
        SELECT a.* INTO STRICT c FROM auction_comments a WHERE a.auction_event_id=d.id
          AND NOT EXISTS(SELECT 1 FROM auction_comments b WHERE b.auction_event_id=k.id AND b.bat_comment_id=a.bat_comment_id);
        IF c.vehicle_id IS DISTINCT FROM d.vehicle_id OR c.comment_type IS DISTINCT FROM 'bid'
          OR c.bid_amount IS DISTINCT FROM d.high_bid OR c.bid_amount<=0
          OR NOT EXISTS(SELECT 1 FROM vehicle_observations o WHERE o.id=ANY(observed_ids) AND o.kind='bid'
            AND NOT coalesce(o.is_superseded,false) AND o.structured_data->>'projection_error' IS NULL
            AND o.source_id=(SELECT id FROM observation_sources WHERE slug='bat')
            AND o.extraction_method='bat_public_live_v1'
            AND o.vehicle_match_signals->>'native_post_id'=native_post
            AND o.vehicle_match_signals->>'source_url_match'='true'
            AND o.raw_source_ref='bat:public-live:post:'||native_post
            AND o.extraction_metadata->>'schema'='bat_public_live_v1'
            AND o.structured_data->>'native_post_id'=native_post
            AND o.structured_data#>>'{public_live_frame,event}'='comment-added'
            AND o.structured_data#>>'{public_live_frame,data,comment,type}'='bat-bid'
            AND o.structured_data#>>'{public_live_frame,data,comment,post}'=native_post
            AND o.structured_data#>>'{public_live_frame,data,comment,id}'=c.bat_comment_id::text
            AND (o.structured_data#>>'{public_live_frame,data,comment,bidAmount}')::numeric=c.bid_amount
            AND (o.structured_data#>>'{public_live_frame,data,comment,timestamp}')::numeric=extract(epoch FROM c.posted_at)
            AND (o.structured_data->>'received_at')::timestamptz=read_at
            AND o.source_identifier LIKE 'public-live:'||native_post||':comment-added:comment:'||c.bat_comment_id||':%'
            AND o.observed_at=c.posted_at) THEN RAISE EXCEPTION 'native duplicate unique bid identity unavailable'; END IF;
        IF EXISTS(SELECT 1 FROM auction_comments a WHERE a.vehicle_id=k.vehicle_id AND a.content_hash=c.content_hash) THEN RAISE EXCEPTION 'native duplicate unique comment hash collision'; END IF;
        IF canonical_read_at>read_at AND ROW(d.high_bid,d.total_bids,d.auction_end_date) IS DISTINCT FROM ROW(k.high_bid,k.total_bids,k.auction_end_date) THEN
          RAISE EXCEPTION 'native duplicate episode is older than conflicting canonical state'; END IF;
        PERFORM 1 FROM external_auction_bids b
          WHERE (b.auction_comment_id=ANY(comment_ids) OR b.auction_event_id=k.id) AND b.superseded_by IS NULL
          ORDER BY b.id FOR UPDATE;
        evidence:=(r->'source')||jsonb_build_object('run_id',r->>'run_id','canonical_event_id',k.id,'source_snapshot_id',capture.id,
          'source_sha256',capture.html_sha256,'source_read_at',read_at,'native_post_id',native_post,'vin',vin);
        audit_reason:=(r->>'reason')||' (preserved native duplicate correction)';
        INSERT INTO superseded_rows(source_table,row_id,row_data,asserted_by,source,reason)
          VALUES('auction_events',d.id,to_jsonb(d),p_asserted_by,evidence,audit_reason),
                ('auction_events',k.id,to_jsonb(k),p_asserted_by,evidence,audit_reason),
                ('vehicle_events',ep.id,to_jsonb(ep),p_asserted_by,evidence,audit_reason),
                ('auction_comments',c.id,to_jsonb(c),p_asserted_by,evidence,audit_reason);
        INSERT INTO superseded_rows(source_table,row_id,row_data,asserted_by,source,reason)
          SELECT 'external_auction_bids',b.id,to_jsonb(b),p_asserted_by,evidence,audit_reason FROM external_auction_bids b
            WHERE (b.auction_comment_id=ANY(comment_ids) OR b.auction_event_id=k.id) AND b.superseded_by IS NULL;
        INSERT INTO superseded_rows(source_table,row_id,row_data,asserted_by,source,reason)
          SELECT 'vehicle_observations',o.id,to_jsonb(o),p_asserted_by,evidence,audit_reason FROM vehicle_observations o WHERE id=ANY(observed_ids);
        UPDATE auction_events SET duplicate_of=k.id,updated_at=now() WHERE id=d.id;
        INSERT INTO auction_event_duplicate_mark(event_id,duplicate_of,vehicle_id,source,canonical_listing_url,run_id)
          VALUES(d.id,k.id,d.vehicle_id,d.source,canonical_listing_url(d.source_url),r->>'run_id');
        UPDATE auction_comments SET vehicle_id=k.vehicle_id,auction_event_id=k.id,
          merged_from_vehicle_id=coalesce(merged_from_vehicle_id,d.vehicle_id) WHERE id=c.id;
        PERFORM record_external_auction_bids('comment_lot_moves',comment_ids);
        result:=correct_vehicle_event_link(jsonb_build_array(jsonb_build_object('action','move','event_id',ep.id,
          'expected_vehicle_id',d.vehicle_id,'to_vehicle_id',k.vehicle_id,'source',evidence,'reason',audit_reason)),p_asserted_by);
        IF result->>'moved' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'native duplicate episode move refused'; END IF;
        UPDATE vehicle_events SET merged_from_vehicle_id=coalesce(merged_from_vehicle_id,d.vehicle_id) WHERE id=ep.id;
        FOREACH v_to IN ARRAY observed_ids LOOP
          UPDATE vehicle_observations SET auction_event_id=CASE WHEN auction_event_id=d.id THEN k.id ELSE auction_event_id END,
            structured_data=CASE WHEN structured_data->>'source_auction_event_id'=d.id::text
              THEN jsonb_set(CASE WHEN structured_data->>'auction_event_id'=d.id::text THEN jsonb_set(structured_data,'{auction_event_id}',to_jsonb(k.id::text)) ELSE structured_data END,
                '{source_auction_event_id}',to_jsonb(k.id::text))
              WHEN structured_data->>'auction_event_id'=d.id::text THEN jsonb_set(structured_data,'{auction_event_id}',to_jsonb(k.id::text)) ELSE structured_data END WHERE id=v_to;
          result:=relink_testimony('observation',v_to,k.vehicle_id,audit_reason,NULL);
          IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native duplicate observation relink refused'; END IF;
        END LOOP;
        IF read_at>canonical_read_at THEN
          UPDATE auction_events SET high_bid=d.high_bid,total_bids=d.total_bids,comments_count=d.comments_count,
            unique_bidders=d.unique_bidders,watchers=d.watchers,page_views=d.page_views,auction_end_date=d.auction_end_date,
            scraped_at=d.scraped_at,raw_data=coalesce(raw_data,'{}')||jsonb_build_object('source_read',d.raw_data->'source_read',
              'live_stream',d.raw_data->'live_stream','link_correction',evidence),updated_at=now() WHERE id=k.id;
          projection:=true;
        ELSIF read_at=canonical_read_at AND ROW(d.high_bid,d.total_bids,d.auction_end_date) IS DISTINCT FROM ROW(k.high_bid,k.total_bids,k.auction_end_date) THEN
          RAISE EXCEPTION 'native duplicate equal-clock state conflict';
        END IF;
        IF (SELECT count(*) FROM auction_comments WHERE auction_event_id=d.id)<>duplicates
          OR EXISTS(SELECT 1 FROM external_auction_bids WHERE auction_event_id=d.id AND superseded_by IS NULL) THEN
          RAISE EXCEPTION 'native duplicate correction left active duplicate bids'; END IF;
        v_preserved:=v_preserved+1;
        v_native_receipts:=v_native_receipts||jsonb_build_array(jsonb_build_object('event_id',d.id,'canonical_event_id',k.id,
          'preserved_comments',duplicates,'moved_comments',1,'observations',cardinality(observed_ids),'projected',projection,'source_read_at',read_at));
      END;
      CONTINUE;
    END IF;

    IF v_action IS DISTINCT FROM 'move' THEN
      RAISE EXCEPTION '%: action % not allowed (move only; an auction whose lot has no vehicle waits for it)',
        c_writer, v_action;
    END IF;

    SELECT * INTO v_ev FROM auction_events WHERE id = (r ->> 'event_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(r ->> 'event_id');
      CONTINUE;
    END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM (r ->> 'expected_vehicle_id')::uuid THEN
      v_stale := v_stale || jsonb_build_array(jsonb_build_object('event_id', v_ev.id, 'live_vehicle_id', v_ev.vehicle_id,
                                                                 'expected_vehicle_id', r ->> 'expected_vehicle_id'));
      CONTINUE;
    END IF;
    -- comments and links cascade on delete and predictions lose their link: such an auction is held, not written
    IF EXISTS (SELECT 1 FROM auction_comments c WHERE c.auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM auction_event_links l WHERE l.from_auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM auction_event_links l WHERE l.to_auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM hammer_predictions h WHERE h.auction_event_id = v_ev.id) THEN
      v_held := v_held || jsonb_build_array(jsonb_build_object('event_id', v_ev.id,
                                                               'reason', 'has comments, event links or predictions'));
      CONTINUE;
    END IF;

    v_to := (r ->> 'to_vehicle_id')::uuid;
    IF v_to IS NULL OR NOT EXISTS (SELECT 1 FROM vehicles WHERE id = v_to AND deleted_at IS NULL) THEN
      RAISE EXCEPTION '%: target vehicle % is missing or deleted', c_writer, v_to;
    END IF;
    IF v_to = v_ev.vehicle_id THEN
      RAISE EXCEPTION '%: auction event % already belongs to vehicle %', c_writer, v_ev.id, v_to;
    END IF;
    -- the lot's own vehicle may already hold this auction (the same lot under www. or a trailing slash counts)
    v_dup := NULL;
    SELECT t.id INTO v_dup FROM auction_events t
    WHERE t.vehicle_id = v_to AND t.id <> v_ev.id
      AND t.source IS NOT DISTINCT FROM v_ev.source
      AND regexp_replace(lower(t.source_url), '^https?://(www\.)?|/+$', '', 'g')
        = regexp_replace(lower(v_ev.source_url), '^https?://(www\.)?|/+$', '', 'g')
    LIMIT 1;
    IF v_dup IS NULL THEN
      INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      VALUES ('auction_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
              (r -> 'source') || jsonb_build_object('relinked_to_vehicle', v_to),
              (r ->> 'reason') || ' (relinked; this is the row before the move)');
      UPDATE auction_events SET
        vehicle_id = v_to,
        merged_from_vehicle_id = v_ev.vehicle_id,
        updated_at = now()
      WHERE id = v_ev.id;
      v_moved := v_moved + 1;
      CONTINUE;
    END IF;
    INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    VALUES ('auction_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
            (r -> 'source') || jsonb_build_object('duplicate_of_event', v_dup, 'lot_vehicle_id', v_to),
            (r ->> 'reason') || ' (the lot''s own vehicle already holds this auction: duplicate)');
    DELETE FROM auction_events WHERE id = v_ev.id;
    v_dups := v_dups + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'retired_duplicates', v_dups,
    'stale', v_stale, 'missing', v_missing, 'held', v_held, 'asserted_by', p_asserted_by,
    'preserved_duplicates',v_preserved,'native_corrections',v_native_receipts);
END;
$function$;


-- Both passes resolve retained duplicate comments through their one-hop canonical lot.
DO $guard$ BEGIN
  IF md5(pg_get_functiondef('public.record_external_auction_bids(text,uuid[])'::regprocedure)) NOT IN
    ('160578cee081785b786aa85156f3c6bf','eb223923aa33906eda043ec484aa1375') THEN
    RAISE EXCEPTION 'record_external_auction_bids drifted; review before replacement';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.record_external_auction_bids(p_source text, p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidates integer := 0; v_inserted integer := 0; v_merged integer := 0;
  v_keyed integer := 0; v_superseded integer := 0; v_unresolved integer := 0;
  v_moved integer := 0; v_source text := p_source;
  r record; v_event record; v_holder uuid;
BEGIN
  IF p_source NOT IN ('auction_comments', 'bat_bids', 'bid_history', 'legacy', 'comment_lot_moves') THEN
    RAISE EXCEPTION 'record_external_auction_bids: unknown source %', p_source;
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN jsonb_build_object('source', p_source, 'ids', 0, 'candidates', 0, 'inserted', 0, 'merged', 0);
  END IF;

  IF p_source = 'legacy' THEN
    FOR r IN SELECT b.* FROM external_auction_bids b
             WHERE b.id = ANY (p_ids) AND b.platform = 'cars_and_bids' AND b.auction_event_id IS NULL AND b.superseded_by IS NULL
             ORDER BY b.id LOOP
      v_candidates := v_candidates + 1;
      SELECT e.id, e.vehicle_id, e.source_url, e.source_listing_id INTO v_event
      FROM auction_events e
      WHERE e.vehicle_id = r.vehicle_id AND e.source = 'cars_and_bids'
        AND (substring(e.source_url from 'carsandbids\.com/auctions/([A-Za-z0-9]+)')
               = substring(r.raw_data->>'auction_url' from 'carsandbids\.com/auctions/([A-Za-z0-9]+)')
             OR (r.raw_data->>'auction_url' IS NULL
                 AND (SELECT count(*) FROM auction_events x WHERE x.vehicle_id = r.vehicle_id AND x.source = 'cars_and_bids') = 1))
      ORDER BY e.created_at, e.id LIMIT 1;
      IF v_event.id IS NULL THEN v_unresolved := v_unresolved + 1; CONTINUE; END IF;
      SELECT k.id INTO v_holder FROM external_auction_bids k
      WHERE k.auction_event_id = v_event.id AND k.bid_amount = r.bid_amount
        AND k.bidder_username IS NOT DISTINCT FROM r.bidder_username AND k.superseded_by IS NULL;
      IF v_holder IS NOT NULL THEN
        UPDATE external_auction_bids SET superseded_by = v_holder, updated_at = now() WHERE id = r.id;
        UPDATE external_auction_bids SET bid_number = r.bid_number, updated_at = now()
        WHERE id = v_holder AND bid_number IS NULL AND r.bid_number IS NOT NULL;
        v_superseded := v_superseded + 1;
      ELSE
        UPDATE external_auction_bids b SET
          auction_event_id = v_event.id, vehicle_id = v_event.vehicle_id,
          source_url = coalesce(b.source_url, v_event.source_url), source_listing_id = coalesce(b.source_listing_id, v_event.source_listing_id),
          bidder_external_identity_id = coalesce(b.bidder_external_identity_id, (
            SELECT xi.id FROM external_identities xi WHERE xi.platform = 'cars_and_bids' AND xi.handle = b.bidder_username
              AND b.bidder_username <> 'Unknown' AND lower(b.bidder_username) <> 'anonymous')),
          currency = coalesce(b.currency, 'USD'),
          bid_timestamp_basis = CASE WHEN b.bid_timestamp IS NULL THEN NULL ELSE coalesce(b.bid_timestamp_basis, 'unverified') END,
          source_recorded_at = coalesce(b.source_recorded_at, b.created_at), updated_at = now()
        WHERE b.id = r.id;
        v_keyed := v_keyed + 1;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'candidates', v_candidates, 'keyed', v_keyed,
      'superseded', v_superseded, 'unresolved', v_unresolved);
  END IF;

  IF p_source = 'comment_lot_moves' THEN
    -- A bid comment re-pointed to another lot row (a writer re-keying the lot, e.g. a second lot row for the same
    -- auction): its current bid row moves with it, or is superseded by the row the new lot already holds for that bid.
    FOR r IN SELECT b.id, b.bid_amount, b.bidder_username, e.id AS event_id, e.vehicle_id, e.source_url, e.source_listing_id
             FROM auction_comments c
             JOIN external_auction_bids b ON b.auction_comment_id = c.id AND b.superseded_by IS NULL
             JOIN auction_events original_event ON original_event.id = c.auction_event_id
             JOIN auction_events e ON e.id = coalesce(original_event.duplicate_of,original_event.id)
               AND e.duplicate_of IS NULL
               AND (original_event.duplicate_of IS NULL OR (
                 e.source IS NOT DISTINCT FROM original_event.source
                 AND canonical_listing_url(e.source_url)=canonical_listing_url(original_event.source_url)
                 AND (e.vehicle_id=original_event.vehicle_id OR EXISTS(
                   SELECT 1 FROM vehicles owner WHERE owner.id=e.vehicle_id AND owner.deleted_at IS NULL
                     AND owner.merged_into_vehicle_id IS NULL AND owner.status IS DISTINCT FROM 'merged'
                     AND owner.vin=original_event.raw_data#>>'{listing_details,vin}'
                     AND owner.vin ~ '^[A-HJ-NPR-Z0-9]{17}$'))))
             WHERE c.id = ANY (p_ids) AND b.auction_event_id IS DISTINCT FROM e.id
             ORDER BY b.id LOOP
      SELECT k.id INTO v_holder FROM external_auction_bids k
      WHERE k.auction_event_id = r.event_id AND k.bid_amount = r.bid_amount
        AND k.bidder_username IS NOT DISTINCT FROM r.bidder_username AND k.superseded_by IS NULL;
      IF v_holder IS NOT NULL THEN
        UPDATE external_auction_bids SET superseded_by = v_holder, updated_at = now() WHERE id = r.id;
        v_superseded := v_superseded + 1;
      ELSE
        UPDATE external_auction_bids SET auction_event_id = r.event_id, vehicle_id = r.vehicle_id, source_url = r.source_url,
          source_listing_id = coalesce(r.source_listing_id, source_listing_id), updated_at = now()
        WHERE id = r.id;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
    v_source := 'auction_comments';
  END IF;

  WITH cand AS (
    SELECT c.platform, e.vehicle_id, e.id AS auction_event_id, coalesce(e.source_url, c.source_url) AS source_url,
           e.source_listing_id,
           coalesce(c.source_comment_id, c.bat_comment_id::text, substring(c.content_hash from '^cab_[0-9a-fA-F-]{36}_(.+)$')) AS source_comment_id,
           c.id AS auction_comment_id, NULL::uuid AS bat_bid_id, c.author_username AS bidder_username,
           coalesce(c.external_identity_id, c.author_external_identity_id) AS bidder_external_identity_id,
           c.bid_amount::integer AS bid_amount, external_auction_bid_currency(c.platform, c.comment_text) AS currency,
           c.posted_at AS bid_timestamp, CASE WHEN c.posted_at IS NOT NULL THEN 'source_posted' END AS bid_timestamp_basis,
           NULL::integer AS bid_number, 'auction_comments'::text AS source, c.created_at AS source_recorded_at, NULL::jsonb AS raw_data
    FROM auction_comments c JOIN auction_events original_event ON original_event.id = c.auction_event_id
             JOIN auction_events e ON e.id = coalesce(original_event.duplicate_of,original_event.id)
               AND e.duplicate_of IS NULL
               AND (original_event.duplicate_of IS NULL OR (
                 e.source IS NOT DISTINCT FROM original_event.source
                 AND canonical_listing_url(e.source_url)=canonical_listing_url(original_event.source_url)
                 AND (e.vehicle_id=original_event.vehicle_id OR EXISTS(
                   SELECT 1 FROM vehicles owner WHERE owner.id=e.vehicle_id AND owner.deleted_at IS NULL
                     AND owner.merged_into_vehicle_id IS NULL AND owner.status IS DISTINCT FROM 'merged'
                     AND owner.vin=original_event.raw_data#>>'{listing_details,vin}'
                     AND owner.vin ~ '^[A-HJ-NPR-Z0-9]{17}$'))))
    WHERE v_source = 'auction_comments' AND c.id = ANY (p_ids) AND c.platform IN ('bat', 'cars_and_bids')
      AND c.comment_type = 'bid' AND c.bid_amount > 0 AND c.bid_amount <= 2147483647 AND c.bid_amount = trunc(c.bid_amount)
    UNION ALL
    SELECT 'bat', e.vehicle_id, e.id, e.source_url, e.source_listing_id,
           coalesce(ac.source_comment_id, ac.bat_comment_id::text), ac.id, bb.id, bb.bat_username,
           coalesce(bb.external_identity_id, ac.external_identity_id, (
             SELECT xi.id FROM external_identities xi WHERE xi.platform = 'bat' AND xi.handle = bb.bat_username
               AND bb.bat_username <> 'Unknown' AND lower(bb.bat_username) <> 'anonymous')),
           bb.bid_amount::integer, external_auction_bid_currency('bat', ac.comment_text), bb.bid_timestamp,
           CASE WHEN bb.bid_timestamp IS NULL THEN NULL WHEN bb.source = 'comment' THEN 'source_posted'
                WHEN bb.source = 'bid_history' THEN 'source_bid_list' ELSE 'unverified' END,
           NULL::integer, 'bat_bids', bb.created_at, NULL::jsonb
    FROM bat_bids bb
    LEFT JOIN bat_listings bl ON bl.id = bb.bat_listing_id
    JOIN LATERAL (
      SELECT x.id, x.vehicle_id, x.source_url, x.source_listing_id FROM (
        SELECT e1.id, e1.vehicle_id, e1.source_url, e1.source_listing_id, 0 AS pref FROM auction_events e1 WHERE e1.id = bb.auction_event_id AND e1.duplicate_of IS NULL
        UNION ALL
        SELECT e2.id, e2.vehicle_id, e2.source_url, e2.source_listing_id, 1 FROM auction_events e2
        WHERE e2.vehicle_id = bb.vehicle_id AND bl.bat_listing_url IS NOT NULL AND e2.duplicate_of IS NULL
          AND lower(substring(e2.source_url, 'bringatrailer\.com/listing/([^/?#]+)'))
              = lower(substring(bl.bat_listing_url, 'bringatrailer\.com/listing/([^/?#]+)'))
      ) x ORDER BY x.pref, x.id LIMIT 1) e ON true
    LEFT JOIN auction_comments ac ON ac.vehicle_id = bb.vehicle_id AND ac.content_hash = bb.metadata->>'comment_content_hash'
    WHERE v_source = 'bat_bids' AND bb.id = ANY (p_ids)
      AND bb.bid_amount > 0 AND bb.bid_amount <= 2147483647 AND bb.bid_amount = trunc(bb.bid_amount)
    UNION ALL
    SELECT 'cars_and_bids', e.vehicle_id, e.id, e.source_url, e.source_listing_id,
           nullif(btrim(h.el->>'id'), ''), NULL::uuid, NULL::uuid, btrim(h.el->>'bidder'),
           (SELECT xi.id FROM external_identities xi WHERE xi.platform = 'cars_and_bids' AND xi.handle = btrim(h.el->>'bidder')
              AND btrim(h.el->>'bidder') <> 'Unknown' AND lower(btrim(h.el->>'bidder')) <> 'anonymous'),
           (h.el->>'amount')::numeric::integer, 'USD', h.ts, CASE WHEN h.ts IS NOT NULL THEN 'source_bid_list' END,
           CASE WHEN (h.el->>'bid_number') ~ '^[0-9]{1,6}$' THEN (h.el->>'bid_number')::integer END,
           'auction_events.bid_history', coalesce(e.scraped_at, e.updated_at, e.created_at), h.el
    FROM auction_events e
    CROSS JOIN LATERAL (
      SELECT el, CASE WHEN el->>'timestamp' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d' THEN (el->>'timestamp')::timestamptz
                      WHEN el->>'timeAgo' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d' THEN (el->>'timeAgo')::timestamptz END AS ts
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.bid_history) = 'array' THEN e.bid_history ELSE '[]'::jsonb END) AS a(el)
      WHERE jsonb_typeof(el) = 'object') h
    WHERE v_source = 'bid_history' AND e.id = ANY (p_ids) AND e.source = 'cars_and_bids'
      AND (h.el->>'amount') ~ '^[0-9]{1,9}(\.0+)?$' AND (h.el->>'amount')::numeric > 0
      AND nullif(btrim(h.el->>'bidder'), '') IS NOT NULL
  ), pick AS (
    SELECT DISTINCT ON (auction_event_id, bid_amount, bidder_username) * FROM cand
    ORDER BY auction_event_id, bid_amount, bidder_username,
      CASE bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END,
      bid_timestamp NULLS LAST, auction_comment_id NULLS LAST, bat_bid_id NULLS LAST
  ), up AS (
    INSERT INTO external_auction_bids AS b (platform, vehicle_id, auction_event_id, source_url, source_listing_id,
      source_comment_id, auction_comment_id, bat_bid_id, bidder_username, bidder_external_identity_id, bid_amount,
      currency, bid_timestamp, bid_timestamp_basis, bid_number, source, source_recorded_at, raw_data)
    SELECT platform, vehicle_id, auction_event_id, source_url, source_listing_id, source_comment_id, auction_comment_id,
      bat_bid_id, bidder_username, bidder_external_identity_id, bid_amount, currency, bid_timestamp, bid_timestamp_basis,
      bid_number, source, source_recorded_at, raw_data
    FROM pick
    ON CONFLICT (auction_event_id, bid_amount, bidder_username) WHERE auction_event_id IS NOT NULL AND superseded_by IS NULL
    DO UPDATE SET
      auction_comment_id = coalesce(b.auction_comment_id, excluded.auction_comment_id),
      bat_bid_id = coalesce(b.bat_bid_id, excluded.bat_bid_id),
      source_comment_id = coalesce(b.source_comment_id, excluded.source_comment_id),
      bidder_external_identity_id = coalesce(b.bidder_external_identity_id, excluded.bidder_external_identity_id),
      currency = coalesce(b.currency, excluded.currency),
      bid_number = coalesce(b.bid_number, excluded.bid_number),
      source_url = coalesce(b.source_url, excluded.source_url),
      source_listing_id = coalesce(b.source_listing_id, excluded.source_listing_id),
      bid_timestamp = CASE WHEN (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                              < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                           THEN excluded.bid_timestamp ELSE b.bid_timestamp END,
      raw_data = CASE WHEN b.bid_timestamp IS NOT NULL
                       AND (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                         < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                      THEN coalesce(b.raw_data, '{}'::jsonb) || jsonb_build_object('replaced_bid_timestamp', b.bid_timestamp,
                             'replaced_bid_timestamp_basis', b.bid_timestamp_basis)
                      ELSE b.raw_data END,
      bid_timestamp_basis = CASE WHEN (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                              < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                           THEN excluded.bid_timestamp_basis ELSE b.bid_timestamp_basis END,
      updated_at = now()
    WHERE (b.auction_comment_id IS NULL AND excluded.auction_comment_id IS NOT NULL)
       OR (b.bat_bid_id IS NULL AND excluded.bat_bid_id IS NOT NULL)
       OR (b.source_comment_id IS NULL AND excluded.source_comment_id IS NOT NULL)
       OR (b.bidder_external_identity_id IS NULL AND excluded.bidder_external_identity_id IS NOT NULL)
       OR (b.currency IS NULL AND excluded.currency IS NOT NULL)
       OR (b.bid_number IS NULL AND excluded.bid_number IS NOT NULL)
       OR (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
        < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
    RETURNING (b.xmax = 0) AS inserted
  )
  SELECT (SELECT count(*) FROM cand), count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
  INTO v_candidates, v_inserted, v_merged FROM up;

  IF p_source = 'comment_lot_moves' THEN
    RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'moved', v_moved, 'superseded', v_superseded,
      'candidates', v_candidates, 'inserted', v_inserted, 'merged', v_merged);
  END IF;
  RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'candidates', v_candidates,
    'inserted', v_inserted, 'merged', v_merged);
END $$;


COMMIT;

