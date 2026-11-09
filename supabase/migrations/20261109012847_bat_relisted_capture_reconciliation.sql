-- Reconcile a relisted capture only through the canonical intake's existing
-- native receipt. Monitors remain on their inventory parent; no identity moves.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset bat_relist_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0'
 OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0'
 OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE
 body text:=pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
 old_read text:=$old$SELECT m.id, m.vehicle_id, m.last_synced_at, m.last_comment_count,
           e.updated_at AS read_at, e.auction_end_date AS read_end, e.outcome AS read_outcome
    FROM monitored_auctions m
    LEFT JOIN LATERAL (
      SELECT a.updated_at, a.auction_end_date, a.outcome FROM auction_events a
      WHERE a.vehicle_id = m.vehicle_id
        AND rtrim(a.source_url, '/') = rtrim(m.external_auction_url, '/')$old$;
 new_read text:=$new$SELECT m.id, m.vehicle_id, m.last_synced_at, m.last_comment_count,
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
        WHERE native.id=nullif(m.stream_state->>'last_observation_id','')::uuid
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
              AND other_lot.vehicle_id IS DISTINCT FROM native.vehicle_id)
      ),m.vehicle_id) AND a.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')$new$;
 old_count text:='SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.vehicle_id;';
 new_count text:=$count$SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.read_vehicle_id
        AND c.source_url IN (rtrim(r.external_auction_url,'/'),rtrim(r.external_auction_url,'/')||'/');$count$;
BEGIN
 IF strpos(body,new_read)>0 AND strpos(body,new_count)>0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,old_read,'')))/length(old_read)<>1
 OR (length(body)-length(replace(body,old_count,'')))/length(old_count)<>1 THEN
   RAISE EXCEPTION 'Unexpected BaT reconciliation body; review before replacing';
 END IF;
 EXECUTE replace(replace(body,old_read,new_read),old_count,new_count);
END;
$repair$;
SET statement_timeout = :'bat_relist_prior_statement_timeout';
SET lock_timeout = :'bat_relist_prior_lock_timeout';
