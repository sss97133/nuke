-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_listing_state -f this-file.sql
-- Proves record_listing_submission and vehicle_listing_state: who may write (tied caller or service role), the cited
-- source and reason, one row per (vehicle, platform, external id) with its history, and who may read what (a tied
-- viewer the full state; anyone else only a live or sold listing; a cancelled one nobody).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
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

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
-- listing_exports in its live shape: its own-user row policies, the status and platform checks, the updated_at clock.
CREATE TABLE public.listing_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid NOT NULL, platform text NOT NULL,
  export_format text NOT NULL, title text NOT NULL, description text, asking_price_cents bigint, reserve_price_cents bigint,
  exported_images jsonb DEFAULT '[]'::jsonb, image_count integer DEFAULT 0, status text DEFAULT 'prepared',
  external_listing_url text, external_listing_id text, submitted_at timestamptz, activated_at timestamptz, ended_at timestamptz,
  sold_price_cents bigint, sold_at timestamptz, commission_cents bigint, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (export_format IN ('json', 'csv', 'html', 'text')),
  CHECK (platform IN ('nzero', 'bat', 'ebay', 'craigslist', 'carscom', 'facebook', 'autotrader', 'hemmings', 'carsandbids', 'hagerty', 'other')),
  CHECK (status IN ('prepared', 'submitted', 'active', 'sold', 'expired', 'cancelled')));
CREATE FUNCTION public.update_listing_exports_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER update_listing_exports_updated_at BEFORE UPDATE ON public.listing_exports
  FOR EACH ROW EXECUTE FUNCTION public.update_listing_exports_updated_at();
ALTER TABLE public.listing_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY view_own_exports ON public.listing_exports FOR SELECT USING (user_id = auth.uid());
CREATE POLICY create_own_exports ON public.listing_exports FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY update_own_exports ON public.listing_exports FOR UPDATE USING (user_id = auth.uid());
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.listing_exports TO authenticated, service_role;

\ir ../migrations/20261110100000_listing_submission_state.sql
\ir ../migrations/20261110100000_listing_submission_state.sql

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_error(text) TO anon, authenticated, service_role;

-- v1: owner O, uploader U, contributor C with access; S is a stranger. v2 has only a creator.
INSERT INTO public.vehicles (id, owner_id, uploaded_by) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b');
INSERT INTO public.vehicles (id, created_by_user_id) VALUES ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000d');
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000c', 'mechanic', 'active');

CREATE FUNCTION public.t_record(p_vehicle uuid, p_status text, p_stage text, p_since timestamptz, p_url text DEFAULT 'https://bringatrailer.com/listing/x/') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.record_listing_submission(p_vehicle, 'bat', p_status, p_stage, p_since, '126086136', p_url,
    '{"type":"gmail","ref":"1a1882cdcc18f840","title":"Your 1973 Pontiac Firebird was accepted by BaT!","asserted_by":"contract"}',
    'The venue wrote to the seller about this listing on that day.') $$;
GRANT EXECUTE ON FUNCTION public.t_record(uuid, text, text, timestamptz, text) TO authenticated, service_role;

SET statement_timeout = '5s';
-- 1. Nobody tied: anon has no execute; a stranger is refused; the reader answers nothing.
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.record_listing_submission(uuid,text,text,text,timestamptz,text,text,jsonb,text)', 'EXECUTE'), 'anon may not write');
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-00000000000e';
SELECT public.t_assert(public.t_error($q$SELECT public.t_record('10000000-0000-0000-0000-000000000001', 'submitted', 'accepted', '2026-10-29T15:00:03Z')$q$) LIKE '%not tied%', 'a stranger is refused');
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001') IS NULL, 'nothing recorded reads as null');

-- 2. The owner records the acceptance, then the draft; the row is the owner's and keeps its history.
SET test.auth_uid = '20000000-0000-0000-0000-00000000000a';
DO $$
DECLARE r jsonb; s jsonb;
BEGIN
  r := public.t_record('10000000-0000-0000-0000-000000000001', 'submitted', 'accepted', '2026-10-29T15:00:03Z');
  PERFORM public.t_assert(r->>'status' = 'recorded' AND r->>'listing_status' = 'submitted', format('acceptance recorded; got %s', r));
  PERFORM public.t_assert((SELECT count(*) FROM public.listing_exports WHERE vehicle_id = '10000000-0000-0000-0000-000000000001'
    AND user_id = '20000000-0000-0000-0000-00000000000a' AND platform = 'bat' AND external_listing_id = '126086136'
    AND submitted_at = '2026-10-29T15:00:03Z' AND activated_at IS NULL AND metadata->>'stage' = 'accepted'
    AND metadata->'source'->>'ref' = '1a1882cdcc18f840' AND metadata->>'asserted_by' = 'contract' AND metadata->'history' = '[]'::jsonb) = 1,
    'one row, the owner''s, with the source and an empty history');
  r := public.t_record('10000000-0000-0000-0000-000000000001', 'submitted', 'draft_pending_approval', '2026-11-03T21:44:33Z');
  PERFORM public.t_assert(r->>'status' = 'updated' AND r->>'was' = 'submitted', format('draft stage updated the same row; got %s', r));
  PERFORM public.t_assert((SELECT count(*) FROM public.listing_exports WHERE vehicle_id = '10000000-0000-0000-0000-000000000001') = 1, 'still one row');
  PERFORM public.t_assert((SELECT jsonb_array_length(metadata->'history') = 1 AND metadata->'history'->0->>'stage' = 'accepted'
                                  AND metadata->'history'->0->>'status' = 'submitted' AND metadata->>'stage' = 'draft_pending_approval'
                                  AND submitted_at = '2026-10-29T15:00:03Z'
                           FROM public.listing_exports WHERE vehicle_id = '10000000-0000-0000-0000-000000000001'), 'history keeps the acceptance; submitted_at keeps its first clock');
  s := public.vehicle_listing_state('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(s->>'visibility' = 'tied' AND s->>'platform' = 'bat' AND s->>'status' = 'submitted' AND s->>'stage' = 'draft_pending_approval'
    AND (s->>'stage_since')::timestamptz = '2026-11-03T21:44:33Z' AND s->>'url' = 'https://bringatrailer.com/listing/x/' AND s->>'external_listing_id' = '126086136',
    format('the owner reads the full state; got %s', s));
  PERFORM public.t_assert(s ? 'as_of' AND NOT (s ? 'reserve_price_cents') AND NOT (s ? 'asking_price_cents'), 'no money in the state');
