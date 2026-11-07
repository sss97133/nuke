-- READ-ONLY preview of derive_vehicle_relationships: one SELECT, no DDL, no writes, no temp tables.
-- It reproduces the ordered evidence chain over existing tables, so it can run against production BEFORE the
-- migration (20261111180000_garage_evidence_chain.sql) is deployed. The migration's function body is generated
-- from this file (:'user_id' -> p_user, nullif(:'vehicle_id','')::uuid -> p_vehicle); scripts/tests asserts that
-- the function and this file return the same rows.
--
-- Run (read-only session; the claims line only lets get_user_garage report the reader's current answer):
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v user_id=<uuid> -v vehicle_id= \
--     -c "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)" \
--     -f supabase/sql/derive_vehicle_relationships_preview.sql
-- (pass -v vehicle_id=<uuid> to limit to one vehicle; an empty value means every vehicle of the account)
--
-- Chain, in order. Each step records its cited evidence, a confidence and the candidate roles it eliminated in
-- evidence->'chain'. A step that only supports a hypothesis says decides=false.
--   1 origin facts   uploader, device, capture time, GPS of the account's own photos
--   2 listings       bat_listings / external_listings matched to the vehicle; seller -> organization (direct, or
--                    org_seller_aliases). An organization-listed vehicle is that organization's inventory:
--                    the account is business_handling or contributor, never owner
--   3 org GPS        organization_vehicles + organization lat/lon vs the account's photo centroid. Low-confidence
--                    hypothesis ONLY (neighbouring organizations ~25 m apart exist); never decides inventory
--   4 titles         approved ownership_verifications with https title doc -> owner_verified (conflicts with step 2
--                    are flagged, not hidden)
--   5 statements     garage_owner_correction_v1; long-tenure owner statement + own photos -> owner_reported;
--                    a downgrade counts only if it cites evidence
-- Time decay: documenting with no photo or activity for platform_config 'garage_documenting_decay_months'
-- ({"months": n}, default 18 here) -> previously_documented, with documented_from / documented_to = min / max
-- capture time of the account's own photos.
WITH cfg AS (
  SELECT :'user_id'::uuid AS u,
         nullif(:'vehicle_id', '')::uuid AS only_v,
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
ORDER BY h.vid;
