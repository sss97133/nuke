-- A native CC slug ends in 4matic+. Preserve exact trusted host/owner and read-only privileges.
SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout \gset cc_plus_prior_
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval = interval '0' OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval = interval '0' OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END, false);
DO $repair$
DECLARE
 body text := pg_get_functiondef('public.cc_latest_snapshot_states(jsonb)'::regprocedure);
 old_pattern text := '^https://collectingcars[.]com/for-sale/[a-zA-Z0-9-]+$';
 new_pattern text := '^https://collectingcars[.]com/for-sale/[a-zA-Z0-9+-]+$';
BEGIN
 IF strpos(body,new_pattern)>0 AND strpos(body,old_pattern)=0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,old_pattern,'')))/length(old_pattern)<>1 OR strpos(body,new_pattern)>0 THEN
  RAISE EXCEPTION 'CC native owner validation changed; review before replacement';
 END IF;
 EXECUTE replace(body,old_pattern,new_pattern);
END $repair$;
SELECT set_config('statement_timeout', :'cc_plus_prior_statement_timeout', false);
SELECT set_config('lock_timeout', :'cc_plus_prior_lock_timeout', false);
