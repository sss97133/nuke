-- Contract for 20261124195200_polarity_reference_after_rule (empty disposable PG17; the rule table and model_fold_logic_key stubbed
-- with the live anchor). Asserts the narrowed pattern on generic phrasings (no listing text), that the logic key moves with
-- a rule row, and an idempotent re-apply.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.code_reading_polarity_rules') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
CREATE TABLE public.code_reading_polarity_rules (rule_key text PRIMARY KEY, polarity text, side text, pattern text, priority int, note text);
INSERT INTO public.code_reading_polarity_rules VALUES
 ('candidates_reference_after', 'candidates', 'after', $r$^\W*(\w+\W+){0,1}(optional|standard(?!\W+(shift|trans))|available|offered)\y$r$, 41, 'old');
CREATE TABLE public.vehicle_decode_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), superseded_at timestamptz);
CREATE TABLE public.data_set_item_kinds (item_key text PRIMARY KEY, set_kind text, note text);
CREATE FUNCTION public.model_fold_logic_key() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  select md5('x'
          || '|' || coalesce((select md5(string_agg(r.id::text, ',' order by r.id)) from public.vehicle_decode_rules r), '')
          || '|' || coalesce((select md5(string_agg(row(k.*)::text, ',' order by k.item_key)) from public.data_set_item_kinds k), ''))
$function$;
CREATE TEMP TABLE k0 AS SELECT public.model_fold_logic_key() AS k;

\ir ../migrations/20261124195200_polarity_reference_after_rule.sql
\ir ../migrations/20261124195200_polarity_reference_after_rule.sql

DO $$
DECLARE p text := (SELECT pattern FROM public.code_reading_polarity_rules WHERE rule_key = 'candidates_reference_after'); k1 text;
BEGIN
  ASSERT ' Offered at Auction City 2014 (Lot 1)' !~* p, 'an auction title is the lot itself';
  ASSERT ' Convertible Offered at Auction City' !~* p, 'one word, then offered at';
  ASSERT ' offered here was delivered new' !~* p, 'offered here';
  ASSERT ', available here on a site' !~* p, 'available here';
  ASSERT ' with optional manual input' !~* p, 'with optional: the option is the next thing';
  ASSERT ' engine, standard short box' !~* p, 'standard names the next thing';
  ASSERT ' stick available until 2020' ~* p, 'generic availability';
  ASSERT ' become available as an option' ~* p, 'became available';
  ASSERT ' offered in the mid-2000s' ~* p, 'offered in a period';
  ASSERT ' V8 offered (and still does)' ~* p, 'offered, generic';
  k1 := public.model_fold_logic_key();
  ASSERT k1 <> (SELECT k FROM k0), 'the logic key covers the polarity rows';
  UPDATE public.code_reading_polarity_rules SET priority = 42;
  ASSERT public.model_fold_logic_key() <> k1, 'a rule row edit moves the logic key';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.model_fold_logic_key()'::regprocedure), 'polarity_rules_in_logic_key_v1', 'g')) = 1, 'patched once';
END $$;
\echo polarity_reference_after_rule: ok
