-- Keep the public locator lookup correlated to its admitted UUID. Under anon
-- RLS the flattened join scanned vehicles (estimated cost 545712); OFFSET 0
-- preserves the same rows and the parameterized primary-key lookup (cost 14).
SELECT current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout \gset bat_locator_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0' OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0' OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE
 old_fragment text:=$old$       AND other_lot.vehicle_id IS DISTINCT FROM v.id)
 ) bound ON true$old$;
 new_fragment text:=$new$       AND other_lot.vehicle_id IS DISTINCT FROM v.id)
 OFFSET 0
 ) bound ON true$new$;
 target regprocedure;
 body text;
BEGIN
 FOREACH target IN ARRAY ARRAY['public.market_pulse_live()'::regprocedure,'public.market_lot_activity(uuid[],integer)'::regprocedure] LOOP
   body:=pg_get_functiondef(target);
   IF strpos(body,new_fragment)>0 THEN CONTINUE; END IF;
   IF (length(body)-length(replace(body,old_fragment,'')))/length(old_fragment)<>1 THEN
     RAISE EXCEPTION 'Native public locator body drifted for %; inspect before applying',target;
   END IF;
   EXECUTE replace(body,old_fragment,new_fragment);
 END LOOP;
END $repair$;
SET statement_timeout = :'bat_locator_prior_statement_timeout';
SET lock_timeout = :'bat_locator_prior_lock_timeout';
