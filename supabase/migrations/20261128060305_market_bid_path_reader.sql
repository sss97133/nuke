-- Existing order-book owner: source-keyed, bounded on-read states with both input clocks.
-- Neither the legacy reader nor scheduled fold/writer is changed or invoked.
BEGIN;
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval=interval '0'
 OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,true);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval=interval '0'
 OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,true);
DO $$ BEGIN
 IF to_regprocedure('public.lot_order_book_read(uuid)') IS NULL THEN RAISE EXCEPTION 'Existing order-book reader is required'; END IF;
 IF to_regprocedure('public.lot_order_book_read(uuid,jsonb)') IS NOT NULL
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.lot_order_book_read(uuid,jsonb)'))<>'46be016b759b6e044820c6e3488788b3'
 THEN RAISE EXCEPTION 'Bid-path reader differs from the reviewed body'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lot_order_book_read(p_auction_event_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp SET TimeZone='UTC'
AS $bidpath$
DECLARE
 v_now timestamptz:=statement_timestamp(); v_lot record; v_url text; v_from timestamptz;
 v_mode text:=coalesce(p_request->>'knowledge_mode','current_recorded_state');
 v_hash text:=p_request->>'snapshot_hash'; v_selected uuid;
 v_event_to timestamptz; v_recorded_to timestamptz; v_clock text;
 v_n bigint; v_bytes numeric; v_unsafe bigint; v_result jsonb;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR p_auction_event_id IS NULL
  OR EXISTS(SELECT FROM jsonb_object_keys(p_request) k WHERE k NOT IN
    ('knowledge_mode','cutoff','event_cutoff','recorded_cutoff','snapshot_hash','selected_bid_comment_id'))
  OR (p_request?'knowledge_mode' AND (jsonb_typeof(p_request->'knowledge_mode')<>'string'
    OR v_mode NOT IN ('current_recorded_state','recorded_input_reconstruction')))
  OR (p_request?'snapshot_hash' AND (jsonb_typeof(p_request->'snapshot_hash')<>'string' OR v_hash!~'^[0-9a-f]{32}$'))
  OR (p_request?'selected_bid_comment_id' AND (jsonb_typeof(p_request->'selected_bid_comment_id')<>'string'
    OR p_request->>'selected_bid_comment_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
 THEN RETURN jsonb_build_object('state','unavailable','reason','invalid_bid_path_request'); END IF;
 v_selected:=(p_request->>'selected_bid_comment_id')::uuid;
 FOREACH v_clock IN ARRAY ARRAY['cutoff','event_cutoff','recorded_cutoff'] LOOP
  IF p_request?v_clock AND (jsonb_typeof(p_request->v_clock)<>'string'
    OR p_request->>v_clock!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR NOT pg_input_is_valid(p_request->>v_clock,'timestamptz'))
  THEN RETURN jsonb_build_object('state','unavailable','reason','invalid_cutoff'); END IF;
 END LOOP;
 SELECT e.id,e.vehicle_id,e.source_url,e.auction_end_date,e.currency_code,e.currency_source,
   e.price_basis,e.price_kind,e.price_kind_source,e.price_basis_conflict INTO v_lot
 FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
 WHERE e.id=p_auction_event_id AND e.source IN ('bat','bringatrailer')
   AND e.source_url~'^https://bringatrailer[.]com/listing/[a-z0-9-]+/?$'
   AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
   AND v.status IS DISTINCT FROM 'merged' AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable','reason','unknown_or_ineligible_episode'); END IF;
 IF v_lot.auction_end_date IS NULL OR NOT isfinite(v_lot.auction_end_date)
 THEN RETURN jsonb_build_object('state','unavailable','reason','episode_close_unestablished'); END IF;
 v_url:=rtrim(v_lot.source_url,'/'); v_from:=v_lot.auction_end_date-interval '14 days';
 IF (SELECT count(*) FROM (SELECT e.id FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
   WHERE e.source IN ('bat','bringatrailer') AND e.source_url IN (v_url,v_url||'/')
    AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    AND v.status IS DISTINCT FROM 'merged' AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' LIMIT 2) aliases)<>1
 THEN RETURN jsonb_build_object('state','unavailable','reason','ambiguous_source_episode'); END IF;
 IF v_mode='recorded_input_reconstruction' THEN
  IF NOT p_request?'cutoff' OR p_request?|ARRAY['event_cutoff','recorded_cutoff']
  THEN RETURN jsonb_build_object('state','unavailable','reason','reconstruction_cutoff_required'); END IF;
  v_recorded_to:=(p_request->>'cutoff')::timestamptz;v_event_to:=least(v_recorded_to,v_lot.auction_end_date);
 ELSE
  IF p_request?'cutoff' OR ((p_request?|ARRAY['event_cutoff','recorded_cutoff']) AND v_hash IS NULL)
   OR (v_hash IS NOT NULL AND NOT p_request?&ARRAY['event_cutoff','recorded_cutoff'])
  THEN RETURN jsonb_build_object('state','unavailable','reason','pinned_evidence_cutoffs_required'); END IF;
  v_recorded_to:=coalesce((p_request->>'recorded_cutoff')::timestamptz,v_now);
  v_event_to:=coalesce((p_request->>'event_cutoff')::timestamptz,least(v_now,v_lot.auction_end_date));
 END IF;
 IF NOT isfinite(v_recorded_to) OR NOT isfinite(v_event_to) OR v_recorded_to>v_now
  OR v_event_to>least(v_recorded_to,v_lot.auction_end_date) OR v_event_to<v_from
 THEN RETURN jsonb_build_object('state','unavailable','reason','cutoff_outside_episode_window'); END IF;
 -- Cheap fixed-width/numeric guards precede URL patterns, hash serialization and quadratic state work.
 SELECT count(*),coalesce(sum(octet_length(source_url)),0),count(*) FILTER(WHERE bid_amount IS NOT NULL
   AND (bid_amount NOT BETWEEN -1000000000000000000::numeric AND 1000000000000000000::numeric OR scale(bid_amount)>6))
 INTO v_n,v_bytes,v_unsafe FROM (SELECT source_url,bid_amount FROM public.auction_comments
   WHERE auction_event_id=p_auction_event_id ORDER BY id LIMIT 5001) held;
 IF v_n>5000 THEN RETURN jsonb_build_object('state','unavailable','reason','comment_input_limit_exceeded','truncated',true); END IF;
 IF v_bytes>4194304 THEN RETURN jsonb_build_object('state','unavailable','reason','source_locator_size_exceeded','truncated',true); END IF;
 IF v_unsafe>0 THEN RETURN jsonb_build_object('state','unavailable','reason','bid_amount_representation_unsupported'); END IF;

 WITH held AS MATERIALIZED (
  SELECT c.id,c.vehicle_id,c.auction_event_id,c.comment_type,c.bid_amount,c.posted_at,c.created_at,
    c.external_identity_id,c.bat_comment_id,c.source_url,i.id AS keyed_identity,
    isfinite(c.posted_at) AND c.posted_at BETWEEN v_from AND v_event_to AS event_eligible,
    isfinite(c.created_at) AND c.created_at<=v_recorded_to AS recorded_eligible
  FROM public.auction_comments c LEFT JOIN public.external_identities i ON i.id=c.external_identity_id AND i.platform='bat'
  WHERE c.auction_event_id=p_auction_event_id ORDER BY c.id LIMIT 5001
 ), audit AS MATERIALIZED (
  SELECT count(*) FILTER(WHERE vehicle_id IS DISTINCT FROM v_lot.vehicle_id) AS parent_conflicts,
   count(*) FILTER(WHERE source_url IS NOT NULL AND (source_url!~'^https://(www[.])?bringatrailer[.]com/listing/[a-z0-9-]+/?(#comment-[0-9]+)?$'
     OR rtrim(regexp_replace(regexp_replace(source_url,'^https://www[.]','https://'),'#comment-[0-9]+$',''),'/')<>v_url)) AS locator_conflicts,
   count(*) FILTER(WHERE comment_type='bid' AND event_eligible AND recorded_eligible AND bid_amount<0) AS negative_amounts,
   count(*) FILTER(WHERE comment_type='bid' AND event_eligible AND recorded_eligible AND bid_amount>=0) AS eligible_bids
  FROM held
 ), bids AS MATERIALIZED (
  SELECT h.*,row_number() OVER(ORDER BY h.posted_at,coalesce(h.bat_comment_id,0),(h.id::text) COLLATE "C")::integer AS seq,
   coalesce('identity:'||keyed_identity::text,'unresolved_bid:'||id::text) AS entry_key
  FROM held h WHERE comment_type='bid' AND event_eligible AND recorded_eligible AND bid_amount>=0
   AND (SELECT parent_conflicts=0 AND locator_conflicts=0 AND negative_amounts=0 AND eligible_bids<=500 FROM audit)
 ), prices AS MATERIALIZED (
  SELECT b.*,max(b.bid_amount) OVER(ORDER BY seq) AS price FROM bids b
 ), book AS MATERIALIZED (
  SELECT current.seq,current.price AS running_price,prior.entry_key,prior.keyed_identity,max(prior.bid_amount) AS revealed_bid
  FROM prices current JOIN bids prior ON prior.seq<=current.seq
  GROUP BY current.seq,current.price,prior.entry_key,prior.keyed_identity
 ), aggregates AS MATERIALIZED (
  SELECT bk.seq,count(*) AS entrants,count(*) FILTER(WHERE bk.keyed_identity IS NOT NULL) AS identities,
    (array_agg(bk.revealed_bid ORDER BY bk.revealed_bid DESC))[2] AS second_best,
    count(*) FILTER(WHERE bk.revealed_bid>=bk.running_price*0.9) AS depth_90,
    count(*) FILTER(WHERE bk.revealed_bid>=bk.running_price*0.75) AS depth_75
  FROM book bk GROUP BY bk.seq
 ), states AS MATERIALIZED (
  SELECT p.*,a.entrants,a.identities,a.second_best,a.depth_90,a.depth_75,
    p.price-lag(p.price) OVER(ORDER BY p.seq) AS price_change FROM prices p JOIN aggregates a ON a.seq=p.seq
 ), selected AS MATERIALIZED (
  SELECT * FROM states WHERE v_selected IS NULL OR id=v_selected ORDER BY seq DESC LIMIT 1
 ), selected_book AS MATERIALIZED (
  SELECT x.*,count(*) OVER(ORDER BY revealed_bid DESC RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS depth_at_revealed_bid
  FROM book x WHERE x.seq=(SELECT seq FROM selected)
 ), snapshot AS MATERIALIZED (
  SELECT md5(jsonb_build_object('method','captured_bid_path','version',1,'lot',v_lot.id,'vehicle',v_lot.vehicle_id,
    'source_url',v_url,'recorded_close',v_lot.auction_end_date,'currency',v_lot.currency_code,'currency_source',v_lot.currency_source,
    'price_basis',v_lot.price_basis,'price_kind',v_lot.price_kind,'price_kind_source',v_lot.price_kind_source,
    'price_basis_conflict',v_lot.price_basis_conflict,'mode',v_mode,'event_cutoff',v_event_to,'recorded_cutoff',v_recorded_to,
    'held',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM held h),'[]'::jsonb))::text) AS hash
 )
 SELECT CASE
  WHEN a.parent_conflicts>0 OR a.locator_conflicts>0 THEN jsonb_build_object('state','unavailable','reason','conflicting_comment_source_relation')
  WHEN a.negative_amounts>0 THEN jsonb_build_object('state','unavailable','reason','negative_bid_amount')
  WHEN a.eligible_bids>500 THEN jsonb_build_object('state','unavailable','reason','bid_state_limit_exceeded','truncated',true)
  WHEN v_hash IS NOT NULL AND v_hash<>snap.hash THEN jsonb_build_object('state','unavailable','reason','evidence_snapshot_changed')
  WHEN v_selected IS NOT NULL AND NOT EXISTS(SELECT FROM selected) THEN jsonb_build_object('state','unavailable','reason','selected_bid_not_in_known_inputs')
  ELSE jsonb_build_object('state','partial','reason','retained_keyed_known_inputs_only','contract_version',1,
   'method_id','captured_bid_path','method_version',1,'folding_mode','on_read_no_stored_fold_writes',
   'auction_event_id',v_lot.id,'vehicle_id',v_lot.vehicle_id,'source_url',v_url||'/',
   'measured_at',v_now,'knowledge_mode',v_mode,'event_cutoff',v_event_to,'recorded_cutoff',v_recorded_to,
   'close_at_as_currently_recorded',v_lot.auction_end_date,'window_from',v_from,
   'window_basis','recorded_close_minus_14_days_not_observed_opening','historical_forecast_receipt',false,
   'final_sale_price_used_as_input',false,'complete_external_capture',false,'snapshot_hash',snap.hash,
   'limits',jsonb_build_object('source_rows',5000,'bid_states',500,'source_locator_bytes',4194304,'amount_absolute',1000000000000000000::text,'amount_scale',6),
   'units',jsonb_build_object('amounts','exact_numeric_decimal_strings','entries','platform_identity_or_one_unresolved_bid',
      'depth_90','entries_at_or_above_90_percent_of_running_high_bid','depth_75','entries_at_or_above_75_percent_of_running_high_bid',
      'seconds_to_close','seconds_from_posted_time_to_currently_recorded_close','willingness_to_pay','unmeasured_bid_is_a_lower_bound'),
   'amount_context',jsonb_build_object('basis','current_lot_fields_not_historical_qualification',
     'currency_state',CASE WHEN v_lot.currency_code~'^[A-Z]{3}$' AND nullif(btrim(v_lot.currency_source),'') IS NOT NULL THEN 'recorded_claim' ELSE 'unknown' END,
     'currency_code',v_lot.currency_code,'currency_source',v_lot.currency_source,'price_basis',v_lot.price_basis,
     'price_kind',v_lot.price_kind,'price_kind_source',v_lot.price_kind_source,'price_basis_conflict',v_lot.price_basis_conflict),
   'ordering','posted_at_then_native_comment_id_or_zero_then_comment_uuid_C',
   'summary',(SELECT jsonb_build_object('bid_count',count(*),'keyed_participant_count',count(DISTINCT keyed_identity),
     'unresolved_bid_entries',count(*) FILTER(WHERE keyed_identity IS NULL),'first_bid_at',min(posted_at),'last_bid_at',max(posted_at),
     'running_high_bid',max(bid_amount)::text,'minimum_bid',min(bid_amount)::text,
     'latest_bid',(SELECT bid_amount::text FROM bids ORDER BY seq DESC LIMIT 1),
     'trailing_window_anchor',v_event_to,
     'bids_in_60_minutes_to_event_cutoff',count(*) FILTER(WHERE posted_at>v_event_to-interval '60 minutes'),
     'bids_in_10_minutes_to_event_cutoff',count(*) FILTER(WHERE posted_at>v_event_to-interval '10 minutes')) FROM bids),
   'coverage',jsonb_build_object('keyed_source_rows',v_n,'eligible_bid_states',a.eligible_bids,
     'source_bid_marked_rows',(SELECT count(*) FROM held WHERE comment_type='bid'),
     'amount_without_bid_label',(SELECT count(*) FROM held WHERE bid_amount IS NOT NULL AND comment_type IS DISTINCT FROM 'bid'),
     'bid_marked_unknown_amounts',(SELECT count(*) FROM held WHERE comment_type='bid' AND bid_amount IS NULL),
     'bid_marked_unknown_event_time',(SELECT count(*) FROM held WHERE comment_type='bid' AND (posted_at IS NULL OR NOT isfinite(posted_at))),
     'bid_marked_unknown_recording_time',(SELECT count(*) FROM held WHERE comment_type='bid' AND (created_at IS NULL OR NOT isfinite(created_at))),
     'bids_outside_event_cutoff',(SELECT count(*) FROM held WHERE comment_type='bid' AND event_eligible IS FALSE),
     'posted_bids_recorded_after_cutoff',(SELECT count(*) FROM held WHERE comment_type='bid' AND event_eligible AND created_at>v_recorded_to),
     'eligible_bids_without_platform_key',(SELECT count(*) FROM bids WHERE keyed_identity IS NULL),
     'eligible_bids_with_other_platform_key',(SELECT count(*) FROM bids WHERE external_identity_id IS NOT NULL AND keyed_identity IS NULL),
     'unkeyed_source_rows','not_assessed'),
   'states',coalesce((SELECT jsonb_agg(jsonb_build_object('seq',s.seq,'bid_comment_id',s.id,
     'native_comment_id',s.bat_comment_id::text,'source_url',v_url||'/'||CASE WHEN s.bat_comment_id>0 THEN '#comment-'||s.bat_comment_id ELSE '' END,
     'source_locator_basis',CASE WHEN s.source_url IS NULL THEN 'typed_lot_relation_only' ELSE 'source_and_typed_lot_relation' END,
     'posted_at',s.posted_at,'db_recorded_at',s.created_at,'seconds_to_close',extract(epoch FROM v_lot.auction_end_date-s.posted_at),
     'amount',s.bid_amount::text,'price',s.price::text,'external_identity_id',s.keyed_identity,
     'price_change',s.price_change::text,'top_two_gap',(s.price-s.second_best)::text,
     'entries',s.entrants,'identities',s.identities,'unresolved_entries',s.entrants-s.identities,
     'second_best',s.second_best::text,'depth_90',s.depth_90,'depth_75',s.depth_75) ORDER BY s.seq) FROM states s),'[]'::jsonb),
   'selected_bid_comment_id',(SELECT id FROM selected),'selected_seq',(SELECT seq FROM selected),
   'selected_book_basis','posted_order_prefix_within_requested_known_inputs',
   'book',coalesce((SELECT jsonb_agg(jsonb_build_object('entry_key',x.entry_key,'external_identity_id',x.keyed_identity,
     'maximum_revealed_bid',x.revealed_bid::text,'depth_at_revealed_bid',x.depth_at_revealed_bid,
     'bid_count',support.bid_count,'first_bid_comment_id',support.first_bid_comment_id,
     'last_bid_comment_id',support.last_bid_comment_id,'highest_bid_comment_id',support.highest_bid_comment_id,
     'supporting_bid_comment_ids',support.ids)
     ORDER BY x.revealed_bid DESC,x.entry_key COLLATE "C") FROM selected_book x
     CROSS JOIN LATERAL(SELECT count(*) AS bid_count,(array_agg(b.id ORDER BY b.seq))[1] AS first_bid_comment_id,
       (array_agg(b.id ORDER BY b.seq DESC))[1] AS last_bid_comment_id,
       (array_agg(b.id ORDER BY b.seq) FILTER(WHERE b.bid_amount=x.revealed_bid))[1] AS highest_bid_comment_id,
       jsonb_agg(b.id ORDER BY b.seq) AS ids FROM bids b WHERE b.entry_key=x.entry_key AND b.seq<=x.seq) support),'[]'::jsonb))
 END INTO v_result FROM audit a CROSS JOIN snapshot snap;
 RETURN v_result;
END;
$bidpath$;
COMMENT ON FUNCTION public.lot_order_book_read(uuid,jsonb) IS
'Existing order-book owner: bounded on-read bid path and selected revealed-bid book from exact public BaT source rows with event and recording cutoffs, source keys, exact decimal strings and current lot amount qualifications. A bid is a lower bound, not latent willingness to pay. Reconstruction from current mutable testimony is not a historical forecast receipt. Legacy reader and stored folds unchanged; no source, fold or scheduling writes.';
REVOKE ALL ON FUNCTION public.lot_order_book_read(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lot_order_book_read(uuid,jsonb) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
