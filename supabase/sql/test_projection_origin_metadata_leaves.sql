-- Empty disposable PG17 only:
--   createdb dm_refinement_leaves; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_leaves -f this-file.sql
--   (-v omig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125231500_projection_origin_metadata_leaves.sql: for a non-insider the public vehicle projection drops
-- contact-named keys of origin_metadata whole (the gate) and redacts phones and emails leaf by leaf (the backstop) with
-- the contact_redaction_rules rows: emails everywhere; phones in text, never inside a URL (a leaf that is one URL is
-- left alone, a sentence is redacted around its URLs) and never under an id/serial key unless that key names a contact;
-- every email the prior serialized-text regex redacted is still redacted; a value with nothing to change is returned
-- untouched; with no enabled rule origin_metadata is null; rule rows change the answer without a function change; the
-- rows refuse malformed rules; text_redact_contact's patterns equal the seeded rows; insiders read the raw value through
-- get_vehicle_profile_data and anon reads the redacted one; the owner keys are masked exactly as jsonb_mask_keys masks
-- them, with the recursive walk only when one sits below the top level.
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
              "repost_of": "7025550151", "auction_observation_id": "7025550152", "source_snapshot_id": ["7025550158", "7025550159"],
              "bat_url": "https://example.invalid/listing?who=x@y.invalid",
              "raw_description": "line one\n7025550153 line two \"q@r.invalid\"",
              "lot": 7025550154, "nested": [[{"deep": "e@f.invalid and (702) 555-0155"}]],
              "sentence": "see https://x.invalid/7025550161 or call 702-555-0162",
              "url_then_text": "https://a.invalid/x 702-555-0163",
              "phone_number": "7025550164", "seller_contact_id": "7025550165", "Cell_Number": "702 555 0166",
              "deep_contact": {"x": [{"Seller_Phone": {"n": "ask", "v": ["7025550167"]}}], "keep": "fine"}, "null_party": {"Party_Type": null}}'),
  ('dropobj', '{"a": "fine", "x": {"seller_phone": {"n": "ask"}}}'),
  ('dropkey', '{"seller_phone": "ask for Bob", "a": "fine"}'),
  ('clean',  '{"images": ["https://cdn.invalid/p/1.jpg"], "lot_number": "12", "note": "no contact here", "n": 5, "b": true, "z": null,
              "bat_snapshot_parsed": {"party_type": null}, "seller_phone": null}'),
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
  -- 0. Contact-named keys are dropped whole, at any depth, any case, whatever their value holds.
  ASSERT NOT (m ? 'seller_phone') AND NOT (m -> 'bat_snapshot_parsed' ? 'party_type'), '0 seller_phone and party_type dropped';
  ASSERT m -> 'deep_contact' = '{"x": [{}], "keep": "fine"}', '0 a nested, mixed-case contact key and its object dropped';
  ASSERT (SELECT r FROM om_after WHERE k = 'dropkey') = '{"a": "fine"}', '0 a contact key with no pattern in it is still dropped';
  ASSERT (SELECT r FROM om_after WHERE k = 'dropobj') = '{"a": "fine", "x": {}}', '0 an object under a contact key alone still walks';
  ASSERT m -> 'null_party' = '{"Party_Type": null}', '0 a contact key holding null is kept (nothing to withhold)';
  ASSERT m -> 'bat_snapshot_parsed' -> 'features' = '["a", "ring [contact through Nuke]"]', '1 array of text under a key';
  ASSERT m -> 'nested' = '[[{"deep": "[contact through Nuke] and [contact through Nuke]"}]]', '1 nested arrays and objects';
  ASSERT m ->> 'raw_description' = E'line one\n[contact through Nuke] line two "[contact through Nuke]"',
    '1 decoded leaf: a phone after a newline and an email inside quotes';
  ASSERT m ->> 'sentence' = 'see https://x.invalid/7025550161 or call [contact through Nuke]', '1 a sentence: redacted around its URL';
  ASSERT m ->> 'url_then_text' = 'https://a.invalid/x [contact through Nuke]', '1 a leaf that starts with a URL but is not one';
  -- 1b. An id/serial key skip never applies to a key that names a contact.
  ASSERT m ->> 'phone_number' = '[contact through Nuke]' AND m ->> 'seller_contact_id' = '[contact through Nuke]'
     AND m ->> 'Cell_Number' = '[contact through Nuke]', '1b contact-named id/number keys are redacted';
  -- 2. URL leaves keep their digits; id and serial keys keep their values.
  ASSERT m -> 'images' = src -> 'images' AND m -> 'thumbnail_url' = src -> 'thumbnail_url'
     AND m -> 'discovery_url' = src -> 'discovery_url', '2 URL leaves the page renders are untouched';
  ASSERT m -> 'chassis_number' = src -> 'chassis_number' AND m -> 'craigslist_post_id' = src -> 'craigslist_post_id'
     AND m -> 'engine_number' = src -> 'engine_number' AND m -> 'repost_of' = src -> 'repost_of'
     AND m -> 'auction_observation_id' = src -> 'auction_observation_id' AND m -> 'source_snapshot_id' = src -> 'source_snapshot_id'
     AND m -> 'bat_snapshot_parsed' -> 'chassis' = src -> 'bat_snapshot_parsed' -> 'chassis', '2 id and serial keys are untouched';
  -- A number is walked as its text (lead ruling, 2026-11-25): a 10-digit phone-shaped number under a key no rule skips
  -- is redacted like the same digits in a string.
  ASSERT m -> 'lot' = '"[contact through Nuke]"'::jsonb, format('2 a phone-shaped number is walked as text: %s', m -> 'lot');
  -- 3. Emails are redacted in URL leaves too, as the serialized-text regex did; keys are kept.
  ASSERT m ->> 'bat_url' = 'https://example.invalid/listing?who=[contact through Nuke]', '3 email inside a URL';
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)
       = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(src) k WHERE k <> 'seller_phone'), '3 every other key kept';
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
           -> 'origin_metadata' ->> 'sentence' = 'see https://x.invalid/7025550161 or call 702-555-0162', '7 phone rule disabled: phone passes';
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
      INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
        VALUES ('bad', 'redact', p, 'x', false, 99, 'contract case: must be refused', '2026-11-25');
    EXCEPTION WHEN check_violation OR invalid_regular_expression THEN ok := true;
    END;
    ASSERT ok, format('8 pattern %L refused', p);
  END LOOP;
  ok := false;
  BEGIN
    INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, skip_key_regex, never_skip_key_regex, ordinal, reason, measured_at)
      VALUES ('bad2', 'redact', 'x\d', 'x', false, '(', 'phone', 98, 'contract case: must be refused', '2026-11-25');
  EXCEPTION WHEN check_violation OR invalid_regular_expression THEN ok := true;
  END;
  ASSERT ok, '8 skip_key_regex that does not compile refused';
  ok := false;
  BEGIN
    INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_key_regex, ordinal, reason, measured_at)
      VALUES ('bad3', 'redact', 'x\d', 'x', '_id$', 97, 'contract case: must be refused', '2026-11-25');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, '8 a key skip without a never-skip refused';
  FOREACH p IN ARRAY ARRAY['.*', 'x*', ''] LOOP
    ok := false;
    BEGIN
      INSERT INTO public.contact_redaction_rules (rule_key, action, key_regex, ordinal, reason, measured_at)
        VALUES ('bad4', 'drop_key', p, 96, 'contract case: must be refused', '2026-11-25');
    EXCEPTION WHEN check_violation THEN ok := true;
    END;
    ASSERT ok, format('8 drop key regex %L refused', p);
  END LOOP;
  ok := false;
  BEGIN
    INSERT INTO public.contact_redaction_rules (rule_key, action, key_regex, pattern, replacement, ordinal, reason, measured_at)
      VALUES ('bad5', 'drop_key', '^x$', 'x\d', 'x', 95, 'contract case: must be refused', '2026-11-25');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, '8 a drop rule carrying a pattern refused';
  ASSERT has_table_privilege('anon', 'public.contact_redaction_rules', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.contact_redaction_rules', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.contact_redaction_rules', 'DELETE'), '8 grants';
