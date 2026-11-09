-- Garage evidence chain: derive_vehicle_relationships becomes an ordered elimination over cited evidence
-- (1 origin facts, 2 matched listings, 3 org GPS hypothesis, 4 titles, 5 account statements). Each step records its
-- evidence, confidence and the candidate roles it eliminated in evidence->'chain'.
-- Adds: org_seller_aliases (platform seller handle -> organization, seeded: bat 'vivalasvegasautos' -> Viva),
-- derived_role 'previously_documented' + documented_from / documented_to, the decay window in platform_config
-- ('garage_documenting_decay_months', {"months": 18}: documenting with no photo or activity for that long becomes
-- previously_documented; change the row, not the function).
-- The function body is generated from supabase/sql/derive_vehicle_relationships_preview.sql (the read-only preview);
-- scripts/tests/garage-relationship-derivations.sql asserts both return the same rows.
-- Rollback: re-apply 20261111170000's function body; drop the alias table and columns; derivation rows are superseded, never deleted.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.org_seller_aliases (
  platform text NOT NULL,
  seller_username text NOT NULL CHECK (seller_username = lower(btrim(seller_username))),
  organization_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'owner statement 2026-11-07',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, seller_username)
);
COMMENT ON TABLE public.org_seller_aliases IS
  'Platform seller handle (lowercase) that is known to be an organization. Lets a listing whose seller is a handle resolve to organizations.id. Read by derive_vehicle_relationships (step 2). No FK on purpose: an alias may be loaded before the organization row.';
