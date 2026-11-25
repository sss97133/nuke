-- vehicle_row_public_projection: origin_metadata redacted leaf by leaf with contact rules held as rows.
--
-- WHY. The public projection (vehicle_row_read and get_vehicle_profile_data for a non-insider) redacted origin_metadata
-- by one email regex run over the jsonb's serialized text: no phone coverage, and a regex over serialized json sees
-- escapes (\n, \") rather than the text a reader sees, so word boundaries shift. Prod 2026-11-25 (read-only, counts only,
-- 128 of 4096 id slices = 1/32 of public cars): 861 non-URL string leaves hold a phone number the email regex misses,
-- 811 of them in bat_snapshot_parsed (its party_type seller text: 73 of 93 in a 16-slice sub-sample), plus seller_phone,
-- raw_description and a saleroom addendum. The same pattern on every leaf would also have rewritten 246 URL leaves the
-- page renders (images, image_urls, thumbnail_url, discovery_url, listing_url) and 47 serial or id leaves (chassis_number,
-- bat_snapshot_parsed.chassis, engine_number, craigslist_post_id, *_id), so each rule carries its scope.
--
-- WHAT.
--   public.contact_redaction_rules: one row per pattern (rule_key, pattern, replacement, skip_url_leaves,
--     skip_key_regex, ordinal, enabled, reason, measured_at). Seeded with text_redact_contact's two patterns verbatim:
--     email on every leaf (today's coverage), phone on leaves that are not URLs and not under an id/serial/url key.
--     CHECKs refuse a pattern that does not compile or matches the empty string. anon and authenticated read it; only
--     the service role and migrations write it.
--   public.text_redact_by_rules(text, rules jsonb, key text): applies the rules in order to one string.
--   public.jsonb_redact_contact_leaves(jsonb, rules jsonb, key text): rebuilds the value with every string leaf passed
--     through it; an array's elements take the key of the array; object keys are kept (0 of 32,816 keys in a
--     16-slice sample look like a phone or email, so the serialized-text regex's key coverage is not lost today).
--   public.jsonb_redact_contact(jsonb): reads the enabled rules once, tries each once over the decoded leaves it may
--     touch (joined by newlines) and walks only when one matches; else returns the value as it came. No enabled rule:
--     null (fail closed). vehicle_row_public_projection calls it for origin_metadata.
-- text_redact_contact (13 callers in other lanes) is not changed; the contract asserts its two literals equal the
-- seeded rows. Built on 20261125202000: the guard accepts only that body (or this one on a re-run).
-- CONTRACT: supabase/sql/test_projection_origin_metadata_leaves.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125231500_projection_origin_metadata_leaves.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text; t text;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO s
  FROM pg_proc p WHERE p.oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
  -- The body 20261125202000 installs, or this migration's own on a re-run.
  IF s IS DISTINCT FROM 'd72ab841ab9c56dea9e1e4773141e021e979d3c8c0d413057c715831d2e8514d'
     AND position('projection_origin_metadata_leaves_v1' in pg_get_functiondef('public.vehicle_row_public_projection(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_row_public_projection is not the 20261125202000 body (sha256 %); deploy that first or review', s;
  END IF;
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO t
  FROM pg_proc p WHERE p.oid = 'public.text_redact_contact(text)'::regprocedure;
  IF t IS DISTINCT FROM 'accf208fc08cfcac63e598c1bde7df77b1a8802c2919ca058c1b715cb2c83cf1' THEN
    RAISE EXCEPTION 'text_redact_contact changed (sha256 %); the seeded rule rows copy its patterns, review them', t;
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.contact_redaction_rules (
  rule_key text PRIMARY KEY CHECK (rule_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- Compiles, cannot match the empty string, and has no \A or \Z (string-edge anchors the joined-leaf test would miss).
  pattern text NOT NULL CHECK (NOT ('' ~ pattern) AND pattern !~ '\\[AZ]'),
  replacement text NOT NULL CHECK (length(replacement) BETWEEN 1 AND 80),
  skip_url_leaves boolean NOT NULL,
  skip_key_regex text CHECK (skip_key_regex IS NULL OR ('' ~ skip_key_regex) IS NOT NULL),
  ordinal integer NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (length(reason) >= 12),
  measured_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.contact_redaction_rules IS
  'One row per contact pattern the public vehicle projection redacts from origin_metadata string leaves, in ordinal '
  'order: pattern (POSIX ARE, applied globally), replacement, skip_url_leaves (leave a leaf that starts with http(s):// '
  'alone), skip_key_regex (leave a leaf whose nearest key matches alone). Read once per call by '
  'vehicle_row_public_projection; no enabled row withholds origin_metadata. Seeded 20261125231500 from '
  'text_redact_contact. Revert a rule by enabled = false.';
ALTER TABLE public.contact_redaction_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_redaction_rules_read ON public.contact_redaction_rules;
CREATE POLICY contact_redaction_rules_read ON public.contact_redaction_rules FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.contact_redaction_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_redaction_rules TO anon, authenticated;
GRANT ALL ON public.contact_redaction_rules TO service_role;

INSERT INTO public.contact_redaction_rules
  (rule_key, pattern, replacement, skip_url_leaves, skip_key_regex, ordinal, reason, measured_at) VALUES
  ('email', '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', false, NULL, 10,
   'text_redact_contact email pattern; every leaf, as the serialized-text regex covered', '2026-11-25'),
  ('phone', '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', true,
   '(^|_)(id|ids|number|chassis|vin|url|urls|uuid)$|^repost_of$', 20,
   'text_redact_contact phone pattern; not URL leaves (246 in a 1/32 sample) nor id/serial keys (47)', '2026-11-25')
ON CONFLICT (rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.text_redact_by_rules(p_text text, p_rules jsonb, p_key text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE r jsonb; t text := p_text;
BEGIN
  IF t IS NULL OR pg_catalog.jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RETURN t; END IF;
  FOR r IN SELECT x FROM pg_catalog.jsonb_array_elements(p_rules) x LOOP
    CONTINUE WHEN coalesce((r ->> 'skip_url_leaves')::boolean, false) AND t ~* '^\s*https?://';
    CONTINUE WHEN r ->> 'skip_key_regex' IS NOT NULL AND p_key IS NOT NULL AND p_key ~ (r ->> 'skip_key_regex');
    t := pg_catalog.regexp_replace(t, r ->> 'pattern', r ->> 'replacement', 'g');
  END LOOP;
  RETURN t;
END
$function$;

CREATE OR REPLACE FUNCTION public.jsonb_redact_contact_leaves(p_j jsonb, p_rules jsonb, p_key text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE pg_catalog.jsonb_typeof(p_j)
    WHEN 'object' THEN (SELECT coalesce(pg_catalog.jsonb_object_agg(e.key, public.jsonb_redact_contact_leaves(e.value, p_rules, e.key)), '{}'::jsonb)
                        FROM pg_catalog.jsonb_each(p_j) e)
    WHEN 'array' THEN (SELECT coalesce(pg_catalog.jsonb_agg(public.jsonb_redact_contact_leaves(e.value, p_rules, p_key) ORDER BY e.ord), '[]'::jsonb)
                       FROM pg_catalog.jsonb_array_elements(p_j) WITH ORDINALITY e(value, ord))
    WHEN 'string' THEN pg_catalog.to_jsonb(public.text_redact_by_rules(p_j #>> '{}', p_rules, p_key))
    ELSE p_j END
$function$;

CREATE OR REPLACE FUNCTION public.jsonb_redact_contact(p_j jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  v_rules jsonb;
  v_all text;
  v_text text;
  r jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_j) NOT IN ('object', 'array') THEN RETURN p_j; END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('pattern', c.pattern, 'replacement', c.replacement,
           'skip_url_leaves', c.skip_url_leaves, 'skip_key_regex', c.skip_key_regex) ORDER BY c.ordinal)
    INTO v_rules FROM public.contact_redaction_rules c WHERE c.enabled;
  IF v_rules IS NULL THEN RETURN 'null'::jsonb; END IF;  -- no enabled rule: withhold, never pass raw
  -- Fast path: each rule is tried once over the decoded string leaves it may touch, joined by newlines; a value no
  -- rule can change is returned as it came. (Key skips are left to the walk, so this only ever walks more.)
  SELECT pg_catalog.string_agg(l #>> '{}', E'\n'),
         pg_catalog.string_agg(l #>> '{}', E'\n') FILTER (WHERE (l #>> '{}') !~* '^\s*https?://')
    INTO v_all, v_text
  FROM pg_catalog.jsonb_path_query(p_j, 'strict $.**') l WHERE pg_catalog.jsonb_typeof(l) = 'string';
  FOR r IN SELECT x FROM pg_catalog.jsonb_array_elements(v_rules) x LOOP
    -- 'w': ^ and $ also match at each newline, so a match inside one leaf is also a match in the joined text.
    IF pg_catalog.regexp_like(CASE WHEN coalesce((r ->> 'skip_url_leaves')::boolean, false) THEN v_text ELSE v_all END,
                              r ->> 'pattern', 'w') THEN
      RETURN public.jsonb_redact_contact_leaves(p_j, v_rules);
    END IF;
  END LOOP;
  RETURN p_j;
END
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- vehicle_row_projection_withheld_columns_v1: a vehicles column the request role cannot SELECT is null here.
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  -- projection_origin_metadata_leaves_v1: origin_metadata goes through public.jsonb_redact_contact (string leaf by
  -- string leaf with the enabled contact_redaction_rules rows; null when no rule is enabled).
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', public.jsonb_redact_contact(r.j -> 'origin_metadata'))
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'])
                || coalesce((
                  SELECT pg_catalog.jsonb_object_agg(a.attname::text, 'null'::jsonb)
                  FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                    AND jsonb_typeof(p_row) = 'object' AND jsonb_typeof(p_row -> a.attname::text) <> 'null'
                    AND NOT pg_catalog.has_column_privilege(
                      (SELECT CASE auth.role() WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END),
                      a.attrelid, a.attnum, 'SELECT')), '{}'::jsonb) AS j) r) m
$function$;

DO $check$
DECLARE f record; n int;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, position('projection_origin_metadata_leaves_v1' in p.prosrc) > 0
           AND position('vehicle_row_projection_withheld_columns_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
  SELECT count(*) INTO n FROM public.contact_redaction_rules WHERE enabled AND rule_key IN ('email', 'phone');
  IF NOT (NOT f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=""'] AND f.marked AND n = 2
          AND NOT has_table_privilege('anon', 'public.contact_redaction_rules', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'UPDATE')
          AND has_table_privilege('anon', 'public.contact_redaction_rules', 'SELECT')) THEN
    RAISE EXCEPTION 'vehicle_row_public_projection or contact_redaction_rules not as intended';
  END IF;
END $check$;
COMMIT;
