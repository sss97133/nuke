-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_profile_read -f this-file.sql
-- Proves the viewer-scoped profile document: attribution, coverage, the odometer and price rules,
-- and that the viewer's own row policies bound what the document can carry.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- Supabase's auth shims and roles, as the live policies use them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The tables the read touches, with the live SELECT policies that matter to it.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz,
  year integer, make text, model text, normalized_model text, series text, trim text,
  transmission text, transmission_model text, mileage integer, mileage_source text,
  canonical_body_style text, body_style text, engine_size text, drivetrain text,
  city text, state text, location text);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text,
  source_type text, source_confidence integer, extracted_at timestamptz, status text);
CREATE TABLE public.ownership_verifications (
  vehicle_id uuid, user_id uuid, status text, title_document_url text, drivers_license_url text);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_type text, event_date date,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.test_price_facts (
  vehicle_id uuid PRIMARY KEY, price_kind text, price_amount numeric, price_as_of timestamptz,
  price_live boolean, platform text, source_url text);

CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
-- The live reader returns twenty columns; the document reads these seven by name.
CREATE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
RETURNS TABLE (vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamptz,
               price_live boolean, platform text, source_url text)
LANGUAGE sql STABLE AS $$
  SELECT vehicle_id, price_kind, price_amount, price_as_of, price_live, platform, source_url
  FROM public.test_price_facts WHERE vehicle_id = ANY (p_vehicle_ids) $$;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT
  USING (is_public = true OR auth.role() = 'service_role');
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT
  USING (is_public = false AND (SELECT auth.uid()) IS NOT NULL AND (
    (SELECT auth.uid()) = user_id OR (SELECT auth.uid()) = owner_id OR (SELECT auth.uid()) = uploaded_by
    OR public.vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.field_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view evidence" ON public.field_evidence FOR SELECT
  USING (auth.role() = 'authenticated'
    OR (coalesce(source_type, '') <> ALL (ARRAY['quickbooks', 'invoice', 'email_receipt', 'receipt', 'bank_statement', 'card_statement'])
        AND coalesce(field_name, '') <> ALL (ARRAY['seller_name', 'seller_profile_url', 'seller_phone', 'seller_email', 'buyer_name'])));
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicle_events ON public.timeline_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = timeline_events.vehicle_id AND v.is_public = true));
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_claims ON public.ownership_verifications FOR SELECT USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.vehicle_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON public.vehicle_contributors FOR SELECT USING (user_id = (SELECT auth.uid()));
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

\ir ../migrations/20261013143000_vehicle_profile_read.sql
\ir ../migrations/20261013144500_vehicle_profile_read_acronyms.sql
\ir ../migrations/20261013161500_vehicle_profile_read_timeline.sql

-- Seeds. v1: the documented case; v2: nothing recorded; v3: a sourceless odometer; v4: private;
-- v5: a classified asking price; v6: competing evidence; v7: a live auction bid.
INSERT INTO public.vehicles (id, owner_id, uploaded_by, year, make, model, normalized_model, body_style, engine_size, transmission, drivetrain, city, state, mileage, mileage_source) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
  1966, 'Ford', 'Mustang', 'Mustang', 'Coupe', '4.7L V8', 'Automatic', 'RWD', 'Boulder City', 'NV', 10000, 'bring a trailer');
INSERT INTO public.vehicles (id, year, make, model) VALUES ('10000000-0000-0000-0000-000000000002', 1990, 'Acme', 'Thing');
INSERT INTO public.vehicles (id, year, make, model, body_style, mileage, mileage_source) VALUES
 ('10000000-0000-0000-0000-000000000003', 1966, 'Ford', 'Mustang', 'coupe', 1, NULL);
INSERT INTO public.vehicles (id, user_id, is_public, year, make, model, drivetrain) VALUES
 ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', false, 1988, 'Chevrolet', 'K5 Blazer', '4WD');
INSERT INTO public.vehicles (id, year, make, model, location) VALUES
 ('10000000-0000-0000-0000-000000000005', 2004, 'Honda', 'Rune', 'Salt Lake City, UT');
INSERT INTO public.vehicles (id, year, make, model, engine_size) VALUES
 ('10000000-0000-0000-0000-000000000006', 1966, 'Ford', 'Mustang', '4.7L  V8 ');
INSERT INTO public.vehicles (id, year, make, model) VALUES ('10000000-0000-0000-0000-000000000007', 1998, 'Acura', 'NSX');
INSERT INTO public.vehicles (id, year, make, model, body_style, transmission) VALUES
 ('10000000-0000-0000-0000-000000000008', 1977, 'Chevrolet', 'K5 Blazer', 'SUV', 'AUTOMATIC 4WD');

INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extracted_at, status) VALUES
 ('10000000-0000-0000-0000-000000000001', 'engine_size',  '4.7L V8',   'user-submission_listing', 80, '2026-09-01T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000001', 'body_style',   'coupe',     'user-submission_listing', 80, '2026-08-01T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000001', 'engine_size',  '4.7L V8',   'factory_service_manual',  95, '2026-09-02T00:00:00Z', 'pending'),
 ('10000000-0000-0000-0000-000000000001', 'engine_size',  '289ci V8',  'factory_service_manual',  95, '2026-09-02T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000001', 'drivetrain',   'RWD',       'bat',                     90, '2026-09-03T00:00:00Z', 'superseded'),
 ('10000000-0000-0000-0000-000000000001', 'transmission', 'Automatic', 'invoice',                 95, '2026-09-04T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000001', 'mileage',      '100010',    'bat',                     90, '2026-09-05T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000006', 'engine_size',  '4.7L V8',   'user-submission_listing', 60, '2026-09-01T00:00:00Z', 'accepted'),
 ('10000000-0000-0000-0000-000000000006', 'engine_size',  '4.7l v8',   'factory_service_manual',  95, '2026-09-06T00:00:00Z', 'accepted');
INSERT INTO public.timeline_events (vehicle_id, event_type, event_date, created_at) VALUES
 ('10000000-0000-0000-0000-000000000001', 'photo_session', '2026-02-01', '2026-02-01T10:00:00Z'),
 ('10000000-0000-0000-0000-000000000001', 'photo_session', '2026-02-01', '2026-02-01T11:00:00Z'),
 ('10000000-0000-0000-0000-000000000001', 'service',       '2026-02-01', '2026-02-01T12:00:00Z'),
 ('10000000-0000-0000-0000-000000000001', 'service',       '2025-12-24', '2025-12-24T09:00:00Z'),
 ('10000000-0000-0000-0000-000000000001', NULL,            '2025-12-24', '2026-03-01T09:00:00Z'),
 ('10000000-0000-0000-0000-000000000001', 'note',          NULL,         '2026-03-02T09:00:00Z'),
 ('10000000-0000-0000-0000-000000000004', 'service',       '2026-01-01', '2026-01-01T09:00:00Z');
INSERT INTO public.test_price_facts VALUES
 ('10000000-0000-0000-0000-000000000001', 'sold', 24000, '2026-09-21T00:00:00Z', false, 'bring-a-trailer', 'https://bringatrailer.com/listing/x'),
 ('10000000-0000-0000-0000-000000000003', 'estimate', 112200, '2026-09-21T00:00:00Z', false, 'user-submission', NULL),
 ('10000000-0000-0000-0000-000000000005', 'ask', 5000, '2026-10-01T00:00:00Z', false, 'ksl', 'https://classifieds.ksl.com/listing/1'),
 ('10000000-0000-0000-0000-000000000007', 'bid', 127777, NULL, true, 'bat', 'https://bringatrailer.com/listing/nsx');
INSERT INTO public.ownership_verifications VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'approved', 'https://x/title.pdf', 'https://x/id.pdf'),
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'approved', 'pending', 'https://x/id.pdf');
INSERT INTO public.vehicle_contributors VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'mechanic', 'active');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;

