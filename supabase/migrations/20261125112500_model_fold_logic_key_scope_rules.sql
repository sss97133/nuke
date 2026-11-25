-- model_fold_logic_key_scope_rules_v1: a decode rule row moves the model fold's logic key only when a configured scope
-- can use it.
--
-- WHY. model_fold_logic_key hashed every vehicle_decode_rules row, so a rule landed for a make no fold scope decodes
-- (the next make's rows, from the decode-rule producer) would change the key and send model_fold_sweep round every
-- configured scope again (pontiac_f_body: 15.8k cars, one pass per min_pass_hours) for nothing.
--
-- WHAT CHANGES. The rule hash covers only rows whose make is NULL (rows for every make) or is the make of a scope in
-- model_fold config 'scopes' or 'decode_scopes' (model_fold_scope_make). Everything else in the key is unchanged.
--
-- EXPECTED. The key value does not change on deploy: every live row today is Pontiac or make NULL, and pontiac_f_body
-- is the configured scope, so the hashed rows are the same rows in the same order. Adding a scope for a make brings that
-- make's rows into the key (one sweep pass, as intended).
--
-- REVERT. Remove the WHERE clause between model_fold_logic_key_scope_rules_v1 and its _end marker.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a text := E'                                from public.vehicle_decode_rules r), '''')\n';
  r text := E'                                from public.vehicle_decode_rules r\n'
         || E'                               -- model_fold_logic_key_scope_rules_v1: only rows a configured scope can use\n'
         || E'                               where r.make is null\n'
         || E'                                  or lower(r.make) in (select public.model_fold_scope_make(s.scope)\n'
         || E'                                                         from jsonb_array_elements_text(\n'
         || E'                                                                coalesce(public.model_fold_config() -> ''scopes'', ''[]''::jsonb)\n'
         || E'                                                                || coalesce(public.model_fold_config() -> ''decode_scopes'', ''[]''::jsonb)) s(scope))\n'
         || E'                               -- model_fold_logic_key_scope_rules_v1_end\n'
         || E'                             ), '''')\n';
  n int;
BEGIN
  d := pg_get_functiondef('public.model_fold_logic_key()'::regprocedure);
  IF position('model_fold_logic_key_scope_rules_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'model_fold_logic_key rule-hash anchor drifted: % matches', n; END IF;
  EXECUTE replace(d, a, r);
END $patch$;
