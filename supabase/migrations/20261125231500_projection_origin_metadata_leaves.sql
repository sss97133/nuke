-- vehicle_row_public_projection: origin_metadata contact keys dropped and contact text redacted by rule rows; each
-- step computed once.
--
-- WHY. The public projection (vehicle_row_read and get_vehicle_profile_data for a non-insider) redacted origin_metadata
-- by one email regex over the jsonb's serialized text: no phone coverage, and a regex over serialized json sees escapes
-- (\n, \") rather than the text a reader sees. Prod 2026-11-25 (read-only, counts only):
--   leaves, 128 of 4,096 id slices (1/32 of public cars): 861 non-URL string leaves hold a phone the email regex misses,
--     811 in bat_snapshot_parsed; phone-shaped runs also sit in 246 URL leaves the page renders and 47 id/serial leaves.
--   keys, 32 of 4,096 slices (8,962 public cars): bat_snapshot_parsed.party_type (the BaT seller line) holds a string on
--     231 cars, 212 of them a phone or email; no other key named phone, mobile, cell, tel, contact, whatsapp, fax or
--     mail. None of the five owner keys sits below the top level of any jsonb column on those cars.
-- Cost: one public car whose to_jsonb row is 17,844 bytes, anon claims, EXPLAIN ANALYZE, ms per call, two sessions of
-- interleaved runs (prod is shared, so medians move between sessions): live projection 108 (runs 89-124; 102-191 in
-- earlier runs). Its subqueries were pulled up, so the masks ran once per reference; the same body with OFFSET 0
-- barriers 20-29; this body 17-30. Pieces alone: the origin_metadata fast path 1.0-1.2 (this row takes it), the
-- nested-key test plus top-level mask 4-5 against jsonb_mask_keys 9-14, and 20261125202000's grant mask 15-22, which is
-- most of what remains.
--
-- WHAT.
--   public.contact_redaction_rules, one row per rule in ordinal order:
--     drop_key (the gate): an object key matching key_regex, case-insensitive, at any depth, holding a non-null value,
--       is removed with its value. Seeded: contact_keys ^(seller_phone|party_type)$.
--     redact (the backstop): pattern replaced in string leaves. skip_url_leaves: a leaf that is exactly one URL is left
--       alone; in any other leaf the URLs are left alone and the text around them is redacted. skip_key_regex: a leaf
--       under a matching key is left alone unless the key matches never_skip_key_regex (a CHECK makes a skip name one).
--       Seeded: email (text_redact_contact's, every leaf) and phone (text_redact_contact's, skips
--       (^|_)(id|number|chassis)$|^repost_of$ from the census, never skips phone|mobile|cell|tel|contact|whatsapp|fax).
--     CHECKs refuse a pattern or key regex that does not compile or matches the empty string, and a rule of one action
--     carrying the other's columns. anon and authenticated read it; only the service role and migrations write it.
--   public.text_redact_by_rules(text, rules, key), public.jsonb_redact_contact_leaves(jsonb, rules, key): the walk.
--   public.jsonb_redact_contact(jsonb): reads the enabled rules once and tries each once over all it could change,
--     joined by newlines (keys holding a value; string leaves with URLs cut out where the rule skips them); walks only
--     when one matches. No enabled rule: null (fail closed).
--   vehicle_row_public_projection: nulls the five owner keys at the top level directly and runs the recursive
--     jsonb_mask_keys walk only when one sits deeper (same answer, contract case 12); OFFSET 0 on each level.
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
  -- drop_key: an object key matching key_regex (case-insensitive) is removed with its whole value: the gate.
  -- redact: pattern is replaced in string leaves: the backstop.
  action text NOT NULL CHECK (action IN ('drop_key', 'redact')),
  key_regex text,
  -- Compiles, cannot match the empty string, and has no \A or \Z (string-edge anchors the joined-leaf test would miss).
  pattern text CHECK (pattern IS NULL OR (NOT ('' ~ pattern) AND pattern !~ '\\[AZ]')),
  replacement text CHECK (replacement IS NULL OR length(replacement) BETWEEN 1 AND 80),
  -- A leaf that is one URL and nothing else is left alone; in any other leaf the URLs are left alone and the rest is
  -- redacted.
  skip_url_leaves boolean NOT NULL DEFAULT false,
  -- A leaf whose nearest key matches skip_key_regex (case-sensitive) is left alone, unless the key also matches
  -- never_skip_key_regex (case-insensitive): a key that names a contact is always redacted.
  skip_key_regex text CHECK (skip_key_regex IS NULL OR ('' ~ skip_key_regex) IS NOT NULL),
  never_skip_key_regex text CHECK (never_skip_key_regex IS NULL OR ('' ~ never_skip_key_regex) IS NOT NULL),
  ordinal integer NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (length(reason) >= 12),
  measured_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_redaction_rules_shape CHECK (
    (action = 'drop_key' AND key_regex IS NOT NULL AND NOT ('' ~* key_regex) AND pattern IS NULL AND replacement IS NULL
       AND NOT skip_url_leaves AND skip_key_regex IS NULL AND never_skip_key_regex IS NULL)
    OR (action = 'redact' AND key_regex IS NULL AND pattern IS NOT NULL AND replacement IS NOT NULL)),
  -- A skip must name what it may never skip.
  CONSTRAINT contact_redaction_rules_skip_has_never CHECK (skip_key_regex IS NULL OR never_skip_key_regex IS NOT NULL)
);
COMMENT ON TABLE public.contact_redaction_rules IS
  'How the public vehicle projection treats origin_metadata for a non-insider, one row per rule, applied in ordinal '
  'order. drop_key: an object key matching key_regex (case-insensitive, any depth) and holding a non-null value is '
  'removed with that value. redact: '
  'pattern (POSIX ARE, global) is replaced in string leaves; skip_url_leaves leaves a leaf that is exactly one URL '
  'alone and the URLs inside other leaves alone; skip_key_regex leaves a leaf under a matching key alone unless the key '
  'matches never_skip_key_regex. Read once per call; no enabled row withholds origin_metadata. Seeded 20261125231500 '
  'from a prod key census. Revert a rule by enabled = false.';