-- 1. Anonymous reader.
SET ROLE anon;
SET test.auth_role = 'anon';
DO $$
DECLARE d jsonb; m jsonb; s jsonb; f jsonb;
BEGIN
  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(d->>'viewer' = 'anon', 'anonymous viewer');
  PERFORM public.t_assert(d->>'vehicle_id' = '10000000-0000-0000-0000-000000000001', 'vehicle id');
  PERFORM public.t_assert((d->>'read_at')::timestamptz > now() - interval '1 minute', 'read_at is the read clock');
  PERFORM public.t_assert((SELECT string_agg(x->>'kind', ',' ORDER BY o) FROM jsonb_array_elements(d->'sections') WITH ORDINALITY AS t(x, o)) = 'masthead,strip,timeline', 'masthead, strip and timeline');
  m := d->'sections'->0;
  PERFORM public.t_assert(m->>'kind' = 'masthead' AND m->>'model' = 'Mustang' AND (m->>'year')::int = 1966, 'masthead identity');
  PERFORM public.t_assert(m->'identity_source'->>'normalized_model' = 'Mustang', 'identity_source for the client tokens');
  PERFORM public.t_assert((m->'price'->>'value')::numeric = 24000 AND m->'price'->>'unit' = 'USD', 'typed price value and unit');
  PERFORM public.t_assert(m->>'priceLabel' = 'Last recorded sale', 'a sale is the last recorded sale');
  PERFORM public.t_assert(m->'price'->'source'->>'label' = 'BRING A TRAILER' AND m->'price'->'source'->>'url' LIKE 'https://bringatrailer%'
    AND m->'price'->'source'->>'kind' = 'listing' AND m->'price'->'source'->>'method' = 'sold', 'price source: platform, link, class, kind');
  PERFORM public.t_assert((m->'price'->>'trust')::numeric = 0.9 AND (m->'price'->>'observed_at')::timestamptz = '2026-09-21T00:00:00Z', 'price trust and clock');
  s := d->'sections'->1;
  PERFORM public.t_assert(s->>'kind' = 'strip', 'strip second');
  PERFORM public.t_assert((SELECT string_agg(x->>'label', '|' ORDER BY o) FROM jsonb_array_elements(s->'facets') WITH ORDINALITY AS t(x, o))
    = 'Coupe|4.7L V8|Automatic|RWD|Boulder City, NV', 'facet labels in strip order, title-cased where declared');
  PERFORM public.t_assert((SELECT string_agg(x->>'dimension', '|' ORDER BY o) FROM jsonb_array_elements(s->'facets') WITH ORDINALITY AS t(x, o))
    = 'body_style|engine|transmission|drivetrain|location', 'facet dimensions');
  f := s->'facets'->1->'member';
  PERFORM public.t_assert(f->'source'->>'kind' = 'listing' AND (f->>'trust')::numeric = 0.8
    AND (f->>'observed_at')::timestamptz = '2026-09-01T00:00:00Z' AND f->'source'->>'method' = 'user-submission_listing'
    AND f->'source'->>'label' = 'user-submission listing', 'engine attributed to the accepted listing row, with its confidence and clock');
  PERFORM public.t_assert(s->'facets'->0->'member'->'source'->>'kind' = 'listing', 'body style matched case-insensitively');
  PERFORM public.t_assert(s->'facets'->3->'member'->'source'->>'kind' = 'legacy' AND (s->'facets'->3->'member'->>'trust')::numeric = 0.3
    AND s->'facets'->3->'member'->'observed_at' = 'null'::jsonb AND s->'facets'->3->'member'->'source'->>'label' = 'vehicle record',
    'a superseded row does not attribute: drivetrain is the legacy record');
  PERFORM public.t_assert(s->'facets'->2->'member'->'source'->>'kind' = 'legacy', 'anon cannot read the invoice row, so the transmission is the legacy record');
  PERFORM public.t_assert(s->'facets'->4->'member'->'source'->>'kind' = 'legacy', 'location has no evidence field');
  PERFORM public.t_assert((s->'odometer'->>'value')::int = 10000 AND s->'odometer'->>'unit' = 'mi'
    AND s->'odometer'->'source'->>'kind' = 'listing' AND s->'odometer'->'source'->>'label' = 'bring a trailer'
    AND (s->'odometer'->>'trust')::numeric = 0.6, 'the odometer reads the record source when no accepted evidence matches the reading');
  PERFORM public.t_assert(s->'coverage' = jsonb_build_object('n', 3, 'of', 6, 'grain', 'facts attributed', 'as_of', '2026-09-01T00:00:00+00:00'),
    format('coverage: body and engine by evidence, odometer by the record source; got %s', s->'coverage'));
END $$;

