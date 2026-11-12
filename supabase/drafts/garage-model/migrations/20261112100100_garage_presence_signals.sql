-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, migration 01 (PRESENCE lane): the READ-ONLY signal layer. Every presence, departure and relationship
-- signal SPEC.md section 4.2 lists, normalised into one shape. Nothing here writes; the fold (migration 02) is the writer.
-- Design and reasons: docs/garage-model/SPEC.md section 4, docs/garage-model/PRESENCE.md.
--
-- Depends on 20261112100000_garage_core.sql. Reads (never writes) these live tables, columns checked against the catalog
-- snapshot of 2026-11-12: vehicle_images, vehicles, work_sessions, organization_vehicles, vehicle_events, receipts,
-- vehicle_user_permissions, vehicle_contributors, vehicle_contributor_invites, contributors.
--
-- Additions beyond core, all additive and confined to garage_* objects:
--   * garage_derivation_versions: the thresholds are parameters of a derivation version (SPEC 4.3), not literals in a reader.
--   * garage_stay_evidence.signal_class ('A' location-proving, 'B' supporting, 'C' exit), .note and .relationship_hint, so a
--     reader can tell a photo that proves location from one at a site nobody confirmed, and can recompute a stay's relationship
--     AS OF a date from the citations in force then (no hindsight), without re-running the fold.
--
-- Signal classes (SPEC 4.2): A proves the car was physically at the place on that date; B supports (relationship, confidence)
-- and can only make a car "related, never seen here"; C is an exit (it closes a stay only when dated after the last A).
--
-- Honest handling of dates (decisions, each also stated in PRESENCE.md):
--   * placeholder dates: a photo or session dated before garage_derivation_versions.date_floor (default 2000-01-01, which
--     excludes the 1978-01-01 and 1985-01-01 session placeholders and any 1970 epoch default) is EXCLUDED, not down-weighted:
--     a date that is a stand-in carries no information about when the car was here.
--   * future dates (later than now() + 1 day) are EXCLUDED: a clock error cannot be an observation.
--   * taken_at NULL is EXCLUDED from site evidence (created_at is the upload time, not the capture time).
--   * taken_at within 2 minutes of created_at may be the upload-time fallback rather than an EXIF capture time; the repo does not
--     record which. Such a photo is KEPT and DOWN-WEIGHTED (x0.6) with note 'taken_at_equals_upload_time'. Weight changes
--     confidence only, never the state.
--   * GPS NULL, or exactly 0,0, is not site evidence at all.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ---------------------------------------------------------------------------------------------------------------
-- Derivation versions: the knobs. One row per version; an old as-of read reproduces under its own row.
-- Not client-readable (no grant); the SECURITY DEFINER readers/fold read it.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.garage_derivation_versions (
  version        text PRIMARY KEY CHECK (btrim(version) <> ''),
  gap_days       integer NOT NULL CHECK (gap_days > 0),        -- unseen gap that splits a car's history into two stays
  here_days      integer NOT NULL CHECK (here_days > 0),       -- last location-proving sighting this recent: here
  probable_days  integer NOT NULL CHECK (probable_days > here_days),  -- up to this old: probably_here; older: stale
  date_floor     date NOT NULL,                                -- dates before this are placeholders and are excluded
  upload_fallback_seconds integer NOT NULL DEFAULT 120 CHECK (upload_fallback_seconds >= 0),
  upload_fallback_weight  numeric NOT NULL DEFAULT 0.6 CHECK (upload_fallback_weight BETWEEN 0 AND 1),
  decided_by     text NOT NULL,                                -- who set these numbers: they are decisions, not measurements
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.garage_derivation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.garage_derivation_versions FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.garage_derivation_versions IS
  'Thresholds of a stay derivation. Parameters, not measurements: each row says who decided it. No client grant.';
-- v1 = the prior study's proposals (MODEL.md sections 7 and 8), pending Skylar's answer to SPEC Q12. A judgment, labelled as one.
INSERT INTO public.garage_derivation_versions (version, gap_days, here_days, probable_days, date_floor, decided_by, note)
VALUES ('v1', 180, 90, 365, DATE '2000-01-01', 'proposal: photo-truth study 2026-11-12 (MODEL.md 7-8); owner decision pending (SPEC Q12)',
        'gap 180 d splits stays; here <= 90 d; probably_here <= 365 d; dates before 2000-01-01 are placeholders')
ON CONFLICT (version) DO NOTHING;

-- Citation additions (additive; defaults keep the core test's rows valid).
ALTER TABLE public.garage_stay_evidence
  ADD COLUMN IF NOT EXISTS signal_class text NOT NULL DEFAULT 'B' CHECK (signal_class IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS relationship_hint text CHECK (relationship_hint IS NULL OR relationship_hint IN
    ('owned', 'dealer_inventory', 'consignment', 'customer_work', 'storage', 'passing_through', 'unknown'));

-- ---------------------------------------------------------------------------------------------------------------
-- Great-circle distance in metres (haversine, mean earth radius). IMMUTABLE so it can sit in a filter.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 2 * 6371008.8 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Terminal vehicle: follow merged_into_vehicle_id. A merge MOVES history onto the terminal record. A chain that ends in a
-- deleted record, a cycle, a missing row or more than 10 hops is "gone" (SPEC 4.3 rule 3).
-- gone_at is the deleted_at of the record the chain ends on; when the chain is merely broken (cycle / missing / too long)
-- it is NULL and the caller uses the last known row's updated_at, labelled approximate.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_terminal_map(p_vehicles uuid[])
RETURNS TABLE (vehicle_id uuid, terminal_id uuid, gone boolean, gone_at timestamptz, gone_reason text, gone_at_approximate boolean)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE walk AS (
    SELECT v.id AS origin, v.id AS cur, v.merged_into_vehicle_id AS nxt, 0 AS hops, ARRAY[v.id] AS seen, false AS cyc
    FROM public.vehicles v WHERE v.id = ANY (p_vehicles)
    UNION ALL
    SELECT w.origin, n.id, n.merged_into_vehicle_id, w.hops + 1, w.seen || n.id, n.id = ANY (w.seen)
    FROM walk w JOIN public.vehicles n ON n.id = w.nxt
    WHERE w.nxt IS NOT NULL AND w.hops < 10 AND NOT w.cyc
  ),
  ends AS (  -- the last row of each walk
    SELECT DISTINCT ON (origin) origin, cur, nxt, hops, cyc FROM walk ORDER BY origin, hops DESC
  )
  SELECT e.origin, e.cur,
         (v.deleted_at IS NOT NULL OR e.nxt IS NOT NULL OR e.cyc) AS gone,
         CASE WHEN v.deleted_at IS NOT NULL THEN v.deleted_at END AS gone_at,
         CASE WHEN v.deleted_at IS NOT NULL THEN 'deleted'
              WHEN e.cyc THEN 'merge_cycle'
              WHEN e.nxt IS NOT NULL AND e.hops >= 10 THEN 'merge_chain_too_long'
              WHEN e.nxt IS NOT NULL THEN 'merge_target_missing' END AS gone_reason,
         (v.deleted_at IS NULL AND (e.nxt IS NOT NULL OR e.cyc)) AS gone_at_approximate
  FROM ends e JOIN public.vehicles v ON v.id = e.cur
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The relationship a live organization_vehicles link suggests, given how the garage knows that org.
--   owner @ operator org -> owned        owner @ hosted org -> dealer_inventory     owner @ tenant org -> unknown (their cars)
--   consigner -> consignment             service_provider -> customer_work
--   work_location: active -> customer_work (ambiguous with storage, SPEC 6.1: weight stays low), pending -> no hint
--   sold_by and everything else -> no hint (sold_by is an exit, not a relationship)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_org_link_hint(p_relationship_type text, p_status text, p_org_kind text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_relationship_type = 'owner' AND p_org_kind = 'operator' THEN 'owned'
    WHEN p_relationship_type = 'owner' AND p_org_kind = 'hosted'   THEN 'dealer_inventory'
    WHEN p_relationship_type = 'consigner'                         THEN 'consignment'
    WHEN p_relationship_type = 'service_provider'                  THEN 'customer_work'
    WHEN p_relationship_type = 'work_location' AND p_status = 'active' THEN 'customer_work'
    ELSE NULL
  END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- THE SIGNAL LAYER. One row per signal, one shape.
--
--   garage_id, vehicle_id (TERMINAL vehicle), signal (a garage_stay_evidence.signal value), signal_class (A/B/C),
--   observed_at (event clock), source_table, source_id, originator_user_id / originator_external_identity_id (who MADE it;
--   never the garage owner by default), weight, relationship_hint (nullable; one of the stay relationships),
--   organization_id (the garage org an org-held hint is about), note (why it was down-weighted or classed as it was).
--
-- A vehicle appears only if the garage has a TIE to it: a photo inside a site, an organization_vehicles link at one of the
-- garage's organizations, a member assertion, a supporting record authored by a garage member, or a contributor-link upload
-- on an invite a member made. Without that tie a receipt or a sale event on some stranger's car would put every car in the
-- world into every garage. Exits and supporting signals are returned only for tied vehicles.
--
-- Cost: the photo arm needs an index on vehicle_images(latitude, longitude) WHERE latitude IS NOT NULL to be bounded on the
-- 64M-row live table; it is NOT created here (it would be its own gated migration, see PRESENCE.md). p_vehicle narrows every arm
-- to one car for the per-car read. Granted to service_role only (it reads across every user's photos).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_presence_signals(
  p_garage uuid, p_as_of timestamptz DEFAULT now(), p_version text DEFAULT 'v1', p_vehicle uuid DEFAULT NULL)
RETURNS TABLE (garage_id uuid, vehicle_id uuid, signal text, signal_class text, observed_at timestamptz, source_table text,
               source_id text, originator_user_id uuid, originator_external_identity_id uuid, weight numeric,
               relationship_hint text, organization_id uuid, note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  prm public.garage_derivation_versions%ROWTYPE;
  v_floor timestamptz;
  v_ceiling timestamptz := least(p_as_of, now() + interval '1 day');
BEGIN
  SELECT * INTO prm FROM public.garage_derivation_versions WHERE version = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown derivation version %', p_version USING ERRCODE = '22023'; END IF;
  v_floor := prm.date_floor::timestamptz;

  RETURN QUERY
  WITH
  sites AS (
    SELECT s.id, s.lat, s.lon, s.radius_m, s.valid_from, s.valid_to, (s.confirmed_at IS NOT NULL) AS confirmed,
           -- bounding box in degrees (generous: 1 deg latitude ~ 111 km; longitude shrinks with cos(lat))
           s.radius_m / 111000.0 * 1.2 AS dlat,
           s.radius_m / (111000.0 * greatest(0.01, cos(radians(s.lat)))) * 1.2 AS dlon
    FROM public.garage_sites s WHERE s.garage_id = p_garage
  ),
  members AS (  -- everyone who has ever been an approved member (an as-of read must credit a technician who has since left)
    SELECT m.user_id, m.external_identity_id, m.role, m.status, m.started_at, m.ended_at
    FROM public.garage_members m WHERE m.garage_id = p_garage AND m.started_at IS NOT NULL
  ),
  gorgs AS (
    SELECT go.organization_id, go.kind FROM public.garage_organizations go WHERE go.garage_id = p_garage
  ),
  -- ---- A / B: photos --------------------------------------------------------------------------------------------
  photo_raw AS (
    SELECT i.id, i.vehicle_id AS raw_vehicle, i.taken_at AS obs, i.created_at, i.source,
           i.latitude::double precision AS lat, i.longitude::double precision AS lon,
           coalesce(i.documented_by_user_id, i.user_id) AS author, i.photographer_attribution
    FROM public.vehicle_images i
    WHERE i.vehicle_id IS NOT NULL
      AND (p_vehicle IS NULL OR i.vehicle_id = p_vehicle OR i.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
      AND i.taken_at IS NOT NULL AND i.taken_at >= v_floor AND i.taken_at <= v_ceiling
      AND coalesce(i.is_superseded, false) = false AND coalesce(i.is_duplicate, false) = false
      AND coalesce(i.is_document, false) = false AND coalesce(i.is_sensitive, false) = false
      AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
      AND (
        (i.latitude IS NOT NULL AND i.longitude IS NOT NULL AND NOT (i.latitude = 0 AND i.longitude = 0)
          AND EXISTS (SELECT 1 FROM sites st WHERE i.latitude BETWEEN st.lat - st.dlat AND st.lat + st.dlat
                                                AND i.longitude BETWEEN st.lon - st.dlon AND st.lon + st.dlon))
        OR i.source = 'contributor_link'
      )
  ),
  photo_hit AS (  -- the site valid on the photo's own date that contains the point; confirmed sites win
    SELECT p.*, h.site_id, h.confirmed
    FROM photo_raw p
    LEFT JOIN LATERAL (
      SELECT st.id AS site_id, st.confirmed
      FROM sites st
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
        AND (st.valid_from IS NULL OR st.valid_from <= (p.obs AT TIME ZONE 'UTC')::date)
        AND (st.valid_to IS NULL OR st.valid_to >= (p.obs AT TIME ZONE 'UTC')::date)
        AND public.garage_distance_m(p.lat, p.lon, st.lat, st.lon) <= st.radius_m
      ORDER BY st.confirmed DESC, st.id
      LIMIT 1
    ) h ON true
  ),
  photo_contrib AS (  -- contributor-link photos carry the contributor in photographer_attribution = 'contributor:<uuid>'
    SELECT p.*, c.user_id AS c_user, c.external_identity_id AS c_ext
    FROM photo_hit p
    LEFT JOIN public.contributors c
      ON p.photographer_attribution ~ '^contributor:[0-9a-fA-F-]{36}$'
     AND c.id = substr(p.photographer_attribution, 13)::uuid
  ),
  photo_signals AS (
    SELECT p.raw_vehicle,
           CASE WHEN p.site_id IS NOT NULL THEN 'site_photo' ELSE 'contributor_link_upload' END AS sig,
           CASE WHEN p.site_id IS NOT NULL AND p.confirmed THEN 'A' ELSE 'B' END AS cls,
           p.obs, 'vehicle_images'::text AS st, p.id::text AS sid,
           CASE WHEN p.source = 'contributor_link' THEN p.c_user ELSE p.author END AS o_user,
           CASE WHEN p.source = 'contributor_link' THEN p.c_ext END AS o_ext,
           (CASE WHEN p.site_id IS NOT NULL AND p.confirmed THEN 1.0
                 WHEN p.site_id IS NOT NULL THEN 0.5 ELSE 0.2 END)
             * (CASE WHEN abs(extract(epoch FROM (p.obs - p.created_at))) <= prm.upload_fallback_seconds
                     THEN prm.upload_fallback_weight ELSE 1 END) AS w,
           NULL::text AS hint, NULL::uuid AS org,
           concat_ws(',',
             CASE WHEN p.site_id IS NOT NULL AND NOT p.confirmed THEN 'site_unconfirmed' END,
             CASE WHEN p.site_id IS NULL THEN 'no_gps_inside_site' END,
             CASE WHEN abs(extract(epoch FROM (p.obs - p.created_at))) <= prm.upload_fallback_seconds
                  THEN 'taken_at_equals_upload_time' END) AS note
    FROM photo_contrib p
    WHERE p.site_id IS NOT NULL OR p.source = 'contributor_link'
  ),
  -- ---- R / B: organization_vehicles links -------------------------------------------------------------------------
  org_links AS (
    SELECT ov.vehicle_id AS raw_vehicle, ov.id, ov.relationship_type, ov.status, g.kind, ov.organization_id,
           coalesce(ov.start_date::timestamptz, ov.created_at) AS obs, ov.sale_date, ov.end_date
    FROM public.organization_vehicles ov JOIN gorgs g ON g.organization_id = ov.organization_id
    WHERE ov.vehicle_id IS NOT NULL AND coalesce(ov.user_rejected, false) = false
      AND (p_vehicle IS NULL OR ov.vehicle_id = p_vehicle OR ov.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
  ),
  org_signals AS (
    SELECT l.raw_vehicle, 'org_link'::text AS sig, 'B'::text AS cls, l.obs, 'organization_vehicles'::text AS st, l.id::text AS sid,
           NULL::uuid AS o_user, NULL::uuid AS o_ext,
           (CASE WHEN l.status = 'active' THEN 0.5 WHEN l.status = 'pending' THEN 0.15 ELSE 0.1 END)::numeric AS w,
           public.garage_org_link_hint(l.relationship_type, l.status, l.kind) AS hint, l.organization_id AS org,
           concat_ws(',', 'relationship:' || l.relationship_type, 'status:' || l.status, 'org_kind:' || l.kind,
                     'relationship_evidence_not_presence') AS note
    FROM org_links l WHERE l.obs <= v_ceiling
    UNION ALL  -- the org sold it: an exit, only when the link says WHEN (undated sales are not guessed)
    SELECT l.raw_vehicle, 'sale_event', 'C', coalesce(l.sale_date::timestamptz, l.end_date::timestamptz), 'organization_vehicles', l.id::text,
           NULL, NULL, 0.8::numeric, NULL, l.organization_id, 'org link ' || l.relationship_type || ' ' || l.status
    FROM org_links l
    WHERE l.relationship_type IN ('sold_by', 'owner') AND l.status IN ('sold', 'past')
      AND coalesce(l.sale_date::timestamptz, l.end_date::timestamptz) IS NOT NULL
      AND coalesce(l.sale_date::timestamptz, l.end_date::timestamptz) >= v_floor
      AND coalesce(l.sale_date::timestamptz, l.end_date::timestamptz) <= v_ceiling
  ),
  -- ---- B: supporting records authored by a member ------------------------------------------------------------------
  session_signals AS (
    SELECT w.vehicle_id AS raw_vehicle, 'work_session'::text AS sig, 'B'::text AS cls,
           coalesce(w.start_time, w.session_date::timestamptz) AS obs, 'work_sessions'::text AS st, w.id::text AS sid,
           w.user_id AS o_user, NULL::uuid AS o_ext,
           (CASE WHEN w.owner_confirmed_at IS NOT NULL THEN 0.6
                 WHEN coalesce(w.session_type, '') IN ('capture_derived', 'auto_detected') THEN 0.1
                 ELSE 0.3 END)::numeric AS w,
           NULL::text AS hint, NULL::uuid AS org,
           concat_ws(',', 'work_happened_not_where',
             CASE WHEN coalesce(w.session_type, '') IN ('capture_derived', 'auto_detected') THEN 'derived_from_photo_burst' END) AS note,
           w.session_date
    FROM public.work_sessions w
    WHERE w.vehicle_id IS NOT NULL AND w.session_date IS NOT NULL
      AND w.session_date::timestamptz >= v_floor                      -- placeholder dates (1978-01-01, 1985-01-01) out
      AND coalesce(w.start_time, w.session_date::timestamptz) <= v_ceiling
      AND (p_vehicle IS NULL OR w.vehicle_id = p_vehicle OR w.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
      AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = w.user_id)   -- ever a member: a backfill predates the garage row
  ),
  receipt_signals AS (
    SELECT r.vehicle_id AS raw_vehicle, 'receipt'::text AS sig, 'B'::text AS cls,
           coalesce(r.occurred_at, r.receipt_date::timestamptz, r.transaction_date::timestamptz, r.purchase_date::timestamptz) AS obs,
           'receipts'::text AS st, r.id::text AS sid, coalesce(r.created_by, r.user_id) AS o_user, NULL::uuid AS o_ext,
           0.2::numeric AS w, NULL::text AS hint, NULL::uuid AS org, 'purchase_not_location'::text AS note
    FROM public.receipts r
    WHERE r.vehicle_id IS NOT NULL AND coalesce(r.is_superseded, false) = false AND r.duplicate_of IS NULL
      AND coalesce(r.occurred_at, r.receipt_date::timestamptz, r.transaction_date::timestamptz, r.purchase_date::timestamptz) >= v_floor
      AND coalesce(r.occurred_at, r.receipt_date::timestamptz, r.transaction_date::timestamptz, r.purchase_date::timestamptz) <= v_ceiling
      AND (p_vehicle IS NULL OR r.vehicle_id = p_vehicle OR r.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
      AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = coalesce(r.created_by, r.user_id))
  ),
  -- relationship hints from a member's own permission or contributor row. Contribution is NOT ownership: only an explicit
  -- owner permission held by a manager-or-above member hints 'owned', and only at weight 0.4 (below an org link or an assertion).
  perm_signals AS (
    SELECT p.vehicle_id AS raw_vehicle, 'org_link'::text AS sig, 'B'::text AS cls, coalesce(p.granted_at, p.created_at) AS obs,
           'vehicle_user_permissions'::text AS st, p.id::text AS sid, p.user_id AS o_user, NULL::uuid AS o_ext, 0.4::numeric AS w,
           CASE WHEN p.role = 'owner' AND public.garage_role_rank(m.role) >= 80 THEN 'owned'
                WHEN p.role = 'consigned' THEN 'consignment' END AS hint,
           NULL::uuid AS org, concat_ws(',', 'permission:' || p.role, 'permission_is_not_title') AS note
    FROM public.vehicle_user_permissions p
    JOIN members m ON m.user_id = p.user_id
    WHERE p.vehicle_id IS NOT NULL AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
      AND coalesce(p.granted_at, p.created_at) <= v_ceiling
      AND (p_vehicle IS NULL OR p.vehicle_id = p_vehicle OR p.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
  ),
  contrib_signals AS (
    SELECT c.vehicle_id AS raw_vehicle, 'org_link'::text AS sig, 'B'::text AS cls, coalesce(c.start_date::timestamptz, c.created_at) AS obs,
           'vehicle_contributors'::text AS st, c.id::text AS sid, c.user_id AS o_user, NULL::uuid AS o_ext, 0.1::numeric AS w,
           CASE WHEN c.role = 'consigner' THEN 'consignment' END AS hint,   -- a photographer / mechanic / even a self-claimed 'owner' contributor never implies owned
           NULL::uuid AS org, concat_ws(',', 'contributor_role:' || c.role, 'contribution_is_not_ownership') AS note
    FROM public.vehicle_contributors c
    JOIN members m ON m.user_id = c.user_id
    WHERE c.vehicle_id IS NOT NULL AND coalesce(c.status, 'active') = 'active'
      AND coalesce(c.start_date::timestamptz, c.created_at) <= v_ceiling
      AND (p_vehicle IS NULL OR c.vehicle_id = p_vehicle OR c.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
  ),
  -- ---- A / C / R: the human word ---------------------------------------------------------------------------------
  assertion_signals AS (
    SELECT a.vehicle_id AS raw_vehicle,
           'member_assertion'::text AS sig,
           CASE a.kind WHEN 'here' THEN 'A' WHEN 'relationship' THEN 'B' ELSE 'C' END AS cls,   -- left and not_here are exits
           CASE a.kind WHEN 'left' THEN coalesce((a.value ->> 'on')::timestamptz, a.asserted_at) ELSE a.asserted_at END AS obs,
           'garage_stay_assertions'::text AS st, a.id::text AS sid, a.asserted_by AS o_user, NULL::uuid AS o_ext,
           1.0::numeric AS w,
           CASE WHEN a.kind = 'relationship' THEN a.value ->> 'relationship' END AS hint,
           NULL::uuid AS org, ('assertion:' || a.kind)::text AS note
    FROM public.garage_stay_assertions a
    LEFT JOIN public.garage_stay_assertions sup ON sup.id = a.superseded_by
    WHERE a.garage_id = p_garage AND a.asserted_at <= v_ceiling
      AND (a.superseded_by IS NULL OR sup.asserted_at > p_as_of)       -- the word in force at p_as_of
      AND (p_vehicle IS NULL OR a.vehicle_id = p_vehicle OR a.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
  ),
  -- ---- C: sale / listing events ----------------------------------------------------------------------------------
  event_signals AS (
    SELECT e.vehicle_id AS raw_vehicle,
           CASE WHEN e.event_status = 'sold' THEN 'sale_event' ELSE 'listing' END AS sig,
           'C'::text AS cls,
           CASE WHEN e.event_status = 'sold' THEN coalesce(e.sold_at, e.ended_at) ELSE coalesce(e.started_at, e.ended_at) END AS obs,
           'vehicle_events'::text AS st, e.id::text AS sid, NULL::uuid AS o_user, NULL::uuid AS o_ext,
           (CASE WHEN e.event_status = 'sold' THEN 1.0 ELSE 0.4 END)::numeric AS w, NULL::text AS hint, NULL::uuid AS org,
           concat_ws(',', 'event_type:' || e.event_type, 'status:' || e.event_status,
                     CASE WHEN e.event_status <> 'sold' THEN 'listing_is_weak_exit' END) AS note
    FROM public.vehicle_events e
    WHERE e.vehicle_id IS NOT NULL
      AND (e.event_status = 'sold' OR (e.event_type IN ('listing', 'auction', 'classified') AND e.event_status IN ('active', 'ended', 'unsold')))
      AND (p_vehicle IS NULL OR e.vehicle_id = p_vehicle OR e.vehicle_id IN (SELECT mv.id FROM public.vehicles mv WHERE mv.merged_into_vehicle_id = p_vehicle))
  ),
  -- ---- everything that ties a vehicle to this garage, then the exits and supporting rows for tied vehicles only -------
  tie_raw AS (
    SELECT raw_vehicle FROM photo_signals WHERE sig = 'site_photo'
    UNION SELECT raw_vehicle FROM org_signals WHERE sig = 'org_link'
    UNION SELECT raw_vehicle FROM assertion_signals
    UNION SELECT raw_vehicle FROM session_signals
    UNION SELECT raw_vehicle FROM receipt_signals
    UNION SELECT raw_vehicle FROM perm_signals
    UNION SELECT raw_vehicle FROM contrib_signals
    UNION SELECT ps.raw_vehicle FROM photo_signals ps
          WHERE ps.sig = 'contributor_link_upload'
            AND EXISTS (SELECT 1 FROM public.vehicle_contributor_invites inv JOIN members m ON m.user_id = inv.created_by
                        WHERE inv.vehicle_id = ps.raw_vehicle)
  ),
  all_raw AS (
    SELECT * FROM (
      SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM photo_signals WHERE sig = 'site_photo'
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM photo_signals ps
        WHERE ps.sig = 'contributor_link_upload'
          AND EXISTS (SELECT 1 FROM public.vehicle_contributor_invites inv JOIN members m ON m.user_id = inv.created_by WHERE inv.vehicle_id = ps.raw_vehicle)
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM org_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM session_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM receipt_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM perm_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM contrib_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM assertion_signals
      UNION ALL SELECT raw_vehicle, sig, cls, obs, st, sid, o_user, o_ext, w, hint, org, note FROM event_signals
    ) u
    WHERE u.obs IS NOT NULL AND u.raw_vehicle IN (SELECT raw_vehicle FROM tie_raw)
  ),
  tmap AS (
    SELECT t.* FROM public.garage_terminal_map(ARRAY(SELECT DISTINCT raw_vehicle FROM all_raw)) t
  ),
  mapped AS (
    SELECT p_garage AS g, t.terminal_id AS vid, r.sig, r.cls, r.obs, r.st, r.sid, r.o_user, r.o_ext, r.w, r.hint, r.org,
           concat_ws(',', r.note, CASE WHEN t.vehicle_id <> t.terminal_id THEN 'moved_from_merged_record' END) AS note
    FROM all_raw r JOIN tmap t ON t.vehicle_id = r.raw_vehicle
    WHERE p_vehicle IS NULL OR t.terminal_id = p_vehicle
  ),
  gone_signals AS (   -- the record is deleted, or its merge chain cannot be resolved: the car cannot be counted as here
    SELECT DISTINCT ON (t.terminal_id)   -- several merged-away ids can resolve to one terminal record: one gone signal
           p_garage AS g, t.terminal_id AS vid, 'record_deleted_or_merged'::text AS sig, 'C'::text AS cls,
           coalesce(t.gone_at, (SELECT v.updated_at FROM public.vehicles v WHERE v.id = t.terminal_id)) AS obs,
           'vehicles'::text AS st, t.terminal_id::text AS sid, NULL::uuid AS o_user, NULL::uuid AS o_ext, 1.0::numeric AS w,
           NULL::text AS hint, NULL::uuid AS org,
           concat_ws(',', 'reason:' || t.gone_reason, CASE WHEN t.gone_at_approximate THEN 'date_is_updated_at_approximate' END) AS note
    FROM tmap t
    WHERE t.gone AND (p_vehicle IS NULL OR t.terminal_id = p_vehicle)
  ),
  unioned AS (
    SELECT * FROM mapped
    UNION ALL
    SELECT * FROM gone_signals WHERE obs IS NOT NULL AND obs <= v_ceiling
  )
  SELECT u.g, u.vid, u.sig, u.cls, u.obs, u.st, u.sid, u.o_user, u.o_ext, round(u.w, 3), u.hint, u.org, nullif(u.note, '')
  FROM unioned u
  -- a signal that is not an exit or a gone marker must not be dated after the as-of read
  WHERE u.obs <= v_ceiling
  ORDER BY u.vid, u.obs, u.sig, u.sid;
END
$fn$;
COMMENT ON FUNCTION public.garage_presence_signals(uuid, timestamptz, text, uuid) IS
  'Read-only. Every presence, departure and relationship signal for one garage in one shape: (garage_id, vehicle_id [terminal], signal, class A/B/C, observed_at, source, originator ids, weight, relationship_hint). A = proves location, B = supports, C = exit. service_role only.';

REVOKE EXECUTE ON FUNCTION public.garage_distance_m(double precision, double precision, double precision, double precision),
  public.garage_terminal_map(uuid[]), public.garage_org_link_hint(text, text, text),
  public.garage_presence_signals(uuid, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.garage_distance_m(double precision, double precision, double precision, double precision),
  public.garage_terminal_map(uuid[]), public.garage_org_link_hint(text, text, text),
  public.garage_presence_signals(uuid, timestamptz, text, uuid) TO service_role;
