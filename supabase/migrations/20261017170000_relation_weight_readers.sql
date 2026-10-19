-- A relation is a weight computed from its contributions, not a stored status.
--
-- OWNER, 2026-10-15: "active cant be a hard code like it is. its a weight. a relation goes dormant immediately after
-- one day if not maintained by contribution. even within 24hr can stall. i mean at work they dont want u wasting a
-- single minute". And: "when i clicked on an org it sent me to the site" (the phone's organization rows opened
-- nuke.ag).
--
-- MEASURED 2026-10-15 (scripts/data/q.sh):
--   - organization_contributors: 11 rows, all status 'active', none with an end_date; no writer ever sets 'inactive'.
--     The owner's 8 memberships all read active.
--   - organization_vehicles: 528,634 rows (pg_class estimate), 552K of them status 'active' by count; default
--     'active'. vehicle_contributors: 128 rows, all active.
--   - The owner's newest vehicle_images row was taken 2026-09-26 (his phone has not uploaded since; the iOS lane is
--     on it). So no membership has had a photo contribution in more than 17 days, while every badge says ACTIVE.
--   - Viva! Las Vegas Autos, Taylor Customs and Ernies Upholstery have organization_locations within 60 m of each
--     other: one GPS fix cannot say which of them a photo belongs to.
--
-- THE WEIGHT. weight(relation, t) = 2^(-(t - last contribution at or before t) / 6 h). One contribution reads 1 at
-- once, 0.5 after 6 h, 1/16 after 24 h. The states are cut from the weight: live >= 0.5 (within 6 h), stalling
-- >= 1/16 (6 to 24 h), dormant below 1/16 (more than a day, or nothing in the window). Only the last contribution
-- sets the weight: a summed or union weight over a busy day would keep the relation above 1/16 for 30-40 h after it
-- ended (eight hourly
-- contributions ending 24 h before t give 1 - prod(1 - 2^(-k/6)) = 0.29), and the owner's rule is dormant after a
-- day. How much happened is reported beside the weight (distinct contribution hours in the last 24 h), not folded
-- into it. Point-in-time: every evidence clock is <= p_at, so a weight can be replayed for any past moment.
--
-- A CONTRIBUTION (passive evidence; at work nobody spends a minute in the app):
--   - site_photo: the person's vehicle_images row (not superseded) taken within 150 m of one of the organization's
--     organization_locations. At a location shared with another organization (another org's location within 150 m
--     of the photo) it counts only when the photo's vehicle is linked to this organization in organization_vehicles;
--     otherwise it is reported as an unresolved shared-site photo and counts for none of them.
--   - org_image: an organization_images row the person uploaded for the organization (taken_at, else created_at).
--   - timeline_event: a timeline_events row with the person and the organization (event_date is a date; read at
--     12:00 UTC of that day).
--   - work: a contractor_work_contributions row (work_date is a date; 12:00 UTC).
--   For organization <-> vehicle contact: the vehicle's photos (anyone's, as the viewer may read them) at the
--   organization's locations, and timeline_events naming both.
--
-- BOUNDS. Everything reads the 48 h before p_at: an older contribution weighs < 2^-8, so the weight is exact, and
-- a relation with nothing in the window is dormant with its last contribution reported as unknown. The person's
-- photos come from idx_vehicle_images_user_taken_at; a vehicle's from vehicle_images_taken_date, for the
-- organization's 2,000 most recent links (the largest organization has 143,630). Reading every photo at a location
-- instead (idx_vehicle_images_gps: 17,693 photos at Viva's) took 176 ms warm and 8.5 s cold as postgres and timed
-- out at 15 s as the owner, because the read policies run a PL/pgSQL access check per row.
--
-- TESTED in a rolled-back transaction as the owner (authenticated), 2026-10-15:
--   - user_org_relations at now: all 8 memberships dormant, nothing in the window. At 2026-09-15 06:00Z: Viva,
--     Taylor and Ernies each report 5 unresolved shared-site photos (the owner's photos at their shared lot, of
--     vehicles linked to none of them), so none of the three is credited.
--   - get_org_page for Viva at now and at 2026-09-15 06:00Z, both calls together: 1.45 s. 236 links, 179 distinct
--     vehicles, the top 50 returned.
--
-- Membership still decides permissions and filing eligibility (user_associated_vehicle_ids, the RLS policies, the
-- phone's contributor gate): a dormant relation must still be able to file the photo that revives it. These
-- readers only measure. All run SECURITY INVOKER, so the viewer's own read of vehicle_images decides what counts.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.relation_weight(p_last timestamptz, p_at timestamptz DEFAULT now(),
                                                  p_half_life interval DEFAULT interval '6 hours')
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_last IS NULL OR p_at IS NULL OR p_last > p_at THEN 0::double precision
    ELSE power(2::double precision, -extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life))
  END
