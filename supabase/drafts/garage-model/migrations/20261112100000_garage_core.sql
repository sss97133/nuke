-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, migration 00 (SPEC lane): the place, its sites, its members, join links, the derived stay fold,
-- the stay citations and the durable human assertions. Design and reasons: docs/garage-model/SPEC.md.
--
-- What is real here and what is a stub:
--   REAL   tables, constraints, indexes, garage_role_rank, garage_member_rank (policies need it), RLS, grants,
--          create_garage, garage_record_assertion, garage_my_garages, garage_members_read.
--   STUB   garage_now, garage_timeline, garage_stay_evidence_read, garage_inbound_feed (PRESENCE lane fills the
--          bodies; they raise 0A000 so nothing can mistake a stub for an empty garage) and
--          can_see_vehicle_via_garage (VISIBILITY lane; fails closed, returns false).
--   JOIN lane (create/preview/redeem/revoke join link, decide_garage_membership) is NOT here; only the table.
--
-- Additions beyond CONTRACT.md (additive, nullable or defaulted; the contract names are unchanged):
--   garage_organizations (hosted orgs such as Viva), garage_vehicle_stays.organization_id,
--   garage_stay_evidence.id + recorded_at (the knowledge clock), the basis column on garage_timeline, and the
--   create_garage / garage_record_assertion writers. Each is explained in SPEC.md sections 2, 4 and 8.
--
-- Live tables this draft references (read live 2026-11-12): public.organizations, public.organization_locations,
-- public.user_sites, public.external_identities, public.vehicles, auth.users. Nothing on them is altered.
--
-- Live-name note: "garage" already means "a user's own vehicle collection" in the repo (get_user_garage,
-- garage_derivation_evidence, record_garage_owner_correction, revoke_garage_membership(vehicle)). None of those names
-- collide with the objects below (checked against the live catalog, 2026-11-12), but readers must not confuse them.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------------------------------------------
-- Rank. Pure function of the role; the single place the ladder lives.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_role_rank(p_role text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_role
    WHEN 'owner'        THEN 100
    WHEN 'manager'      THEN 80
    WHEN 'technician'   THEN 50
    WHEN 'staff'        THEN 40
    WHEN 'photographer' THEN 30
    WHEN 'customer'     THEN 20
    WHEN 'viewer'       THEN 10
    ELSE 0
  END
$$;
COMMENT ON FUNCTION public.garage_role_rank(text) IS
  'Garage rank ladder: owner 100, manager 80, technician 50, staff 40, photographer 30, customer 20, viewer 10, anything else 0.';

-- ---------------------------------------------------------------------------------------------------------------
-- The place.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.garages (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL CHECK (btrim(name) <> ''),
  operator_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by               uuid NOT NULL REFERENCES auth.users(id),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX garages_operator_org_idx ON public.garages (operator_organization_id) WHERE operator_organization_id IS NOT NULL;
COMMENT ON TABLE public.garages IS
  'A shared physical place with members. Not an organization: one org can run several places and one place can host several orgs. Private to members.';

-- Orgs whose cars are kept in the place (the operator, hosted orgs such as a dealer whose inventory sits there).
CREATE TABLE public.garage_organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id       uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  kind            text NOT NULL CHECK (kind IN ('operator', 'hosted', 'tenant')),
  valid_from      date,
  valid_to        date,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX garage_organizations_open_uq
  ON public.garage_organizations (garage_id, organization_id, kind) WHERE valid_to IS NULL;

-- Where the place physically is, over time (shops move). Private: unlike organization_locations (public read).
CREATE TABLE public.garage_sites (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id                uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  lat                      double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon                      double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  radius_m                 integer NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 1 AND 5000),
  valid_from               date,
  valid_to                 date,
  organization_location_id uuid REFERENCES public.organization_locations(id) ON DELETE SET NULL,
  user_site_id             uuid REFERENCES public.user_sites(id) ON DELETE SET NULL,
  source                   text NOT NULL CHECK (btrim(source) <> ''),
  confirmed_by             uuid REFERENCES auth.users(id),
  confirmed_at             timestamptz,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL))
);
CREATE INDEX garage_sites_garage_idx ON public.garage_sites (garage_id, valid_from);
CREATE INDEX garage_sites_user_site_idx ON public.garage_sites (user_site_id) WHERE user_site_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Join links (table only; the functions belong to the JOIN lane). Raw token is never stored.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.garage_join_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id         uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role              text NOT NULL CHECK (role IN ('manager', 'technician', 'staff', 'photographer', 'customer', 'viewer')),
  max_uses          integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses_count        integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  requires_approval boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (uses_count <= max_uses)
);
CREATE INDEX garage_join_links_garage_idx ON public.garage_join_links (garage_id) WHERE revoked_at IS NULL;
COMMENT ON COLUMN public.garage_join_links.role IS 'Never owner: an owner is made by create_garage, not by a link.';