ALTER TABLE public.org_seller_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_seller_aliases_service ON public.org_seller_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.org_seller_aliases FROM anon, authenticated;
GRANT ALL ON public.org_seller_aliases TO service_role;
INSERT INTO public.org_seller_aliases(platform, seller_username, organization_id)
VALUES ('bat', 'vivalasvegasautos', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf');

INSERT INTO public.platform_config(config_key, config_value, description)
VALUES ('garage_documenting_decay_months', '{"months": 18}',
        'Months without a photo or activity after which a documenting relationship is shown as previously_documented (derive_vehicle_relationships).')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.vehicle_relationship_derivations
  ADD COLUMN documented_from timestamptz,
  ADD COLUMN documented_to timestamptz;
COMMENT ON COLUMN public.vehicle_relationship_derivations.documented_from IS 'Earliest capture time of the account''s own photos of the vehicle (min of taken_at, else created_at).';
COMMENT ON COLUMN public.vehicle_relationship_derivations.documented_to IS 'Latest capture time of the account''s own photos of the vehicle (max of taken_at, else created_at).';
ALTER TABLE public.vehicle_relationship_derivations DROP CONSTRAINT vehicle_relationship_derivations_derived_role_check;
ALTER TABLE public.vehicle_relationship_derivations ADD CONSTRAINT vehicle_relationship_derivations_derived_role_check
  CHECK (derived_role IN ('owner_verified','owner_reported','co_owner_verified','previously_owned','business_handling',
    'consignment','sales_representative','claimed_interest','transfer_pending','documenting','previously_documented',
    'contributor','profile_record'));

CREATE OR REPLACE FUNCTION public.derive_vehicle_relationships(
  p_user uuid, p_vehicle uuid DEFAULT NULL, p_run_id uuid DEFAULT gen_random_uuid(), p_dry_run boolean DEFAULT true)
RETURNS TABLE(vehicle_id uuid, old_role text, derived_role text, confidence numeric, evidence jsonb, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_service boolean := coalesce(auth.role() = 'service_role', false);
  r record; v_prev uuid; v_prev_role text; v_new uuid;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'user required' USING ERRCODE = '22023'; END IF;
  IF NOT v_service AND (p_dry_run IS NOT TRUE OR auth.uid() IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'service role required (or own-account dry run)' USING ERRCODE = '42501';
  END IF;

  FOR r IN
WITH cfg AS (
  SELECT p_user AS u,
         p_vehicle AS only_v,
         coalesce((SELECT (pc.config_value->>'months')::int FROM platform_config pc
                    WHERE pc.config_key = 'garage_documenting_decay_months'), 18) AS months
),
cand AS (
  SELECT DISTINCT c.vid FROM cfg CROSS JOIN LATERAL (
      SELECT ov.vehicle_id AS vid FROM ownership_verifications ov WHERE ov.user_id = cfg.u
      UNION SELECT vup.vehicle_id FROM vehicle_user_permissions vup WHERE vup.user_id = cfg.u
      UNION SELECT vo.vehicle_id FROM vehicle_ownerships vo WHERE vo.owner_profile_id = cfg.u
      UNION SELECT dv.vehicle_id FROM discovered_vehicles dv WHERE dv.user_id = cfg.u
      UNION SELECT vc.vehicle_id FROM vehicle_contributors vc WHERE vc.user_id = cfg.u
      UNION SELECT v.id FROM vehicles v WHERE v.user_id = cfg.u AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      UNION SELECT vi.vehicle_id FROM vehicle_images vi WHERE vi.user_id = cfg.u
      UNION SELECT o.vehicle_id FROM vehicle_observations o
        WHERE o.submitted_by_user_id = cfg.u AND o.structured_data->>'claim_contract' = 'garage_owner_correction_v1'
    ) c
  WHERE c.vid IS NOT NULL AND (cfg.only_v IS NULL OR c.vid = cfg.only_v)
),
cur AS MATERIALIZED (
  SELECT g.vehicle_id AS vid, g.relationship FROM get_user_garage((SELECT cfg.u FROM cfg)) g
),
f AS (
  SELECT cand.vid, cfg.u, cfg.months,
         ver.id AS ver_id,
         perm.co_by_other, perm.self_granted, perm.owner_perm,
         obs.id AS obs_id, obs.content_text, obs.structured_data,
         ph.n AS photos, ph.first_t, ph.last_t, ph.gps_n, ph.recent_gps_n, ph.devices, ph.clat, ph.clon,
         ol.t AS obs_last,
         EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = cand.vid AND vc.user_id = cfg.u) AS contrib,
         EXISTS (SELECT 1 FROM vehicle_ownerships vo WHERE vo.vehicle_id = cand.vid AND vo.owner_profile_id = cfg.u
                   AND vo.is_current = true) AS cur_own,
         EXISTS (SELECT 1 FROM discovered_vehicles dv WHERE dv.vehicle_id = cand.vid AND dv.user_id = cfg.u
                   AND dv.is_active = true AND dv.relationship_type = 'previously_owned') AS disc_prev,
         org.org_id, org.org_conf, org.n_orgs, org.srcs
  FROM cand CROSS JOIN cfg
  -- Step 4 evidence: approved, https document, not revoked (revoked_at read defensively; the column may not exist).
  LEFT JOIN LATERAL (
    SELECT ov.id FROM ownership_verifications ov
     WHERE ov.vehicle_id = cand.vid AND ov.user_id = cfg.u AND ov.status = 'approved'
       AND ov.title_document_url ~ '^https://' AND to_jsonb(ov)->>'revoked_at' IS NULL
     ORDER BY ov.created_at DESC LIMIT 1) ver ON true
  -- A grant counts only if someone other than the account itself made it.
  LEFT JOIN LATERAL (
    SELECT coalesce(bool_or(p.role = 'co_owner' AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
                            AND p.granted_by IS NOT NULL AND p.granted_by <> p.user_id), false) AS co_by_other,
           coalesce(bool_or(p.granted_by = p.user_id AND p.role IN ('owner','co_owner') AND p.revoked_at IS NULL), false) AS self_granted,
           coalesce(bool_or(p.role = 'owner' AND p.revoked_at IS NULL), false) AS owner_perm
      FROM vehicle_user_permissions p WHERE p.vehicle_id = cand.vid AND p.user_id = cfg.u) perm ON true
  -- Step 5 evidence: latest live account statement.
  LEFT JOIN LATERAL (
    SELECT o.id, o.content_text, o.structured_data FROM vehicle_observations o
     WHERE o.vehicle_id = cand.vid AND o.submitted_by_user_id = cfg.u AND o.is_superseded IS NOT TRUE
       AND o.structured_data->>'claim_contract' = 'garage_owner_correction_v1'
       AND o.structured_data->'correction' ? 'relationship'
     ORDER BY o.observed_at DESC NULLS LAST, o.ingested_at DESC LIMIT 1) obs ON true
  -- Step 1 evidence: the account's own photos (uploader, device, capture time, GPS).
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, min(p.t) AS first_t, max(p.t) AS last_t,
           count(*) FILTER (WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL) AS gps_n,
           count(*) FILTER (WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
                              AND p.t >= now() - make_interval(months => cfg.months)) AS recent_gps_n,
           count(DISTINCT p.dev) AS devices,
           avg(p.lat) FILTER (WHERE p.lon IS NOT NULL) AS clat, avg(p.lon) FILTER (WHERE p.lat IS NOT NULL) AS clon
      FROM (SELECT coalesce(vi.taken_at, vi.created_at) AS t, vi.latitude::float8 AS lat, vi.longitude::float8 AS lon,
                   to_jsonb(vi)->>'device_fingerprint' AS dev
              FROM vehicle_images vi WHERE vi.vehicle_id = cand.vid AND vi.user_id = cfg.u) p) ph ON true
  LEFT JOIN LATERAL (
    SELECT max(o.observed_at) AS t FROM vehicle_observations o
     WHERE o.vehicle_id = cand.vid AND o.submitted_by_user_id = cfg.u) ol ON true
  -- Step 2 evidence: listings matched to the vehicle and the organization their seller resolves to.
  LEFT JOIN LATERAL (
    SELECT (array_agg(x.org ORDER BY x.conf DESC))[1] AS org_id, max(x.conf) AS org_conf,
           count(DISTINCT x.org) AS n_orgs,
           jsonb_agg(jsonb_build_object('source', x.src, 'organization_id', x.org, 'confidence', x.conf, 'ref', x.ref)) AS srcs
      FROM (
        SELECT bl.organization_id AS org, 0.90 AS conf, 'bat_listings.organization_id' AS src, bl.bat_listing_url AS ref
          FROM bat_listings bl WHERE bl.vehicle_id = cand.vid AND bl.organization_id IS NOT NULL
        UNION ALL
        SELECT a.organization_id, 0.80, 'bat_listings.seller_username via org_seller_aliases', bl.bat_listing_url
          FROM bat_listings bl JOIN org_seller_aliases a ON a.platform = 'bat' AND a.seller_username = lower(btrim(bl.seller_username))
         WHERE bl.vehicle_id = cand.vid AND bl.organization_id IS NULL
        UNION ALL
        SELECT el.organization_id, 0.90, 'external_listings.organization_id', el.listing_url
          FROM external_listings el WHERE el.vehicle_id = cand.vid AND el.organization_id IS NOT NULL
        UNION ALL
        SELECT a.organization_id, 0.70, 'vehicles.bat_seller via org_seller_aliases', NULL::text
          FROM vehicles v JOIN org_seller_aliases a ON a.platform = 'bat' AND a.seller_username = lower(btrim(v.bat_seller))
         WHERE v.id = cand.vid
        UNION ALL
        SELECT a.organization_id, 0.70, 'vehicles.origin_metadata.bat_snapshot_parsed.seller_username via org_seller_aliases', NULL::text
          FROM vehicles v JOIN org_seller_aliases a ON a.platform = 'bat'
           AND a.seller_username = lower(btrim(v.origin_metadata->'bat_snapshot_parsed'->>'seller_username'))
         WHERE v.id = cand.vid
      ) x) org ON true
),
g1 AS (
  SELECT f.*, f.structured_data->'correction'->'relationship' AS claim FROM f
),
g2 AS (
  SELECT g1.*,
         ARRAY(SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(g1.claim->'roles') = 'array'
                                                          THEN g1.claim->'roles' ELSE '[]'::jsonb END) x) AS roles,
         g1.obs_id IS NOT NULL AND (
           coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(g1.structured_data->'correction'->'evidence_ids') = 'array'
                                            THEN g1.structured_data->'correction'->'evidence_ids' END), 0) > 0
           OR nullif(btrim(coalesce(g1.content_text, '')), '') IS NOT NULL) AS cited,
         coalesce((g1.claim->>'ownership_denied')::boolean, false) AS denied_raw,
         CASE WHEN g1.claim->>'start_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              THEN (g1.claim->>'start_date')::date <= current_date - 365 ELSE false END AS tenure
  FROM g1
),
g3 AS (
  SELECT g2.*,
         -- a downgrade (denial, dispute, claimed_interest) counts only when it cites evidence
         g2.denied_raw AND g2.cited AS denied,
         (coalesce((g2.claim->>'disputed')::boolean, false) OR 'claimed_interest' = ANY (g2.roles)) AS disputed_raw,
         coalesce(g2.photos, 0) AS n_photos,
         greatest(g2.last_t, g2.obs_last) AS act_last
  FROM g2
),
g4 AS (
  SELECT g3.*,
         g3.disputed_raw AND g3.cited AS disputed,
         (g3.denied_raw OR g3.disputed_raw) AND NOT g3.cited AS uncited_ignored,
         g3.act_last IS NOT NULL AND g3.act_last < now() - make_interval(months => g3.months) AS decayed,
         g3.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM organization_contributors oc
            WHERE oc.user_id = g3.u AND oc.organization_id = g3.org_id AND oc.status = 'active'
              AND (oc.end_date IS NULL OR oc.end_date >= current_date)) AS org_member
  FROM g3
),
-- Step 3: organizations the vehicle is linked to, nearest to the photo centroid within 150 m. Hypothesis only.
g5 AS (
  SELECT g4.*, gps.gps_org, gps.gps_m, gps.gps_neighbours
  FROM g4 LEFT JOIN LATERAL (
    SELECT l.organization_id AS gps_org, round(d.m::numeric) AS gps_m,
           (SELECT count(*) FROM organizations o2
             WHERE o2.id <> l.organization_id AND o2.latitude IS NOT NULL AND o2.longitude IS NOT NULL
               AND 12742000 * asin(sqrt(least(1, power(sin(radians(o2.latitude::float8 - o.latitude::float8) / 2), 2)
                     + cos(radians(o.latitude::float8)) * cos(radians(o2.latitude::float8))
                       * power(sin(radians(o2.longitude::float8 - o.longitude::float8) / 2), 2)))) <= 100) AS gps_neighbours
      FROM organization_vehicles l
      JOIN organizations o ON o.id = l.organization_id AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
      CROSS JOIN LATERAL (SELECT 12742000 * asin(sqrt(least(1, power(sin(radians(o.latitude::float8 - g4.clat) / 2), 2)
                     + cos(radians(g4.clat)) * cos(radians(o.latitude::float8))
                       * power(sin(radians(o.longitude::float8 - g4.clon) / 2), 2)))) AS m) d
     WHERE l.vehicle_id = g4.vid AND g4.gps_n > 0 AND d.m <= 150
     ORDER BY d.m LIMIT 1) gps ON true
),
h AS (
  SELECT g5.*,
    -- Ladder: [role, confidence, why]. Steps 2 and 4 gate it; step 5 statements fill the middle.
    CASE
      WHEN g5.ver_id IS NOT NULL AND (g5.denied OR g5.disputed) THEN jsonb_build_array('claimed_interest', 0.5, 'verified title capped by cited denial or dispute')
      WHEN g5.ver_id IS NOT NULL THEN jsonb_build_array(
        CASE WHEN g5.co_by_other AND NOT g5.owner_perm THEN 'co_owner_verified' ELSE 'owner_verified' END,
        CASE WHEN g5.org_id IS NOT NULL THEN 0.7 ELSE 0.98 END,
        'approved ownership verification with title document')
      WHEN g5.disputed AND g5.cited THEN jsonb_build_array('claimed_interest', 0.6, 'cited dispute')
      WHEN 'transfer_pending' = ANY (g5.roles) OR g5.claim->>'title_status' = 'transfer_pending'
        THEN jsonb_build_array('transfer_pending', 0.6, 'account states transfer pending')
      WHEN 'owner_current' = ANY (g5.roles) AND NOT g5.denied AND g5.org_id IS NULL THEN jsonb_build_array('owner_reported',
        CASE WHEN g5.tenure AND g5.n_photos > 0 THEN 0.85 WHEN g5.n_photos > 0 THEN 0.75 ELSE 0.6 END,
        CASE WHEN g5.tenure AND g5.n_photos > 0 THEN 'long-tenure owner statement with own photos'
             ELSE 'account states current ownership; no verified title' END)
      WHEN 'owner_past' = ANY (g5.roles) AND NOT g5.denied THEN jsonb_build_array('previously_owned', 0.6, 'account states past ownership')
      WHEN 'business_handling' = ANY (g5.roles) THEN jsonb_build_array('business_handling', 0.6, 'correction role')
      WHEN 'sales_representative' = ANY (g5.roles) THEN jsonb_build_array('sales_representative', 0.6, 'correction role')
      WHEN 'consignment' = ANY (g5.roles) THEN jsonb_build_array('consignment', 0.6, 'correction role')
      WHEN 'shared_interest' = ANY (g5.roles) OR g5.disputed THEN jsonb_build_array('claimed_interest', 0.4, 'shared or claimed interest')
      WHEN g5.cur_own AND NOT g5.denied AND g5.org_id IS NULL
        THEN jsonb_build_array('owner_reported', 0.5, 'current ownership record without title verification')
      WHEN g5.disc_prev THEN jsonb_build_array('previously_owned', 0.5, 'discovered previously_owned')
      WHEN g5.org_member THEN jsonb_build_array('business_handling', 0.6, 'member of the organization that lists the vehicle')
      WHEN g5.contrib THEN jsonb_build_array('contributor', 0.5, 'contributor row; not ownership')
      WHEN g5.org_id IS NOT NULL AND g5.n_photos > 0
        THEN jsonb_build_array('contributor', 0.45, 'own photos of an organization-listed vehicle; not ownership')
      WHEN g5.n_photos > 0 AND g5.decayed THEN jsonb_build_array('previously_documented', 0.4, 'own photos only; no photo or activity within the decay window')
      WHEN g5.n_photos > 0 THEN jsonb_build_array('documenting', 0.4, 'own photos only; not ownership')
      ELSE jsonb_build_array('profile_record', 0.3, 'creator of the profile')
    END AS d,
    CASE WHEN g5.gps_org IS NULL THEN NULL
         ELSE (CASE WHEN g5.recent_gps_n > 0 THEN 0.3 ELSE 0.15 END) * (CASE WHEN g5.gps_neighbours > 0 THEN 0.5 ELSE 1 END) END AS gps_conf
  FROM g5
)
SELECT h.vid AS vehicle_id,
       cur.relationship AS old_role,
       h.d->>0 AS derived_role,
       (h.d->>1)::numeric AS confidence,
       jsonb_build_object(
         'title_verification_id', h.ver_id, 'correction_observation_id', h.obs_id,
         'correction_cited', h.cited, 'own_photo_count', h.n_photos, 'contributor_row', h.contrib,
         'co_owner_grant_by_other', h.co_by_other, 'long_tenure', h.tenure,
         'documented_from', h.first_t, 'documented_to', h.last_t,
         'organization_inventory', h.org_id,
         'chain', jsonb_build_array(
           jsonb_build_object('step', 1, 'name', 'origin_facts', 'confidence', CASE WHEN h.n_photos > 0 THEN 0.4 ELSE 0.3 END,
             'evidence', jsonb_build_object('uploader_photo_count', h.n_photos, 'device_count', h.devices,
               'first_capture', h.first_t, 'last_capture', h.last_t, 'gps_photo_count', coalesce(h.gps_n, 0),
               'last_activity', h.act_last, 'decay_months', h.months, 'decayed', h.decayed),
             'eliminated', CASE WHEN h.n_photos = 0 THEN '["documenting","previously_documented"]'::jsonb ELSE '[]'::jsonb END),
           jsonb_build_object('step', 2, 'name', 'matched_listings', 'confidence', h.org_conf,
             'evidence', jsonb_build_object('organization_id', h.org_id, 'sources', coalesce(h.srcs, '[]'::jsonb),
               'organizations_named', coalesce(h.n_orgs, 0), 'account_is_org_member', h.org_member,
               'decides', h.org_id IS NOT NULL),
             'eliminated', CASE WHEN h.org_id IS NULL THEN '[]'::jsonb
                                WHEN h.ver_id IS NULL THEN '["owner_verified","co_owner_verified","owner_reported"]'::jsonb
                                ELSE '["owner_reported"]'::jsonb END),
           jsonb_build_object('step', 3, 'name', 'organization_gps', 'confidence', h.gps_conf,
             'evidence', jsonb_build_object('organization_id', h.gps_org, 'distance_m', h.gps_m,
               'neighbouring_organizations_within_100m', coalesce(h.gps_neighbours, 0),
               'ambiguous', coalesce(h.gps_neighbours, 0) > 0, 'recent_photos', coalesce(h.recent_gps_n, 0) > 0,
               'hypothesis', CASE WHEN h.gps_org IS NULL THEN NULL ELSE 'documenting at organization' END,
               'decides', false),
             'eliminated', '[]'::jsonb),
           jsonb_build_object('step', 4, 'name', 'titles', 'confidence', CASE WHEN h.ver_id IS NOT NULL THEN 0.98 END,
             'evidence', jsonb_build_object('title_verification_id', h.ver_id,
               'conflict_with_organization_listing', h.ver_id IS NOT NULL AND h.org_id IS NOT NULL),
             'eliminated', CASE WHEN h.ver_id IS NOT NULL
               THEN '["owner_reported","contributor","documenting","previously_documented","profile_record"]'::jsonb
               ELSE '["owner_verified","co_owner_verified"]'::jsonb END),
           jsonb_build_object('step', 5, 'name', 'account_statements',
             'confidence', CASE WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL THEN (h.d->>1)::numeric END,
             'evidence', jsonb_build_object('observation_id', h.obs_id, 'roles', to_jsonb(h.roles), 'cited', h.cited,
               'uncited_downgrade_ignored', h.uncited_ignored, 'long_tenure', h.tenure),
             'eliminated', CASE WHEN h.uncited_ignored THEN '["claimed_interest"]'::jsonb
                                WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL AND h.d->>0 IN ('owner_reported','previously_owned')
                                  THEN '["contributor","documenting","profile_record"]'::jsonb
                                ELSE '[]'::jsonb END))
       ) AS evidence,
       (h.d->>2) || CASE WHEN notes.t <> '' THEN ' (' || notes.t || ')' ELSE '' END AS reason,
       ARRAY(SELECT i FROM unnest(ARRAY[h.obs_id, h.ver_id]) i WHERE i IS NOT NULL) AS evidence_ids,
       h.ver_id AS title_verification_id,
       CASE WHEN h.n_photos > 0 THEN h.first_t END AS documented_from,
       CASE WHEN h.n_photos > 0 THEN h.last_t END AS documented_to
