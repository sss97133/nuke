-- Fixture for disposable PG17 contracts: vehicle_observations, vehicles and the row policies that guard them, with the
-- policy text and observation_is_public() as production has them on 2026-10-14 (pg_policy, pg_get_functiondef).
-- Included by the contract that proves a read path under row security; it does not guard the database itself.
-- Roles: a request is simulated with  SET ROLE anon|authenticated  plus  SET request.jwt.claims = '{"sub": ..., "role": ...}'.
-- Shapes: only the columns the readers and policies touch. vehicle_user_has_access is stubbed to false (it grants a
-- private vehicle's non-owner contributors access, which no contract here uses).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim', true), ''), NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record', 'ownership',
  'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion', 'splice', 'activity', 'offer');

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT false, deleted_at timestamptz);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text, display_name text, category text);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, observed_at timestamptz NOT NULL, source_id uuid, source_url text,
  kind public.observation_kind NOT NULL, content_text text, structured_data jsonb NOT NULL DEFAULT '{}',
  is_superseded boolean DEFAULT false, submitted_by_user_id uuid, extraction_method text, confidence text,
  citation_excerpt text, citation_page_number integer, subject_type text NOT NULL DEFAULT 'vehicle', subject_id uuid);

CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- observation_is_public: the live definition (md5 of pg_get_functiondef a19d4d1abf5af344878d05bf98be0f49).
CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind observation_kind, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$function$;

-- vehicles: the two SELECT policies (pg_policy, 2026-10-14).
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT TO public
  USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
         AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
              OR vehicle_user_has_access(id, (SELECT auth.uid()))));
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT TO public
  USING ((is_public = true) OR (auth.role() = 'service_role'));

-- vehicle_observations: the live read policies (vo_subject_owner_read applies only where vehicle_id IS NULL).
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY garage_correction_private_read ON public.vehicle_observations AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((extraction_method IS DISTINCT FROM 'garage_owner_correction_v1') OR (submitted_by_user_id = auth.uid()));
CREATE POLICY garage_correction_speaker_read ON public.vehicle_observations FOR SELECT TO authenticated
  USING ((extraction_method = 'garage_owner_correction_v1') AND (subject_type = 'user') AND (subject_id = auth.uid())
         AND (submitted_by_user_id = auth.uid()));
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM vehicles v
                  WHERE v.id = vehicle_observations.vehicle_id
                    AND (v.user_id = (SELECT auth.uid()) OR v.owner_id = (SELECT auth.uid()) OR v.uploaded_by = (SELECT auth.uid())
                         OR (v.is_public = true AND observation_is_public(vehicle_observations.kind, vehicle_observations.structured_data)))));
CREATE POLICY vo_service_role_all ON public.vehicle_observations FOR ALL TO public
  USING ((auth.jwt() ->> 'role') = 'service_role');
GRANT SELECT ON public.vehicles, public.vehicle_observations, public.observation_sources TO anon, authenticated, service_role;

-- The indexes production already has on the table that these reads can reach.
CREATE INDEX idx_observations_vehicle ON public.vehicle_observations (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_observations_vehicle_time ON public.vehicle_observations (vehicle_id, observed_at DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_vo_vehicle_source_kind ON public.vehicle_observations (vehicle_id, source_id, kind);
CREATE INDEX idx_vobs_engagement_contrib ON public.vehicle_observations (vehicle_id, kind, is_superseded, ((structured_data ->> 'authored')))
  WHERE vehicle_id IS NOT NULL;
