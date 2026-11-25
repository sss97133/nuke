-- Empty disposable PG17 only:
--   createdb dm_refinement_leaves; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_leaves -f this-file.sql
--   (-v omig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125231500_projection_origin_metadata_leaves.sql: the public vehicle projection redacts origin_metadata
-- string leaf by string leaf with the contact_redaction_rules rows: phones and emails in text leaves, emails in URL
-- leaves, never a phone-shaped run inside a URL or under an id/serial key; every email the prior serialized-text regex
-- redacted is still redacted; a value with nothing to redact is returned untouched; with no enabled rule origin_metadata
-- is null; rule rows change the answer without a function change; the rows refuse a pattern that does not compile or
-- matches nothing-at-all; text_redact_contact's patterns equal the seeded rows; insiders read the raw value through
-- get_vehicle_profile_data and anon reads the redacted one.
\set ON_ERROR_STOP on
\if :{?omig}
\else
  \set omig ../migrations/20261125231500_projection_origin_metadata_leaves.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
\ir ../migrations/20261125202000_vehicle_row_projection_withheld_columns.sql

-- Made-up values in an empty disposable PG17 database, never production.
CREATE TEMP TABLE om_case (k text PRIMARY KEY, om jsonb);
INSERT INTO om_case VALUES
  ('mixed', '{"seller_phone": "call (702) 555-0142 today",
              "bat_snapshot_parsed": {"party_type": "Dealer: Desert Cars, 702.555.0143, sales@desert.invalid",
                                      "chassis": "1234567890123", "features": ["a", "ring 702-555-0144"]},
              "images": ["https://cdn.invalid/p/1234567890.jpg", "https://cdn.invalid/p/7025550145.jpg"],
              "thumbnail_url": "https://cdn.invalid/t/7025550146.jpg",
              "discovery_url": "https://example.invalid/post/7025550147.html",
              "chassis_number": "7025550148", "craigslist_post_id": "7025550149", "engine_number": "702 555 0150",
              "repost_of": "7025550151", "auction_observation_id": "7025550152", "craigslist_post_ids": ["7025550158", "7025550159"],
              "bat_url": "https://example.invalid/listing?who=x@y.invalid",
              "raw_description": "line one\n7025550153 line two \"q@r.invalid\"",
              "lot": 7025550154, "nested": [[{"deep": "e@f.invalid and (702) 555-0155"}]]}'),
  ('clean',  '{"images": ["https://cdn.invalid/p/1.jpg"], "lot_number": "12", "note": "no contact here", "n": 5, "b": true, "z": null}'),
  ('emails', '{"a": "x@y.invalid", "b": ["he said \"p@q.invalid\"", {"c": "mailto:m@n.invalid"}], "u": "https://h.invalid/?e=s@t.invalid"}'),
  ('array',  '["call 702-555-0156", "https://cdn.invalid/7025550157.jpg"]');

CREATE TEMP TABLE om_before AS
  SELECT k, public.vehicle_row_public_projection(jsonb_build_object('id', k, 'origin_metadata', om)) -> 'origin_metadata' AS r FROM om_case;
DO $$ BEGIN
  ASSERT (SELECT r ->> 'seller_phone' FROM om_before WHERE k = 'mixed') LIKE '%555-0142%',
    'the defect reproduces on the prior body: a phone leaf passes';
END $$;

-- Prod's default privileges for tables postgres creates in public (pg_default_acl, read 2026-11-25): ALL to anon,
-- authenticated and service_role, so a new table is writable by anon unless its migration revokes it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\ir :omig
\ir :omig

CREATE TEMP TABLE om_after AS
  SELECT k, public.vehicle_row_public_projection(jsonb_build_object('id', k, 'origin_metadata', om)) -> 'origin_metadata' AS r FROM om_case;

DO $$
DECLARE m jsonb := (SELECT r FROM om_after WHERE k = 'mixed'); src jsonb := (SELECT om FROM om_case WHERE k = 'mixed');
BEGIN
  -- 1. Phones and emails in text leaves are redacted, at any depth and inside arrays.
  ASSERT m ->> 'seller_phone' = 'call [contact through Nuke] today', '1 seller_phone';
  ASSERT m -> 'bat_snapshot_parsed' ->> 'party_type' = 'Dealer: Desert Cars, [contact through Nuke], [contact through Nuke]', '1 party_type';
  ASSERT m -> 'bat_snapshot_parsed' -> 'features' = '["a", "ring [contact through Nuke]"]', '1 array of text under a key';
  ASSERT m -> 'nested' = '[[{"deep": "[contact through Nuke] and [contact through Nuke]"}]]', '1 nested arrays and objects';
  ASSERT m ->> 'raw_description' = E'line one\n[contact through Nuke] line two "[contact through Nuke]"',
    '1 decoded leaf: a phone after a newline and an email inside quotes';
  -- 2. URL leaves keep their digits; id and serial keys keep their values; numbers are not strings.
  ASSERT m -> 'images' = src -> 'images' AND m -> 'thumbnail_url' = src -> 'thumbnail_url'
     AND m -> 'discovery_url' = src -> 'discovery_url', '2 URL leaves the page renders are untouched';
  ASSERT m -> 'chassis_number' = src -> 'chassis_number' AND m -> 'craigslist_post_id' = src -> 'craigslist_post_id'
     AND m -> 'engine_number' = src -> 'engine_number' AND m -> 'repost_of' = src -> 'repost_of'
     AND m -> 'auction_observation_id' = src -> 'auction_observation_id' AND m -> 'craigslist_post_ids' = src -> 'craigslist_post_ids'
     AND m -> 'bat_snapshot_parsed' -> 'chassis' = src -> 'bat_snapshot_parsed' -> 'chassis', '2 id and serial keys are untouched';
  ASSERT m -> 'lot' = '7025550154'::jsonb, '2 a json number is not a string leaf';
  -- 3. Emails are redacted in URL leaves too, as the serialized-text regex did; keys are kept.
  ASSERT m ->> 'bat_url' = 'https://example.invalid/listing?who=[contact through Nuke]', '3 email inside a URL';
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(src) k),
    '3 keys kept';
  -- 4. A top-level array is walked the same way, its elements under no key.
  ASSERT (SELECT r FROM om_after WHERE k = 'array') = '["call [contact through Nuke]", "https://cdn.invalid/7025550157.jpg"]', '4 array';
