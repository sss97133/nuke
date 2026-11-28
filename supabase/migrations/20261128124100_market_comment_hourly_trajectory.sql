-- Extend the existing exact-episode comment owner with an opt-in UTC-hour trajectory.
-- No source, inference, fold, job, new store or privilege changes. Legacy projection and hashes stay unchanged.
BEGIN;
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval = interval '0'
  OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN '10s'
  ELSE current_setting('statement_timeout') END, true);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval = interval '0'
  OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN '2s'
  ELSE current_setting('lock_timeout') END, true);

DO $$ BEGIN
  IF to_regprocedure('public.popup_vehicle_intel(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Existing vehicle intelligence owner is required';
  END IF;
  IF to_regprocedure('public.popup_vehicle_intel(uuid,uuid,jsonb)') IS NULL
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.popup_vehicle_intel(uuid,uuid,jsonb)'))
      NOT IN ('d3048a22eafa1dccdcadac5d73069c1e','0dbd70280bdfd5fa95e8b2d2138275c6') THEN
    RAISE EXCEPTION 'Auction comment measurement reader differs from the reviewed body';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(
  p_vehicle_id uuid, p_auction_event_id uuid, p_request jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp SET TimeZone = 'UTC'
AS $surface$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_lot record;
  v_mode text := coalesce(p_request->>'knowledge_mode','current_recorded_state');
  v_filter text := coalesce(p_request->>'evidence_filter','all_discussion');
  v_offset integer := 0;
  v_hash text := p_request->>'snapshot_hash';
  v_event_to timestamptz;
  v_recorded_to timestamptz;
  v_from timestamptz;
  v_url text;
  v_aliases integer;
  v_result jsonb;
  v_value text;
  v_trajectory boolean := false;
  v_bucket timestamptz;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RETURN jsonb_build_object('state','unavailable','reason','invalid_measurement_request');
  END IF;
  IF p_vehicle_id IS NULL OR p_auction_event_id IS NULL
    OR EXISTS(SELECT FROM jsonb_object_keys(p_request) k WHERE k NOT IN
      ('knowledge_mode','cutoff','event_cutoff','recorded_cutoff','offset','snapshot_hash','evidence_filter','include_trajectory','evidence_bucket'))
    OR (p_request ? 'knowledge_mode' AND (jsonb_typeof(p_request->'knowledge_mode') <> 'string'
      OR v_mode NOT IN ('current_recorded_state','recorded_input_reconstruction')))
    OR (p_request ? 'evidence_filter' AND (jsonb_typeof(p_request->'evidence_filter') <> 'string'
      OR v_filter NOT IN ('all_discussion','text','media_only','no_captured_content')))
    OR (p_request ? 'include_trajectory' AND jsonb_typeof(p_request->'include_trajectory') <> 'boolean')
    OR (p_request ? 'offset' AND (jsonb_typeof(p_request->'offset') <> 'number'
      OR NOT pg_input_is_valid(p_request->>'offset','integer')))
    OR (p_request ? 'snapshot_hash' AND (jsonb_typeof(p_request->'snapshot_hash') <> 'string'
      OR v_hash !~ '^[0-9a-f]{32}$')) THEN
    RETURN jsonb_build_object('state','unavailable','reason','invalid_measurement_request');
  END IF;
  v_trajectory := coalesce((p_request->>'include_trajectory')::boolean,false);
  IF p_request ? 'evidence_bucket' AND NOT v_trajectory THEN
    RETURN jsonb_build_object('state','unavailable','reason','trajectory_required_for_bucket');
  END IF;
  v_offset := coalesce((p_request->>'offset')::integer,0);
  IF v_offset < 0 OR v_offset > 5000 OR (v_offset > 0 AND v_hash IS NULL) THEN
    RETURN jsonb_build_object('state','unavailable','reason','invalid_evidence_continuation');
  END IF;
  -- All clocks must be finite, explicitly zoned instants. No natural-language timestamp parsing.
  FOREACH v_value IN ARRAY ARRAY['cutoff','event_cutoff','recorded_cutoff','evidence_bucket'] LOOP
    IF p_request ? v_value AND (jsonb_typeof(p_request->v_value) <> 'string'
      OR p_request->>v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR NOT pg_input_is_valid(p_request->>v_value,'timestamptz')) THEN
      RETURN jsonb_build_object('state','unavailable','reason','invalid_cutoff');
    END IF;
  END LOOP;
  SELECT e.id,e.vehicle_id,e.source_url,e.auction_end_date INTO v_lot
  FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
  WHERE e.id=p_auction_event_id AND e.vehicle_id=p_vehicle_id AND e.source IN ('bat','bringatrailer')
    AND e.source_url ~ '^https://bringatrailer[.]com/listing/[a-z0-9-]+/?$'
    AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    AND v.status IS DISTINCT FROM 'merged' AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','unavailable','reason','unknown_or_ineligible_episode');
  END IF;
  IF v_lot.auction_end_date IS NULL OR NOT isfinite(v_lot.auction_end_date) THEN
    RETURN jsonb_build_object('state','unavailable','reason','episode_close_unestablished');
  END IF;
  v_url := rtrim(v_lot.source_url,'/');
  SELECT count(*) INTO v_aliases FROM (
    SELECT e.id FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
    WHERE e.source IN ('bat','bringatrailer') AND e.source_url IN (v_url,v_url||'/')
      AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND v.status IS DISTINCT FROM 'merged' AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    LIMIT 2
  ) aliases;
  IF v_aliases <> 1 THEN
    RETURN jsonb_build_object('state','unavailable','reason','ambiguous_source_episode');
  END IF;
  v_from := v_lot.auction_end_date-interval '14 days';
  IF v_mode='recorded_input_reconstruction' THEN
    IF NOT p_request ? 'cutoff' OR p_request ?| ARRAY['event_cutoff','recorded_cutoff'] THEN
      RETURN jsonb_build_object('state','unavailable','reason','reconstruction_cutoff_required');
    END IF;
    v_recorded_to := (p_request->>'cutoff')::timestamptz;
    v_event_to := least(v_recorded_to,v_lot.auction_end_date);
  ELSE
    IF p_request ? 'cutoff' OR ((p_request ?| ARRAY['event_cutoff','recorded_cutoff']) AND v_hash IS NULL)
      OR (v_hash IS NOT NULL AND NOT p_request ?& ARRAY['event_cutoff','recorded_cutoff']) THEN
      RETURN jsonb_build_object('state','unavailable','reason','pinned_evidence_cutoffs_required');
    END IF;
    v_recorded_to := coalesce((p_request->>'recorded_cutoff')::timestamptz,v_now);
    v_event_to := coalesce((p_request->>'event_cutoff')::timestamptz,least(v_now,v_lot.auction_end_date));
  END IF;
  IF NOT isfinite(v_recorded_to) OR NOT isfinite(v_event_to) OR v_recorded_to>v_now
    OR v_event_to>least(v_recorded_to,v_lot.auction_end_date) OR v_event_to<v_from THEN
    RETURN jsonb_build_object('state','unavailable','reason','cutoff_outside_episode_window');
  END IF;

  v_bucket := (p_request->>'evidence_bucket')::timestamptz;
  IF v_bucket IS NOT NULL AND (NOT isfinite(v_bucket) OR v_bucket<>date_trunc('hour',v_bucket)
    OR v_bucket>v_event_to OR v_bucket+interval '1 hour'<=v_from) THEN
    RETURN jsonb_build_object('state','unavailable','reason','invalid_trajectory_bucket');
  END IF;

  WITH held AS MATERIALIZED (
    SELECT c.id,c.vehicle_id,c.auction_event_id,c.comment_type,c.bid_amount,c.posted_at,c.created_at,
      c.is_seller,c.external_identity_id,c.comment_text,c.media_urls,c.bat_comment_id,c.source_url
    FROM public.auction_comments c WHERE c.auction_event_id=p_auction_event_id
    ORDER BY c.id LIMIT 5001
  ), audit AS MATERIALIZED (
    SELECT count(*) AS n,coalesce(sum(octet_length(comment_text)),0) AS text_bytes,
      coalesce(sum(cardinality(media_urls)),0) AS media_references,
      count(*) FILTER(WHERE vehicle_id IS DISTINCT FROM p_vehicle_id) AS parent_conflicts,
      count(*) FILTER(WHERE source_url IS NOT NULL AND (source_url !~ '^https://(www[.])?bringatrailer[.]com/listing/[a-z0-9-]+/?(#comment-[0-9]+)?$'
        OR rtrim(regexp_replace(regexp_replace(source_url,'^https://www[.]','https://'),'#comment-[0-9]+$',''),'/')<>v_url)) AS locator_conflicts
    FROM held
  ), measured AS MATERIALIZED (
    SELECT h.*,isfinite(h.posted_at) AND h.posted_at BETWEEN v_from AND v_event_to AS event_eligible,
      isfinite(h.created_at) AND h.created_at<=v_recorded_to AS recorded_eligible,
      h.bid_amount IS NULL AND h.comment_type IN
        ('question','answer','observation','seller_update','seller_response','expert_opinion') AS discussion,
      coalesce(h.comment_text ~ '[^[:space:]]',false) AS has_text,
      (SELECT count(*) FROM unnest(h.media_urls) u WHERE nullif(btrim(u),'') IS NOT NULL) AS media_links,
      char_length(h.comment_text) AS characters,
      regexp_count(h.comment_text,'[^[:space:]]+') AS whitespace_tokens,
      regexp_count(h.comment_text,'[?]') AS question_marks,
      h.comment_text ~* 'https?://' AS url_marker,
      h.comment_text ~* '[0-9]+([.][0-9]+)?[[:space:]]*(hp|bhp|psi|nm|kw|rpm|miles|mi|km|liters|litres|lbs|lb)([^[:alpha:]]|$)' AS numeric_unit_marker,
      i.id AS keyed_identity
    FROM held h LEFT JOIN public.external_identities i ON i.id=h.external_identity_id AND i.platform='bat'
    WHERE (SELECT n<=5000 AND text_bytes<=4194304 AND media_references<=10000
      AND parent_conflicts=0 AND locator_conflicts=0 FROM audit)
  ), eligible AS MATERIALIZED (
    SELECT * FROM measured WHERE event_eligible AND recorded_eligible AND discussion
  ), hourly AS MATERIALIZED (
    SELECT date_trunc('hour',posted_at) AS bucket_start,count(*) AS discussion_entries,
      count(*) FILTER(WHERE has_text) AS text_entries,
      count(*) FILTER(WHERE NOT has_text AND media_links>0) AS media_only_entries,
      count(*) FILTER(WHERE NOT has_text AND media_links=0) AS no_captured_content_entries,
      coalesce(sum(whitespace_tokens) FILTER(WHERE has_text),0) AS whitespace_tokens,
      count(*) FILTER(WHERE has_text AND question_marks>0) AS question_mark_entries,
      count(*) FILTER(WHERE has_text AND url_marker) AS url_marker_entries,
      count(*) FILTER(WHERE has_text AND numeric_unit_marker) AS numeric_unit_marker_entries,
      count(*) FILTER(WHERE is_seller IS TRUE) AS seller_flagged_entries,
      count(*) FILTER(WHERE is_seller IS NULL) AS unknown_seller_flag_entries,
      count(DISTINCT keyed_identity) AS keyed_participant_count,
      count(*) FILTER(WHERE keyed_identity IS NULL) AS unkeyed_participant_entries
    FROM eligible WHERE v_trajectory GROUP BY date_trunc('hour',posted_at)
  ), bucket_windows AS MATERIALIZED (
    SELECT b AS bucket_start,greatest(b,v_from) AS window_start,
      least(b+interval '1 hour',v_event_to) AS window_end,
      extract(epoch FROM least(b+interval '1 hour',v_event_to)-greatest(b,v_from)) AS window_seconds
    FROM generate_series(date_trunc('hour',v_from),date_trunc('hour',v_event_to),interval '1 hour') b
    WHERE v_trajectory
  ), trajectory AS MATERIALIZED (
    SELECT w.*,coalesce(h.discussion_entries,0) AS discussion_entries,
      coalesce(h.text_entries,0) AS text_entries,coalesce(h.media_only_entries,0) AS media_only_entries,
      coalesce(h.no_captured_content_entries,0) AS no_captured_content_entries,
      coalesce(h.whitespace_tokens,0) AS whitespace_tokens,
      coalesce(h.question_mark_entries,0) AS question_mark_entries,
      coalesce(h.url_marker_entries,0) AS url_marker_entries,
      coalesce(h.numeric_unit_marker_entries,0) AS numeric_unit_marker_entries,
      coalesce(h.seller_flagged_entries,0) AS seller_flagged_entries,
      coalesce(h.unknown_seller_flag_entries,0) AS unknown_seller_flag_entries,
      coalesce(h.keyed_participant_count,0) AS keyed_participant_count,
      coalesce(h.unkeyed_participant_entries,0) AS unkeyed_participant_entries,
      round(coalesce(h.discussion_entries,0)*3600.0/nullif(w.window_seconds,0),6) AS entries_per_window_hour,
      sum(coalesce(h.discussion_entries,0)) OVER(ORDER BY w.bucket_start) AS cumulative_discussion_entries
    FROM bucket_windows w LEFT JOIN hourly h USING(bucket_start)
  ), snapshot AS MATERIALIZED (
    SELECT md5((jsonb_build_object('method','auction_comment_surface','version',1,'vehicle',p_vehicle_id,
      'lot',p_auction_event_id,'url',v_url,'recorded_close',v_lot.auction_end_date,'mode',v_mode,
      'event_cutoff',v_event_to,'recorded_cutoff',v_recorded_to,'filter',v_filter,
      'source_rows',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM measured m),'[]'::jsonb))
      ||CASE WHEN v_trajectory THEN jsonb_build_object('trajectory_method','auction_comment_hourly_v1')
        ELSE '{}'::jsonb END)::text) AS hash
  ), filtered AS MATERIALIZED (
    SELECT *,row_number() OVER(ORDER BY posted_at,id) AS ordinal FROM eligible
    WHERE (v_filter='all_discussion' OR (v_filter='text' AND has_text)
      OR (v_filter='media_only' AND NOT has_text AND media_links>0)
      OR (v_filter='no_captured_content' AND NOT has_text AND media_links=0))
      AND (v_bucket IS NULL OR date_trunc('hour',posted_at)=v_bucket)
  )
  SELECT CASE
    WHEN a.parent_conflicts>0 OR a.locator_conflicts>0 THEN
      jsonb_build_object('state','unavailable','reason','conflicting_comment_source_relation')
    WHEN a.n>5000 THEN jsonb_build_object('state','unavailable','reason','comment_input_limit_exceeded','truncated',true)
    WHEN a.text_bytes>4194304 OR a.media_references>10000 THEN
      jsonb_build_object('state','unavailable','reason','comment_input_size_exceeded','truncated',true)
    WHEN v_hash IS NOT NULL AND v_hash<>s.hash THEN
      jsonb_build_object('state','unavailable','reason','evidence_snapshot_changed')
    ELSE jsonb_build_object('contract_version',1,'state','partial','reason','retained_keyed_inputs_only',
      'method_id','auction_comment_surface','method_version',1,'knowledge_mode',v_mode,
      'vehicle_id',p_vehicle_id,'auction_event_id',p_auction_event_id,'source_url',v_url||'/',
      'measured_at',v_now,'event_cutoff',v_event_to,'recorded_cutoff',v_recorded_to,
      'close_at_as_currently_recorded',v_lot.auction_end_date,'window_from',v_from,
      'window_basis','recorded_close_minus_14_days_not_observed_opening',
      'historical_forecast_receipt',false,'complete_external_capture',false,'truncated',false,
      'units',jsonb_build_object('volume','retained_source_entries','tokens','whitespace_separated_runs',
        'characters','postgres_character_count','markers','literal_pattern_presence',
        'media','nonblank_stored_media_references_not_verified_assets',
        'expertise','unmeasured','literacy','unmeasured'),
      'pattern_profiles',jsonb_build_object('tokens','posix_nonspace_runs_v1',
        'questions','literal_ascii_question_mark_v1','urls','http_or_https_marker_v1',
        'numeric_units','english_automotive_unit_marker_v1'),
      'coverage',jsonb_build_object('keyed_source_rows',a.n,
        'unknown_event_time',(SELECT count(*) FROM measured WHERE posted_at IS NULL OR NOT isfinite(posted_at)),
        'unknown_recording_time',(SELECT count(*) FROM measured WHERE created_at IS NULL OR NOT isfinite(created_at)),
        'outside_event_window',(SELECT count(*) FROM measured WHERE event_eligible IS FALSE),
        'recorded_after_cutoff',(SELECT count(*) FROM measured WHERE event_eligible AND created_at>v_recorded_to),
        'source_bid_marked_rows',(SELECT count(*) FROM measured WHERE comment_type='bid' OR bid_amount IS NOT NULL),
        'other_source_labels',(SELECT count(*) FROM measured WHERE discussion IS NOT TRUE AND comment_type IS DISTINCT FROM 'bid' AND bid_amount IS NULL),
        'discussion_posted_by_cutoff',(SELECT count(*) FROM measured WHERE discussion AND event_eligible),
        'discussion_recorded_by_cutoff',(SELECT count(*) FROM eligible),
        'unkeyed_source_rows','not_assessed','semantic_classification','not_assessed'),
      'features',(SELECT jsonb_build_object('discussion_entries',count(*),
        'text_entries',count(*) FILTER(WHERE has_text),
        'media_only_entries',count(*) FILTER(WHERE NOT has_text AND media_links>0),
        'no_captured_text_or_media_entries',count(*) FILTER(WHERE NOT has_text AND media_links=0),
        'whitespace_tokens',coalesce(sum(whitespace_tokens) FILTER(WHERE has_text),0),
        'median_whitespace_tokens',percentile_cont(0.5) WITHIN GROUP(ORDER BY whitespace_tokens) FILTER(WHERE has_text),
        'question_mark_entries',count(*) FILTER(WHERE has_text AND question_marks>0),
        'question_mark_count',coalesce(sum(question_marks) FILTER(WHERE has_text),0),
        'url_marker_entries',count(*) FILTER(WHERE has_text AND url_marker),
        'numeric_unit_marker_entries',count(*) FILTER(WHERE has_text AND numeric_unit_marker),
        'seller_flagged_entries',count(*) FILTER(WHERE is_seller IS TRUE),
        'unknown_seller_flag_entries',count(*) FILTER(WHERE is_seller IS NULL),
        'keyed_participant_count',count(DISTINCT keyed_identity),
        'unkeyed_participant_entries',count(*) FILTER(WHERE keyed_identity IS NULL)) FROM eligible),
      'evidence',jsonb_build_object('snapshot_hash',s.hash,'offset',v_offset,'limit',20,'filter',v_filter,
        'matching_entries',(SELECT count(*) FROM filtered),
        'has_more',(SELECT count(*)>v_offset+20 FROM filtered),
        'next_offset',CASE WHEN (SELECT count(*)>v_offset+20 FROM filtered) THEN v_offset+20 END,
        'contributors',coalesce((SELECT jsonb_agg(jsonb_build_object('comment_id',f.id,
          'auction_event_id',f.auction_event_id,'vehicle_id',f.vehicle_id,'native_comment_id',f.bat_comment_id,
          'source_url',v_url||'/'||CASE WHEN f.bat_comment_id>0 THEN '#comment-'||f.bat_comment_id ELSE '' END,
          'source_locator_basis',CASE WHEN f.source_url IS NULL THEN 'typed_lot_relation_only' ELSE 'source_and_typed_lot_relation' END,
          'source_comment_type',f.comment_type,'is_seller',f.is_seller,'posted_at',f.posted_at,'db_recorded_at',f.created_at,
          'characters',CASE WHEN f.has_text THEN f.characters END,
          'whitespace_tokens',CASE WHEN f.has_text THEN f.whitespace_tokens END,
          'question_marks',CASE WHEN f.has_text THEN f.question_marks END,
          'url_marker',CASE WHEN f.has_text THEN f.url_marker END,
          'numeric_unit_marker',CASE WHEN f.has_text THEN f.numeric_unit_marker END,
          'external_identity_id',f.keyed_identity,'media_reference_count',f.media_links,
          'excerpt',CASE WHEN f.has_text THEN left(f.comment_text,600) END,
          'excerpt_truncated',coalesce(f.characters>600,false)) ORDER BY f.ordinal)
          FROM filtered f WHERE f.ordinal>v_offset AND f.ordinal<=v_offset+20),'[]'::jsonb)))
      ||CASE WHEN v_trajectory THEN jsonb_build_object('trajectory',jsonb_build_object(
        'contract_version',1,'method_id','auction_comment_hourly_v1','bucket_unit','UTC_hour',
        'nominal_bucket_seconds',3600,'event_time_basis','posted_at',
        'count_unit','retained_eligible_discussion_entries',
        'rate_basis','eligible_window_seconds_not_observed_capture_uptime',
        'zero_basis','zero_retained_eligible_entries_not_zero_external_activity',
        'participant_basis','distinct_keyed_platform_identities_per_bucket_not_additive_people',
        'buckets',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.bucket_start) FROM trajectory t),'[]'::jsonb)))
      ELSE '{}'::jsonb END
    END INTO v_result FROM audit a CROSS JOIN snapshot s;
  IF v_trajectory AND v_result->>'state'='partial' THEN
    v_result := jsonb_set(v_result,'{evidence,bucket_start}',coalesce(to_jsonb(v_bucket),'null'::jsonb));
  END IF;
  RETURN v_result;
END;
$surface$;

COMMENT ON FUNCTION public.popup_vehicle_intel(uuid,uuid,jsonb) IS
'Existing exact BaT episode owner: bounded SQL surface measurements and optional UTC-hour discussion trajectory with same-population keyed source pages. Hour rates use clipped eligible-window seconds, not observed opening or capture uptime; zeros are retained counts only. Bucket evidence retains the source population hash. Current read or recorded-input reconstruction, never a historical forecast receipt. Literal patterns are not sentiment, expertise or literacy. Legacy no-opt-in projection and one-argument owner unchanged; no source, inference, fold or job writes. Invoker and caller timeouts preserved.';
REVOKE ALL ON FUNCTION public.popup_vehicle_intel(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popup_vehicle_intel(uuid,uuid,jsonb) TO anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