$$;

COMMENT ON FUNCTION public.relation_weight(timestamptz, timestamptz, interval) IS
  'Relation weight at p_at from the last contribution at or before it: 2^(-age / half-life), half-life 6 h. Live >= 0.5, stalling >= 1/16, dormant below (a day). See 20261017170000_relation_weight_readers.sql.';

CREATE OR REPLACE FUNCTION public.relation_state(p_weight double precision)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_weight >= 0.5 THEN 'live' WHEN p_weight >= 0.0625 THEN 'stalling' ELSE 'dormant' END
$$;

-- A person's photos within p_radius_m of an organization's locations, taken in (p_from, p_to], as the caller may read
-- them (the person's rows come from idx_vehicle_images_user_taken_at, so the read policies run on few rows).
-- shared_with counts the other organizations with a location within p_radius_m of the photo.
CREATE OR REPLACE FUNCTION public.org_site_photos(p_org_id uuid, p_user_id uuid, p_from timestamptz, p_to timestamptz,
                                                  p_radius_m double precision DEFAULT 150)
RETURNS TABLE (image_id uuid, vehicle_id uuid, taken_at timestamptz, shared_with integer, vehicle_linked boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH here AS (
    SELECT ol.latitude::float8 AS lat, ol.longitude::float8 AS lon
    FROM organization_locations ol
    WHERE ol.organization_id = p_org_id AND ol.latitude IS NOT NULL AND ol.longitude IS NOT NULL
  ),
  -- other organizations' locations close enough to share a photo with this one
  others AS (
    SELECT DISTINCT o.organization_id, o.latitude::float8 AS lat, o.longitude::float8 AS lon
    FROM organization_locations o
    JOIN here h ON o.latitude BETWEEN (h.lat - 3 * p_radius_m / 111320.0)::numeric AND (h.lat + 3 * p_radius_m / 111320.0)::numeric
               AND o.longitude BETWEEN (h.lon - 3 * p_radius_m / (111320.0 * cos(radians(h.lat))))::numeric
                                   AND (h.lon + 3 * p_radius_m / (111320.0 * cos(radians(h.lat))))::numeric
    WHERE o.organization_id <> p_org_id
  ),
  -- ordered and capped so the planner walks (user_id, taken_at), never the partial GPS index
  mine AS (
    SELECT vi.id, vi.vehicle_id, vi.taken_at, vi.latitude::float8 AS lat, vi.longitude::float8 AS lon
    FROM vehicle_images vi
    WHERE vi.user_id = p_user_id AND vi.taken_at > p_from AND vi.taken_at <= p_to
      AND coalesce(vi.is_superseded, false) = false
    ORDER BY vi.taken_at DESC
    LIMIT 5000
  ),
  near AS (
    SELECT DISTINCT ON (m.id) m.*
    FROM mine m
    JOIN here h ON st_distancesphere(st_makepoint(h.lon, h.lat), st_makepoint(m.lon, m.lat)) <= p_radius_m
  )
  SELECT n.id, n.vehicle_id, n.taken_at,
         (SELECT count(DISTINCT o.organization_id)::int FROM others o
           WHERE st_distancesphere(st_makepoint(o.lon, o.lat), st_makepoint(n.lon, n.lat)) <= p_radius_m),
         n.vehicle_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM organization_vehicles ov
           WHERE ov.organization_id = p_org_id AND ov.vehicle_id = n.vehicle_id
             AND coalesce(ov.user_rejected, false) = false)
  FROM near n
$$;

-- Each linked vehicle's contact with an organization in the 48 h before p_at: its photos within p_radius_m of the
-- organization's locations (anyone's, as the caller may read them) and timeline events naming both. The vehicles are
-- the organization's p_max_links most recent links; each is probed through vehicle_images_taken_date
-- (vehicle_id, taken_at), so the read policies run only on photos inside the window.
CREATE OR REPLACE FUNCTION public.org_vehicle_contact(p_org_id uuid, p_at timestamptz DEFAULT now(),
                                                      p_radius_m double precision DEFAULT 150,
                                                      p_max_links integer DEFAULT 2000)