ALTER TABLE public.contact_redaction_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_redaction_rules_read ON public.contact_redaction_rules;
CREATE POLICY contact_redaction_rules_read ON public.contact_redaction_rules FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.contact_redaction_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_redaction_rules TO anon, authenticated;
GRANT ALL ON public.contact_redaction_rules TO service_role;

INSERT INTO public.contact_redaction_rules
  (rule_key, action, key_regex, pattern, replacement, skip_url_leaves, skip_key_regex, never_skip_key_regex, ordinal,
   reason, measured_at) VALUES
  ('contact_keys', 'drop_key', '^(seller_phone|party_type)$', NULL, NULL, false, NULL, NULL, 5,
   'Key census 2026-11-25, 32 of 4,096 id slices (8,962 public cars): party_type (BaT seller line) holds a string on 231 cars, 212 of them a phone or email; seller_phone named by the lead (1 car in a 128-slice leaf sample). No other key named phone, mobile, cell, tel, contact, whatsapp, fax or mail in the sample. A key holding null is kept.', '2026-11-25'),
  ('email', 'redact', NULL, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]',
   false, NULL, NULL, 10,
   'text_redact_contact email pattern, verbatim; every leaf, URLs included, as the serialized-text regex covered', '2026-11-25'),
  ('phone', 'redact', NULL, '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', true,
   '(^|_)(id|number|chassis)$|^repost_of$', 'phone|mobile|cell|tel|contact|whatsapp|fax', 20,
   'text_redact_contact phone pattern, verbatim. Key skips from the 128-slice leaf census (1/32 of public cars), phone-shaped values under chassis_number 22, craigslist_post_id 20, chassis 17, repost_of 2, engine_number 1, auction_observation_id 1, source_snapshot_id 1, snapshot_id 1; 246 URL leaves. Never skipped: a key naming a contact.', '2026-11-25')