DO $$
DECLARE d jsonb;
BEGIN
  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(d->'sections'->2->'coverage' = jsonb_build_object('n', 5, 'of', 6, 'grain', 'events dated', 'as_of', '2026-03-02T09:00:00+00:00'),
    format('timeline coverage: five dated of six events, as of the latest row; got %s', d->'sections'->2->'coverage'));
  PERFORM public.t_assert(d->'sections'->2->'days' = '[{"day":"2026-02-01","kinds":{"photo_session":2,"service":1}},{"day":"2025-12-24","kinds":{"event":1,"service":1}}]'::jsonb,
    format('days newest first, kinds counted, an untyped event is an event; got %s', d->'sections'->2->'days'));

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000002');
  PERFORM public.t_assert(jsonb_array_length(d->'sections') = 1 AND d->'sections'->0->>'kind' = 'masthead', 'no strip and no timeline when nothing is recorded');
  PERFORM public.t_assert(d->'sections'->0->'price' = 'null'::jsonb AND d->'sections'->0->'priceLabel' = 'null'::jsonb, 'no price without a typed price');

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000003');
  PERFORM public.t_assert(d->'sections'->0->'price' = 'null'::jsonb, 'an estimate is never presented as the price');
  PERFORM public.t_assert(d->'sections'->1->'odometer' = 'null'::jsonb, 'a reading without a source is not shown');
  PERFORM public.t_assert(d->'sections'->1->'coverage' = jsonb_build_object('n', 0, 'of', 1, 'grain', 'facts attributed', 'as_of', NULL), 'one legacy facet, nothing attributed, no clock');

  PERFORM public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000004') IS NULL, 'a private vehicle reads as NULL for anon');
  PERFORM public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000099') IS NULL, 'an unknown vehicle reads as NULL');

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000005');
  PERFORM public.t_assert(d->'sections'->0->'price'->>'unit' = '' AND d->'sections'->0->>'priceLabel' = 'Asking · currency unrecorded'
    AND (d->'sections'->0->'price'->>'trust')::numeric = 0.5, 'a classified asking price carries no currency');
  PERFORM public.t_assert(d->'sections'->1->'facets'->0->>'label' = 'Salt Lake City, UT', 'location falls back to the location column');

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000006');
  PERFORM public.t_assert(d->'sections'->1->'facets'->0->>'label' = '4.7L  V8' OR d->'sections'->1->'facets'->0->>'label' = '4.7L V8', 'engine label is the trimmed record value');
  PERFORM public.t_assert(d->'sections'->1->'facets'->0->'member'->'source'->>'kind' = 'document'
    AND (d->'sections'->1->'facets'->0->'member'->>'trust')::numeric = 0.95, 'the most confident matching row wins, whitespace and case normalized');

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000007');
  PERFORM public.t_assert(d->'sections'->0->>'priceLabel' = 'Current bid' AND (d->'sections'->0->'price'->>'trust')::numeric = 0.7
    AND d->'sections'->0->'price'->'observed_at' = 'null'::jsonb, 'a live bid is the current bid, as of now');

  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000008');
  PERFORM public.t_assert((SELECT string_agg(x->>'label', '|' ORDER BY o) FROM jsonb_array_elements(d->'sections'->1->'facets') WITH ORDINALITY AS t(x, o))
    = 'SUV|Automatic 4WD', format('acronyms keep their capitals in title-cased labels; got %s', d->'sections'->1->'facets'));
END $$;
RESET ROLE;

-- 2. Signed-in readers: the viewer resolves server-side, and policies widen what the document may carry.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE d jsonb;
BEGIN
  d := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(d->>'viewer' = 'owner', 'owner_id is the owner');
  PERFORM public.t_assert(d->'sections'->1->'facets'->2->'member'->'source'->>'kind' = 'document'
    AND (d->'sections'->1->'facets'->2->'member'->>'trust')::numeric = 0.95, 'an authenticated reader sees the invoice attribution');
  PERFORM public.t_assert((d->'sections'->1->'coverage'->>'n')::int = 4, 'coverage counts the invoice attribution for this viewer');
END $$;
SET test.auth_uid = '20000000-0000-0000-0000-000000000002';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'contributor', 'the uploader is a contributor');
SET test.auth_uid = '20000000-0000-0000-0000-000000000003';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'owner', 'an approved verification with both documents is the owner');
SET test.auth_uid = '20000000-0000-0000-0000-000000000005';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'anon', 'a verification still pending a document is not the owner');
SET test.auth_uid = '20000000-0000-0000-0000-000000000006';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000001')->>'viewer' = 'contributor', 'a contributor row is a contributor');
SET test.auth_uid = '20000000-0000-0000-0000-000000000004';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000004')->>'viewer' = 'owner', 'a private vehicle reads for its user');
SET test.auth_uid = '20000000-0000-0000-0000-000000000009';
SELECT public.t_assert(public.vehicle_profile_read('10000000-0000-0000-0000-000000000004') IS NULL, 'a private vehicle reads as NULL for another user');
RESET ROLE;

-- 3. Grants: anon and authenticated may execute; nothing else may.
SELECT public.t_assert(has_function_privilege('anon', 'public.vehicle_profile_read(uuid)', 'EXECUTE'), 'anon may execute');
SELECT public.t_assert(has_function_privilege('authenticated', 'public.vehicle_profile_read(uuid)', 'EXECUTE'), 'authenticated may execute');
SELECT public.t_assert(NOT has_function_privilege('public', 'public.vehicle_profile_read(uuid)', 'EXECUTE'), 'PUBLIC may not execute');
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_profile_read(uuid)'::regprocedure), 'invoker and stable');
SELECT 'vehicle_profile_read contract: PASS' AS result;