RETURNS TABLE (vehicle_id uuid, last_at timestamptz, hours_24h integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH here AS (
    SELECT ol.latitude::float8 AS lat, ol.longitude::float8 AS lon
    FROM organization_locations ol
    WHERE ol.organization_id = p_org_id AND ol.latitude IS NOT NULL AND ol.longitude IS NOT NULL
  ),
  links AS (
    SELECT DISTINCT l.vehicle_id
    FROM (SELECT ov.vehicle_id FROM organization_vehicles ov
          WHERE ov.organization_id = p_org_id AND coalesce(ov.user_rejected, false) = false
          ORDER BY ov.created_at DESC LIMIT p_max_links) l
  ),
  photos AS (
    SELECT l.vehicle_id, vi.taken_at AS at
    FROM links l
    -- ordered and capped so the planner walks (vehicle_id, taken_at) per vehicle: with a latitude IS NOT NULL
    -- condition and the table's stale row estimates it chose a full scan of the partial GPS index instead
    JOIN LATERAL (
      SELECT x.taken_at, x.latitude::float8 AS lat, x.longitude::float8 AS lon
      FROM vehicle_images x
      WHERE x.vehicle_id = l.vehicle_id AND x.taken_at > p_at - interval '48 hours' AND x.taken_at <= p_at
        AND coalesce(x.is_superseded, false) = false
      ORDER BY x.taken_at DESC
      LIMIT 500
    ) vi ON true
    WHERE EXISTS (SELECT 1 FROM here h
                  WHERE st_distancesphere(st_makepoint(h.lon, h.lat), st_makepoint(vi.lon, vi.lat)) <= p_radius_m)
  ),
  events AS (
    SELECT te.vehicle_id, (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' AS at
    FROM timeline_events te
    WHERE te.organization_id = p_org_id AND te.vehicle_id IS NOT NULL
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' > p_at - interval '48 hours'
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
  )
  SELECT e.vehicle_id, max(e.at),
         count(DISTINCT date_trunc('hour', e.at)) FILTER (WHERE e.at > p_at - interval '24 hours')::int
  FROM (SELECT * FROM photos UNION ALL SELECT * FROM events) e
  GROUP BY e.vehicle_id
$$;

-- Every organization a person is a member of, with the relation's weight at p_at.
CREATE OR REPLACE FUNCTION public.user_org_relations(p_user_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH m AS (
    SELECT oc.organization_id, oc.role, oc.status, oc.start_date, oc.end_date, b.business_name, b.business_type
    FROM organization_contributors oc
    LEFT JOIN businesses b ON b.id = oc.organization_id
    WHERE oc.user_id = p_user_id
  ),
  photos AS (
    SELECT m.organization_id, sp.taken_at, sp.shared_with, sp.vehicle_linked
    FROM m, LATERAL org_site_photos(m.organization_id, p_user_id, p_at - interval '48 hours', p_at) sp
  ),
  ev AS (
    SELECT organization_id, 'site_photo'::text AS source, taken_at AS at
    FROM photos WHERE shared_with = 0 OR vehicle_linked
    UNION ALL
    SELECT oi.organization_id, 'org_image', coalesce(oi.taken_at, oi.created_at)
    FROM organization_images oi JOIN m USING (organization_id)
    WHERE oi.user_id = p_user_id
      AND coalesce(oi.taken_at, oi.created_at) > p_at - interval '48 hours' AND coalesce(oi.taken_at, oi.created_at) <= p_at
    UNION ALL
    SELECT te.organization_id, 'timeline_event', (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC'
    FROM timeline_events te JOIN m USING (organization_id)
    WHERE te.user_id = p_user_id
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' > p_at - interval '48 hours'
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
    UNION ALL
    SELECT cw.organization_id, 'work', (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC'
    FROM contractor_work_contributions cw JOIN m USING (organization_id)
    WHERE cw.contractor_user_id = p_user_id
      AND (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' > p_at - interval '48 hours'
      AND (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
  ),
  per_source AS (
    SELECT organization_id, jsonb_object_agg(source, last_at) AS last_by_source
    FROM (SELECT organization_id, source, max(at) AS last_at FROM ev GROUP BY 1, 2) s
    GROUP BY organization_id
  ),
  per_org AS (
    SELECT ev.organization_id, max(ev.at) AS last_at,
           count(DISTINCT date_trunc('hour', ev.at)) FILTER (WHERE ev.at > p_at - interval '24 hours') AS hours_24h,
           ps.last_by_source
    FROM ev JOIN per_source ps USING (organization_id)
    GROUP BY ev.organization_id, ps.last_by_source
  ),
  unresolved AS (
    SELECT organization_id, count(*) AS n
    FROM photos WHERE shared_with > 0 AND NOT vehicle_linked AND taken_at > p_at - interval '24 hours'
    GROUP BY organization_id
  ),
  rel AS (
    SELECT m.*, p.last_at, coalesce(p.hours_24h, 0) AS hours_24h, coalesce(p.last_by_source, '{}'::jsonb) AS last_by_source,
           coalesce(u.n, 0) AS unresolved_24h, relation_weight(p.last_at, p_at) AS weight
    FROM m LEFT JOIN per_org p USING (organization_id) LEFT JOIN unresolved u USING (organization_id)
  )
  SELECT jsonb_build_object(
    'as_of', p_at,
    'half_life_hours', 6,
    'dormant_below', 0.0625,
    'window_hours', 48,
    'relations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'organization_id', r.organization_id,
        'name', r.business_name,
        'type', r.business_type,
        'role', r.role,
        'membership_status', r.status,
        'start_date', r.start_date,
        'end_date', r.end_date,
        'relation', jsonb_build_object(
          'weight', r.weight,
          'state', relation_state(r.weight),
          'last_contribution_at', r.last_at,
          'contributions_24h', r.hours_24h,
          'last_by_source', r.last_by_source,
          'unresolved_shared_site_photos_24h', r.unresolved_24h))
        ORDER BY r.weight DESC, r.last_at DESC NULLS LAST, r.start_date DESC NULLS LAST)
      FROM rel r), '[]'::jsonb))
$$;

COMMENT ON FUNCTION public.user_org_relations(uuid, timestamptz) IS
  'A person''s organization memberships with each relation''s weight at p_at (half-life 6 h, dormant after a day) from site photos, org images, timeline events and contractor work in the 48 h before p_at. Measures only; membership still decides permissions.';

-- One organization for the app: header, the viewer's relation, and linked vehicles by most recent contact.
CREATE OR REPLACE FUNCTION public.get_org_page(p_org_id uuid, p_at timestamptz DEFAULT now(), p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH org AS (
    SELECT b.id, b.business_name, b.business_type, b.city, b.state FROM businesses b WHERE b.id = p_org_id
  ),
  -- the 2,000 most recent links, the same population org_vehicle_contact probes
  links AS (
    SELECT ov.vehicle_id, ov.relationship_type, ov.created_at
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_org_id AND coalesce(ov.user_rejected, false) = false
    ORDER BY ov.created_at DESC
    LIMIT 2000
  ),
  contact AS (
    SELECT c.vehicle_id, c.last_at, c.hours_24h FROM org_vehicle_contact(p_org_id, p_at) c
  ),
  ranked AS (
    SELECT DISTINCT ON (l.vehicle_id) l.vehicle_id, l.relationship_type, l.created_at, c.last_at, coalesce(c.hours_24h, 0) AS hours_24h
    FROM links l LEFT JOIN contact c USING (vehicle_id)
    ORDER BY l.vehicle_id, l.created_at DESC
  ),
  top AS (
    SELECT r.*, v.year, v.make, v.model
    FROM ranked r
    JOIN vehicles v ON v.id = r.vehicle_id          -- the viewer's read of vehicles decides which appear
    ORDER BY r.last_at DESC NULLS LAST, r.created_at DESC
    LIMIT greatest(1, least(p_limit, 200))
  )
  SELECT jsonb_build_object(
    'org', (SELECT jsonb_build_object('id', o.id, 'name', o.business_name, 'type', o.business_type,
                                      'city', o.city, 'state', o.state) FROM org o),
    'as_of', p_at,
    'half_life_hours', 6,
    'dormant_below', 0.0625,
    'basis', jsonb_build_array('photos within 150 m of the organization''s locations', 'organization images',
                               'timeline events', 'contractor work'),
    'you', (SELECT jsonb_build_object('role', r->>'role', 'relation', r->'relation')
            FROM jsonb_array_elements(user_org_relations(auth.uid(), p_at)->'relations') r
            WHERE auth.uid() IS NOT NULL AND r->>'organization_id' = p_org_id::text
            LIMIT 1),
    'vehicles', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'vehicle_id', t.vehicle_id, 'year', t.year, 'make', t.make, 'model', t.model,
        'relationship_type', t.relationship_type,
        -- the newest photo the viewer may read and the gallery shows: by capture time
        -- (vehicle_images_taken_date, backward), else by upload time (idx_vehicle_images_created_at)
        'image_url', coalesce(
          (SELECT vi.image_url FROM vehicle_images vi
           WHERE vi.vehicle_id = t.vehicle_id AND vi.taken_at IS NOT NULL AND vehicle_image_gallery_eligible(vi)
           ORDER BY vi.taken_at DESC LIMIT 1),
          (SELECT vi.image_url FROM vehicle_images vi
           WHERE vi.vehicle_id = t.vehicle_id AND vehicle_image_gallery_eligible(vi)
           ORDER BY vi.created_at DESC LIMIT 1)),
        'relation', jsonb_build_object(
          'weight', relation_weight(t.last_at, p_at),
          'state', relation_state(relation_weight(t.last_at, p_at)),
          'last_contribution_at', t.last_at,
          'contributions_24h', t.hours_24h))
        ORDER BY t.last_at DESC NULLS LAST, t.created_at DESC)
      FROM top t), '[]'::jsonb),
    'vehicles_considered', (SELECT count(DISTINCT vehicle_id) FROM links),
    -- distinct vehicles (one vehicle can hold several links), counted up to 10,001
    'vehicles_total', (SELECT count(DISTINCT x.vehicle_id) FROM (SELECT ov.vehicle_id FROM organization_vehicles ov
                                             WHERE ov.organization_id = p_org_id AND coalesce(ov.user_rejected, false) = false
                                             LIMIT 10001) x)
  )
$$;

COMMENT ON FUNCTION public.get_org_page(uuid, timestamptz, integer) IS
  'The app''s organization page: header, the viewer''s relation weight, and linked vehicles ordered by last contact at the organization (its locations'' photos and timeline events). SECURITY INVOKER: the viewer''s reads decide.';

GRANT EXECUTE ON FUNCTION public.relation_weight(timestamptz, timestamptz, interval) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relation_state(double precision) TO anon, authenticated;
-- anon too: get_org_page runs as its caller and calls both; as anon they read only public rows and no relations.
GRANT EXECUTE ON FUNCTION public.org_site_photos(uuid, uuid, timestamptz, timestamptz, double precision) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_vehicle_contact(uuid, timestamptz, double precision, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_relations(uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_page(uuid, timestamptz, integer) TO anon, authenticated;
