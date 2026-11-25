-- Disposable PG17 contract for 20261125112500_model_fold_logic_key_scope_rules. Synthetic rows only.
-- Runs the live model_fold_logic_key (2026-11-25) and asserts: the key is unchanged by the migration while every rule row
-- is Pontiac or make NULL; a rule for a make no scope uses does not move it; a Pontiac or make-NULL rule does; adding a
-- scope for a make brings that make's rows in; a replay changes nothing.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb);
INSERT INTO public.platform_config VALUES
  ('model_fold', '{"scopes": ["pontiac_f_body"], "decode_scopes": ["pontiac_f_body"], "decoder": "text_code_decode_v2"}');
CREATE TABLE IF NOT EXISTS public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  make text,
  model text,
  code text,
  year_min integer,
  year_max integer,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualifiers) = 'object'),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  citation_url text NOT NULL CHECK (citation_url ~ '^https?://'),
  citation_title text,
  citation_locator text,
  cited_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.vehicle_decode_rules (id),
  superseded_at timestamptz,
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max),
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_decode_rules_lookup
  ON public.vehicle_decode_rules (rule_key, upper(code)) WHERE superseded_at IS NULL;
-- One current row per rule, scope and citation: a second reading of the same table supersedes, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_decode_rules_current_unique
  ON public.vehicle_decode_rules (rule_key, coalesce(make, ''), coalesce(model, ''), coalesce(code, ''),
    coalesce(year_min, 0), coalesce(year_max, 0), citation_url) WHERE superseded_at IS NULL;
ALTER TABLE public.vehicle_decode_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_facet_claim_roles (role text, field text, item_key text);
CREATE TABLE public.data_set_item_kinds (item_key text);
CREATE TABLE public.code_reading_polarity_rules (rule_key text);
CREATE OR REPLACE FUNCTION public.model_fold_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select config_value from public.platform_config where config_key = 'model_fold' limit 1), '{}'::jsonb)
$function$
;
CREATE OR REPLACE FUNCTION public.model_fold_scope_make(p_scope text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_scope when 'pontiac_f_body' then 'pontiac' when 'ford_mustang_65_73' then 'ford'
                      when 'chevrolet_camaro_67_69' then 'chevrolet' end
$function$;

CREATE OR REPLACE FUNCTION public.model_fold_logic_key()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select md5(coalesce((select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text)
                         from pg_proc p
                        where p.pronamespace = 'public'::regnamespace
                          and (p.proname ~ '^(text_code_decode_v|text_code_matches_v|text_spec_matches_v|text_rpo_known_v)[0-9]+$'
                               or p.proname in ('data_set_candidates_v1','data_set_code_candidates_v1','data_set_basis_live',
                                                'data_set_membership_plan_v1','observation_is_public','model_fold_invalidate_readings'))), '')
          || '|' || coalesce(public.model_fold_config() ->> 'decoder', '')
          || '|' || coalesce((select md5(string_agg(r.id::text || ':' || coalesce(r.superseded_at::text, ''), ',' order by r.id))
                                from public.vehicle_decode_rules r), '')
          -- data_set_claim_role_witnesses_v1: the claim-role and item-kind rule rows
          || '|' || coalesce((select md5(string_agg(row(c.*)::text, ',' order by c.role, c.field, c.item_key)) from public.vehicle_facet_claim_roles c), '')
          || '|' || coalesce((select md5(string_agg(row(k.*)::text, ',' order by k.item_key)) from public.data_set_item_kinds k), '')
          -- polarity_rules_in_logic_key_v1
          || '|' || coalesce((select md5(string_agg(row(p.*)::text, ',' order by p.rule_key)) from public.code_reading_polarity_rules p), ''))
$function$;
INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_url) VALUES
  ('engine_stamp_code', 'Pontiac', 'WS', '{"x": 1}', 'https://example.org/a'),
  ('transmission_id_rule', NULL, 'M20', '{"x": 1}', 'https://example.org/b');
CREATE TEMP TABLE k (step text PRIMARY KEY, key text);
INSERT INTO k VALUES ('before', public.model_fold_logic_key());

\ir ../migrations/20261125112500_model_fold_logic_key_scope_rules.sql
\ir ../migrations/20261125112500_model_fold_logic_key_scope_rules.sql
SET client_min_messages = warning;

DO $t$
DECLARE k0 text := (SELECT key FROM k WHERE step = 'before'); k1 text; d text;
BEGIN
  d := pg_get_functiondef('public.model_fold_logic_key()'::regprocedure);
  IF (length(d) - length(replace(d, 'model_fold_logic_key_scope_rules_v1_end', ''))) / length('model_fold_logic_key_scope_rules_v1_end') <> 1 THEN
    RAISE EXCEPTION 'patched more than once'; END IF;
  IF public.model_fold_logic_key() IS DISTINCT FROM k0 THEN RAISE EXCEPTION 'key moved on deploy with only Pontiac/NULL rows'; END IF;

  INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_url)
  VALUES ('vin_format', 'Chevrolet', 'chev_fmt', '{"x": 1}', 'https://example.org/c');
  IF public.model_fold_logic_key() IS DISTINCT FROM k0 THEN RAISE EXCEPTION 'a Chevrolet row moved the key with no Chevrolet scope'; END IF;

  INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_url)
  VALUES ('engine_stamp_code', 'Pontiac', 'YS', '{"x": 1}', 'https://example.org/d');
  k1 := public.model_fold_logic_key();
  IF k1 IS NOT DISTINCT FROM k0 THEN RAISE EXCEPTION 'a Pontiac row did not move the key'; END IF;

  INSERT INTO public.vehicle_decode_rules (rule_key, make, code, value, citation_url)
  VALUES ('transmission_id_rule', NULL, 'M21', '{"x": 1}', 'https://example.org/e');
  IF public.model_fold_logic_key() IS NOT DISTINCT FROM k1 THEN RAISE EXCEPTION 'a make-NULL row did not move the key'; END IF;
  k1 := public.model_fold_logic_key();

  UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{scopes}', '["pontiac_f_body", "chevrolet_camaro_67_69"]')
   WHERE config_key = 'model_fold';
  IF public.model_fold_logic_key() IS NOT DISTINCT FROM k1 THEN RAISE EXCEPTION 'a Chevrolet scope did not bring its rows in'; END IF;
END $t$;
\echo model_fold_logic_key_scope_rules: ok