END $$;

-- 3. Who else reads it: the uploader and a contributor with access, nobody else.
SET test.auth_uid = '20000000-0000-0000-0000-00000000000b';
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001')->>'stage' = 'draft_pending_approval', 'the uploader reads the stage');
SET test.auth_uid = '20000000-0000-0000-0000-00000000000c';
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001')->>'stage' = 'draft_pending_approval', 'a contributor with access reads the stage');
SET test.auth_uid = '20000000-0000-0000-0000-00000000000e';
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001') IS NULL, 'a stranger reads nothing while the listing is pending');
RESET ROLE;
SET ROLE anon;
SET test.auth_role = 'anon';
SET test.auth_uid = '';
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001') IS NULL, 'anon reads nothing while the listing is pending');
RESET ROLE;

-- 4. Live: everyone sees the venue, the status and the url; nothing else. Cancelled: nobody sees it.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-00000000000a';
SELECT public.t_assert(public.t_record('10000000-0000-0000-0000-000000000001', 'active', 'live', '2026-11-10T16:00:00Z')->>'status' = 'updated', 'went live');
SELECT public.t_assert((SELECT activated_at = '2026-11-10T16:00:00Z' AND jsonb_array_length(metadata->'history') = 2 FROM public.listing_exports WHERE vehicle_id = '10000000-0000-0000-0000-000000000001'), 'activated_at set once; two history steps');
RESET ROLE;
SET ROLE anon;
SET test.auth_role = 'anon';
SET test.auth_uid = '';
DO $$
DECLARE s jsonb := public.vehicle_listing_state('10000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM public.t_assert(s->>'visibility' = 'public' AND s->>'status' = 'active' AND s->>'platform' = 'bat' AND s->>'url' = 'https://bringatrailer.com/listing/x/'
    AND (s->>'activated_at')::timestamptz = '2026-11-10T16:00:00Z', format('anon reads the live listing; got %s', s));
  PERFORM public.t_assert(NOT (s ? 'stage') AND NOT (s ? 'external_listing_id') AND NOT (s ? 'submitted_at'), format('anon reads no stage, id or submission clock; got %s', s));
END $$;
RESET ROLE;
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-00000000000a';
SELECT public.t_assert(public.t_record('10000000-0000-0000-0000-000000000001', 'cancelled', 'withdrawn', now())->>'status' = 'updated', 'withdrawn');
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000001') IS NULL, 'a cancelled listing is nobody''s state, not even the owner''s');

-- 5. What the writer refuses.
SELECT public.t_assert(public.t_error($q$SELECT public.record_listing_submission('10000000-0000-0000-0000-000000000001', 'bat', 'bogus', NULL, NULL, NULL, NULL, '{"type":"t","ref":"r","title":"t"}', 'ten characters long')$q$) LIKE '%not a listing status%', 'an unknown status is refused');
SELECT public.t_assert(public.t_error($q$SELECT public.record_listing_submission('10000000-0000-0000-0000-000000000001', 'bat', 'submitted', NULL, NULL, NULL, NULL, '{"type":"t"}', 'ten characters long')$q$) LIKE '%no cited source%', 'a source without ref and title is refused');
SELECT public.t_assert(public.t_error($q$SELECT public.record_listing_submission('10000000-0000-0000-0000-000000000001', 'bat', 'submitted', NULL, NULL, NULL, NULL, '{"type":"t","ref":"r","title":"t"}', 'short')$q$) LIKE '%needs a reason%', 'a short reason is refused');
SELECT public.t_assert(public.t_error($q$SELECT public.record_listing_submission('10000000-0000-0000-0000-000000000001', 'bogusvenue', 'submitted', NULL, NULL, NULL, NULL, '{"type":"t","ref":"r","title":"t"}', 'ten characters long')$q$) LIKE '%not a listing platform%', 'an unknown platform is refused');
RESET ROLE;

-- 6. The service role records for a vehicle whose only person is its creator; the row is the creator's.
SET test.auth_role = 'service_role';
SET test.auth_uid = '';
SELECT public.t_assert(public.t_record('10000000-0000-0000-0000-000000000002', 'submitted', 'accepted', '2026-10-29T15:00:03Z')->>'status' = 'recorded', 'service role records');
SELECT public.t_assert((SELECT user_id = '20000000-0000-0000-0000-00000000000d' FROM public.listing_exports WHERE vehicle_id = '10000000-0000-0000-0000-000000000002'), 'the creator holds the row');
SELECT public.t_assert(public.vehicle_listing_state('10000000-0000-0000-0000-000000000002')->>'visibility' = 'tied', 'service role reads as tied');
RESET statement_timeout;
SELECT public.t_assert(public.t_error($q$SELECT public.t_record('10000000-0000-0000-0000-000000000002', 'submitted', 'x', now())$q$) LIKE '%statement_timeout%', 'the writer demands a bounded statement_timeout');
SELECT 'listing_submission_state contract: PASS' AS result;
