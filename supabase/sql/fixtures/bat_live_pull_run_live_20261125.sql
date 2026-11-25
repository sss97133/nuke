-- Live body of public.bat_live_pull_run(integer,boolean), read with pg_get_functiondef on 2026-11-25 (sha256 base64
-- okR58VUumLi/ey0z4KTj7bZ7iP0GDQuVPFTlGCiFdhg=). Fixture for test_bat_live_pull_relive_fence.sql; not a migration.
CREATE OR REPLACE FUNCTION public.bat_live_pull_run(p_lots integer DEFAULT NULL::integer, p_force_sync boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src      uuid;
  v_cfg      jsonb;
  v_last     jsonb;
  v_now      timestamptz := now();
  v_samples  jsonb;
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
  v_inflight integer := 0;
  v_slots    integer;
  v_ms       integer;
  v_key      text := get_service_role_key_for_cron();
  v_base     text := get_service_url();
  v_cad      interval;
  v_reserve  integer;
  v_lots     integer;
  v_closing  integer;
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
  v_pause_ms := coalesce(CASE WHEN v_cfg ->> 'pause_run_p50_ms' ~ '^\d{1,6}$' THEN (v_cfg ->> 'pause_run_p50_ms')::integer END, 15000);
  v_window   := make_interval(hours => coalesce(CASE WHEN v_cfg ->> 'priority_window_hours' ~ '^\d{1,6}$' THEN (v_cfg ->> 'priority_window_hours')::integer END, 48));
  v_last     := coalesce(v_cfg -> 'last_run', '{}'::jsonb);
  -- C1: slots per run held for lots never dispatched (next_poll_at IS NULL), so lots beyond the priority window
  -- get their first read instead of waiting for the window to have fewer than p_lots due lots (it never does at peak).
  -- Slots per run come from live_pull.lots_per_run (default 6); p_lots overrides only when passed. Closing-window lots
  -- take at most live_pull.closing_slots (default 1): the native stream covers them, and spending every slot on them
  -- starved the hourly/daily cadences (2026-10-05: 220/220 closing lots took HTML slots; the check failed from 10Z).
  v_lots     := greatest(coalesce(p_lots, CASE WHEN v_cfg ->> 'lots_per_run' ~ '^\d{1,6}$' THEN (v_cfg ->> 'lots_per_run')::integer END, 6), 0);
  v_closing  := least(greatest(coalesce(CASE WHEN v_cfg ->> 'closing_slots' ~ '^\d{1,6}$' THEN (v_cfg ->> 'closing_slots')::integer END, 1), 0), v_lots);
  v_reserve  := least(coalesce(CASE WHEN v_cfg ->> 'reserve_first_read' ~ '^\d{1,6}$' THEN (v_cfg ->> 'reserve_first_read')::integer END, 1), v_lots);

  -- 1. Account the previous passes. The reader upserts the lot's auction_events row on every read.
  FOR r IN
    SELECT m.id, m.vehicle_id, m.last_synced_at, m.last_comment_count,
           m.external_auction_url, e.vehicle_id AS read_vehicle_id,
           e.updated_at AS read_at, e.auction_end_date AS read_end, e.outcome AS read_outcome
    FROM monitored_auctions m
    LEFT JOIN LATERAL (
      SELECT a.vehicle_id, a.updated_at, a.auction_end_date, a.outcome FROM auction_events a
      WHERE a.vehicle_id = coalesce((
        SELECT native.vehicle_id FROM public.vehicle_observations native
        JOIN public.observation_sources provenance ON provenance.id=native.source_id AND provenance.slug='bat'
        JOIN public.vehicles locator ON locator.id=m.vehicle_id
        JOIN public.vehicles canonical ON canonical.id=native.vehicle_id AND canonical.deleted_at IS NULL
        WHERE native.id=CASE WHEN m.stream_state->>'last_observation_id'
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (m.stream_state->>'last_observation_id')::uuid END
          AND native.extraction_method='bat_public_live_v1' AND native.is_superseded IS NOT TRUE
          AND native.vehicle_id IS DISTINCT FROM m.vehicle_id
          AND native.vehicle_match_signals->>'monitor_vehicle_id'=m.vehicle_id::text
          AND native.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native.vehicle_match_signals->>'source_url_match'='true'
          AND locator.deleted_at IS NULL AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id=native.vehicle_id
            AND e.source_platform='bat' AND e.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/'))
          AND NOT EXISTS (SELECT 1 FROM public.vehicle_events other_event WHERE other_event.source_platform='bat'
            AND lower(substring(other_event.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
            AND other_event.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
            AND other_event.vehicle_id IS DISTINCT FROM native.vehicle_id)
          AND NOT EXISTS (SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
              AND other_lot.duplicate_of IS NULL
              AND other_lot.vehicle_id IS DISTINCT FROM native.vehicle_id)
      ),m.vehicle_id) AND a.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
      ORDER BY a.updated_at DESC LIMIT 1
    ) e ON true
    WHERE m.source_id = v_src
      AND m.vehicle_id IS NOT NULL
      AND m.last_synced_at > v_now - interval '6 hours'
      AND (m.last_comment_synced_at IS NULL OR m.last_comment_synced_at < m.last_synced_at)
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    IF r.read_at >= r.last_synced_at THEN
      SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.read_vehicle_id
        AND c.source_url IN (rtrim(r.external_auction_url,'/'),rtrim(r.external_auction_url,'/')||'/');
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

  -- 2a. Slots this run: lots_per_run minus the lots dispatched in the last 150 s (the reader's gateway limit) and not
  --     yet read. Until 2026-10-13 one such lot skipped the whole pass; now it costs one slot for at most 150 s, and
  --     the cap on concurrent reads is the same. In-flight lots are not due (see the dispatch query).
  SELECT count(*) INTO v_inflight
  FROM monitored_auctions m
  WHERE m.source_id = v_src
    AND m.last_synced_at > v_now - interval '150 seconds'
    AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                      AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                      AND e.updated_at >= m.last_synced_at);
  v_slots   := greatest(v_lots - v_inflight, 0);
  v_closing := least(v_closing, v_slots);
  v_reserve := least(v_reserve, v_slots);
  IF v_slots = 0 AND v_lots > 0 THEN
    v_skip := format('all %s slots in flight', v_lots);
  END IF;

  -- 2b. The pause rule: this function's own wall time, the median of the last 10 runs' samples (live_pull.run_samples,
  --     [run_at_ms, run_ms] pairs written at the end of each run), against live_pull.pause_run_p50_ms (default 15000).
  --     A run that errors leaves no sample. The pg_net REST probe this replaces measured the pg_net worker's batch wait,
  --     not REST (header, WHY 1).
  v_samples := coalesce(v_cfg -> 'run_samples', '[]'::jsonb);
  SELECT array_agg((s ->> 1)::numeric ORDER BY (s ->> 1)::numeric) INTO v_lat
  FROM jsonb_array_elements(v_samples) s
  WHERE jsonb_typeof(s) = 'array' AND (s ->> 1) ~ '^\d{1,9}$';
  IF coalesce(array_length(v_lat, 1), 0) >= 3 THEN
    v_p50 := v_lat[(array_length(v_lat, 1) + 1) / 2];
    IF v_p50 > v_pause_ms THEN
      v_skip := coalesce(v_skip || '; ', '') || format('paused: run p50 %s ms over the last %s runs', round(v_p50), array_length(v_lat, 1));
    END IF;
  END IF;
  -- A clock is never a terminal source event. Retire only qualified same-lot outcomes.
  -- Rows lock in id order and a row another transaction holds is skipped (as the dispatch does), so this run cannot
  -- deadlock against job 500 or the stream workers; a skipped row is retired by a later minute.
  UPDATE monitored_auctions m SET is_live=false
  WHERE m.id IN (
    SELECT m2.id FROM monitored_auctions m2
    WHERE m2.source_id=v_src AND m2.is_live AND (EXISTS (
      SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m2.vehicle_id
        WHERE native_receipt.id=nullif(m2.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m2.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m2.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m2.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))
    ORDER BY m2.id FOR UPDATE OF m2 SKIP LOCKED);

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
        AND (v.platform_source = 'bringatrailer' OR (
        /* canonical-bat-monitor-v1 */
        v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
        AND v.origin_metadata->>'platform'='bringatrailer'
        AND v.origin_metadata->>'source'='bat_auctions_page'
        AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
        -- Native inventory identity, not a freshness clock: unchanged rows keep last_sync.
        AND CASE WHEN pg_input_is_valid(v.origin_metadata->>'last_sync','timestamp with time zone')
          THEN (v.origin_metadata->>'last_sync')::timestamptz<=now()+interval '1 minute'
          ELSE false END
        AND EXISTS (SELECT 1 FROM public.vehicle_events current_episode
          WHERE current_episode.vehicle_id=v.id AND current_episode.source_platform='bat'
            AND current_episode.event_type='auction' AND current_episode.event_status IN ('active','live')
            AND rtrim(current_episode.source_url,'/')=rtrim(v.listing_url,'/'))
        AND NOT EXISTS (SELECT 1 FROM public.auction_events terminal
          WHERE terminal.vehicle_id=v.id AND rtrim(terminal.source_url,'/')=rtrim(v.listing_url,'/')
            AND terminal.outcome IN ('sold','reserve_not_met','cancelled'))
      ))
        AND v.deleted_at IS NULL
        AND CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END > v_now - interval '24 hours'
        AND v.listing_url ~ '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+'
        AND NOT (EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = v.id
                        AND rtrim(a.source_url, '/') = rtrim(v.listing_url, '/')
                        AND a.outcome IN ('sold', 'reserve_not_met')) OR EXISTS (
      SELECT 1 FROM public.monitored_auctions closed_monitor
      WHERE closed_monitor.source_id=v_src
        AND closed_monitor.external_auction_id=substring(v.listing_url from '/listing/([^/?]+)')
        AND closed_monitor.vehicle_id=v.id
        AND closed_monitor.external_auction_url IN (rtrim(v.listing_url,'/'),rtrim(v.listing_url,'/')||'/')
        AND EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=closed_monitor.vehicle_id
        WHERE native_receipt.id=nullif(closed_monitor.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM closed_monitor.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=closed_monitor.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(closed_monitor.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id))))
    ) l
    ORDER BY l.slug   -- stable lock order for the upsert
    ON CONFLICT (source_id, external_auction_id) DO UPDATE
    SET is_live = true, vehicle_id = EXCLUDED.vehicle_id, auction_end_time = greatest(m.auction_end_time, EXCLUDED.auction_end_time),
        external_auction_url = EXCLUDED.external_auction_url, priority = EXCLUDED.priority
    WHERE (m.is_live, m.vehicle_id, m.auction_end_time, m.priority)
          IS DISTINCT FROM (true, EXCLUDED.vehicle_id, greatest(m.auction_end_time, EXCLUDED.auction_end_time), EXCLUDED.priority);

  END IF;

  -- Reconcile known current-cache lots that never acquired a monitor. The
  -- canonical parent/native-post binding is required; board status and clock
  -- expiry cannot hide an unresolved source result from the existing reader.
  INSERT INTO monitored_auctions AS m
    (source_id,external_auction_id,external_auction_url,vehicle_id,
     auction_end_time,is_live,current_bid_cents,priority)
  SELECT DISTINCT ON (substring(e.source_url from '/listing/([^/?]+)'))
    v_src,substring(e.source_url from '/listing/([^/?]+)'),e.source_url,e.vehicle_id,
    e.ended_at,true,coalesce(round(e.current_price*100)::bigint,0),2
  FROM vehicle_events e JOIN vehicles v ON v.id=e.vehicle_id
  WHERE e.source_platform='bat' AND e.event_type='auction'
    AND e.ended_at>v_now-interval '24 hours' AND e.ended_at<=v_now+interval '15 minutes'
    AND v.deleted_at IS NULL AND (v.platform_source = 'bringatrailer' OR (
        /* canonical-bat-monitor-v1 */
        v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
        AND v.origin_metadata->>'platform'='bringatrailer'
        AND v.origin_metadata->>'source'='bat_auctions_page'
        AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
        -- Native inventory identity, not a freshness clock: unchanged rows keep last_sync.
        AND CASE WHEN pg_input_is_valid(v.origin_metadata->>'last_sync','timestamp with time zone')
          THEN (v.origin_metadata->>'last_sync')::timestamptz<=now()+interval '1 minute'
          ELSE false END
        AND EXISTS (SELECT 1 FROM public.vehicle_events current_episode
          WHERE current_episode.vehicle_id=v.id AND current_episode.source_platform='bat'
            AND current_episode.event_type='auction' AND current_episode.event_status IN ('active','live')
            AND rtrim(current_episode.source_url,'/')=rtrim(v.listing_url,'/'))
        AND NOT EXISTS (SELECT 1 FROM public.auction_events terminal
          WHERE terminal.vehicle_id=v.id AND rtrim(terminal.source_url,'/')=rtrim(v.listing_url,'/')
            AND terminal.outcome IN ('sold','reserve_not_met','cancelled'))
      ))
    AND v.origin_metadata->>'source'='bat_auctions_page'
    AND v.origin_metadata->>'external_id' ~ '^\d{4,}$'
    AND rtrim(v.listing_url,'/')=rtrim(e.source_url,'/')
    AND substring(e.source_url from '/listing/([^/?]+)') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM auction_events a WHERE a.vehicle_id=e.vehicle_id
      AND a.source_url IN (rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
      AND a.outcome IN ('sold','reserve_not_met','cancelled'))
  ORDER BY substring(e.source_url from '/listing/([^/?]+)'),e.updated_at DESC,e.vehicle_id LIMIT 5000
  ON CONFLICT(source_id,external_auction_id) DO NOTHING;

  -- Recover recent clock-retired monitors independently of HTML/board gates.
  -- The board's sale_status may already be not_sold because the clock expired;
  -- only a qualified same-source outcome is allowed to terminate capture.
  UPDATE monitored_auctions m SET is_live=true
  WHERE m.id IN (
    SELECT m2.id FROM monitored_auctions m2 JOIN vehicles v ON v.id=m2.vehicle_id
    WHERE m2.source_id=v_src AND NOT m2.is_live
      AND v.deleted_at IS NULL
      AND v.origin_metadata->>'source'='bat_auctions_page'
      AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]*$'
      AND rtrim(v.listing_url,'/')=rtrim(m2.external_auction_url,'/')
      AND m2.auction_end_time>v_now-interval '24 hours'
      AND m2.auction_end_time<=v_now+interval '15 minutes'
      AND NOT (EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m2.vehicle_id
        WHERE native_receipt.id=nullif(m2.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m2.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m2.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m2.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))
    ORDER BY m2.id FOR UPDATE OF m2 SKIP LOCKED);

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
               -- Known inventory price change; one existing-slot attempt per retained source clock.
               OR (m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.last_synced_at <= v_now - interval '150 seconds'
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND EXISTS (
                     SELECT 1 FROM public.vehicles locator
                     JOIN public.listing_page_snapshots inventory ON inventory.id=CASE
                       WHEN pg_input_is_valid(locator.origin_metadata->>'source_snapshot_id','uuid')
                       THEN (locator.origin_metadata->>'source_snapshot_id')::uuid END
                     JOIN public.vehicle_observations receipt ON receipt.id=CASE
                       WHEN pg_input_is_valid(m.stream_state->>'last_observation_id','uuid')
                       THEN (m.stream_state->>'last_observation_id')::uuid END
                     JOIN public.vehicles canonical ON canonical.id=receipt.vehicle_id
                     JOIN public.auction_events_canonical captured ON captured.vehicle_id=canonical.id
                       AND captured.source='bat'
                       AND captured.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                     WHERE locator.id=m.vehicle_id AND locator.deleted_at IS NULL
                       AND locator.merged_into_vehicle_id IS NULL AND locator.status IS DISTINCT FROM 'merged'
                       AND canonical.deleted_at IS NULL AND canonical.merged_into_vehicle_id IS NULL
                       AND canonical.status IS DISTINCT FROM 'merged'
                       AND m.external_auction_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
                       AND locator.listing_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND locator.origin_metadata->>'source'='bat_auctions_page'
                       AND locator.origin_metadata->>'platform'='bringatrailer'
                       AND locator.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
                       AND inventory.platform='bat' AND inventory.success AND inventory.http_status=200
                       AND inventory.listing_url IN('https://bringatrailer.com/auctions','https://bringatrailer.com/auctions/')
                       AND inventory.fetched_at=CASE WHEN pg_input_is_valid(locator.origin_metadata->>'source_read_at','timestamp with time zone')
                         THEN (locator.origin_metadata->>'source_read_at')::timestamptz END
                       AND inventory.fetched_at>m.last_synced_at AND inventory.fetched_at<=v_now
                       AND receipt.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid
                       AND receipt.extraction_method='bat_public_live_v1' AND receipt.is_superseded IS NOT TRUE
                       AND receipt.structured_data->>'projection_error' IS NULL
                       AND receipt.structured_data->>'native_post_id'=locator.origin_metadata->>'external_id'
                       AND receipt.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND (receipt.vehicle_id=m.vehicle_id OR (
                         receipt.vehicle_match_signals->>'monitor_vehicle_id'=m.vehicle_id::text
                         AND receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
                         AND receipt.vehicle_match_signals->>'source_url_match'='true') OR (
                         -- A sanctioned correction preserves original capture signals.
                         -- Prove that lineage separately; never reinterpret them as lot_slug.
                         receipt.merged_from_vehicle_id=m.vehicle_id
                         AND receipt.vehicle_match_signals->>'binding'='bat_auctions_page'
                         AND receipt.vehicle_match_signals->>'source_url_match'='true'
                         AND receipt.raw_source_ref='bat:public-live:post:'||(locator.origin_metadata->>'external_id')
                         AND captured.raw_data#>>'{link_correction,canonical_event_id}'=captured.id::text
                         AND captured.raw_data#>>'{link_correction,native_post_id}'=locator.origin_metadata->>'external_id'
                         AND nullif(captured.raw_data#>>'{link_correction,run_id}','') IS NOT NULL
                         AND (receipt.auction_event_id IS NULL OR receipt.auction_event_id=captured.id)
                         AND (receipt.structured_data->>'auction_event_id' IS NULL OR receipt.structured_data->>'auction_event_id'=captured.id::text)
                         AND (receipt.structured_data->>'source_auction_event_id' IS NULL OR receipt.structured_data->>'source_auction_event_id'=captured.id::text)
                         AND EXISTS(SELECT 1 FROM public.auction_event_duplicate_mark correction
                           JOIN public.auction_events duplicate ON duplicate.id=correction.event_id
                           WHERE correction.run_id=captured.raw_data#>>'{link_correction,run_id}'
                             AND correction.retired_at IS NULL AND correction.duplicate_of=captured.id
                             AND correction.vehicle_id=m.vehicle_id AND correction.source='bat'
                             AND correction.canonical_listing_url=rtrim(m.external_auction_url,'/')
                             AND duplicate.duplicate_of=captured.id AND duplicate.vehicle_id=m.vehicle_id
                             AND duplicate.source='bat' AND duplicate.source_listing_id=captured.source_listing_id
                             AND duplicate.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                             AND EXISTS(SELECT 1 FROM public.superseded_rows before_image
                               WHERE before_image.source_table='vehicle_observations' AND before_image.row_id=receipt.id
                                 AND before_image.restored_at IS NULL
                                 AND before_image.source=captured.raw_data->'link_correction'
                                 AND before_image.row_data->>'id'=receipt.id::text
                                 AND before_image.row_data->>'vehicle_id'=m.vehicle_id::text
                                 AND (before_image.row_data->>'auction_event_id' IS NULL OR before_image.row_data->>'auction_event_id' IN(duplicate.id::text,captured.id::text))
                                 AND (before_image.row_data#>>'{structured_data,auction_event_id}' IS NULL OR before_image.row_data#>>'{structured_data,auction_event_id}' IN(duplicate.id::text,captured.id::text))
                                 AND (before_image.row_data#>>'{structured_data,source_auction_event_id}' IS NULL OR before_image.row_data#>>'{structured_data,source_auction_event_id}' IN(duplicate.id::text,captured.id::text))
                                 AND before_image.row_data-ARRAY['vehicle_id','subject_id','merged_from_vehicle_id','auction_event_id','structured_data']
                                   =to_jsonb(receipt)-ARRAY['vehicle_id','subject_id','merged_from_vehicle_id','auction_event_id','structured_data']
                                 AND (before_image.row_data->'structured_data')-ARRAY['auction_event_id','source_auction_event_id']
                                   =receipt.structured_data-ARRAY['auction_event_id','source_auction_event_id']))
                         AND EXISTS(SELECT 1 FROM public.vehicle_events corrected_episode
                           WHERE corrected_episode.vehicle_id=canonical.id AND corrected_episode.source_platform='bat'
                             AND corrected_episode.event_type='auction' AND corrected_episode.merged_from_vehicle_id=m.vehicle_id
                             AND corrected_episode.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                             AND corrected_episode.event_status IN('active','live') AND corrected_episode.sold_at IS NULL
                             AND corrected_episode.duplicate_of_event_id IS NULL AND corrected_episode.ended_at>v_now)))
                       AND inventory.fetched_at>CASE WHEN pg_input_is_valid(receipt.structured_data->>'received_at','timestamp with time zone')
                         THEN (receipt.structured_data->>'received_at')::timestamptz END
                       AND (captured.raw_data#>>'{source_read,at}' IS NULL
                         OR pg_input_is_valid(captured.raw_data#>>'{source_read,at}','timestamp with time zone'))
                       AND (captured.raw_data#>>'{live_stream,last_frame_received_at}' IS NULL
                         OR pg_input_is_valid(captured.raw_data#>>'{live_stream,last_frame_received_at}','timestamp with time zone'))
                       AND inventory.fetched_at>greatest(
                         CASE WHEN pg_input_is_valid(captured.raw_data#>>'{source_read,at}','timestamp with time zone')
                           THEN (captured.raw_data#>>'{source_read,at}')::timestamptz END,
                         CASE WHEN pg_input_is_valid(captured.raw_data#>>'{live_stream,last_frame_received_at}','timestamp with time zone')
                           THEN (captured.raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz END)
                       AND captured.outcome='live' AND captured.auction_end_date>v_now
                       AND CASE WHEN jsonb_typeof(locator.origin_metadata->'source_current_bid')='number'
                         THEN (locator.origin_metadata->>'source_current_bid')::numeric>0
                           AND (locator.origin_metadata->>'source_current_bid')::numeric<'Infinity'::numeric
                           AND (locator.origin_metadata->>'source_current_bid')::numeric<>captured.high_bid
                         ELSE false END
                       AND captured.high_bid>0 AND captured.high_bid<'Infinity'::numeric
                       AND NOT EXISTS(SELECT 1 FROM public.auction_events_canonical other
                         WHERE other.source='bat' AND other.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                           AND other.id<>captured.id)
                       AND EXISTS(SELECT 1 FROM public.vehicle_events episode
                         WHERE episode.vehicle_id=canonical.id AND episode.source_platform='bat' AND episode.event_type='auction'
                           AND episode.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                           AND episode.event_status IN('active','live') AND episode.sold_at IS NULL
                           AND episode.duplicate_of_event_id IS NULL AND episode.ended_at>v_now
                           AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other
                             WHERE other.source_platform='bat' AND other.event_type='auction'
                               AND other.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                               AND other.duplicate_of_event_id IS NULL AND other.id<>episode.id))))
               -- One-time native payload capability catchup; normal dispatch fences repeat attempts.
               OR (m.last_synced_at < timestamptz '2026-11-08 20:01:29+00'
                   AND m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND nullif(m.stream_state->>'last_observation_id','') IS NULL
                   AND EXISTS (SELECT 1 FROM public.auction_events legacy
                     WHERE legacy.vehicle_id=m.vehicle_id AND legacy.source='bat'
                       AND legacy.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND legacy.outcome='live' AND legacy.high_bid>0 AND legacy.total_bids>0
                       AND legacy.scraped_at>=m.last_synced_at AND legacy.auction_end_date>v_now))
               -- Current cadence transition; failed reads retain their retry backoff.
               OR (m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND EXISTS (
                     SELECT 1 FROM (SELECT CASE
                       WHEN m.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,under_12h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,under_12h}')::integer END, 60))
                       WHEN m.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,h12_to_48}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,h12_to_48}')::integer END, 360))
                       ELSE make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,over_48h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,over_48h}')::integer END, 1440))
                     END AS interval) cadence
                     WHERE m.poll_interval_ms > extract(epoch FROM cadence.interval) * 1000
                       AND m.last_synced_at <= v_now - cadence.interval))
               OR (m.auction_end_time <= v_now + interval '10 minutes'
                   AND (m.last_synced_at IS NULL OR m.last_synced_at <= v_now - interval '1 minute')))
          AND (m.last_synced_at IS NULL OR m.last_synced_at <= v_now - interval '150 seconds'   -- in flight: not due again
               OR EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                            AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                            AND e.updated_at >= m.last_synced_at))
      ), closing AS (
        -- Each queue locks the rows it picks (FOR UPDATE SKIP LOCKED): a row another transaction holds is skipped
        -- before the LIMIT, so the slot goes to the next candidate, and the UPDATE below never waits or deadlocks.
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND m.auction_end_time <= v_now + interval '10 minutes'
        ORDER BY m.last_synced_at NULLS FIRST, m.auction_end_time
        LIMIT v_closing
        FOR UPDATE OF m SKIP LOCKED
      ), fresh AS (
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND m.next_poll_at IS NULL
          AND coalesce(m.auction_end_time, 'infinity'::timestamptz) > v_now + interval '10 minutes'   -- closing lots only via closing's cap
        ORDER BY m.auction_end_time
        LIMIT least(v_reserve, greatest(v_slots - (SELECT count(*) FROM closing), 0))
        FOR UPDATE OF m SKIP LOCKED
      ), rest AS (
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = m.id)
          AND coalesce(m.auction_end_time, 'infinity'::timestamptz) > v_now + interval '10 minutes'   -- closing lots only via closing's cap
        ORDER BY (m.auction_end_time <= v_now + v_window) DESC, m.next_poll_at NULLS FIRST, m.auction_end_time
        LIMIT greatest(v_slots - (SELECT count(*) FROM fresh) - (SELECT count(*) FROM closing), 0)
        FOR UPDATE OF m SKIP LOCKED
      )
      SELECT m.id, m.external_auction_url, m.auction_end_time, (m.next_poll_at IS NULL) AS first_read
      FROM monitored_auctions m
      WHERE m.id IN (SELECT id FROM closing UNION ALL SELECT id FROM fresh UNION ALL SELECT id FROM rest)
      ORDER BY m.auction_end_time
    LOOP
      IF r.first_read THEN v_first := v_first + 1; END IF;
      v_cad := CASE
        WHEN r.auction_end_time <= v_now + interval '10 minutes' THEN interval '1 minute'
        WHEN r.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,under_12h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,under_12h}')::integer END, 60))
        WHEN r.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,h12_to_48}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,h12_to_48}')::integer END, 360))
        ELSE make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,over_48h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,over_48h}')::integer END, 1440))
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

  -- This run's wall time so far, transaction start to here, is the sample the next runs' pause rule reads; the write-back
  -- below is the only statement after it. Kept: the last 10.
  v_ms := greatest(round((extract(epoch FROM clock_timestamp()) - extract(epoch FROM v_now)) * 1000)::integer, 0);
  v_samples := v_samples || jsonb_build_array(jsonb_build_array((extract(epoch FROM v_now) * 1000)::bigint, v_ms));
  SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_samples
  FROM jsonb_array_elements(v_samples) WITH ORDINALITY t(e, o)
  WHERE o > jsonb_array_length(v_samples) - 10;

  UPDATE live_auction_sources
  SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}', (coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes') || jsonb_build_object(
        'run_samples', v_samples,
        'last_run', jsonb_build_object(
          'at', v_now, 'accounted', v_acc, 'read', v_read, 'failed', v_failed,
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'first_read_dispatched', v_first,
          'in_flight', v_inflight, 'slots_free', v_slots,
          'stream_lots',v_stream_lots,'stream_request_id',v_stream_req,'run_ms', v_ms,'run_p50_ms', round(v_p50),
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
                            'dispatched', v_sent, 'first_read_dispatched', v_first, 'in_flight', v_inflight, 'slots_free', v_slots,
                            'stream_lots',v_stream_lots,'stream_request_id',v_stream_req, 'run_ms', v_ms, 'run_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$function$
;
