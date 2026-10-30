-- Preserve a publisher style label under its own name; trim is not inferred.
-- Existing historical receipt compatibility is retained for model-label matching.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.retained_native_listing_source(public.vehicle_observations)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'+soxj0Yz1ABQA84yYpEV/xjgEwGoVbhnKP0LEhLXIL0=' THEN RAISE EXCEPTION 'Native source association owner changed';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_native_listing_source)')>2 THEN RAISE EXCEPTION 'Relevant source work active';END IF;
 IF (length(f)-length(replace(f,$old$coalesce(p.structured_data->>'trim','')$old$,'')))/length($old$coalesce(p.structured_data->>'trim','')$old$)<>1 THEN RAISE EXCEPTION 'Publisher style association anchor changed';END IF;
 f:=replace(f,$old$coalesce(p.structured_data->>'trim','')$old$,$new$coalesce(p.structured_data->>'publisher_style_label',p.structured_data->>'trim','')$new$);
 EXECUTE f;
END $patch$;
DO $locks$ BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN RAISE EXCEPTION 'Lock wait detected; rollback publisher style association';END IF;
END $locks$;
NOTIFY pgrst,'reload schema';
COMMIT;

