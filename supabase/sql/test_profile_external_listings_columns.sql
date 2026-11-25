-- Empty disposable PG17 only:
--   createdb dm_refinement_profile; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_profile -f this-file.sql
--   (-v lmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125221500_profile_external_listings_columns.sql: get_vehicle_profile_data's external_listings key hands a
-- non-insider only the external_listings columns their role may SELECT (none today, so an empty list), never
-- reserve_price, with grants read at call time; insiders and the service role read the rows exactly as before; nothing
-- else in the answer changes. Builds on the 20261125220000 contract and its fixture (it leaves both cars, the callers
-- and that body in place).
\set ON_ERROR_STOP on
\if :{?lmig}
\else
  \set lmig ../migrations/20261125221500_profile_external_listings_columns.sql
\endif
\ir test_profile_timeline_private_sources.sql

-- Fixture rows in an empty disposable PG17 database, never production.
INSERT INTO public.external_listings (id, vehicle_id, platform, listing_url, listing_status, current_bid, reserve_price,
  commission_rate, affiliate_link, metadata, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'fixture_house', 'https://example.invalid/lot/1',
   'active', 1000, 4242, 0.05, 'https://example.invalid/aff', '{"note":"fixture"}', '2026-01-01'),
  ('b0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'fixture_house', 'https://example.invalid/lot/2',
   'sold', 2000, null, null, null, null, '2026-02-01'),
  ('b0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'fixture_house', 'https://example.invalid/lot/3',
   'active', 3000, 5151, null, null, null, '2026-03-01');

TRUNCATE public.tp_answers;
BEGIN; SELECT pg_temp.capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.ans('before', 'anon', '11111111-1111-4111-8111-111111111111')->'external_listings') e
                 WHERE e->>'reserve_price' = '4242'),
    'the defect reproduces on the prior body: anon reads reserve_price';
END $$;

\ir :lmig
\ir :lmig
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE pub uuid := '11111111-1111-4111-8111-111111111111'; priv uuid := '22222222-2222-4222-8222-222222222222'; k text; n int;
BEGIN
  -- 1. With today's grants (none on external_listings) a non-insider reads an empty list.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims','author'] LOOP
    ASSERT pg_temp.ans('after', k, pub)->'external_listings' = '[]'::jsonb, format('1 %s reads no listing columns', k);
    ASSERT pg_temp.ans('after', k, pub)::text NOT LIKE '%4242%' AND pg_temp.ans('after', k, pub)::text NOT LIKE '%example.invalid/aff%',
      format('1 %s answer carries no reserve or affiliate value', k);
  END LOOP;
  -- 2. Insiders and the service role read the listings exactly as before.
  ASSERT pg_temp.ans('after', 'owner', pub)->'external_listings' = pg_temp.ans('before', 'owner', pub)->'external_listings'
     AND jsonb_array_length(pg_temp.ans('after', 'owner', pub)->'external_listings') = 2, '2 owner listings unchanged';
  ASSERT pg_temp.ans('after', 'service', pub) = pg_temp.ans('before', 'service', pub)
     AND pg_temp.ans('after', 'service', priv) = pg_temp.ans('before', 'service', priv), '2 service unchanged';
  ASSERT pg_temp.ans('after', 'contributor', priv)->'external_listings'->0->>'reserve_price' = '5151',
    '2 tied contributor reads the private car''s listing';
  -- 3. Nothing else changed: every answer is byte-identical with external_listings set aside.
  SELECT count(*) INTO n FROM public.tp_answers a JOIN public.tp_answers b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before'
     AND ((a.r IS NULL) <> (b.r IS NULL) OR (a.r - 'external_listings') IS DISTINCT FROM (b.r - 'external_listings'));
  ASSERT n = 0, format('3 %s answers changed outside external_listings', n);
END $$;
-- The insider's listing text is the prior body's json_agg(el.*) text (json, not jsonb: key order and number format kept).
DO $$ BEGIN
  PERFORM public.t_claims('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  ASSERT (public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')->'external_listings')::text
       = (SELECT json_agg(el.* ORDER BY el.created_at DESC)::text FROM public.external_listings el
            WHERE el.vehicle_id = '11111111-1111-4111-8111-111111111111'), '2 owner listing json text as the prior body built it';
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- 5. An organisation member who is not an insider (the org's link to the car is not owner or consigner, so
--    vehicle_user_has_access does not tie them) reads no listing columns either: v_org_member is not v_insider.
INSERT INTO auth.users (id) VALUES ('abababab-abab-4bab-8bab-abababababab');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status) VALUES
  (gen_random_uuid(), 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', '11111111-1111-4111-8111-111111111111', 'service_provider', 'active');
INSERT INTO public.organization_contributors (id, organization_id, user_id, role, status) VALUES
  (gen_random_uuid(), 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'abababab-abab-4bab-8bab-abababababab', 'employee', 'active');
DO $$ BEGIN
  PERFORM public.t_claims('abababab-abab-4bab-8bab-abababababab');
  ASSERT NOT public.vehicle_user_has_access('11111111-1111-4111-8111-111111111111', 'abababab-abab-4bab-8bab-abababababab'),
    '5 the org member is not tied';
  ASSERT public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')::jsonb -> 'external_listings' = '[]'::jsonb,
    '5 an org member who is not an insider reads no listing columns';
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- 4. Grants are read at call time: granting anon two columns and reserve_price shows anon those two and never the
--    reserve; a signed-in stranger (no grant) still reads nothing; the function body does not change.
CREATE TEMP TABLE el_body AS SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS sha FROM pg_proc
 WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
GRANT SELECT (platform, listing_url, reserve_price) ON public.external_listings TO anon;
BEGIN;
SELECT public.t_claims('');
SET LOCAL ROLE anon;
DO $$ DECLARE l jsonb := public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')::jsonb->'external_listings';
BEGIN
  ASSERT jsonb_array_length(l) = 2, '4 anon reads both listings once columns are granted';
  ASSERT (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['listing_url','platform'])
          FROM jsonb_array_elements(l) e), '4 anon reads exactly the granted columns, never reserve_price';
END $$;
RESET ROLE;
SELECT public.t_claims('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.get_vehicle_profile_data('11111111-1111-4111-8111-111111111111')::jsonb->'external_listings' = '[]'::jsonb,
    '4 a stranger without the grant still reads nothing';
END $$;
COMMIT;
REVOKE SELECT (platform, listing_url, reserve_price) ON public.external_listings FROM anon;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure) = (SELECT sha FROM el_body), '4 function unchanged';
END $$;
SELECT 'PASS: get_vehicle_profile_data hands non-insiders only listing columns their role may select' AS result;
