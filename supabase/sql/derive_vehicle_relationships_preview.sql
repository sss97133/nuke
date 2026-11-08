-- READ-ONLY preview of derive_vehicle_relationships: one SELECT, no DDL, no writes, no temp tables.
-- It reproduces the ordered evidence chain over base tables only (it never reads listing_vehicle_matches,
-- listing_seller_derivations or organization_aliases), so it can run against production BEFORE the migrations that create
-- those tables are deployed. The function body in supabase/migrations/20261111200000_garage_listing_org_evidence.sql is
-- generated from this file by scripts/garage/build-chain-function.mjs (:'user_id' -> p_user,
-- nullif(:'vehicle_id','')::uuid -> p_vehicle); scripts/tests asserts the two are identical and return the same rows.
-- Needs org_seller_aliases (20261111180000), normalize_vehicle_model_family (20261111190000) and, from
-- 20261111200000, own_origin_source, parse_owner_statement and listing_detail_enrichments (read-only use of each).
--
-- Run (read-only session; the claims line only lets get_user_garage report the reader's current answer):
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v user_id=<uuid> -v vehicle_id= \
--     -c "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)" \
--     -f supabase/sql/derive_vehicle_relationships_preview.sql
-- (pass -v vehicle_id=<uuid> to limit to one vehicle; an empty value means every vehicle of the account)
--
-- No vehicle id, no user label and no organization name is an input anywhere in this file; every rule is generic.
--
-- Chain, in order. Each step records its cited evidence, a confidence and the candidate roles it eliminated in
-- evidence->'chain'. A step that only supports a hypothesis says decides=false.
--   1 origin facts   uploader, device, capture time, GPS. A photo is an OWN-DEVICE capture only when its EXIF has
--                    camera_make AND camera_model and (source_type = 'user_library', or synced_by is a capture-relay /
--                    photo-sync writer, or its device_fingerprint was seen on the account's capture_relay_ios uploads).
--                    OR its provenance chain is the account's own library / upload: own_origin_source(source, storage_path,
--                    uploader, account) (one SQL function, one source list; scraped / external sources do not count; a
--                    dropbox_import row with automation_script set is a bulk scraper and is passed as 'dropbox_import#automated').
--                    Photos that fail both tests are imports (scraped or bulk-loaded under the importer's user_id).
--   2 listings       bat_listings (linked, or unlinked but matched here by URL / VIN / chassis / lot, title alone being
--                    too weak) and external_listings; seller handle -> organization (org_seller_aliases, else an
--                    organization whose slug / website host / name equals the handle). Organizations that are duplicates
--                    (same normalized name, or same website host) are ONE organization (canonical = one with GPS, then
--                    lowest id). An organization-listed vehicle is that organization's inventory: the account is
--                    business_handling or contributor, never owner
--   3 org GPS        per (account, vehicle): capture sessions (photos within session_gap_hours), span, distinct days and
--                    months, share of geotagged photos within org_radius_m of an organization. GPS at an organization
--                    alone never makes inventory. A shoot-shaped pattern (<= max_sessions sessions, all geotagged photos
--                    at one organization, <= max_span_days, >= min_photos, mostly geotagged) derives business_handling
--                    when that organization lists the vehicle, else contributor-at-organization. A long span with photos
--                    away from every organization is a long-term personal pattern (evidence only). When two organizations
--                    are in range the one that lists / is linked to the vehicle wins, else the result is ambiguous and
--                    its confidence is halved (see the tie-break paragraph below). Rules come from platform_config 'garage_shop_shoot_rules'.
--   4 titles         approved ownership_verifications with https title doc -> owner_verified (conflicts with step 2
--                    are flagged, not hidden)
--   5 statements     garage_owner_correction_v1 and owner_statement_v1 (first-person chat statements stored by
--                    record_owner_statement; facts parsed by parse_owner_statement; unstored ones can be previewed through the
--                    inline_stmts CTE below, empty by default). A title denial ("not titled to me") caps the role below
--                    owner (confidence <= 0.7, never owner_verified) and does not by itself remove the garage role; a first-person
--                    statement (intake_actor not 'authorized_agent', or a
--                    quoted first-person statement attributed to the account) outranks an agent paraphrase, newest first;
--                    long-tenure first-person owner statement + own-device photos -> owner_reported;
--                    a downgrade counts only if it cites evidence
-- No own-device photo, no organization link, no title and no statement -> imported_by_user (the garage hides it). A
-- vehicle_contributors or vehicle_user_permissions row (any role, granted by anyone) is NOT evidence by itself.
-- Duplicate clusters: vehicles of the account that find_vehicle_duplicate_candidates would list with score >=
-- platform_config 'garage_shop_shoot_rules'.dup_min_score (default 0.70; score recomputed inline: 0.50 + year 0.15 same /
-- 0.05 off by one + VIN equal 0.30 + identical model text 0.05) share their statements, so a statement on a photo-less
-- duplicate reaches the photo-rich record (evidence.chain[5].evidence.statement_vehicle_id says where it was made).
-- Shoot at two organizations: the organization listing / linked to the vehicle wins; then the one with more listing /
-- organization_vehicles links among the account's OTHER vehicles photographed in the same sessions (co-occurrence);
-- then, for a vehicle that appears in a listing, business_type dealer/auction before restoration; else ambiguous
-- (role contributor, confidence <= 0.2, flag 'org_ambiguous' in evidence.flags, both organizations cited in
-- chain[3].evidence.organizations).
-- Import provenance (step 1): a user photo is marked IMPORTED, with its signals cited, when any of: its source / storage path
-- says download / import / url_scraper / screenshot; its original filename is a download / screenshot / web-export name
-- (screenshot, download, '<digits>_<id>_o.jpg', 'name-<w>x<h>.jpg', IMG-<date>-WA<n>); it has no camera make / model and a
-- web export size (long side 640 / 800 / 1024 / 1200 / 1280 / 1600 / 2048); its file_hash equals, or its dhash (64-bit hex,
-- vehicle_images.dhash) equals, or (rows of dhash_matches, filled offline) is within Hamming distance 6 of, an image from a listing scrape (source bat / mecum / classic_com /
-- craigslist / url_scraper / cars_and_bids / carsandbids, or an image_url on a listing CDN). The perceptual match is the
-- strongest signal. A hash match does not mark an upload that has camera make + model + taken_at and was stored BEFORE the
-- scraped copy (the original that the listing republished). An imported photo is never own-device. A vehicle whose photos are
-- predominantly imported (more than half) derives imported_by_user, citing the matches (evidence.chain[1].imported_examples).
-- (vehicle_images has file_hash and dhash as text; phash_hex lives on image_identities and is not used here.)
-- Scene context (step 3 tie-break): see the tie-break note below; scene labels come from the scene_labels placeholder CTE
-- (rows of vehicle_photo_session_scenes), organization kinds from organizations.business_type / entity_type / services_offered.
-- Time decay: documenting with no own photo or activity for platform_config 'garage_documenting_decay_months'
-- ({"months": n}, default 18 here) -> previously_documented, with documented_from / documented_to = min / max
-- capture time of the account's own-device photos.
WITH cfg AS (
  SELECT :'user_id'::uuid AS u,
         nullif(:'vehicle_id', '')::uuid AS only_v,
         coalesce((SELECT (pc.config_value->>'months')::int FROM platform_config pc
                    WHERE pc.config_key = 'garage_documenting_decay_months'), 18) AS months,
         rr.r_radius, rr.r_gap_h, rr.r_max_s, rr.r_max_span, rr.r_min_ph, rr.r_min_geo, rr.r_pers_span, rr.r_dup
  FROM (SELECT
          coalesce((pc.config_value->>'org_radius_m')::float8, 60) AS r_radius,
          coalesce((pc.config_value->>'session_gap_hours')::float8, 2) AS r_gap_h,
          coalesce((pc.config_value->>'max_sessions')::int, 2) AS r_max_s,
          coalesce((pc.config_value->>'max_span_days')::float8, 30) AS r_max_span,
          coalesce((pc.config_value->>'min_photos')::int, 5) AS r_min_ph,
          coalesce((pc.config_value->>'min_geotag_share')::float8, 0.8) AS r_min_geo,
          coalesce((pc.config_value->>'personal_span_days')::float8, 365) AS r_pers_span,
          coalesce((pc.config_value->>'dup_min_score')::float8, 0.7) AS r_dup
        FROM (SELECT 1) one LEFT JOIN platform_config pc ON pc.config_key = 'garage_shop_shoot_rules') rr
),
-- INLINE STATEMENTS PLACEHOLDER (empty by default; keep this CTE when generating the function). To preview statements that
-- are not stored yet, replace the WHERE false with real rows: (id, vehicle_id, observed_at, content_text, structured_data),
-- where structured_data is {"claim_contract":"owner_statement_v1","facts":parse_owner_statement(content_text)}.
inline_stmts AS (
  SELECT t.id, t.vehicle_id, t.observed_at, t.content_text, t.structured_data
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::text, NULL::jsonb)) t(id, vehicle_id, observed_at, content_text, structured_data)
   WHERE false
),
-- HISTORY PLACEHOLDER (empty by default; keep this CTE when generating the function). Listings read from public pages
-- (scripts/garage/ingest-bat-seller-history.mjs writes a hist_listings VALUES CTE with these columns). Read like a
-- bat_listings row with no vehicle and no organization: the matcher below uses url / VIN / lot / title and the seller handle.
hist_listings AS (
  SELECT t.url, t.lot, t.vin, t.seller, t.title, t.end_date
    FROM (VALUES (NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date)) t(url, lot, vin, seller, title, end_date)
   WHERE false -- (hist_listings)
),
-- SCENE PLACEHOLDER (empty by default; keep this CTE when generating the function). One row per photo session, labelled by a
-- vision model (table vehicle_photo_session_scenes; scene_label in dealer_lot, showroom, shop_interior, upholstery_work,
-- paint_body, outdoor_street, other). Read only to break an organization tie, never to create one.
scene_labels AS (
  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.scene_label, t.model, t.confidence, t.rationale
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::text, NULL::text, NULL::numeric, NULL::text))
         t(run_id, vehicle_id, session_key, image_ids, scene_label, model, confidence, rationale)
   WHERE false -- (scene_labels)
),
cand_all AS (
  SELECT DISTINCT c.vid FROM cfg CROSS JOIN LATERAL (
      SELECT ov.vehicle_id AS vid FROM ownership_verifications ov WHERE ov.user_id = cfg.u
      UNION SELECT vup.vehicle_id FROM vehicle_user_permissions vup WHERE vup.user_id = cfg.u
      UNION SELECT vo.vehicle_id FROM vehicle_ownerships vo WHERE vo.owner_profile_id = cfg.u
      UNION SELECT dv.vehicle_id FROM discovered_vehicles dv WHERE dv.user_id = cfg.u
      UNION SELECT vc.vehicle_id FROM vehicle_contributors vc WHERE vc.user_id = cfg.u
      UNION SELECT v.id FROM vehicles v WHERE v.user_id = cfg.u AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      UNION SELECT vi.vehicle_id FROM vehicle_images vi WHERE vi.user_id = cfg.u
      UNION SELECT o.vehicle_id FROM vehicle_observations o
        WHERE o.submitted_by_user_id = cfg.u
          AND o.structured_data->>'claim_contract' IN ('garage_owner_correction_v1', 'owner_statement_v1')
      UNION SELECT i.vehicle_id FROM inline_stmts i
    ) c
  WHERE c.vid IS NOT NULL
),
cand AS (
  SELECT ca.vid FROM cand_all ca CROSS JOIN cfg WHERE cfg.only_v IS NULL OR ca.vid = cfg.only_v
),
-- Duplicate clusters among ALL the account's vehicles (find_vehicle_duplicate_candidates logic, score recomputed inline).
dv AS MATERIALIZED (
  SELECT v.id AS vid, v.year, lower(btrim(v.make)) AS mk, lower(btrim(v.model)) AS model,
         normalize_vehicle_model_family(v.model) AS fam, nullif(upper(btrim(v.vin)), '') AS vin
    FROM cand_all ca JOIN vehicles v ON v.id = ca.vid WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
),
dup AS MATERIALIZED (
  SELECT a.vid AS a, b.vid AS b
    FROM dv a CROSS JOIN cfg JOIN dv b ON b.vid <> a.vid AND a.mk <> '' AND b.mk = a.mk
     AND a.year IS NOT NULL AND b.year IS NOT NULL AND abs(b.year - a.year) <= 1
     AND a.fam IS NOT NULL AND b.fam = a.fam
     AND (a.vin IS NULL OR b.vin IS NULL OR a.vin = b.vin)
   WHERE a.vid IN (SELECT cand.vid FROM cand)
     AND 0.50 + CASE WHEN b.year = a.year THEN 0.15 ELSE 0.05 END
         + CASE WHEN a.vin IS NOT NULL AND a.vin = b.vin THEN 0.30 ELSE 0 END
         + CASE WHEN b.model = a.model THEN 0.05 ELSE 0 END >= cfg.r_dup - 1e-9
),
cur AS MATERIALIZED (
  SELECT g.vehicle_id AS vid, g.relationship FROM get_user_garage((SELECT cfg.u FROM cfg)) g
),
-- Device fingerprints seen on the account's own capture-relay uploads.
fp AS MATERIALIZED (
  SELECT DISTINCT to_jsonb(vi)->>'device_fingerprint' AS dev
    FROM vehicle_images vi CROSS JOIN cfg
   WHERE vi.user_id = cfg.u AND to_jsonb(vi)->>'source' = 'capture_relay_ios'
     AND nullif(btrim(to_jsonb(vi)->>'device_fingerprint'), '') IS NOT NULL
),
-- PERCEPTUAL MATCH PLACEHOLDER (empty by default; keep this CTE when generating the function). Near-duplicate dhash matches are
-- computed offline (scripts/garage/dhash-match.mjs --dry-run writes the VALUES rows): the account's photo (image_id) and the
-- scraped listing image it resembles (matched_image_id, matched_source) at Hamming distance hamming_distance. SQL never scans
-- vehicle_images for Hamming distance; only indexed equality (file_hash =, dhash =) is evaluated here.
dhash_matches AS (
  SELECT t.image_id, t.matched_image_id, t.matched_source, t.hamming_distance
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::int)) t(image_id, matched_image_id, matched_source, hamming_distance)
   WHERE false -- (dhash_matches)
),
-- Perceptual matches come only from the offline dhash_matches rows (vehicle_images.dhash has no index, so an in-query
-- equality join scans the whole table); the nearest match per photo wins.
dhm AS MATERIALIZED (
  SELECT DISTINCT ON (m.image_id) m.image_id, m.matched_id, m.matched_source, m.matched_created_at, m.dist
    FROM (
      SELECT d.image_id, d.matched_image_id AS matched_id, coalesce(d.matched_source, s.source) AS matched_source,
             s.created_at AS matched_created_at, d.hamming_distance AS dist
        FROM dhash_matches d LEFT JOIN vehicle_images s ON s.id = d.matched_image_id
       WHERE d.image_id IS NOT NULL AND d.hamming_distance <= 6
    ) m
   ORDER BY m.image_id, m.dist, m.matched_id::text
),
-- Step 1: every photo the account uploaded to a candidate vehicle, flagged own-device or import.
pp AS MATERIALIZED (
  SELECT vi.id, vi.vehicle_id AS vid, coalesce(vi.taken_at, vi.created_at) AS t,
         vi.latitude::float8 AS lat, vi.longitude::float8 AS lon,
         x.j->>'device_fingerprint' AS dev,
         o2.origin, o2.unk, sc.m AS scraped_match, im.imp, im.cite AS imp_cite,
         (nullif(btrim(x.j->'exif_data'->>'camera_make'), '') IS NOT NULL OR nullif(btrim(x.j->'exif_data'->>'camera_model'), '') IS NOT NULL
          OR vi.taken_at IS NOT NULL OR vi.latitude IS NOT NULL OR vi.longitude IS NOT NULL) AS has_fact,
         (o2.origin OR coalesce(nullif(btrim(x.j->'exif_data'->>'camera_make'), '') IS NOT NULL
          AND nullif(btrim(x.j->'exif_data'->>'camera_model'), '') IS NOT NULL
          AND (x.j->'exif_data'->>'source_type' = 'user_library'
               OR x.j->'exif_data'->>'synced_by' ~* '^(capture[-_ ]?relay|photo[-_ ]?(auto[-_ ]?)?sync)'
               OR x.j->>'device_fingerprint' IN (SELECT fp.dev FROM fp)), false)) AND NOT im.imp AS own
    FROM cand_all ca JOIN vehicle_images vi ON vi.vehicle_id = ca.vid CROSS JOIN cfg
         CROSS JOIN LATERAL (SELECT to_jsonb(vi) AS j OFFSET 0) x  -- OFFSET 0: build the row json once, not once per reference
         -- Origin unknown: a user_upload row stored at the bucket root ('<uuid>.jpg') or under 'unorganized/' with no camera
         -- make / model, no taken_at, no GPS and no original file name (a '<uuid>.jpg' name is storage-generated, not original). It is not own-device and not own library.
         CROSS JOIN LATERAL (SELECT coalesce(regexp_replace(lower(btrim(x.j->>'source')), '[-\s]+', '_', 'g') = 'user_upload'
             AND lower(coalesce(x.j->>'storage_path', '')) ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+|unorganized/.*)$'
             AND nullif(btrim(x.j->'exif_data'->>'camera_make'), '') IS NULL AND nullif(btrim(x.j->'exif_data'->>'camera_model'), '') IS NULL
             AND vi.taken_at IS NULL AND vi.latitude IS NULL AND vi.longitude IS NULL
             AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[x.j->>'file_name', x.j->>'filename']) f(n)
                             WHERE nullif(btrim(f.n), '') IS NOT NULL AND lower(btrim(f.n)) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$'), false) AS unk OFFSET 0) u2
         CROSS JOIN LATERAL (SELECT coalesce(NOT u2.unk AND own_origin_source(
             CASE WHEN nullif(btrim((SELECT iv.automation_script FROM vehicles iv WHERE iv.id = vi.vehicle_id)), '') IS NOT NULL THEN coalesce(x.j->>'source', '') || '#automated'
                  ELSE x.j->>'source' END,
             x.j->>'storage_path', vi.user_id, cfg.u), false) AS origin, u2.unk OFFSET 0) o2
         -- An origin-unknown photo that shares file_hash / dhash with an image from an external scrape is scraped (cited).
         LEFT JOIN LATERAL (
           SELECT jsonb_build_object('image_id', vi.id, 'matched_image_id', q.id, 'matched_source', q.source, 'via', q.via) AS m
             FROM (SELECT s.id, s.source, 'file_hash' AS via, (SELECT sv.automation_script FROM vehicles sv WHERE sv.id = s.vehicle_id) AS automation_script FROM vehicle_images s
                    WHERE vi.file_hash IS NOT NULL AND s.file_hash = vi.file_hash AND s.id <> vi.id) q
            WHERE o2.unk
              AND (regexp_replace(lower(btrim(coalesce(q.source, ''))), '[-\s]+', '_', 'g')
                     IN ('bat', 'mecum', 'classic_com', 'classiccom', 'craigslist', 'url_scraper')
                   OR (regexp_replace(lower(btrim(coalesce(q.source, ''))), '[-\s]+', '_', 'g') = 'dropbox_import'
                       AND nullif(btrim(q.automation_script), '') IS NOT NULL))
            ORDER BY q.id::text LIMIT 1) sc ON true
         -- Import provenance: the same file (file_hash) as an image from a listing scrape
         LEFT JOIN LATERAL (
           SELECT s.id, s.source, s.created_at FROM vehicle_images s
            WHERE vi.file_hash IS NOT NULL AND s.file_hash = vi.file_hash AND s.id <> vi.id
              AND (regexp_replace(lower(btrim(coalesce(s.source, ''))), '[-\s]+', '_', 'g')
                     IN ('bat', 'mecum', 'classic_com', 'classiccom', 'craigslist', 'url_scraper', 'cars_and_bids', 'carsandbids')
                   OR lower(coalesce(s.image_url, '')) ~ '^https?://([a-z0-9-]+\.)*(bringatrailer|carsandbids|mecum|classic|craigslist|hemmings|pcarmarket|cargurus|autotrader)\.(com|org)(/|$)')
            ORDER BY s.id::text LIMIT 1) fh ON true  -- ::text keeps the planner on the file_hash index (an id-ordered scan with a filter never ends)
         LEFT JOIN dhm ON dhm.image_id = vi.id
         -- Import provenance: path / source, file name, web export size without camera EXIF, and the hash matches above
         CROSS JOIN LATERAL (SELECT
             regexp_replace(lower(btrim(coalesce(x.j->>'source', ''))), '[-\s]+', '_', 'g') AS src,
             lower(coalesce(x.j->>'storage_path', '')) AS sp,
             -- file_name / filename; a '<uuid>.ext' name is generated by storage and is not an original name
             CASE WHEN lower(btrim(coalesce(x.j->>'file_name', ''))) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$' THEN '' ELSE lower(btrim(coalesce(x.j->>'file_name', ''))) END AS fn1,
             CASE WHEN lower(btrim(coalesce(x.j->>'filename', ''))) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$' THEN '' ELSE lower(btrim(coalesce(x.j->>'filename', ''))) END AS fn2,
             (nullif(btrim(x.j->'exif_data'->>'camera_make'), '') IS NOT NULL
              AND nullif(btrim(x.j->'exif_data'->>'camera_model'), '') IS NOT NULL) AS cam,
             (SELECT max(q.v::int) FROM unnest(ARRAY[x.j->>'width', x.j->>'width_px', x.j->>'image_width', x.j->'exif_data'->>'width',
                x.j->'exif_data'->>'ImageWidth', x.j->'exif_data'->>'PixelXDimension', x.j->'exif_data'->>'image_width']) q(v)
               WHERE q.v ~ '^[0-9]{1,5}$') AS w,
             (SELECT max(q.v::int) FROM unnest(ARRAY[x.j->>'height', x.j->>'height_px', x.j->>'image_height', x.j->'exif_data'->>'height',
                x.j->'exif_data'->>'ImageHeight', x.j->'exif_data'->>'PixelYDimension', x.j->'exif_data'->>'image_height']) q(v)
               WHERE q.v ~ '^[0-9]{1,5}$') AS hgt OFFSET 0) ib
         CROSS JOIN LATERAL (SELECT array_remove(ARRAY[
             CASE WHEN ib.src ~ '(^|_)(download|downloaded|url_scraper|screenshot|screenshots|url_import|web_import|import_url|imported)(_|$)'
                    OR ib.sp ~ '(^|/)(downloads?|url[-_]?scraper|screenshots?|web[-_]?imports?|imports?|imported)(/|$)' THEN 'path_or_source' END,
             CASE WHEN EXISTS (SELECT 1 FROM unnest(ARRAY[ib.fn1, ib.fn2]) f(n)
                                WHERE f.n ~ 'screen[ _-]?shot' OR f.n ~ '(^|[^a-z])download' OR f.n ~ '^[0-9]+_[a-z0-9_]+_o\.(jpe?g|png)$'
                                   OR f.n ~ '-[0-9]{2,4}x[0-9]{2,4}\.(jpe?g|png|webp)$' OR f.n ~ '^img-[0-9]{8}-wa[0-9]+') THEN 'filename' END,
             CASE WHEN NOT ib.cam AND greatest(coalesce(ib.w, 0), coalesce(ib.hgt, 0)) IN (640, 800, 1024, 1200, 1280, 1600, 2048)
                    AND x.j->'exif_data'->>'DateTimeOriginal' IS NULL THEN 'web_size_no_camera_exif' END,
             CASE WHEN fh.id IS NOT NULL AND NOT (ib.cam AND vi.taken_at IS NOT NULL AND vi.created_at < fh.created_at) THEN 'file_hash' END,
             CASE WHEN dhm.dist IS NOT NULL AND NOT (ib.cam AND vi.taken_at IS NOT NULL AND vi.created_at < dhm.matched_created_at) THEN 'dhash' END
           ], NULL) AS sigs OFFSET 0) sg
         CROSS JOIN LATERAL (SELECT cardinality(sg.sigs) > 0 AS imp,
             CASE WHEN cardinality(sg.sigs) > 0 THEN jsonb_build_object('image_id', vi.id, 'signals', to_jsonb(sg.sigs),
               'via', CASE WHEN 'dhash' = ANY (sg.sigs) THEN 'dhash' WHEN 'file_hash' = ANY (sg.sigs) THEN 'file_hash' END,
               'hamming_distance', CASE WHEN 'dhash' = ANY (sg.sigs) THEN dhm.dist END,
               'matched_image_id', CASE WHEN 'dhash' = ANY (sg.sigs) THEN dhm.matched_id WHEN 'file_hash' = ANY (sg.sigs) THEN fh.id END,
               'matched_source', CASE WHEN 'dhash' = ANY (sg.sigs) THEN dhm.matched_source WHEN 'file_hash' = ANY (sg.sigs) THEN fh.source END,
               'file_name', nullif(coalesce(nullif(ib.fn1, ''), ib.fn2), ''), 'source', x.j->>'source',
               'storage_path', x.j->>'storage_path', 'width', ib.w, 'height', ib.hgt) END AS cite) im
   WHERE vi.user_id = cfg.u
),
-- Step 3: capture sessions of own-device photos (a new session after a gap of r_gap_h hours).
ps1 AS (
  SELECT pp.*, lag(pp.t) OVER (PARTITION BY pp.vid ORDER BY pp.t, pp.id) AS prev_t FROM pp WHERE pp.own
),
ps2 AS MATERIALIZED (
  SELECT ps1.id, ps1.vid, ps1.t, ps1.lat, ps1.lon,
         sum(CASE WHEN ps1.prev_t IS NULL OR ps1.t - ps1.prev_t > make_interval(secs => cfg.r_gap_h * 3600) THEN 1 ELSE 0 END)
           OVER (PARTITION BY ps1.vid ORDER BY ps1.t, ps1.id) AS sess
    FROM ps1 CROSS JOIN cfg
),
pts AS MATERIALIZED (
  SELECT DISTINCT round(ps2.lat::numeric, 4)::float8 AS plat, round(ps2.lon::numeric, 4)::float8 AS plon
    FROM ps2 WHERE ps2.lat IS NOT NULL AND ps2.lon IS NOT NULL
),
-- organizations within r_radius metres of a (4-decimal) photo location; the box only pre-filters (about 220 m)
pto AS MATERIALIZED (
  SELECT p.plat, p.plon, o.id AS org_id, d.m
    FROM pts p CROSS JOIN cfg
    JOIN organizations o ON o.latitude IS NOT NULL AND o.longitude IS NOT NULL
     AND abs(o.latitude::float8 - p.plat) < 0.002 AND abs(o.longitude::float8 - p.plon) < 0.003
    CROSS JOIN LATERAL (SELECT 12742000 * asin(sqrt(least(1, power(sin(radians(o.latitude::float8 - p.plat) / 2), 2)
                     + cos(radians(p.plat)) * cos(radians(o.latitude::float8))
                       * power(sin(radians(o.longitude::float8 - p.plon) / 2), 2)))) AS m) d
   WHERE d.m <= cfg.r_radius
),
-- Step 2 identifiers of the candidate vehicles.
cv AS MATERIALIZED (
  SELECT cand.vid, v.year, lower(btrim(v.make)) AS make, normalize_vehicle_model_family(v.model) AS fam,
         upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g')) AS vin,
         upper(regexp_replace(coalesce(v.origin_metadata->'bat_snapshot_parsed'->>'chassis', v.origin_metadata->>'chassis', ''),
               '[^A-Za-z0-9]', '', 'g')) AS chassis,
         nullif(btrim(coalesce(v.origin_metadata->'bat_snapshot_parsed'->>'lot_number', v.origin_metadata->>'lot_number')), '') AS lot,
         ARRAY(SELECT DISTINCT regexp_replace(regexp_replace(lower(btrim(u.x)), '[?#].*$', ''), '/+$', '')
                 FROM unnest(ARRAY[v.bat_auction_url, v.listing_url, v.origin_metadata->>'bat_auction_url',
                                   v.origin_metadata->>'listing_url', v.origin_metadata->>'url']) u(x)
                WHERE nullif(btrim(u.x), '') IS NOT NULL) AS urls
    FROM cand JOIN vehicles v ON v.id = cand.vid
),
-- Listings not yet attached to any vehicle: identifiers read from the listing and its raw_data.
ul AS MATERIALIZED (
  SELECT bl.id AS listing_id, bl.organization_id,
         regexp_replace(regexp_replace(lower(btrim(coalesce(bl.bat_listing_url, ''))), '[?#].*$', ''), '/+$', '') AS u,
         upper(regexp_replace(coalesce(bl.raw_data->>'vin', bl.raw_data->>'VIN', ''), '[^A-Za-z0-9]', '', 'g')) AS vin,
         upper(regexp_replace(coalesce(bl.raw_data->>'chassis', bl.raw_data->>'chassis_number', en.chassis, ''), '[^A-Za-z0-9]', '', 'g')) AS chassis,
         nullif(btrim(coalesce(bl.bat_lot_number::text, en.lot_number)), '') AS lot,
         (regexp_match(coalesce(bl.bat_listing_title, en.title, ''), '\m(19[0-9]{2}|20[0-4][0-9])\M'))[1]::int AS ty,
         btrim(regexp_replace(lower(coalesce(bl.bat_listing_title, en.title, '')), '[^a-z0-9]+', ' ', 'g')) AS tl,
         lower(btrim(coalesce(nullif(btrim(bl.seller_username), ''), bl.raw_data->>'seller_username', bl.raw_data->>'seller',
                              en.seller_username))) AS seller,
         bl.bat_listing_url AS ref
    FROM bat_listings bl
    -- detail-page enrichment (append-only table; the newest active row for this listing)
    LEFT JOIN LATERAL (SELECT e.chassis, e.lot_number, e.title, e.seller_username FROM listing_detail_enrichments e
                        WHERE e.superseded_at IS NULL AND e.listing_id = bl.id
                        ORDER BY e.created_at DESC LIMIT 1) en ON true
   WHERE bl.vehicle_id IS NULL AND EXISTS (SELECT 1 FROM cv)
  UNION ALL
  -- listings read from public seller pages that are not bat_listings rows (the placeholder above; empty by default)
  SELECT md5(h.url)::uuid, NULL::uuid,
         regexp_replace(regexp_replace(lower(btrim(coalesce(h.url, ''))), '[?#].*$', ''), '/+$', ''),
         upper(regexp_replace(coalesce(h.vin, ''), '[^A-Za-z0-9]', '', 'g')),
         upper(regexp_replace(coalesce(h.vin, ''), '[^A-Za-z0-9]', '', 'g')),
         nullif(btrim(h.lot), ''),
         (regexp_match(coalesce(h.title, ''), '\m(19[0-9]{2}|20[0-4][0-9])\M'))[1]::int,
         btrim(regexp_replace(lower(coalesce(h.title, '')), '[^a-z0-9]+', ' ', 'g')),
         lower(btrim(h.seller)), h.url
    FROM hist_listings h
   WHERE h.url IS NOT NULL AND EXISTS (SELECT 1 FROM cv)
     AND NOT EXISTS (SELECT 1 FROM bat_listings b2 WHERE b2.bat_listing_url = h.url)
),
-- One row per matching signal. Strong signals are global; a title match counts only when the listing matches exactly
-- one of the account's candidate vehicles by title.
mm AS (
  SELECT ul.listing_id, cv.vid, 'url' AS sig FROM ul JOIN cv ON ul.u <> '' AND ul.u = ANY (cv.urls)
  UNION ALL
  SELECT ul.listing_id, cv.vid, 'vin' FROM ul JOIN cv ON length(cv.vin) >= 9 AND cv.vin IN (ul.vin, ul.chassis)
  UNION ALL
  SELECT ul.listing_id, cv.vid, 'chassis' FROM ul JOIN cv ON length(cv.chassis) >= 6 AND cv.chassis IN (ul.vin, ul.chassis)
  UNION ALL
  SELECT ul.listing_id, cv.vid, 'lot' FROM ul JOIN cv ON ul.lot IS NOT NULL AND ul.lot = cv.lot
  UNION ALL
  SELECT t.listing_id, t.vid, 'title' FROM (
    SELECT ul.listing_id, cv.vid, count(*) OVER (PARTITION BY ul.listing_id) AS n_title
      FROM ul JOIN cv ON ul.ty = cv.year AND cv.make <> '' AND cv.fam IS NOT NULL
       AND strpos(' ' || ul.tl || ' ', ' ' || cv.make || ' ') > 0
       AND strpos(' ' || ul.tl || ' ', ' ' || btrim(regexp_replace(cv.fam, '[^a-z0-9]+', ' ', 'g')) || ' ') > 0) t
   WHERE t.n_title = 1
),
mx AS (
  SELECT mm.listing_id, mm.vid, array_agg(DISTINCT mm.sig ORDER BY mm.sig) AS sigs,
         CASE WHEN bool_or(mm.sig IN ('url', 'vin')) THEN 0.95
              WHEN bool_or(mm.sig = 'chassis') THEN 0.85
              WHEN bool_or(mm.sig = 'lot') AND bool_or(mm.sig = 'title') THEN 0.80
              WHEN bool_or(mm.sig = 'lot') THEN 0.60
              ELSE 0.35 END AS score
    FROM mm GROUP BY mm.listing_id, mm.vid
),
-- High-confidence matches (score >= 0.8) are the only ones the chain uses; the rest stay proposals.
ml AS (
  SELECT mx.vid, mx.listing_id, mx.score, mx.sigs, ul.organization_id, ul.seller, ul.ref
    FROM mx JOIN ul ON ul.listing_id = mx.listing_id WHERE mx.score >= 0.8
),
-- Every organization row once, with the keys duplicates and seller handles are compared on.
orgn AS MATERIALIZED (
  SELECT o.id, o.latitude::float8 AS lat, o.longitude::float8 AS lon, n2.nn,
         h.host, regexp_replace(lower(coalesce(o.slug, '')), '[^a-z0-9]', '', 'g') AS slug_n,
         kk.okind,
         CASE WHEN lower(coalesce(to_jsonb(o)->>'business_type', '')) ~ '(dealer|auction)' THEN 0
              WHEN lower(coalesce(to_jsonb(o)->>'business_type', '')) ~ 'restor' THEN 1 ELSE 2 END AS bt_rank,
         regexp_replace(split_part(h.host, '.', 1), '[^a-z0-9]', '', 'g') AS host_n,
         replace(n2.nn, ' ', '') AS nn_ns,
         -- how many organizations share this website host / normalized name (a platform page host is not an identity)
         CASE WHEN h.host = '' THEN 0 ELSE count(*) OVER (PARTITION BY h.host) END AS host_c,
         CASE WHEN n2.nn = '' THEN 0 ELSE count(*) OVER (PARTITION BY n2.nn) END AS nn_c
    FROM organizations o
    -- Business kind from the organization's own classification: type fields decide, services_offered only when they are silent;
    -- a record that reads as both stays unclassified (NULL).
    CROSS JOIN LATERAL (SELECT lower(coalesce(to_jsonb(o)->>'business_type', '') || ' ' || coalesce(to_jsonb(o)->>'entity_type', '')) AS tf,
                               lower(coalesce(to_jsonb(o)->>'services_offered', '')) AS sf) kt
    CROSS JOIN LATERAL (SELECT CASE
        WHEN kt.tf ~ '(dealer|auction|consign)' AND kt.tf !~ '(restor|upholster|body_shop|paint|fabricat|garage|builder)' THEN 'dealer'
        WHEN kt.tf ~ '(restor|upholster|body_shop|paint|fabricat|garage|builder)' AND kt.tf !~ '(dealer|auction|consign)' THEN 'shop'
        WHEN kt.tf !~ '(dealer|auction|consign|restor|upholster|body_shop|paint|fabricat|garage|builder)' THEN
          CASE WHEN kt.sf ~ '(dealer|auction|consign)' AND kt.sf !~ '(restor|upholster|body_shop|paint|fabricat|garage|builder)' THEN 'dealer'
               WHEN kt.sf ~ '(restor|upholster|body_shop|paint|fabricat|garage|builder)' AND kt.sf !~ '(dealer|auction|consign)' THEN 'shop' END
        END AS okind) kk
    CROSS JOIN LATERAL (SELECT btrim(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(lower(coalesce(o.name, '')), '[''’`]', '', 'g'),
                                      '[^a-z0-9]+', ' ', 'g'),
                       '\m(custom|llc|inc|incorporated|corp|co|ltd|the)\M', ' ', 'g'),
        '\s+', ' ', 'g')) AS nn) n2
    CROSS JOIN LATERAL (SELECT regexp_replace(split_part(split_part(split_part(
        regexp_replace(lower(coalesce(o.website, '')), '^[a-z]+://', ''), '/', 1), '?', 1), ':', 1), '^www\.', '') AS host) h
),
-- Scene kind of each candidate vehicle's photo sessions (confidence >= 0.6): dealer_lot / showroom -> dealer;
-- shop_interior / upholstery_work / paint_body -> shop. A vehicle whose sessions read as both without a 2:1 majority has no kind.
vscene AS MATERIALIZED (
  SELECT k.vid,
         CASE WHEN k.wd > 0 AND k.wd >= 2 * k.ws THEN 'dealer' WHEN k.ws > 0 AND k.ws >= 2 * k.wd THEN 'shop' END AS kind,
         k.cites
    FROM (SELECT sl.vehicle_id AS vid,
                 coalesce(sum(sl.confidence) FILTER (WHERE sl.scene_label IN ('dealer_lot', 'showroom')), 0) AS wd,
                 coalesce(sum(sl.confidence) FILTER (WHERE sl.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')), 0) AS ws,
                 jsonb_agg(jsonb_build_object('run_id', sl.run_id, 'session_key', sl.session_key, 'scene_label', sl.scene_label,
                             'model', sl.model, 'confidence', sl.confidence, 'rationale', sl.rationale)
                           ORDER BY sl.confidence DESC, sl.session_key) AS cites
            FROM scene_labels sl
           WHERE sl.vehicle_id IN (SELECT cand.vid FROM cand)
             AND sl.scene_label IN ('dealer_lot', 'showroom', 'shop_interior', 'upholstery_work', 'paint_body')
             AND coalesce(sl.confidence, 0) >= 0.6
           GROUP BY sl.vehicle_id) k
),
-- Seller handles the evidence names for each candidate vehicle: [vehicle, handle, confidence, source, ref].
sel AS MATERIALIZED (
  SELECT cand.vid, s.seller, s.conf, s.src, s.ref FROM cand CROSS JOIN LATERAL (
      SELECT lower(btrim(bl.seller_username)) AS seller, 0.80 AS conf, 'bat_listings.seller_username' AS src, bl.bat_listing_url AS ref
        FROM bat_listings bl
       WHERE bl.vehicle_id = cand.vid AND bl.organization_id IS NULL AND nullif(btrim(bl.seller_username), '') IS NOT NULL
      UNION ALL
      SELECT lower(btrim(coalesce(bl.raw_data->>'seller_username', bl.raw_data->>'seller'))), 0.75,
             'bat_listings.raw_data seller', bl.bat_listing_url
        FROM bat_listings bl
       WHERE bl.vehicle_id = cand.vid AND bl.organization_id IS NULL AND nullif(btrim(bl.seller_username), '') IS NULL
         AND nullif(btrim(coalesce(bl.raw_data->>'seller_username', bl.raw_data->>'seller')), '') IS NOT NULL
      UNION ALL
      SELECT ml.seller, 0.75, 'matched bat_listing seller (' || array_to_string(ml.sigs, '+') || ')', ml.ref
        FROM ml WHERE ml.vid = cand.vid AND ml.organization_id IS NULL AND ml.seller IS NOT NULL
      UNION ALL
      SELECT lower(btrim(v.bat_seller)), 0.70, 'vehicles.bat_seller', NULL::text
        FROM vehicles v WHERE v.id = cand.vid AND nullif(btrim(v.bat_seller), '') IS NOT NULL
      UNION ALL
      SELECT lower(btrim(v.origin_metadata->'bat_snapshot_parsed'->>'seller_username')), 0.70,
             'vehicles.origin_metadata.bat_snapshot_parsed.seller_username', NULL::text
        FROM vehicles v
       WHERE v.id = cand.vid AND nullif(btrim(v.origin_metadata->'bat_snapshot_parsed'->>'seller_username'), '') IS NOT NULL
    ) s
),
-- Step 2 organization evidence before duplicate collapse: [vehicle, organization, confidence, source, ref].
lsrc AS MATERIALIZED (
  SELECT cand.vid, x.org, x.conf, x.src, x.ref FROM cand CROSS JOIN LATERAL (
      SELECT bl.organization_id AS org, 0.90 AS conf, 'bat_listings.organization_id' AS src, bl.bat_listing_url AS ref
        FROM bat_listings bl WHERE bl.vehicle_id = cand.vid AND bl.organization_id IS NOT NULL
      UNION ALL
      SELECT el.organization_id, 0.90, 'external_listings.organization_id', el.listing_url
        FROM external_listings el WHERE el.vehicle_id = cand.vid AND el.organization_id IS NOT NULL
      UNION ALL
      SELECT ml.organization_id, 0.85, 'matched bat_listing organization (' || array_to_string(ml.sigs, '+') || ')', ml.ref
        FROM ml WHERE ml.vid = cand.vid AND ml.organization_id IS NOT NULL
    ) x
  UNION ALL
  SELECT sel.vid, a.organization_id, sel.conf, sel.src || ' via org_seller_aliases', sel.ref
    FROM sel JOIN org_seller_aliases a ON a.platform = 'bat' AND a.seller_username = sel.seller
  UNION ALL
  -- no alias row: an organization whose slug, website host or name is the handle (min 6 characters)
  SELECT sel.vid, i.id, sel.conf - 0.15, sel.src || ' via inferred organization handle', sel.ref
    FROM sel
    CROSS JOIN LATERAL (SELECT regexp_replace(sel.seller, '[^a-z0-9]', '', 'g') AS h) hh
    JOIN LATERAL (SELECT DISTINCT n.id FROM orgn n
                   WHERE length(hh.h) >= 6 AND hh.h IN (n.slug_n, n.host_n, n.nn_ns)) i ON true
   WHERE NOT EXISTS (SELECT 1 FROM org_seller_aliases a WHERE a.platform = 'bat' AND a.seller_username = sel.seller)
),
-- Organization links of the account's vehicles (organization_vehicles and listings), used for session co-occurrence.
vlink AS MATERIALIZED (
  SELECT ca.vid, x.org FROM cand_all ca CROSS JOIN LATERAL (
      SELECT ov.organization_id AS org FROM organization_vehicles ov WHERE ov.vehicle_id = ca.vid
      UNION SELECT bl.organization_id FROM bat_listings bl WHERE bl.vehicle_id = ca.vid
      UNION SELECT el.organization_id FROM external_listings el WHERE el.vehicle_id = ca.vid) x
   WHERE x.org IS NOT NULL
),
refs AS MATERIALIZED (
  SELECT pto.org_id FROM pto
  UNION SELECT lsrc.org FROM lsrc
  UNION SELECT vlink.org FROM vlink
),
-- Only the referenced organizations are expanded (a), before any join against the full organization list.
orga AS MATERIALIZED (
  SELECT n.* FROM orgn n WHERE n.id IN (SELECT r.org_id FROM refs r)
),
-- Duplicate organizations are one: same normalized name (not 25 km apart when both have GPS) or same website host.
-- canon = the member with GPS, then the lowest id. organization rows are never edited.
-- Three equi-joins (self, name hash join, host hash join) instead of one OR join; the latitude band (25 km is under
-- 0.2249 degrees of latitude) is a superset prefilter in front of the exact distance.
orgmap AS MATERIALIZED (
  SELECT p.org_id, (array_agg(m.id ORDER BY (m.lat IS NULL), m.id::text))[1] AS canon
    FROM (
      SELECT a.id AS org_id, a.id AS mid FROM orga a
      UNION
      SELECT a.id, m.id FROM orga a JOIN orgn m ON m.nn = a.nn
       WHERE a.nn <> '' AND length(a.nn) >= 6 AND a.nn_c <= 5
         AND (a.lat IS NULL OR m.lat IS NULL
              OR (abs(m.lat - a.lat) <= 0.225
                  AND 12742000 * asin(sqrt(least(1, power(sin(radians(m.lat - a.lat) / 2), 2)
                        + cos(radians(a.lat)) * cos(radians(m.lat)) * power(sin(radians(m.lon - a.lon) / 2), 2)))) <= 25000))
      UNION
      SELECT a.id, m.id FROM orga a JOIN orgn m ON m.host = a.host
       WHERE a.host <> '' AND a.host_c <= 5
    ) p
    JOIN orgn m ON m.id = p.mid
   GROUP BY p.org_id
),
lsc AS MATERIALIZED (
  SELECT lsrc.vid, coalesce(om.canon, lsrc.org) AS org, lsrc.org AS listed_org, lsrc.conf, lsrc.src, lsrc.ref
    FROM lsrc LEFT JOIN orgmap om ON om.org_id = lsrc.org
),
poc AS MATERIALIZED (
  SELECT ps2.id AS photo_id, ps2.vid, coalesce(om.canon, pto.org_id) AS canon, min(pto.m) AS m
    FROM ps2
    JOIN pto ON pto.plat = round(ps2.lat::numeric, 4)::float8 AND pto.plon = round(ps2.lon::numeric, 4)::float8
    LEFT JOIN orgmap om ON om.org_id = pto.org_id
   GROUP BY ps2.id, ps2.vid, coalesce(om.canon, pto.org_id)
),
orgt AS MATERIALIZED (
  SELECT poc.vid, poc.canon, count(*) AS n_at, min(poc.m) AS min_m,
         EXISTS (SELECT 1 FROM organization_vehicles ov LEFT JOIN orgmap om ON om.org_id = ov.organization_id
                  WHERE ov.vehicle_id = poc.vid AND coalesce(om.canon, ov.organization_id) = poc.canon) AS ov_rel
    FROM poc GROUP BY poc.vid, poc.canon
),
-- Session co-occurrence: other vehicles of the account photographed (own device) within the sessions of this vehicle
-- (its first to last capture, widened by the session gap), and the organizations those vehicles are linked / listed at.
cooc AS MATERIALIZED (
  SELECT r.vid, coalesce(om.canon, l.org) AS canon, count(DISTINCT p2.vid) AS n
    FROM (SELECT ps2.vid, min(ps2.t) AS a, max(ps2.t) AS b FROM ps2 GROUP BY ps2.vid) r CROSS JOIN cfg
    JOIN ps2 p2 ON p2.vid <> r.vid
     AND p2.t BETWEEN r.a - make_interval(secs => cfg.r_gap_h * 3600) AND r.b + make_interval(secs => cfg.r_gap_h * 3600)
    JOIN vlink l ON l.vid = p2.vid
    LEFT JOIN orgmap om ON om.org_id = l.org
   GROUP BY r.vid, coalesce(om.canon, l.org)
),
st AS MATERIALIZED (
  SELECT ps2.vid, max(ps2.sess) AS n_sess,
         extract(epoch FROM max(ps2.t) - min(ps2.t)) / 86400.0 AS span_days,
         count(DISTINCT (ps2.t AT TIME ZONE 'UTC')::date) AS n_days,
         count(DISTINCT date_trunc('month', ps2.t AT TIME ZONE 'UTC')) AS n_months,
         count(*) FILTER (WHERE ps2.lat IS NOT NULL AND ps2.lon IS NOT NULL) AS geo_n,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM poc WHERE poc.photo_id = ps2.id)) AS at_any_org
    FROM ps2 GROUP BY ps2.vid
),
f AS (
  SELECT cand.vid, cfg.u, cfg.months, cfg.r_max_s, cfg.r_max_span, cfg.r_min_ph, cfg.r_min_geo, cfg.r_pers_span,
         ver.id AS ver_id,
         perm.co_by_other, perm.self_granted, perm.owner_perm, perm.any_perm,
         obs.id AS obs_id, obs.stmt_vid, obs.content_text, obs.structured_data, obs.first_person,
         ph.n AS photos, ph.n_own, ph.n_origin, ph.n_unk, ph.n_scraped, ph.n_imp, ph.n_fact, ph.imp_cites, ph.scraped_cite, ph.first_t, ph.last_t, ph.gps_n, ph.recent_gps_n, ph.devices,
         ol.t AS obs_last,
         EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = cand.vid AND vc.user_id = cfg.u) AS contrib,
         EXISTS (SELECT 1 FROM vehicle_ownerships vo WHERE vo.vehicle_id = cand.vid AND vo.owner_profile_id = cfg.u
                   AND vo.is_current = true) AS cur_own,
         EXISTS (SELECT 1 FROM discovered_vehicles dv WHERE dv.vehicle_id = cand.vid AND dv.user_id = cfg.u
                   AND dv.is_active = true AND dv.relationship_type = 'previously_owned') AS disc_prev,
         EXISTS (SELECT 1 FROM bat_listings bl WHERE bl.vehicle_id = cand.vid)
           OR EXISTS (SELECT 1 FROM external_listings el WHERE el.vehicle_id = cand.vid)
           OR EXISTS (SELECT 1 FROM ml WHERE ml.vid = cand.vid) AS v_listed,
         org.org_id, org.org_conf, org.n_orgs, org.srcs, mt.matches,
         lu.listing_url AS src_listing_url, lu.source AS src_source,
         lu.src_listing AS src_listing
  FROM cand CROSS JOIN cfg
  -- Origin-fact import rule (step 1): a vehicle created by a listing scrape, with a listing URL, whose photos from the account
  -- carry no camera make / model, taken_at or GPS, was imported by the account from that listing.
  LEFT JOIN LATERAL (
    SELECT v.source, coalesce(nullif(btrim(v.discovery_url), ''), nullif(btrim(v.listing_url), '')) AS listing_url,
           regexp_replace(lower(btrim(coalesce(v.source, ''))), '[-\s]+', '_', 'g')
             IN ('craigslist', 'bat', 'mecum', 'classic_com', 'cars_and_bids', 'facebook_marketplace', 'ebay', 'url_scraper')
           AND coalesce(nullif(btrim(v.discovery_url), ''), nullif(btrim(v.listing_url), '')) ~* '^https?://[^/\s]+\.[^/\s]+/.+'
           AS src_listing
      FROM vehicles v WHERE v.id = cand.vid) lu ON true
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
           coalesce(bool_or(p.role = 'owner' AND p.revoked_at IS NULL), false) AS owner_perm,
           count(*) > 0 AS any_perm
      FROM vehicle_user_permissions p WHERE p.vehicle_id = cand.vid AND p.user_id = cfg.u) perm ON true
  -- Step 5 evidence: the live account statement, on this vehicle or on a high-score duplicate of it. A first-person statement outranks an agent paraphrase; newest first.
  -- (A superseded statement is already excluded: is_superseded is set by the sanctioned writer from 'supersedes'.)
  LEFT JOIN LATERAL (
    SELECT o.id, o.content_text, o.sd AS structured_data, fpx.v AS first_person, o.vehicle_id AS stmt_vid FROM (
        -- stored statements and the inline (unstored) set; an owner_statement_v1 row is read as a relationship claim
        -- built from its parsed facts (ownership claim + tenure -> owner_current + start_date; title denial -> flag).
        SELECT s0.id, s0.vehicle_id, s0.observed_at, s0.ingested_at, s0.content_text, s0.structured_data,
               CASE WHEN s0.structured_data->>'claim_contract' = 'owner_statement_v1' THEN jsonb_build_object(
                      'claim_contract', 'owner_statement_v1', 'intake_actor', 'owner_first_person',
                      'speaker_user_id', cfg.u::text,
                      'title_denied', coalesce((s0.structured_data->'facts'->>'title_denied')::boolean, false),
                      'correction', jsonb_build_object('relationship', jsonb_build_object(
                        'roles', CASE WHEN coalesce((s0.structured_data->'facts'->>'ownership_claim')::boolean, false)
                                      THEN '["owner_current"]'::jsonb ELSE '[]'::jsonb END,
                        'ownership_denied', false, 'disputed', false,
                        'start_date', CASE WHEN (s0.structured_data->'facts'->>'tenure_years') ~ '^[0-9]+(\.[0-9]+)?$'
                                           THEN to_char((s0.observed_at AT TIME ZONE 'UTC')::date
                                                  - round((s0.structured_data->'facts'->>'tenure_years')::numeric * 365)::int, 'YYYY-MM-DD') END)))
                    ELSE s0.structured_data END AS sd
          FROM (SELECT o1.id, o1.vehicle_id, o1.observed_at, o1.ingested_at, o1.content_text, o1.structured_data
                  FROM vehicle_observations o1
                 WHERE o1.submitted_by_user_id = cfg.u AND o1.is_superseded IS NOT TRUE
                   AND o1.structured_data->>'claim_contract' IN ('garage_owner_correction_v1', 'owner_statement_v1')
                UNION ALL
                SELECT i.id, i.vehicle_id, i.observed_at, i.observed_at, i.content_text, i.structured_data FROM inline_stmts i) s0
      ) o
     CROSS JOIN LATERAL (SELECT (coalesce(o.sd->>'intake_actor', '') <> 'authorized_agent'
                                 OR (o.sd->>'speaker_user_id' = cfg.u::text
                                     AND coalesce(o.content_text, '') ~* '^[\s"“'']*(i|we|my|me|i''m|i''ve|i''d)\M')) AS v) fpx
     WHERE (o.vehicle_id = cand.vid OR o.vehicle_id IN (SELECT d.b FROM dup d WHERE d.a = cand.vid))
       AND (o.sd->'correction' ? 'relationship' OR o.sd->>'claim_contract' = 'owner_statement_v1')
     ORDER BY fpx.v DESC, (o.vehicle_id = cand.vid) DESC, o.observed_at DESC NULLS LAST, o.ingested_at DESC LIMIT 1) obs ON true
  -- Step 1 evidence: the account's photos; capture facts count only for own-device photos.
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, count(*) FILTER (WHERE p.own) AS n_own, count(*) FILTER (WHERE p.origin) AS n_origin,
           count(*) FILTER (WHERE p.unk) AS n_unk, count(*) FILTER (WHERE p.scraped_match IS NOT NULL) AS n_scraped,
           count(*) FILTER (WHERE p.imp) AS n_imp, count(*) FILTER (WHERE p.has_fact) AS n_fact,
           (SELECT jsonb_agg(e.c) FROM (SELECT p2.imp_cite AS c FROM pp p2 WHERE p2.vid = cand.vid AND p2.imp
                                         ORDER BY (p2.imp_cite->>'via') IS NULL, p2.id LIMIT 3) e) AS imp_cites,
           (jsonb_agg(p.scraped_match ORDER BY p.id) FILTER (WHERE p.scraped_match IS NOT NULL))->0 AS scraped_cite,
           min(p.t) FILTER (WHERE p.own) AS first_t, max(p.t) FILTER (WHERE p.own) AS last_t,
           count(*) FILTER (WHERE p.own AND p.lat IS NOT NULL AND p.lon IS NOT NULL) AS gps_n,
           count(*) FILTER (WHERE p.own AND p.lat IS NOT NULL AND p.lon IS NOT NULL
                              AND p.t >= now() - make_interval(months => cfg.months)) AS recent_gps_n,
           count(DISTINCT p.dev) FILTER (WHERE p.own) AS devices
      FROM pp p WHERE p.vid = cand.vid) ph ON true
  LEFT JOIN LATERAL (
    SELECT max(o.observed_at) AS t FROM vehicle_observations o
     WHERE o.vehicle_id = cand.vid AND o.submitted_by_user_id = cfg.u) ol ON true
  -- Step 2 evidence: listings and the (duplicate-collapsed) organization their seller resolves to.
  LEFT JOIN LATERAL (
    SELECT (array_agg(x.org ORDER BY x.conf DESC, x.org::text))[1] AS org_id, max(x.conf) AS org_conf,
           count(DISTINCT x.org) AS n_orgs,
           jsonb_agg(jsonb_build_object('source', x.src, 'organization_id', x.org, 'as_listed', x.listed_org,
                                        'confidence', x.conf, 'ref', x.ref) ORDER BY x.conf DESC, x.src, x.org::text) AS srcs
      FROM lsc x WHERE x.vid = cand.vid) org ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('listing_id', ml.listing_id, 'score', ml.score, 'signals', to_jsonb(ml.sigs))
                     ORDER BY ml.score DESC, ml.listing_id::text) AS matches
      FROM ml WHERE ml.vid = cand.vid) mt ON true
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
         coalesce((g1.structured_data->>'title_denied')::boolean, false) AS title_denied,
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
         coalesce(g2.n_own, 0) AS own_n,
         coalesce(g2.n_imp, 0) AS imp_n,
         greatest(g2.last_t, g2.obs_last) AS act_last
  FROM g2
),
g4 AS MATERIALIZED (
  SELECT g3.*,
         g3.disputed_raw AND g3.cited AS disputed,
         (g3.denied_raw OR g3.disputed_raw) AND NOT g3.cited AS uncited_ignored,
         g3.act_last IS NOT NULL AND g3.act_last < now() - make_interval(months => g3.months) AS decayed,
         g3.own_n > 0 OR (g3.n_photos > 0 AND g3.obs_id IS NOT NULL) AS doc_ok,
         g3.n_photos > 0 AND g3.imp_n * 2 > g3.n_photos AS pred_imp,
         coalesce(g3.src_listing, false) AND g3.n_photos > 0 AND coalesce(g3.n_fact, 0) = 0 AND g3.own_n = 0 AS src_imp,
         g3.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM organization_contributors oc
            WHERE oc.user_id = g3.u AND oc.status = 'active'
              AND (oc.end_date IS NULL OR oc.end_date >= current_date)
              AND (oc.organization_id = g3.org_id
                   OR EXISTS (SELECT 1 FROM orgmap om WHERE om.canon = g3.org_id AND om.org_id = oc.organization_id))) AS org_member
  FROM g3
),
-- Step 3: the organization the own-device photos sit at: the listing organization, then a vehicle link, then session
-- co-occurrence, then (listed vehicles only) dealer/auction before restoration, then most photos.
g5 AS (
  SELECT g4.*, so.s_org, round(so.min_m::numeric) AS s_m, so.n_at AS s_n_at, so.s_listed, so.ov_rel AS s_rel, so.s_other,
         so.tb_decided, so.s_orgs, so.s_cooc, so.s_okind, so.s_sm, so.s_sx, so.s_vkind, so.s_scites,
         st.n_sess, st.span_days, st.n_days, st.n_months, st.geo_n, st.at_any_org,
         (SELECT count(*) FROM orgmap om WHERE om.canon = so.s_org AND om.org_id <> om.canon) AS s_aliases
  FROM g4
  LEFT JOIN st ON st.vid = g4.vid
  LEFT JOIN LATERAL (
    SELECT q.canon AS s_org, q.n_at, q.min_m, q.ov_rel, q.listed AS s_listed, q.cooc AS s_cooc,
           q.cnt - 1 AS s_other,
           -- decided by session co-occurrence (c) or by scene + organization kind (a + b); each must not be contradicted by the
           -- other, and an organization whose kind contradicts the scene never wins a tie
           (NOT q.sx AND ((q.cooc > q.next_cooc AND q.sm >= q.next_sm)
                          OR (q.cooc = q.next_cooc AND (q.sm > q.next_sm OR (q.sm = q.next_sm AND q.bt < q.next_bt))))) AS tb_decided,
           q.orgs AS s_orgs, q.okind AS s_okind, q.sm AS s_sm, q.sx AS s_sx, q.vkind AS s_vkind, q.scites AS s_scites
      FROM (SELECT t.canon, t.n_at, t.min_m, t.ov_rel, (t.canon IS NOT DISTINCT FROM g4.org_id) AS listed,
                   coalesce(cc.n, 0) AS cooc, z.sm, z.sx, o.okind, vs.kind AS vkind, vs.cites AS scites,
                   lead(z.sm) OVER w AS next_sm,
                   CASE WHEN g4.v_listed THEN o.bt_rank ELSE 2 END AS bt,
                   row_number() OVER w AS rn, count(*) OVER () AS cnt,
                   lead(coalesce(cc.n, 0)) OVER w AS next_cooc,
                   lead(CASE WHEN g4.v_listed THEN o.bt_rank ELSE 2 END) OVER w AS next_bt,
                   array_agg(t.canon) OVER () AS orgs
              FROM orgt t
              JOIN orgn o ON o.id = t.canon
              LEFT JOIN cooc cc ON cc.vid = t.vid AND cc.canon = t.canon
              LEFT JOIN vscene vs ON vs.vid = t.vid
              CROSS JOIN LATERAL (SELECT CASE WHEN vs.kind IS NOT NULL AND o.okind = vs.kind THEN 1 ELSE 0 END AS sm,
                                         (vs.kind IS NOT NULL AND o.okind IS NOT NULL AND o.okind <> vs.kind) AS sx) z
             WHERE t.vid = g4.vid
            WINDOW w AS (ORDER BY (t.canon IS NOT DISTINCT FROM g4.org_id) DESC, t.ov_rel DESC, coalesce(cc.n, 0) DESC, z.sm DESC,
                                  CASE WHEN g4.v_listed THEN o.bt_rank ELSE 2 END, t.n_at DESC, t.min_m, t.canon::text)) q
     WHERE q.rn = 1) so ON true
),
g6 AS (
  SELECT g5.*,
         g5.s_org IS NOT NULL AND g5.n_sess <= g5.r_max_s AND g5.span_days <= g5.r_max_span
           AND g5.own_n >= g5.r_min_ph AND g5.geo_n >= g5.r_min_geo * g5.own_n AND g5.s_n_at = g5.geo_n AS shoot,
         g5.span_days >= g5.r_pers_span AND g5.geo_n - g5.at_any_org > 0 AS personal,
         g5.s_org IS NOT NULL AND g5.s_other > 0 AND NOT (g5.s_listed OR g5.s_rel) AND NOT coalesce(g5.tb_decided, false) AS amb
  FROM g5
),
h AS (
  SELECT g6.*,
    -- Ladder: [role, confidence, why]. Steps 2 and 4 gate it; step 5 statements fill the middle.
    CASE
      WHEN g6.ver_id IS NOT NULL AND (g6.denied OR g6.disputed) THEN jsonb_build_array('claimed_interest', 0.5, 'verified title capped by cited denial or dispute')
      WHEN g6.ver_id IS NOT NULL AND g6.title_denied AND g6.org_id IS NULL
        THEN jsonb_build_array('owner_reported', 0.6, 'verified title capped below owner by the account''s own title denial')
      WHEN g6.ver_id IS NOT NULL THEN jsonb_build_array(
        CASE WHEN g6.co_by_other AND NOT g6.owner_perm THEN 'co_owner_verified' ELSE 'owner_verified' END,
        CASE WHEN g6.org_id IS NOT NULL THEN 0.7 ELSE 0.98 END,
        'approved ownership verification with title document')
      WHEN g6.disputed AND g6.cited THEN jsonb_build_array('claimed_interest', 0.6, 'cited dispute')
      WHEN 'transfer_pending' = ANY (g6.roles) OR g6.claim->>'title_status' = 'transfer_pending'
        THEN jsonb_build_array('transfer_pending', 0.6, 'account states transfer pending')
      WHEN 'owner_current' = ANY (g6.roles) AND NOT g6.denied AND g6.org_id IS NULL THEN jsonb_build_array('owner_reported',
        least(CASE WHEN g6.tenure AND g6.own_n > 0 AND g6.first_person THEN 0.85 WHEN g6.own_n > 0 THEN 0.75 ELSE 0.6 END,
              CASE WHEN g6.title_denied THEN 0.7 ELSE 1 END),
        CASE WHEN g6.title_denied THEN 'first-person ownership statement; account says the title is not in its name (capped below owner)'
             WHEN g6.tenure AND g6.own_n > 0 AND g6.first_person THEN 'long-tenure first-person owner statement with own-device photos'
             WHEN g6.first_person THEN 'account states current ownership; no verified title'
             ELSE 'agent-paraphrased ownership statement; no verified title' END)
      WHEN 'owner_past' = ANY (g6.roles) AND NOT g6.denied THEN jsonb_build_array('previously_owned', 0.6, 'account states past ownership')
      WHEN 'business_handling' = ANY (g6.roles) THEN jsonb_build_array('business_handling', 0.6, 'correction role')
      WHEN 'sales_representative' = ANY (g6.roles) THEN jsonb_build_array('sales_representative', 0.6, 'correction role')
      WHEN 'consignment' = ANY (g6.roles) THEN jsonb_build_array('consignment', 0.6, 'correction role')
      WHEN 'shared_interest' = ANY (g6.roles) OR g6.disputed THEN jsonb_build_array('claimed_interest', 0.4, 'shared or claimed interest')
      WHEN g6.cur_own AND NOT g6.denied AND g6.org_id IS NULL
        THEN jsonb_build_array('owner_reported', 0.5, 'current ownership record without title verification')
      WHEN g6.disc_prev THEN jsonb_build_array('previously_owned', 0.5, 'discovered previously_owned')
      WHEN g6.org_member THEN jsonb_build_array('business_handling', 0.6, 'member of the organization that lists the vehicle')
      WHEN g6.shoot AND g6.s_listed AND g6.org_id IS NOT NULL
        THEN jsonb_build_array('business_handling', 0.7, 'inventory shoot at the organization that lists the vehicle')
      WHEN g6.src_imp
        THEN jsonb_build_array('imported_by_user', 0.4, 'vehicle created by a ' || g6.src_source || ' listing scrape (' || g6.src_listing_url
          || ') and none of the account''s ' || g6.n_photos || ' photos carries camera make / model, taken_at or GPS; not ownership')
      WHEN g6.pred_imp
        THEN jsonb_build_array('imported_by_user', 0.3, 'user photos are predominantly imported (' || g6.imp_n || ' of ' || g6.n_photos
          || ' carry a download, screenshot, web-export or listing-scrape signal); not ownership')
      WHEN g6.org_id IS NOT NULL AND g6.n_photos > 0
        THEN jsonb_build_array('contributor', CASE WHEN g6.amb THEN 0.2 ELSE 0.45 END, 'own photos of an organization-listed vehicle; not ownership')
      WHEN g6.shoot
        THEN jsonb_build_array('contributor', CASE WHEN g6.amb THEN 0.2 ELSE 0.5 END,
          CASE WHEN g6.amb THEN 'contributor: org_ambiguous, two organizations in range and nothing breaks the tie; not ownership'
               ELSE 'contributor at organization: shoot-shaped photos at an organization; no listing; not ownership' END)
      WHEN g6.doc_ok AND g6.decayed THEN jsonb_build_array('previously_documented', 0.4, 'own photos only; no photo or activity within the decay window')
      WHEN g6.doc_ok THEN jsonb_build_array('documenting', 0.4, 'own photos only; not ownership')
      WHEN g6.n_photos > 0 OR g6.contrib OR g6.any_perm
        THEN jsonb_build_array('imported_by_user', 0.3, 'no own-device photo, organization link, title or statement; photos, contributor and permission rows are not evidence')
      ELSE jsonb_build_array('profile_record', 0.3, 'creator of the profile')
    END AS d,
    CASE WHEN g6.s_org IS NULL THEN NULL
         ELSE (CASE WHEN g6.shoot THEN (CASE WHEN g6.s_listed THEN 0.7 ELSE 0.5 END) ELSE 0.15 END)
              * (CASE WHEN g6.amb THEN 0.5 ELSE 1 END) END AS s_conf
  FROM g6
)
SELECT h.vid AS vehicle_id,
       cur.relationship AS old_role,
       h.d->>0 AS derived_role,
       (h.d->>1)::numeric AS confidence,
       jsonb_build_object(
         'title_verification_id', h.ver_id, 'correction_observation_id', h.obs_id,
         'correction_cited', h.cited, 'own_photo_count', h.n_photos, 'own_device_photo_count', h.own_n,
         'contributor_row', h.contrib,
         'co_owner_grant_by_other', h.co_by_other, 'long_tenure', h.tenure,
         'documented_from', h.first_t, 'documented_to', h.last_t,
         'organization_inventory', h.org_id,
         'flags', CASE WHEN h.amb THEN '["org_ambiguous"]'::jsonb ELSE '[]'::jsonb END,
         'title_denied', h.title_denied,
         'chain', jsonb_build_array(
           jsonb_build_object('step', 1, 'name', 'origin_facts', 'confidence', CASE WHEN h.own_n > 0 THEN 0.4 ELSE 0.3 END,
             'evidence', jsonb_build_object('uploader_photo_count', h.n_photos, 'own_device_photo_count', h.own_n,
               'imported_photo_count', h.n_photos - h.own_n, 'own_origin_photo_count', coalesce(h.n_origin, 0),
               'origin_unknown_photo_count', coalesce(h.n_unk, 0),
               'imported_marked_photo_count', h.imp_n, 'predominantly_imported', h.pred_imp, 'listing_scrape_import', h.src_imp, 'listing_url', CASE WHEN h.src_imp THEN h.src_listing_url END, 'listing_source', CASE WHEN h.src_imp THEN h.src_source END, 'photos_with_capture_facts', coalesce(h.n_fact, 0), 'imported_examples', coalesce(h.imp_cites, '[]'::jsonb), 'scraped_photo_count', coalesce(h.n_scraped, 0), 'scraped_example', h.scraped_cite, 'device_count', h.devices,
               'first_capture', h.first_t, 'last_capture', h.last_t, 'gps_photo_count', coalesce(h.gps_n, 0),
               'last_activity', h.act_last, 'decay_months', h.months, 'decayed', h.decayed),
             'eliminated', CASE WHEN h.own_n = 0 THEN '["documenting","previously_documented"]'::jsonb ELSE '[]'::jsonb END),
           jsonb_build_object('step', 2, 'name', 'matched_listings', 'confidence', h.org_conf,
             'evidence', jsonb_build_object('organization_id', h.org_id, 'sources', coalesce(h.srcs, '[]'::jsonb),
               'inline_matches', coalesce(h.matches, '[]'::jsonb),
               'organizations_named', coalesce(h.n_orgs, 0), 'account_is_org_member', h.org_member,
               'decides', h.org_id IS NOT NULL),
             'eliminated', CASE WHEN h.org_id IS NULL THEN '[]'::jsonb
                                WHEN h.ver_id IS NULL THEN '["owner_verified","co_owner_verified","owner_reported"]'::jsonb
                                ELSE '["owner_reported"]'::jsonb END),
           jsonb_build_object('step', 3, 'name', 'organization_gps', 'confidence', h.s_conf,
             'evidence', jsonb_build_object('organization_id', h.s_org, 'distance_m', h.s_m,
               'pattern', CASE WHEN h.shoot THEN 'shop_shoot' WHEN h.personal THEN 'long_term_personal'
                               WHEN h.s_org IS NOT NULL THEN 'at_organization' END,
               'sessions', h.n_sess, 'span_days', round(h.span_days::numeric, 1),
               'distinct_days', h.n_days, 'distinct_months', h.n_months,
               'geotagged_photos', h.geo_n, 'photos_at_organization', h.s_n_at,
               'share_at_organization', CASE WHEN h.geo_n > 0 THEN round(h.s_n_at::numeric / h.geo_n, 2) END,
               'photos_away_from_organizations', h.geo_n - h.at_any_org,
               'organizations_in_range', CASE WHEN h.s_org IS NULL THEN 0 ELSE 1 + h.s_other END,
               'duplicate_organizations_collapsed', coalesce(h.s_aliases, 0),
               'listed', coalesce(h.s_listed, false), 'linked', coalesce(h.s_rel, false),
               'ambiguous', coalesce(h.amb, false), 'tie_break_decided', coalesce(h.tb_decided, false),
               'session_cooccurrence_links', h.s_cooc,
               'scene_context', jsonb_build_object('vehicle_scene_kind', h.s_vkind, 'selected_organization_kind', h.s_okind,
                 'scene_matches_organization', h.s_sm = 1, 'scene_contradicts_organization', coalesce(h.s_sx, false),
                 'sessions', coalesce(h.s_scites, '[]'::jsonb)), 'organizations', to_jsonb(h.s_orgs),
               'recent_photos', coalesce(h.recent_gps_n, 0) > 0,
               'hypothesis', CASE WHEN h.shoot THEN 'shop shoot at organization'
                                  WHEN h.s_org IS NOT NULL THEN 'photographed at organization' END,
               'decides', coalesce(h.shoot, false)),
             'eliminated', '[]'::jsonb),
           jsonb_build_object('step', 4, 'name', 'titles', 'confidence', CASE WHEN h.ver_id IS NOT NULL THEN 0.98 END,
             'evidence', jsonb_build_object('title_verification_id', h.ver_id,
               'conflict_with_organization_listing', h.ver_id IS NOT NULL AND h.org_id IS NOT NULL),
             'eliminated', CASE WHEN h.ver_id IS NOT NULL
               THEN '["owner_reported","contributor","documenting","previously_documented","profile_record","imported_by_user"]'::jsonb
               ELSE '["owner_verified","co_owner_verified"]'::jsonb END),
           jsonb_build_object('step', 5, 'name', 'account_statements',
             'confidence', CASE WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL THEN (h.d->>1)::numeric END,
             'evidence', jsonb_build_object('observation_id', h.obs_id, 'statement_vehicle_id', h.stmt_vid,
               'statement_from_duplicate', h.stmt_vid IS NOT NULL AND h.stmt_vid <> h.vid, 'roles', to_jsonb(h.roles), 'cited', h.cited,
               'first_person', h.first_person,
               'intake_actor', h.structured_data->>'intake_actor',
               'uncited_downgrade_ignored', h.uncited_ignored, 'long_tenure', h.tenure, 'title_denied', h.title_denied),
             'eliminated', CASE WHEN h.uncited_ignored THEN '["claimed_interest"]'::jsonb
                                WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL AND h.d->>0 IN ('owner_reported','previously_owned')
                                  THEN '["contributor","documenting","profile_record","imported_by_user"]'::jsonb
                                ELSE '[]'::jsonb END))
       ) AS evidence,
       (h.d->>2) || CASE WHEN notes.t <> '' THEN ' (' || notes.t || ')' ELSE '' END AS reason,
       ARRAY(SELECT i FROM unnest(ARRAY[h.obs_id, h.ver_id]) i WHERE i IS NOT NULL) AS evidence_ids,
       h.ver_id AS title_verification_id,
       CASE WHEN h.own_n > 0 THEN h.first_t END AS documented_from,
       CASE WHEN h.own_n > 0 THEN h.last_t END AS documented_to
FROM h
LEFT JOIN cur ON cur.vid = h.vid
CROSS JOIN LATERAL (SELECT concat_ws('; ',
    CASE WHEN h.self_granted THEN 'self-granted permission ignored' END,
    CASE WHEN h.uncited_ignored THEN 'uncited downgrade ignored' END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NULL AND 'owner_current' = ANY (h.roles)
         THEN 'owner statement set aside: listing shows organization inventory' END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NOT NULL THEN 'CONFLICT: title verification vs organization listing' END,
    CASE WHEN h.org_id IS NOT NULL AND h.personal THEN 'long-term personal photo pattern conflicts with organization listing' END,
    CASE WHEN h.amb THEN 'more than one organization in range of the photos: ' || array_to_string(h.s_orgs, ', ') END,
    CASE WHEN h.stmt_vid IS NOT NULL AND h.stmt_vid <> h.vid THEN 'statement taken from duplicate vehicle ' || h.stmt_vid END,
    CASE WHEN coalesce(h.n_orgs, 0) > 1 THEN 'listings name more than one organization' END) AS t) notes
ORDER BY h.vid;