END $$;

-- 9. text_redact_contact's two patterns are the seeded rows, verbatim, and on text with no URL the rows give its answer.
DO $$
DECLARE src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.text_redact_contact(text)'::regprocedure);
        rules jsonb := (SELECT jsonb_agg(jsonb_build_object('action', action, 'key_regex', key_regex, 'pattern', pattern,
                          'replacement', replacement, 'skip_url_leaves', skip_url_leaves, 'skip_key_regex', skip_key_regex,
                          'never_skip_key_regex', never_skip_key_regex) ORDER BY ordinal)
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
INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
  VALUES ('anchored', 'redact', '^SECRET-\d+$', '[gone]', false, 30, 'contract case: anchored whole-leaf rule', '2026-11-25');
DO $$ BEGIN
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": ["x", "SECRET-42"]}'::jsonb) = '{"a": "first leaf", "b": ["x", "[gone]"]}',
    '11 anchored rule on a later leaf';
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": "not SECRET-42"}'::jsonb) = '{"a": "first leaf", "b": "not SECRET-42"}',
    '11 anchored rule does not match mid-leaf';
  ASSERT public.jsonb_redact_contact('{"u": "https://h.invalid/7025550160", "t": "fine"}'::jsonb)::text
       = '{"t": "fine", "u": "https://h.invalid/7025550160"}', '11 URL-only phone shape: returned as it came';
  ASSERT public.jsonb_redact_contact('{"u": "https://h.invalid/?e=s@t.invalid", "t": "fine"}'::jsonb)
       = '{"t": "fine", "u": "https://h.invalid/?e=[contact through Nuke]"}', '11 an email only inside a URL still walks';
  ASSERT public.jsonb_redact_contact('{"a": "see https://h.invalid/7025550170 now", "b": "x https://h.invalid/1"}'::jsonb)::text
       = '{"a": "see https://h.invalid/7025550170 now", "b": "x https://h.invalid/1"}', '11 a phone shape only inside URLs of sentences: as it came';
  ASSERT public.jsonb_redact_contact('{"a": "702 https://h.invalid/ 555-0171"}'::jsonb)
       = '{"a": "702 https://h.invalid/ 555-0171"}', '11 digits on both sides of a URL are not joined into a phone';
  ASSERT public.jsonb_redact_contact('{"a": "https://h.invalid/x 702-555-0190"}'::jsonb)
       = '{"a": "https://h.invalid/x [contact through Nuke]"}', '11 a leaf that starts with a URL is tried by the fast path';
  ASSERT public.jsonb_redact_contact('{"a": {"Party_Type": "ask"}}'::jsonb) = '{"a": {}}', '11 a contact key alone walks';
END $$;
ROLLBACK;
-- 11a. A negative lookaround on a class with no newline is allowed and agrees at a leaf edge: the seeded phone rule's
--      (?![0-9]) before a next leaf that starts with a digit (joined, it sees the newline, not the digit).
DO $$ BEGIN
  ASSERT public.jsonb_redact_contact('{"a": "call 702-555-1234", "b": "5 cars"}'::jsonb)
       = '{"a": "call [contact through Nuke]", "b": "5 cars"}', '11a leaf-final phone before a digit-led leaf';
  ASSERT public.jsonb_redact_contact('["702-555-1234"]'::jsonb) = '["[contact through Nuke]"]', '11a phone alone';
END $$;
BEGIN;
INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
  VALUES ('ok_lookaround', 'redact', '(?<![_])ZZ\d{2}(?![a-z])(?!\w)', '[gone]', false, 32, 'contract case: allowed lookarounds', '2026-11-25');
DO $$ BEGIN
  ASSERT public.jsonb_redact_contact('["x ZZ12", "ab"]'::jsonb) = '["x [gone]", "ab"]', '11a allowed lookarounds: leaf-final match redacted';
END $$;
ROLLBACK;
-- 11b. Positive lookarounds stay allowed: across the joined newline they can only find more, never less, so the fast
--      path still sends every leaf the walk would change to the walk.
BEGIN;
INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
  VALUES ('lookahead', 'redact', 'SECRET\d{3}(?=\s)', '[gone]', false, 31, 'contract case: positive lookahead rule', '2026-11-25');
DO $$ BEGIN
  ASSERT public.jsonb_redact_contact('["SECRET123", "later leaf"]'::jsonb) = '["SECRET123", "later leaf"]',
    '11b leaf-final match is not redacted by the walk, and the joined text does not force a change';
  ASSERT public.jsonb_redact_contact('["first", "SECRET123 x"]'::jsonb) = '["first", "[gone] x"]', '11b mid-leaf lookahead redacted';
END $$;
ROLLBACK;

-- 12. Owner keys: masked as jsonb_mask_keys masks them, top level directly, the recursive walk only when one is nested.
DO $$
DECLARE k text[] := ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'];
        r jsonb; rows jsonb[] := ARRAY[
  '{"id": "a", "owner_name": "N", "purchase_price": 5, "make": "M", "value_breakdown": {"x": [1, {"y": 2}]}}',
  '{"id": "b", "make": "M", "owner_contact": null}',
  '{"id": "c", "value_breakdown": {"purchase_price": 9, "z": [{"owner_name": "N"}]}, "purchase_date": "2020-01-01"}',
  '{"id": "d", "origin_metadata": {"a": "fine", "owner_contact": "o"}}',
  '{"id": "e"}']::jsonb[];
BEGIN
  FOREACH r IN ARRAY rows LOOP
    ASSERT public.vehicle_row_public_projection(r) - 'origin_metadata' = public.jsonb_mask_keys(r, k) - 'origin_metadata',
      format('12 same mask as jsonb_mask_keys for %s', r ->> 'id');
  END LOOP;
  ASSERT public.vehicle_row_public_projection(rows[3]) -> 'value_breakdown' = '{"purchase_price": null, "z": [{"owner_name": null}]}',
    '12 nested owner keys still masked';
  ASSERT public.vehicle_row_public_projection(rows[4]) -> 'origin_metadata' = '{"a": "fine", "owner_contact": null}',
    '12 a nested owner key in origin_metadata still masked';
  ASSERT position('jsonb_path_exists' in (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure)) > 0,
    '12 the walk is gated';
END $$;
-- 13. Each step runs once a call: the OFFSET 0 barriers keep the planner from repeating r.j and m.j at every reference.
BEGIN;
SET LOCAL track_functions = 'all';
DO $$
DECLARE c0 bigint; d0 bigint; w jsonb;
BEGIN
  c0 := coalesce(pg_stat_get_xact_function_calls('public.jsonb_redact_contact(jsonb)'::regprocedure), 0);
  d0 := coalesce(pg_stat_get_xact_function_calls('public.text_redact_contact(text)'::regprocedure), 0);
  w := public.vehicle_row_public_projection('{"id": "t", "description": "call 702-555-0180", "origin_metadata": {"a": "702-555-0181"},
                                              "value_breakdown": {"owner_name": "N"}}'::jsonb);
  ASSERT coalesce(pg_stat_get_xact_function_calls('public.jsonb_redact_contact(jsonb)'::regprocedure), 0) - c0 = 1
     AND coalesce(pg_stat_get_xact_function_calls('public.text_redact_contact(text)'::regprocedure), 0) - d0 = 1,
    format('13 one call each, got %s and %s',
           coalesce(pg_stat_get_xact_function_calls('public.jsonb_redact_contact(jsonb)'::regprocedure), 0) - c0,
           coalesce(pg_stat_get_xact_function_calls('public.text_redact_contact(text)'::regprocedure), 0) - d0);
  ASSERT w -> 'origin_metadata' ->> 'a' = '[contact through Nuke]' AND w ->> 'description' NOT LIKE '%555-0180%', '13 answer';
END $$;
ROLLBACK;
-- Corpus for the equivalence runs: contact text, tokens and keys in the first leaf, a later leaf, at leaf starts and
-- ends, beside URLs, nested in arrays and objects, and values with nothing to change.
CREATE TABLE public.om_corpus (n int PRIMARY KEY, j jsonb NOT NULL);
INSERT INTO public.om_corpus VALUES
  (1, '{"a": "first leaf", "b": "SECRET-42"}'), (2, '{"b": "SECRET-42"}'), (3, '["SECRET123", "later leaf"]'),
  (4, '["later leaf", "SECRET123"]'), (5, '{"a": "x", "b": "PRIVATEdata"}'), (6, '{"a": "call 555-1234", "b": "y"}'),
  (7, '{"a": "first leaf", "b": "TOKENabc"}'), (8, '{"a": "call 702-555-1234", "b": "5 cars"}'),
  (9, '{"a": "5 cars", "b": "702-555-1234"}'), (10, '{"x": {"y": ["no", {"z": "mail s@t.invalid now"}]}}'),
  (11, '{"seller_phone": "702-555-0100", "k": "v"}'), (12, '{"a": {"Party_Type": "Private Party: 702 555 0101"}}'),
  (13, '{"party_type": null, "note": "nothing here"}'), (14, '{"u": "https://h.invalid/7025550160", "t": "fine"}'),
  (15, '{"a": "see https://h.invalid/x 702-555-0190 or s@t.invalid"}'), (16, '{"chassis_number": "702-555-0102", "phone_number": "702-555-0103"}'),
  (17, '[]'), (18, '{}'), (19, '{"n": 7025550104, "b": true}'), (20, '{"a": "line one\nSECRET-7\nline three"}'),
  (21, '{"a": "702-555-0105", "b": "x"}'), (22, '[["a"], ["b", "SECRET-9"]]'), (23, '{"Cell_Number": "x 702.555.0106"}');

-- 14. Every rule whose prefilter_proven_pattern_md5 matches its definition as it stands, read from the table: with that
--     rule alone enabled, and with all such rules together, the fast path's answer equals the leaf-by-leaf walk on every
--     corpus value. A rule keyed as proven without this holding fails here.
BEGIN;
DO $$
DECLARE r record; c record; rules jsonb; bad text[] := '{}'; flagged int := 0;
BEGIN
  FOR r IN SELECT rule_key FROM public.contact_redaction_rules
            WHERE prefilter_proven_pattern_md5 = public.contact_redaction_rule_proof_md5(action, key_regex, pattern)
           UNION ALL SELECT '*all flagged*' LOOP
    UPDATE public.contact_redaction_rules SET enabled = (CASE WHEN r.rule_key = '*all flagged*'
        THEN coalesce(prefilter_proven_pattern_md5 = public.contact_redaction_rule_proof_md5(action, key_regex, pattern), false)
        ELSE rule_key = r.rule_key END);
    SELECT jsonb_agg(jsonb_build_object('action', x.action, 'key_regex', x.key_regex, 'pattern', x.pattern,
             'replacement', x.replacement, 'skip_url_leaves', x.skip_url_leaves, 'skip_key_regex', x.skip_key_regex,
             'never_skip_key_regex', x.never_skip_key_regex) ORDER BY x.ordinal)
      INTO rules FROM public.contact_redaction_rules x WHERE x.enabled;
    IF r.rule_key <> '*all flagged*' THEN flagged := flagged + 1; END IF;
    FOR c IN SELECT * FROM public.om_corpus ORDER BY n LOOP
      IF public.jsonb_redact_contact(c.j) IS DISTINCT FROM public.jsonb_redact_contact_leaves(c.j, rules) THEN
        bad := bad || format('%s on corpus %s', r.rule_key, c.n);
      END IF;
    END LOOP;
  END LOOP;
  ASSERT flagged >= 3, format('14 the three seeded rules carry a matching proof key (%s)', flagged);
  ASSERT cardinality(bad) = 0, format('14 joined answer differs from the walk: %s', bad);
END $$;
ROLLBACK;

-- 15. A new rule is exact by default: prefilter_proven_pattern_md5 defaults to null, and such a rule is applied leaf by leaf,
--     so skeptic2's probes (embedded (?s), negative lookarounds at leaf edges) redact a later leaf as the walk does.
BEGIN;
INSERT INTO public.contact_redaction_rules (rule_key, action, pattern, replacement, skip_url_leaves, ordinal, reason, measured_at)
  VALUES ('probe_s', 'redact', '(?s)^SECRET-\d+', '[gone]', false, 41, 'contract case: unproven rule', '2026-11-25'),
         ('probe_lb', 'redact', '(?<!.)PRIVATE\w+', '[gone]', false, 42, 'contract case: unproven rule', '2026-11-25'),
         ('probe_la', 'redact', '\d{3}-\d{4}(?!.)', '[gone]', false, 43, 'contract case: unproven rule', '2026-11-25'),
         ('probe_tok', 'redact', '(?<!.)TOKEN\w+', '[gone]', false, 44, 'contract case: unproven rule', '2026-11-25'),
         ('probe_sp', 'redact', 'SECRET\d{3}(?!\s)', '[gone]', false, 45, 'contract case: unproven rule', '2026-11-25');
DO $$ BEGIN
  ASSERT (SELECT bool_and(prefilter_proven_pattern_md5 IS NULL) FROM public.contact_redaction_rules WHERE rule_key LIKE 'probe_%'),
    '15 the proof key defaults to null';
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": "SECRET-42"}') = '{"a": "first leaf", "b": "[gone]"}', '15 (?s)^ on a later leaf';
  ASSERT public.jsonb_redact_contact('{"a": "x", "b": "PRIVATEdata"}') = '{"a": "x", "b": "[gone]"}', '15 (?<!.) on a later leaf';
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": "TOKENabc"}') = '{"a": "first leaf", "b": "[gone]"}', '15 (?<!.) token';
  ASSERT public.jsonb_redact_contact('["SECRET123", "later leaf"]') = '["[gone]", "later leaf"]', '15 (?!\s) at a leaf end';
END $$;
ROLLBACK;

-- 16. The proof is keyed to the pattern it proved: skeptic2's edit of a proven rule (email's pattern to (?s)^SECRET-\d+,
--     which passes the CHECK) leaves its proof key stale, so the rule falls to the walk and a later leaf is redacted.
--     Restoring the proved pattern restores the fast path's eligibility with no other write.
BEGIN;
UPDATE public.contact_redaction_rules SET pattern = '(?s)^SECRET-\d+', replacement = '[gone]' WHERE rule_key = 'email';
DO $$ BEGIN
  ASSERT (SELECT prefilter_proven_pattern_md5 <> public.contact_redaction_rule_proof_md5(action, key_regex, pattern)
            FROM public.contact_redaction_rules WHERE rule_key = 'email'), '16 the edit leaves the proof key stale';
  ASSERT public.jsonb_redact_contact('{"a": "first leaf", "b": "SECRET-42"}') = '{"a": "first leaf", "b": "[gone]"}',
    format('16 an edited pattern is walked: %s', public.jsonb_redact_contact('{"a": "first leaf", "b": "SECRET-42"}'));
  ASSERT public.jsonb_redact_contact('{"b": "SECRET-42"}') = '{"b": "[gone]"}', '16 single leaf';