-- ---------------------------------------------------------------------------------------------------------------
-- Membership and rank.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.garage_members (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id            uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES auth.users(id),
  external_identity_id uuid REFERENCES public.external_identities(id),
  role                 text NOT NULL CHECK (role IN ('owner', 'manager', 'technician', 'staff', 'photographer', 'customer', 'viewer')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'left', 'revoked')),
  joined_via_link_id   uuid REFERENCES public.garage_join_links(id) ON DELETE SET NULL,
  invited_by           uuid REFERENCES auth.users(id),
  approved_by          uuid REFERENCES auth.users(id),
  approved_at          timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR external_identity_id IS NOT NULL),
  CHECK (status <> 'active' OR (approved_at IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);
-- One live membership per person per garage. Terminal rows (left, revoked) stay as history.
CREATE UNIQUE INDEX garage_members_one_live_user_uq
  ON public.garage_members (garage_id, user_id) WHERE user_id IS NOT NULL AND status IN ('pending', 'active', 'suspended');
CREATE UNIQUE INDEX garage_members_one_live_identity_uq
  ON public.garage_members (garage_id, external_identity_id) WHERE external_identity_id IS NOT NULL AND status IN ('pending', 'active', 'suspended');
CREATE INDEX garage_members_user_idx ON public.garage_members (user_id) WHERE user_id IS NOT NULL;

-- Rank of a user in a garage: 0 unless an active member. SECURITY DEFINER so policies on garage_members
-- can call it without recursing into their own RLS. (CONTRACT: VISIBILITY lane owns this name; same signature.)
CREATE OR REPLACE FUNCTION public.garage_member_rank(p_garage uuid, p_user uuid DEFAULT auth.uid())
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(max(public.garage_role_rank(m.role)), 0)
  FROM public.garage_members m
  WHERE m.garage_id = p_garage AND m.user_id = p_user AND m.status = 'active'
    AND p_user IS NOT NULL
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Derived stay fold. Recomputable, versioned, never hand-edited: no write grant, no write policy.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.garage_vehicle_stays (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id          uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  vehicle_id         uuid NOT NULL REFERENCES public.vehicles(id),
  relationship       text NOT NULL DEFAULT 'unknown'
    CHECK (relationship IN ('owned', 'dealer_inventory', 'consignment', 'customer_work', 'storage', 'passing_through', 'unknown')),
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,  -- which hosted org, when the relationship is org-held
  arrived_at         timestamptz NOT NULL,
  last_seen_at       timestamptz NOT NULL,
  departed_at        timestamptz,
  departure_basis    text,
  confidence         numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_count     integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  derivation_version text NOT NULL CHECK (btrim(derivation_version) <> ''),
  derived_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seen_at >= arrived_at),
  CHECK (departed_at IS NULL OR departed_at >= arrived_at),
  CHECK ((departed_at IS NULL) = (departure_basis IS NULL))
);
-- A car is in a garage once at a time; a return is a new row after the previous stay closed.
CREATE UNIQUE INDEX garage_vehicle_stays_one_open_uq ON public.garage_vehicle_stays (garage_id, vehicle_id) WHERE departed_at IS NULL;
CREATE UNIQUE INDEX garage_vehicle_stays_arrival_uq ON public.garage_vehicle_stays (garage_id, vehicle_id, arrived_at);
CREATE INDEX garage_vehicle_stays_vehicle_idx ON public.garage_vehicle_stays (vehicle_id);
CREATE INDEX garage_vehicle_stays_garage_seen_idx ON public.garage_vehicle_stays (garage_id, last_seen_at DESC);

