-- code_reading_polarity_rules: the 'offered / available / optional / standard after the span' rule (candidates_reference_after,
-- 20261124193900) read almost every hit wrong. Narrowed, and the rule rows join the fold's logic key.
--
-- WHY. Measured 2026-11-25 on 30,000 sampled active vehicle_code_readings (12 x TABLESAMPLE 0.05, 2,500 each): the rule
-- matched 62 spans, 40 distinct contexts, read locally. 4 were right (a generic statement about the model: '... stick
-- available until 2020', '... become available as an option', '... offered in the mid-2000s', '... V8 offered (and still
-- does)'). 36 were wrong, the span is this vehicle's own:
--   'Offered at <auction> (Lot ...)' auction titles (body style and trim of the lot itself): 30;
--   'offered here' / 'available here on <site>': 2; 'with optional ...' (the option is the next thing named): 2;
--   'standard ...' naming the next thing ('standard short box', 'lists standard equipment'): 2.
-- An exclusive-kind span ruled 'candidates' is not admitted to a data set (data_set_code_candidates_v1), so since
-- 20261124193900 these lots lost their body style and trim memberships from the title.
-- WHAT.
-- 1. The rule's pattern: one optional leading word that is not 'with', then optional|available|offered (no 'standard'),
--    not followed by at|here|by|on|through|for. On the 40 contexts it is true for exactly the 4 right ones.
-- 2. model_fold_logic_key also hashes code_reading_polarity_rules, so a rule row edit re-folds like a code edit (this one
--    included: the pontiac_f_body scope re-derives its memberships).
-- REVERT: restore the 20261124193900 pattern; drop the logic-key line (marker polarity_rules_in_logic_key_v1).
-- Contract: supabase/sql/test_polarity_offered_rule.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

UPDATE public.code_reading_polarity_rules
   SET pattern = $r$^\W*(?!with\y)(\w+\W+){0,1}(optional|available|offered)\y(?!\W+(at|here|by|on|through|for)\y)$r$,
       note = 'a generic statement after the span (offered / available / optional), not the listing''s own offer: '
              || 'no leading with, not followed by at|here|by|on|through|for (20261124195200)'
 WHERE rule_key = 'candidates_reference_after';

DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.model_fold_logic_key()'::regprocedure);
  IF position('polarity_rules_in_logic_key_v1' IN d) > 0 THEN RETURN; END IF;
  IF position($q$from public.data_set_item_kinds k), ''))$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'model_fold_logic_key: anchor not found (needs 20261124194800)';
  END IF;
  d := replace(d, $q$from public.data_set_item_kinds k), ''))$q$,
    $q$from public.data_set_item_kinds k), '')
          -- polarity_rules_in_logic_key_v1
          || '|' || coalesce((select md5(string_agg(row(p.*)::text, ',' order by p.rule_key)) from public.code_reading_polarity_rules p), ''))$q$);
  EXECUTE d;
END $patch$;