END $$;

-- 5. Every email the prior body redacted is still redacted: with no phone in the value, both bodies agree.
DO $$ BEGIN
  ASSERT (SELECT r FROM om_after WHERE k = 'emails') = (SELECT r FROM om_before WHERE k = 'emails'), '5 email-only value as before';
  ASSERT (SELECT r::text FROM om_after WHERE k = 'emails') NOT LIKE '%.invalid"%' , '5 no email survives';
  ASSERT (SELECT count(*) FROM om_after, regexp_matches(r::text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', 'g') x) = 0,
    '5 no email anywhere in any answer';
END $$;

-- 6. Nothing to redact: the value comes back untouched (text identical).
DO $$ BEGIN
  ASSERT (SELECT r::text FROM om_after WHERE k = 'clean') = (SELECT om::text FROM om_case WHERE k = 'clean'), '6 clean value untouched';
  ASSERT public.vehicle_row_public_projection('{"id": "s", "origin_metadata": "a string"}'::jsonb) -> 'origin_metadata' = '"a string"',
    '6 a non-container origin_metadata is left as it was';
END $$;

-- 7. Rule rows decide, read at call time: the function body does not change.
CREATE TEMP TABLE om_body AS SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') AS sha FROM pg_proc
 WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
BEGIN;
UPDATE public.contact_redaction_rules SET enabled = false WHERE rule_key = 'phone';
DO $$ BEGIN
  ASSERT public.vehicle_row_public_projection(jsonb_build_object('origin_metadata', (SELECT om FROM om_case WHERE k = 'mixed')))
           -> 'origin_metadata' ->> 'seller_phone' = 'call (702) 555-0142 today', '7 phone rule disabled: phone passes';
END $$;
UPDATE public.contact_redaction_rules SET enabled = false;
DO $$ DECLARE r jsonb := public.vehicle_row_public_projection('{"id": "v", "make": "M", "origin_metadata": {"a": "b"}}'::jsonb);
BEGIN
  ASSERT r -> 'origin_metadata' = 'null'::jsonb AND r ->> 'make' = 'M', '7 no enabled rule: origin_metadata withheld, the rest kept';
END $$;
ROLLBACK;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure) = (SELECT sha FROM om_body), '7 function unchanged';
END $$;

-- 8. The rows refuse a broken or match-everything pattern; anon and authenticated read them and cannot write them.
DO $$
DECLARE p text; ok boolean;
BEGIN
  FOREACH p IN ARRAY ARRAY['(', '.*', 'a*', '', '\Ax\d', 'x\d\Z'] LOOP
    ok := false;
    BEGIN
      INSERT INTO public.contact_redaction_rules (rule_key, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
        VALUES ('bad', p, 'x', false, 99, 'contract case: must be refused', '2026-11-25');
    EXCEPTION WHEN check_violation OR invalid_regular_expression THEN ok := true;
    END;
    ASSERT ok, format('8 pattern %L refused', p);
  END LOOP;
  ok := false;
  BEGIN
    INSERT INTO public.contact_redaction_rules (rule_key, pattern, replacement, skip_url_leaves, skip_key_regex, ordinal, reason, measured_at)
      VALUES ('bad2', 'x\d', 'x', false, '(', 98, 'contract case: must be refused', '2026-11-25');
  EXCEPTION WHEN check_violation OR invalid_regular_expression THEN ok := true;
  END;
  ASSERT ok, '8 skip_key_regex that does not compile refused';
  ASSERT has_table_privilege('anon', 'public.contact_redaction_rules', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.contact_redaction_rules', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'DELETE'), '8 grants';
END $$;

-- 9. text_redact_contact's two patterns are the seeded rows, verbatim, and on text with no URL the rows give its answer.
DO $$
DECLARE src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.text_redact_contact(text)'::regprocedure);
        rules jsonb := (SELECT jsonb_agg(jsonb_build_object('pattern', pattern, 'replacement', replacement,
                          'skip_url_leaves', skip_url_leaves, 'skip_key_regex', skip_key_regex) ORDER BY ordinal)
                        FROM public.contact_redaction_rules WHERE enabled);
        t text;
BEGIN
  ASSERT (SELECT bool_and(position('''' || replace(pattern, '''', '''''') || '''' in src) > 0 AND position('''' || replacement || '''' in src) > 0)
          FROM public.contact_redaction_rules WHERE rule_key IN ('email', 'phone')), '9 rows copy text_redact_contact';
  FOREACH t IN ARRAY ARRAY['call (702) 555-0142', 'x@y.invalid or 702.555.0143', 'none', E'a\n7025550144', '7025550145x', ''] LOOP
    ASSERT public.text_redact_by_rules(t, rules, NULL) = public.text_redact_contact(t), format('9 same answer for %L', t);
  END LOOP;
END $$;

-- 10. Through the profile reader: anon reads the redacted value on a public car, the owner the raw one.
INSERT INTO auth.users (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.profiles (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.vehicles (id, is_public, owner_id, make, origin_metadata)
  SELECT '11111111-1111-4111-8111-111111111111', true, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'M', om FROM om_case WHERE k = 'mixed';
DO $$ BEGIN
  PERFORM public.t_claims('');
  ASSERT public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')::jsonb -> 'vehicle' -> 'origin_metadata'
           = (SELECT r FROM om_after WHERE k = 'mixed'), '10 anon reads the redacted origin_metadata';
  PERFORM public.t_claims('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  ASSERT public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')::jsonb -> 'vehicle' -> 'origin_metadata'
           = (SELECT om FROM om_case WHERE k = 'mixed'), '10 the owner reads it raw';
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
-- 11. The fast path tries each rule once over the joined leaves; a rule anchored with ^ or $ still finds a later leaf.
BEGIN;
INSERT INTO public.contact_redaction_rules (rule_key, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
  VALUES ('anchored', '^SECRET-\d+$', '[gone]', false, 30, 'contract case: anchored whole-leaf rule', '2026-11-25');
DO $$ BEGIN
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": ["x", "SECRET-42"]}'::jsonb) = '{"a": "first leaf", "b": ["x", "[gone]"]}',
    '11 anchored rule on a later leaf';
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": "not SECRET-42"}'::jsonb) = '{"a": "first leaf", "b": "not SECRET-42"}',
    '11 anchored rule does not match mid-leaf';
  ASSERT public.jsonb_redact_contact('{"u": "https://h.invalid/7025550160", "t": "fine"}'::jsonb)::text
       = '{"t": "fine", "u": "https://h.invalid/7025550160"}', '11 URL-only phone shape: returned as it came';
  ASSERT public.jsonb_redact_contact('{"u": "https://h.invalid/?e=s@t.invalid", "t": "fine"}'::jsonb)
       = '{"t": "fine", "u": "https://h.invalid/?e=[contact through Nuke]"}', '11 an email only inside a URL still walks';
END $$;
ROLLBACK;
SELECT 'PASS: the public projection redacts origin_metadata leaf by leaf with contact rule rows' AS result;
