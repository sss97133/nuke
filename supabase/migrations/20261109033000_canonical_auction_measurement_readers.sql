-- Preserve retained duplicate rows; public measurements admit canonical or explicitly unkeyed testimony.
-- OFFSET 0 keeps the existing event PK lookup correlated under anonymous RLS.
SELECT current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout \gset canonical_reader_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0' OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0' OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE change record; body text;
BEGIN
 FOR change IN SELECT * FROM (VALUES
('public.market_lot_activity(uuid[],integer)'::regprocedure,$old$WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || '/')$old$,$new$WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || '/')
      AND (c.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = c.auction_event_id OFFSET 0))$new$),
('public.get_vehicle_profile_data(uuid)'::regprocedure,$old$FROM public.auction_comments WHERE vehicle_id = p_vehicle_id$old$,$new$FROM public.auction_comments WHERE vehicle_id = p_vehicle_id
      AND (auction_comments.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = auction_comments.auction_event_id OFFSET 0))$new$),
('public.actor_profile_read(text,uuid)'::regprocedure,$old$FROM public.auction_comments WHERE author_external_identity_id = ANY (ids)$old$,$new$FROM public.auction_comments WHERE author_external_identity_id = ANY (ids)
      AND (auction_comments.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = auction_comments.auction_event_id OFFSET 0))$new$),
('public.market_source_pulse_read(text)'::regprocedure,$old$WHERE c.created_at >= t.h0 - interval '23 hours'$old$,$new$WHERE c.created_at >= date_trunc('hour', now()) - interval '23 hours'
      AND (c.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = c.auction_event_id OFFSET 0))$new$)
 ) fragments(target,old_fragment,new_fragment) LOOP
  body:=pg_get_functiondef(change.target);
  IF change.target='public.market_source_pulse_read(text)'::regprocedure
    AND strpos(body,$clock$SELECT date_trunc('hour', now()) AS h0,$clock$)=0 THEN
   RAISE EXCEPTION 'Source pulse horizon drifted; cannot specialize its clock';
  END IF;
  IF strpos(body,change.new_fragment)>0 THEN CONTINUE; END IF;
  IF (length(body)-length(replace(body,change.old_fragment,'')))/length(change.old_fragment)<>1 THEN
   RAISE EXCEPTION 'Canonical auction reader contract drifted for %',change.target;
  END IF;
  EXECUTE replace(body,change.old_fragment,change.new_fragment);
 END LOOP;
END $repair$;
SET statement_timeout = :'canonical_reader_prior_statement_timeout';
SET lock_timeout = :'canonical_reader_prior_lock_timeout';