END $$;
ROLLBACK;

-- 17. Numbers. A key a drop rule names is dropped whatever its value's type (number, string, array, object). A number
--     under any other key is walked as its text: a 10-digit phone-shaped number becomes the replacement (a contact key
--     is never skipped), a number under a skipped id key stays, a short number stays a number; the fast path and the
--     walk agree (the corpus row 19 and these).
DO $$
DECLARE v jsonb; rules jsonb;
BEGIN
  FOREACH v IN ARRAY ARRAY['7025551234', '"702-555-1234"', '[7025551234]', '{"n": 7025551234}']::jsonb[] LOOP
    ASSERT public.jsonb_redact_contact(jsonb_build_object('party_type', v, 'k', 1)) = '{"k": 1}',
      format('17 party_type holding %s is dropped', v);
    ASSERT public.jsonb_redact_contact(jsonb_build_object('a', jsonb_build_object('Seller_Phone', v), 'k', 1)) = '{"a": {}, "k": 1}',
      format('17 nested Seller_Phone holding %s is dropped', v);
  END LOOP;
  ASSERT public.jsonb_redact_contact('{"phone": 7025551234}') = '{"phone": "[contact through Nuke]"}',
    format('17 numeric phone under a contact key: %s', public.jsonb_redact_contact('{"phone": 7025551234}'));
  ASSERT public.jsonb_redact_contact('{"chassis_number": 7025551234, "price": 45000, "miles": 12345678, "timestamp_end": 1700000000}')
       = '{"chassis_number": 7025551234, "price": 45000, "miles": 12345678, "timestamp_end": 1700000000}',
    '17 skipped id and epoch keys and short numbers stay numbers';
  ASSERT public.jsonb_redact_contact('{"x": [1, {"y": 7025550199}]}') = '{"x": [1, {"y": "[contact through Nuke]"}]}',
    format('17 nested numeric phone: %s', public.jsonb_redact_contact('{"x": [1, {"y": 7025550199}]}'));
  SELECT jsonb_agg(jsonb_build_object('action', x.action, 'key_regex', x.key_regex, 'pattern', x.pattern,
           'replacement', x.replacement, 'skip_url_leaves', x.skip_url_leaves, 'skip_key_regex', x.skip_key_regex,
           'never_skip_key_regex', x.never_skip_key_regex) ORDER BY x.ordinal) INTO rules
    FROM public.contact_redaction_rules x WHERE x.enabled;
  FOREACH v IN ARRAY ARRAY['{"phone": 7025551234}', '{"n": 7025550104, "b": true}', '{"price": 45000}',
                           '{"chassis_number": 7025551234}', '[7025551234, "x"]', '{"timestamp_end": 1700000000}']::jsonb[] LOOP
    ASSERT public.jsonb_redact_contact(v) = public.jsonb_redact_contact_leaves(v, rules), format('17 fast = walk on %s', v);
  END LOOP;
END $$;

SELECT 'PASS: the public projection redacts origin_metadata leaf by leaf with contact rule rows' AS result;