FROM h
LEFT JOIN cur ON cur.vid = h.vid
CROSS JOIN LATERAL (SELECT concat_ws('; ',
    CASE WHEN h.self_granted THEN 'self-granted permission ignored' END,
    CASE WHEN h.uncited_ignored THEN 'uncited downgrade ignored' END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NULL AND 'owner_current' = ANY (h.roles)
         THEN 'owner statement set aside: listing shows organization inventory' END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NOT NULL THEN 'CONFLICT: title verification vs organization listing' END,
    CASE WHEN coalesce(h.n_orgs, 0) > 1 THEN 'listings name more than one organization' END) AS t) notes
ORDER BY h.vid
  LOOP
    IF NOT p_dry_run THEN
      SELECT d.id, d.derived_role INTO v_prev, v_prev_role FROM vehicle_relationship_derivations d
       WHERE d.vehicle_id = r.vehicle_id AND d.user_id = p_user AND d.superseded_at IS NULL;
      IF v_prev IS NULL OR v_prev_role <> r.derived_role THEN
        v_new := gen_random_uuid();
        IF v_prev IS NOT NULL THEN
          UPDATE vehicle_relationship_derivations SET superseded_at = now(), superseded_by = v_new,
            superseded_reason = 'rederived run ' || p_run_id WHERE id = v_prev;
        END IF;
        INSERT INTO vehicle_relationship_derivations(id, vehicle_id, user_id, derived_role, confidence, evidence_ids,
          evidence, title_verification_id, run_id, documented_from, documented_to)
        VALUES (v_new, r.vehicle_id, p_user, r.derived_role, r.confidence, r.evidence_ids, r.evidence,
          CASE WHEN r.derived_role IN ('owner_verified','co_owner_verified') THEN r.title_verification_id END,
          p_run_id, r.documented_from, r.documented_to);
      END IF;
    END IF;
    vehicle_id := r.vehicle_id; old_role := r.old_role; derived_role := r.derived_role;
    confidence := r.confidence; evidence := r.evidence; reason := r.reason;
    RETURN NEXT;
  END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION public.derive_vehicle_relationships(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derive_vehicle_relationships(uuid, uuid, uuid, boolean) TO authenticated, service_role;
COMMIT;