ON CONFLICT (rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.text_redact_by_rules(p_text text, p_rules jsonb, p_key text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE r jsonb; t text := p_text; v_segs text[]; v_urls text[]; v_out text; i int;
BEGIN
  IF t IS NULL OR pg_catalog.jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RETURN t; END IF;
  FOR r IN SELECT x FROM pg_catalog.jsonb_array_elements(p_rules) x WHERE x ->> 'action' = 'redact' LOOP
    CONTINUE WHEN r ->> 'skip_key_regex' IS NOT NULL AND p_key IS NOT NULL AND p_key ~ (r ->> 'skip_key_regex')
              AND NOT (p_key ~* (r ->> 'never_skip_key_regex'));
    IF coalesce((r ->> 'skip_url_leaves')::boolean, false) AND t ~* 'https?://' THEN
      CONTINUE WHEN t ~* '^\s*https?://\S+\s*$';           -- the leaf is one URL
      -- Redact between the URLs, never inside one.
      v_segs := pg_catalog.regexp_split_to_array(t, 'https?://\S+', 'i');
      v_urls := ARRAY(SELECT m.u[1] FROM pg_catalog.regexp_matches(t, '(https?://\S+)', 'gi') WITH ORDINALITY m(u, o) ORDER BY m.o);
      v_out := pg_catalog.regexp_replace(v_segs[1], r ->> 'pattern', r ->> 'replacement', 'g');
      FOR i IN 1 .. coalesce(pg_catalog.array_length(v_urls, 1), 0) LOOP
        v_out := v_out || v_urls[i] || pg_catalog.regexp_replace(v_segs[i + 1], r ->> 'pattern', r ->> 'replacement', 'g');
      END LOOP;
      t := v_out;
    ELSE
      t := pg_catalog.regexp_replace(t, r ->> 'pattern', r ->> 'replacement', 'g');
    END IF;
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
                        FROM pg_catalog.jsonb_each(p_j) e
                        WHERE pg_catalog.jsonb_typeof(e.value) = 'null'
                           OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rules) d
                                          WHERE d ->> 'action' = 'drop_key' AND e.key ~* (d ->> 'key_regex')))
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
  v_keys text;
  r jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_j) NOT IN ('object', 'array') THEN RETURN p_j; END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('action', c.action, 'key_regex', c.key_regex,
           'pattern', c.pattern, 'replacement', c.replacement, 'skip_url_leaves', c.skip_url_leaves,
           'skip_key_regex', c.skip_key_regex, 'never_skip_key_regex', c.never_skip_key_regex) ORDER BY c.ordinal)
    INTO v_rules FROM public.contact_redaction_rules c WHERE c.enabled;
  IF v_rules IS NULL THEN RETURN 'null'::jsonb; END IF;  -- no enabled rule: withhold, never pass raw
  -- Fast path: each rule is tried once over everything it could change, joined by newlines (keys holding a value for a
  -- drop rule, since a key holding null has nothing to withhold and is kept;
  -- string leaves for a redact rule, with URLs cut out for a rule that leaves them alone). A value no rule can change
  -- is returned as it came. Key skips are left to the walk, so this only ever walks more.
  SELECT pg_catalog.string_agg(l #>> '{}', E'\n'),
         pg_catalog.string_agg(pg_catalog.regexp_replace(l #>> '{}', 'https?://\S+', E'\n', 'gi'), E'\n')
           FILTER (WHERE (l #>> '{}') !~* '^\s*https?://\S+\s*$')
    INTO v_all, v_text
  FROM pg_catalog.jsonb_path_query(p_j, 'strict $.**') l WHERE pg_catalog.jsonb_typeof(l) = 'string';
  FOR r IN SELECT x FROM pg_catalog.jsonb_array_elements(v_rules) x LOOP
    IF r ->> 'action' = 'drop_key' THEN
      IF v_keys IS NULL THEN
        SELECT coalesce(pg_catalog.string_agg(k #>> '{}', E'\n'), '') INTO v_keys
        FROM pg_catalog.jsonb_path_query(p_j, 'strict $.** ? (@.type() == "object").keyvalue() ? (@.value.type() != "null").key') k;
      END IF;
      IF pg_catalog.regexp_like(v_keys, r ->> 'key_regex', 'wi') THEN
        RETURN public.jsonb_redact_contact_leaves(p_j, v_rules);
      END IF;
    -- 'w': ^ and $ also match at each newline, so a match inside one piece is also a match in the joined text.
    ELSIF pg_catalog.regexp_like(CASE WHEN coalesce((r ->> 'skip_url_leaves')::boolean, false) THEN v_text ELSE v_all END,
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
        -- The five owner keys are nulled at the top level directly; the recursive jsonb_mask_keys walk (90-125 ms on a
        -- 15 KB row, #3930) runs only when one of them also sits below the top level.
        FROM (SELECT CASE WHEN jsonb_typeof(p_row) = 'object' AND NOT pg_catalog.jsonb_path_exists(p_row,
                            'strict $.*.** ? (@.type() == "object" && (exists(@."purchase_price") || exists(@."purchase_date")
                             || exists(@."purchase_location") || exists(@."owner_name") || exists(@."owner_contact")))')
                          THEN p_row || coalesce((SELECT pg_catalog.jsonb_object_agg(k, 'null'::jsonb)
                                                  FROM unnest(ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) k
                                                  WHERE p_row ? k), '{}'::jsonb)
                          ELSE public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) END
                || coalesce((
                  SELECT pg_catalog.jsonb_object_agg(a.attname::text, 'null'::jsonb)
                  FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                    AND jsonb_typeof(p_row) = 'object' AND jsonb_typeof(p_row -> a.attname::text) <> 'null'
                    AND NOT pg_catalog.has_column_privilege(
                      (SELECT CASE auth.role() WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END),
                      a.attrelid, a.attnum, 'SELECT')), '{}'::jsonb) AS j OFFSET 0) r OFFSET 0) m
  -- OFFSET 0: each level is computed once. Without it the planner pulls the subqueries up and repeats r.j and m.j at
  -- every reference, so the masks ran several times a call (prod 2026-11-25, 15 KB row: inline body 236-274 ms, with
  -- the barriers 21 ms).
$function$;

DO $check$
DECLARE f record; n int;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, position('projection_origin_metadata_leaves_v1' in p.prosrc) > 0
           AND position('vehicle_row_projection_withheld_columns_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
  SELECT count(*) INTO n FROM public.contact_redaction_rules WHERE enabled AND rule_key IN ('contact_keys', 'email', 'phone');
  IF NOT (NOT f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=""'] AND f.marked AND n = 3
          AND NOT has_table_privilege('anon', 'public.contact_redaction_rules', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'UPDATE')
          AND has_table_privilege('anon', 'public.contact_redaction_rules', 'SELECT')) THEN
    RAISE EXCEPTION 'vehicle_row_public_projection or contact_redaction_rules not as intended';
  END IF;
END $check$;
COMMIT;
