-- Preserve public scope, privacy, source catalog, grants and collector budgets.
SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout \gset cc_v2_prior_
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval = interval '0' OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval = interval '0' OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END, false);
DO $repair$
DECLARE
 body text := pg_get_functiondef('public.live_bid_tape(integer)'::regprocedure);
 anchor text := $old$o.source_identifier LIKE 'collecting-cars-bid:%'$old$;
 replacement text := $new$(o.source_identifier LIKE 'collecting-cars-bid:%' OR (o.source_identifier LIKE 'collecting-cars-snapshot:v2:%' AND o.extraction_method='cc_typesense_board_snapshot_v2' AND o.structured_data->>'capture_kind'='auction_bid_snapshot'))$new$;
BEGIN
 IF (length(body)-length(replace(body,replacement,'')))/length(replacement)=2 THEN RETURN; END IF;
 IF strpos(body,replacement)>0 OR (length(body)-length(replace(body,anchor,'')))/length(anchor)<>2 OR strpos(body,'ELSE ''bid_snapshot'' END event_kind')=0 THEN
   RAISE EXCEPTION 'Unexpected live_bid_tape CC contract; review before changing';
 END IF;
 EXECUTE replace(body,anchor,replacement);
END $repair$;
SELECT set_config('statement_timeout', :'cc_v2_prior_statement_timeout', false);
SELECT set_config('lock_timeout', :'cc_v2_prior_lock_timeout', false);