-- The citations behind a stay. originator = who made the evidence; the garage affiliation is stay.garage_id;
-- the third thing, how it reaches the owner, is the owner's rank in that garage (never stored here).
CREATE TABLE public.garage_stay_evidence (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id                         uuid NOT NULL REFERENCES public.garage_vehicle_stays(id) ON DELETE CASCADE,
  signal                          text NOT NULL CHECK (signal IN (
    'site_photo', 'work_session', 'org_link', 'sale_event', 'listing', 'receipt',
    'member_assertion', 'contributor_link_upload', 'record_deleted_or_merged')),
  source_table                    text NOT NULL CHECK (btrim(source_table) <> ''),
  source_id                       text NOT NULL CHECK (btrim(source_id) <> ''),
  observed_at                     timestamptz NOT NULL,   -- event clock: when it happened
  recorded_at                     timestamptz NOT NULL DEFAULT now(),  -- knowledge clock: when the garage model learned it
  originator_user_id              uuid REFERENCES auth.users(id),
  originator_external_identity_id uuid REFERENCES public.external_identities(id),
  weight                          numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  CHECK (originator_user_id IS NULL OR originator_external_identity_id IS NULL),
  UNIQUE (stay_id, signal, source_table, source_id)
);
CREATE INDEX garage_stay_evidence_observed_idx ON public.garage_stay_evidence (stay_id, observed_at DESC);
CREATE INDEX garage_stay_evidence_originator_idx ON public.garage_stay_evidence (originator_user_id) WHERE originator_user_id IS NOT NULL;

-- Durable human statements. They outrank derivation; derivation never overwrites them. Superseded, never deleted.
CREATE TABLE public.garage_stay_assertions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id     uuid NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id),
  asserted_by   uuid NOT NULL REFERENCES auth.users(id),
  kind          text NOT NULL CHECK (kind IN ('here', 'left', 'not_here', 'relationship')),
  value         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(value) = 'object'),
  asserted_at   timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.garage_stay_assertions(id),
  CHECK (superseded_by IS DISTINCT FROM id),
  CHECK (kind <> 'relationship' OR value ? 'relationship'),
  CHECK (kind <> 'left' OR value ? 'on')
);
CREATE INDEX garage_stay_assertions_current_idx
  ON public.garage_stay_assertions (garage_id, vehicle_id, kind) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- RLS. Reads for members by rank; no INSERT/UPDATE/DELETE policy and no write grant anywhere:
-- every write goes through a SECURITY DEFINER function (or the service role, which bypasses RLS).
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.garages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_sites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_join_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_vehicle_stays   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_stay_evidence   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_stay_assertions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.garages, public.garage_organizations, public.garage_sites, public.garage_join_links,
  public.garage_members, public.garage_vehicle_stays, public.garage_stay_evidence, public.garage_stay_assertions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.garages, public.garage_organizations, public.garage_sites, public.garage_join_links,
  public.garage_members, public.garage_vehicle_stays, public.garage_stay_evidence, public.garage_stay_assertions
  TO authenticated;

-- Any active member sees the garage row and the orgs it hosts.
CREATE POLICY garages_member_read ON public.garages FOR SELECT TO authenticated
  USING (public.garage_member_rank(id) > 0);
CREATE POLICY garage_organizations_member_read ON public.garage_organizations FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) > 0);
-- Where the place is: technician and above.
CREATE POLICY garage_sites_staff_read ON public.garage_sites FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) >= 50);
-- Join links (hashes only): managers and above.
CREATE POLICY garage_join_links_manager_read ON public.garage_join_links FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) >= 80);
-- Membership: your own rows always (including pending, so the app can say "waiting for approval"); the whole roster for managers.
-- Other members read the roster through garage_members_read(), which returns ids and roles only.
CREATE POLICY garage_members_self_read ON public.garage_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY garage_members_manager_read ON public.garage_members FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) >= 80);
-- Stays, citations, assertions: managers and above see the whole place. Lower ranks read only through
-- garage_now() / garage_stay_evidence_read(), which apply can_see_vehicle_via_garage (VISIBILITY lane).
CREATE POLICY garage_vehicle_stays_manager_read ON public.garage_vehicle_stays FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) >= 80);
CREATE POLICY garage_stay_evidence_manager_read ON public.garage_stay_evidence FOR SELECT TO authenticated
  USING (public.garage_member_rank((SELECT s.garage_id FROM public.garage_vehicle_stays s WHERE s.id = stay_id)) >= 80
         OR originator_user_id = auth.uid());
CREATE POLICY garage_stay_assertions_manager_read ON public.garage_stay_assertions FOR SELECT TO authenticated
  USING (public.garage_member_rank(garage_id) >= 80 OR asserted_by = auth.uid());

-- ---------------------------------------------------------------------------------------------------------------
-- Write functions that belong to the core (SECURITY DEFINER; the only way rows get in for a signed-in user).
-- ---------------------------------------------------------------------------------------------------------------
-- A signed-in user starts a garage and is its first owner (active at once: nobody above them to approve).
CREATE OR REPLACE FUNCTION public.create_garage(p_name text, p_operator_organization_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'create_garage requires a signed-in user' USING ERRCODE = '28000'; END IF;
  INSERT INTO public.garages (name, operator_organization_id, created_by)
  VALUES (btrim(p_name), p_operator_organization_id, v_user) RETURNING id INTO v_id;
  INSERT INTO public.garage_members (garage_id, user_id, role, status, approved_by, approved_at, started_at)
  VALUES (v_id, v_user, 'owner', 'active', v_user, now(), now());
  IF p_operator_organization_id IS NOT NULL THEN
    INSERT INTO public.garage_organizations (garage_id, organization_id, kind, created_by)
    VALUES (v_id, p_operator_organization_id, 'operator', v_user);
  END IF;
  RETURN v_id;
END $$;

-- A member states something about a vehicle in the garage. Rank >= 50 may say here / not_here;
-- rank >= 80 may say left / relationship. A new statement supersedes the previous current one of the same kind
-- only when the new speaker's rank is at least the previous speaker's current rank; otherwise it is refused
-- (a technician cannot overwrite the owner), never silently stored beside it.
CREATE OR REPLACE FUNCTION public.garage_record_assertion(p_garage uuid, p_vehicle uuid, p_kind text, p_value jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rank int;
  v_prev public.garage_stay_assertions%ROWTYPE;
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'garage_record_assertion requires a signed-in user' USING ERRCODE = '28000'; END IF;
  v_rank := public.garage_member_rank(p_garage, v_user);
  IF v_rank < (CASE WHEN p_kind IN ('here', 'not_here') THEN 50 ELSE 80 END) THEN
    RAISE EXCEPTION 'rank % may not assert % in this garage', v_rank, p_kind USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_prev FROM public.garage_stay_assertions
   WHERE garage_id = p_garage AND vehicle_id = p_vehicle AND kind = p_kind AND superseded_by IS NULL
   ORDER BY asserted_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND v_prev.asserted_by <> v_user
     AND public.garage_member_rank(p_garage, v_prev.asserted_by) > v_rank THEN
    RAISE EXCEPTION 'a higher-ranked member already asserted % for this vehicle', p_kind USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.garage_stay_assertions (garage_id, vehicle_id, asserted_by, kind, value)
  VALUES (p_garage, p_vehicle, v_user, p_kind, coalesce(p_value, '{}'::jsonb)) RETURNING id INTO v_id;
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.garage_stay_assertions SET superseded_by = v_id WHERE id = v_prev.id;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Read functions the app calls. SECURITY DEFINER, gated by membership.
-- ---------------------------------------------------------------------------------------------------------------
-- REAL: my garages with my role, rank and status (pending shows too, so the app can say "waiting for approval").
CREATE OR REPLACE FUNCTION public.garage_my_garages()
RETURNS TABLE (garage_id uuid, name text, garage_status text, member_id uuid, role text, rank integer, member_status text,
               started_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.name, g.status, m.id, m.role, public.garage_role_rank(m.role), m.status, m.started_at
  FROM public.garage_members m JOIN public.garages g ON g.id = m.garage_id
  WHERE m.user_id = auth.uid() AND auth.uid() IS NOT NULL AND m.status IN ('pending', 'active', 'suspended')
  ORDER BY public.garage_role_rank(m.role) DESC, g.name
$$;

-- REAL: roster, ids and roles only (no names, no contact details). Active members of rank >= 30 read it.
CREATE OR REPLACE FUNCTION public.garage_members_read(p_garage uuid)
RETURNS TABLE (member_id uuid, user_id uuid, external_identity_id uuid, role text, rank integer, status text,
               started_at timestamptz, joined_via_link boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.user_id, m.external_identity_id, m.role, public.garage_role_rank(m.role), m.status, m.started_at,
         m.joined_via_link_id IS NOT NULL
  FROM public.garage_members m
  WHERE m.garage_id = p_garage AND public.garage_member_rank(p_garage) >= 30
    AND (m.status = 'active' OR public.garage_member_rank(p_garage) >= 80)
  ORDER BY public.garage_role_rank(m.role) DESC, m.started_at NULLS LAST
$$;

-- STUB (VISIBILITY lane). Fails closed.
CREATE OR REPLACE FUNCTION public.can_see_vehicle_via_garage(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT false  -- STUB: VISIBILITY lane fills this body. Until then no vehicle is visible through a garage.
$$;

-- STUB (PRESENCE lane): one row per vehicle with its computed state and the evidence that proves it.
CREATE OR REPLACE FUNCTION public.garage_now(p_garage uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (vehicle_id uuid, state text, relationship text, last_seen_at timestamptz, arrived_at timestamptz,
               departed_at timestamptz, evidence_count integer, proving_evidence jsonb, my_visibility text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'garage_now: not implemented (STUB; PRESENCE lane fills this body)' USING ERRCODE = '0A000';
END $$;

-- STUB (PRESENCE lane): counts per bucket, each with its basis.
CREATE OR REPLACE FUNCTION public.garage_timeline(p_garage uuid, p_from date, p_to date, p_bucket text DEFAULT 'month')
RETURNS TABLE (bucket date, here_count integer, arrivals integer, departures integer, unknown_count integer, basis jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'garage_timeline: not implemented (STUB; PRESENCE lane fills this body)' USING ERRCODE = '0A000';
END $$;

-- STUB (PRESENCE lane): the citations behind one stay; originator ids only, plus the affiliation.
CREATE OR REPLACE FUNCTION public.garage_stay_evidence_read(p_stay uuid)
RETURNS TABLE (signal text, source_table text, source_id text, observed_at timestamptz, recorded_at timestamptz,
               originator_user_id uuid, originator_external_identity_id uuid, weight numeric, affiliation_garage_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'garage_stay_evidence_read: not implemented (STUB; PRESENCE lane fills this body)' USING ERRCODE = '0A000';
END $$;

-- STUB (PRESENCE lane): evidence others contributed into the place, awaiting the owner's eye or placement.
CREATE OR REPLACE FUNCTION public.garage_inbound_feed(p_garage uuid, p_since timestamptz)
RETURNS TABLE (source_table text, source_id text, vehicle_id uuid, observed_at timestamptz, recorded_at timestamptz,
               originator_user_id uuid, originator_external_identity_id uuid, affiliation_garage_id uuid,
               placement_state text, needs_decision boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'garage_inbound_feed: not implemented (STUB; PRESENCE lane fills this body)' USING ERRCODE = '0A000';
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Function grants: signed-in users and the service role only. anon gets nothing from this migration.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.garage_member_rank(uuid, uuid), public.create_garage(text, uuid),
  public.garage_record_assertion(uuid, uuid, text, jsonb), public.garage_my_garages(), public.garage_members_read(uuid),
  public.can_see_vehicle_via_garage(uuid, uuid), public.garage_now(uuid, timestamptz),
  public.garage_timeline(uuid, date, date, text), public.garage_stay_evidence_read(uuid),
  public.garage_inbound_feed(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.garage_member_rank(uuid, uuid), public.create_garage(text, uuid),
  public.garage_record_assertion(uuid, uuid, text, jsonb), public.garage_my_garages(), public.garage_members_read(uuid),
  public.can_see_vehicle_via_garage(uuid, uuid), public.garage_now(uuid, timestamptz),
  public.garage_timeline(uuid, date, date, text), public.garage_stay_evidence_read(uuid),
  public.garage_inbound_feed(uuid, timestamptz)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garage_role_rank(text) TO authenticated, service_role;
