-- READ-ONLY preview of derive_vehicle_relationships: one SELECT, no DDL, no writes, no temp tables.
-- It reproduces the ordered evidence chain over base tables only (it never reads listing_vehicle_matches,
-- listing_seller_derivations or organization_aliases), so it can run against production BEFORE the migrations that create
-- those tables are deployed. The function body in supabase/migrations/20261111200500_garage_listing_org_evidence.sql is
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
-- Statement recency: a first-person ownership statement observed AFTER a cited dispute supersedes the dispute (both are cited in
-- chain[5].evidence.dispute / .ownership_statement, dispute.superseded = true, the role is not capped); an OLDER ownership statement does
-- not, and neither does an agent paraphrase: the newest cited dispute stands (claimed_interest).
-- No own-device photo, no organization link, no title and no statement -> imported_by_user (the garage hides it). A
-- vehicle_contributors or vehicle_user_permissions row (any role, granted by anyone) is NOT evidence by itself.
-- Duplicate clusters (one subject, never merged): the account's vehicles are linked by a high-confidence pair - what
-- find_vehicle_duplicate_candidates would list with score >= platform_config 'garage_shop_shoot_rules'.dup_min_score (default 0.70; score
-- recomputed inline: same make, year within one, same model family, VIN equal or one missing; 0.50 + year 0.15 same / 0.05 off by one + VIN
-- equal 0.30 + identical model text 0.05) - or by shared strong evidence between vehicles of the same make, year, model family and
-- compatible VIN: the same file (file_hash) among the account's photos on both, or the same approved title document. A cluster is the
-- transitive closure of those links. Its members are derived as ONE subject: statements, titles, listings (and the organization they
-- name), scene labels, photos and capture sessions of every member are unioned; each member row keeps its own vehicle_id, carries the same
-- derived role and confidence, and evidence.cluster says which member each piece came from (evidence.chain[2].sources[].member_vehicle_id,
-- chain[3].scene_context.sessions[].member_vehicle_id, chain[4] / chain[5] vehicle ids, cluster.evidence_from.photos_by_member).
-- Review pairs (same make, year within one, same model family, VIN equal or one missing, score >= 'dup_review_min_score' (0.60) and < dup_min_score):
-- a review pair joins the cluster when (a) an independent viewer judged the two vehicles' photos the same vehicle (visual_dup_judgments:
-- verdict 'true', confidence >= 'dup_visual_min_confidence' (0.70), no confident 'false' verdict), or (b) one side has no photo at all, the year
-- is the same, the VIN is present on exactly one side and no colour / trim / body_style / engine / transmission present on both sides differs
-- (basis 'absence_of_contradiction'). A year gap of one joins under (a) only; such a pair is a review pair even one 0.05 step below the band floor (different model
-- text) when one side's VIN matches a listing (bat_listings or hist_listings; cited as vin_matches_listing) and the model families match. Every review pair, joined or not, with its basis, conflicting fields
-- and judgment rows is cited in evidence.duplicate_review; the joined ones also in evidence.cluster.review_pairs_joined.
-- NOT grouped: a pair that is neither a high-score duplicate, nor shares a file / title, nor passes its review judgment (for example the same
-- year + family with different model text when both sides have photos and no viewer judged them the same vehicle).
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
-- Scene context (step 3: tie-break, single-organization support / contradiction): see the notes below; scene labels come from the scene_labels placeholder CTE
-- (rows of vehicle_photo_session_scenes), organization kinds from organizations.business_type / entity_type / services_offered.
-- Scene aggregation: a vehicle (a duplicate cluster as one) can have many labelled sessions. A session votes with its photo count (photo_count,
-- else the length of its image_ids, at least 1); a session labelled more than once counts once (its most confident label). Sessions below
-- confidence 0.6, and sessions labelled outdoor_street or other (non-informative), are DROPPED: they decide nothing and are cited in
-- chain[3].scene_context.dropped_sessions with the reason. The remaining votes are summed per kind (dealer_lot / showroom -> dealer;
-- shop_interior / upholstery_work / paint_body -> shop); a kind needs a 2:1 photo-weight majority. The aggregate is taken per vehicle and,
-- for the sessions photographed (own device) within range of an organization, per organization; the organization's own vote, else the
-- vehicle-wide vote, feeds the tie-break and the single-organization support / contradiction (scene_context.aggregate: scope, kind, weights).
-- Pre-auction inventory needs the vote AT the dealer organization to read dealer and the vehicle-wide vote not to read shop.
-- Pre-auction inventory (below listing / title / statement in the ladder): a dealer_lot / showroom scene (scene_labels, confidence >=
-- 0.6) for a session whose own-device photos sit at an organization of kind dealer / auction / consignor, and the vehicle has no own
-- long-term pattern (not long_term_personal; own-device photos taken anywhere but at that organization span <= max_span_days) ->
-- business_handling, confidence 0.6, evidence.sub_reason 'pre_auction_inventory', scene rows and organization cited in chain[3].
-- Shop custody (below listing / title / statement, above the shoot-shaped contributor rule): counted shop_interior / upholstery_work / paint_body
-- scenes in >= 2 distinct sessions photographed at the same shop-kind organization (restoration / upholstery / paint / body / mechanic) and the
-- vote there reading shop -> business_handling, confidence 0.6, evidence.sub_reason 'shop_custody' (client work), sessions and organization cited in
-- chain[3].shop_custody - even when the photos are not shoot-shaped - UNLESS the vehicle's own-device photos at geotagged places within range of no
-- organization span more than max_span_days (long-term personal; cited as long_term_personal_exception).
-- Shop-then-dealer sequence (above the organization-listing rungs, below title / statement evidence): the vehicle (as its duplicate cluster) has counted
-- shop-scene sessions in range of a shop-kind organization and a LATER dealer-organization listing (bat_listings / external_listings / org_seller_aliases /
-- matched or history listings) whose end / listed date is after the first shop session -> business_handling, evidence.sub_reason 'pre_auction_inventory',
-- custodian_organization_id = the dealer, work_provider = {organization_id: the shop, sessions}; it takes precedence over shop_custody. Fallback: when shop
-- custody would fire but a dealer-kind organization is also in range of those shop scenes and no such listing exists -> contributor, sub_reason
-- 'org_ambiguous', both organizations cited (chain[3].shop_custody.ambiguous_organizations) instead of shop_custody.
-- Place matches (scripts/garage/match-places.mjs; the place_matches CTE): a vision model was shown a session's photos and reference photos of each
-- organization in range and named the known place the session was taken at, or neither. A match at confidence >= 0.7 to an organization within
-- range of the session's own-device photos is the strongest scene evidence: it breaks an organization tie above the generic scene kind (scene_context.
-- place_matched_organization), is never contradicted by a generic label, and sets the session's kind (the organization's kind: dealer for pre-auction
-- inventory, shop for shop custody) in place of the generic label, restricted to that organization. An answer of neither (>= 0.7) drops the session
-- from every scene rule (place_neither): the scene attributes nothing. A match below 0.7, to an organization not in range, or on which two viewers
-- disagree is cited (scene_context.place_match_decisions, with every viewer) and ignored; the generic label then stands as before.
-- Sign evidence (scripts/garage/mine-sign-evidence.mjs; the sign_matches CTE): a session with a readable sign naming an organization in range of the
-- session is decided by the sign (status sign_in_range), counting as an agreed usable match to that organization over any viewer result, cited with the
-- quote; a sign naming an organization not in range is cited only (sign_not_in_range).
-- Time decay: documenting with no own photo or activity for platform_config 'garage_documenting_decay_months'
-- ({"months": n}, default 18 here) -> previously_documented, with documented_from / documented_to = min / max
-- capture time of the account's own-device photos.
WITH cfg AS (
  SELECT :'user_id'::uuid AS u,
         nullif(:'vehicle_id', '')::uuid AS only_v,
         coalesce((SELECT (pc.config_value->>'months')::int FROM platform_config pc
                    WHERE pc.config_key = 'garage_documenting_decay_months'), 18) AS months,
         rr.r_radius, rr.r_gap_h, rr.r_max_s, rr.r_max_span, rr.r_min_ph, rr.r_min_geo, rr.r_pers_span, rr.r_dup, rr.r_dup_rev, rr.r_vis
  FROM (SELECT
          coalesce((pc.config_value->>'org_radius_m')::float8, 60) AS r_radius,
          coalesce((pc.config_value->>'session_gap_hours')::float8, 2) AS r_gap_h,
          coalesce((pc.config_value->>'max_sessions')::int, 2) AS r_max_s,
          coalesce((pc.config_value->>'max_span_days')::float8, 30) AS r_max_span,
          coalesce((pc.config_value->>'min_photos')::int, 5) AS r_min_ph,
          coalesce((pc.config_value->>'min_geotag_share')::float8, 0.8) AS r_min_geo,
          coalesce((pc.config_value->>'personal_span_days')::float8, 365) AS r_pers_span,
          coalesce((pc.config_value->>'dup_min_score')::float8, 0.7) AS r_dup,
          coalesce((pc.config_value->>'dup_review_min_score')::float8, 0.6) AS r_dup_rev,
          coalesce((pc.config_value->>'dup_visual_min_confidence')::float8, 0.7) AS r_vis
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
-- paint_body, outdoor_street, other). Never creates an organization attribution: it breaks a tie, supports a single organization
-- whose kind matches, withholds the GPS attribution when its kind contradicts (unless the organization lists / is linked to the
-- vehicle), and feeds the pre-auction rule (scripts/garage/label-scenes.mjs produces the rows).
scene_labels AS (
  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.scene_label, t.model, t.confidence, t.rationale, t.photo_count
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::int))
         t(run_id, vehicle_id, session_key, image_ids, scene_label, model, confidence, rationale, photo_count)
   WHERE false -- (scene_labels)
),
-- SECOND-VIEWER SCENE PLACEHOLDER (empty by default; keep this CTE when generating the function). Same columns as scene_labels: the rows of an
-- independent second viewer (scripts/garage/label-scenes.mjs --second-viewer, written when the first viewer's confidence was below 0.7). A
-- session with both is counted only when the two labels agree (confidence = the lower one); when they disagree it decides nothing.
scene_labels_v2 AS (
  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.scene_label, t.model, t.confidence, t.rationale, t.photo_count
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::int))
         t(run_id, vehicle_id, session_key, image_ids, scene_label, model, confidence, rationale, photo_count)
   WHERE false -- (scene_labels_v2)
),
-- PLACE MATCH PLACEHOLDER (empty by default; keep this CTE when generating the function). One row per (session, viewer): a vision model
-- was shown the session's photos and reference photos of each organization in range and answered which known place the session was
-- taken at (org_id) or neither (org_id NULL); confidence 0..1; viewer 1 / 2 (scripts/garage/match-places.mjs writes the VALUES rows).
-- A match at confidence >= 0.7 to an organization within range of the session's own-device photos is the strongest scene evidence.
place_matches AS (
  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.photo_count, t.org_id, t.confidence, t.model, t.viewer, t.rationale
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::int, NULL::uuid, NULL::numeric, NULL::text, NULL::int, NULL::text))
         t(run_id, vehicle_id, session_key, image_ids, photo_count, org_id, confidence, model, viewer, rationale)
   WHERE false -- (place_matches)
),
-- SIGN EVIDENCE PLACEHOLDER (empty by default; keep this CTE when generating the function). One row per (vehicle, session): a readable business
-- name in the session's photos (a viewer's sign_text, rationale or cues) that names exactly one organization in range of that session
-- (scripts/garage/mine-sign-evidence.mjs writes the VALUES rows); quote = the matched snippet, source_run_id = the place-match run it came from.
sign_matches AS (
  SELECT t.vehicle_id, t.session_key, t.org_id, t.quote, t.source_run_id
    FROM (VALUES (NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid))
         t(vehicle_id, session_key, org_id, quote, source_run_id)
   WHERE false -- (sign_matches)
),
-- VISUAL DUPLICATE JUDGMENT PLACEHOLDER (empty by default; keep this CTE when generating the function). One row per judged pair of
-- vehicles, from an independent viewer that compared their photos (scripts/garage/compare-duplicates.mjs writes the VALUES rows):
-- verdict 'true' (same vehicle) | 'false' | 'unsure', confidence 0..1. Used only for the duplicate REVIEW pairs below; never merges.
visual_dup_judgments AS (
  SELECT t.a_id, t.b_id, t.verdict, t.confidence, t.model, t.rationale, t.run_id
    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::numeric, NULL::text, NULL::text, NULL::uuid))
         t(a_id, b_id, verdict, confidence, model, rationale, run_id)
   WHERE false -- (visual_dup_judgments)
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
-- VINs (>= 9 characters) of the account's vehicles that also appear on a listing: a bat_listings row (vin column or raw_data) or a seller-page row
-- (hist_listings). One scan of the listing sources, kept to the account's own VINs.
lvin AS MATERIALIZED (
  SELECT DISTINCT x.vin
    FROM (SELECT upper(regexp_replace(coalesce(to_jsonb(bl)->>'vin', bl.raw_data->>'vin', bl.raw_data->>'VIN', ''), '[^A-Za-z0-9]', '', 'g')) AS vin FROM bat_listings bl
          UNION ALL
          SELECT upper(regexp_replace(coalesce(h.vin, ''), '[^A-Za-z0-9]', '', 'g')) FROM hist_listings h) x
   WHERE length(x.vin) >= 9
     AND x.vin IN (SELECT upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g')) FROM cand_all ca JOIN vehicles v ON v.id = ca.vid)
),
-- Duplicate clusters among ALL the account's vehicles (find_vehicle_duplicate_candidates logic, score recomputed inline).
dv AS MATERIALIZED (
  SELECT v.id AS vid, v.year, lower(btrim(v.make)) AS mk, lower(btrim(v.model)) AS model,
         normalize_vehicle_model_family(v.model) AS fam, nullif(upper(btrim(v.vin)), '') AS vin,
         -- descriptive fields compared for contradictions between review pairs (normalized; NULL when absent)
         nullif(regexp_replace(lower(coalesce(to_jsonb(v)->>'color', '')), '[^a-z0-9]', '', 'g'), '') AS f_color,
         nullif(regexp_replace(lower(coalesce(to_jsonb(v)->>'trim', '')), '[^a-z0-9]', '', 'g'), '') AS f_trim,
         nullif(regexp_replace(lower(coalesce(to_jsonb(v)->>'body_style', '')), '[^a-z0-9]', '', 'g'), '') AS f_body,
         nullif(regexp_replace(lower(coalesce(to_jsonb(v)->>'engine', '')), '[^a-z0-9]', '', 'g'), '') AS f_engine,
         nullif(regexp_replace(lower(coalesce(to_jsonb(v)->>'transmission', '')), '[^a-z0-9]', '', 'g'), '') AS f_trans,
         NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id) AS no_photos,
         EXISTS (SELECT 1 FROM lvin l WHERE l.vin = upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g'))) AS vin_listing
    FROM cand_all ca JOIN vehicles v ON v.id = ca.vid WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
),
dup AS MATERIALIZED (
  SELECT a.vid AS a, b.vid AS b
    FROM dv a CROSS JOIN cfg JOIN dv b ON b.vid <> a.vid AND a.mk <> '' AND b.mk = a.mk
     AND a.year IS NOT NULL AND b.year IS NOT NULL AND abs(b.year - a.year) <= 1
     AND a.fam IS NOT NULL AND b.fam = a.fam
     AND (a.vin IS NULL OR b.vin IS NULL OR a.vin = b.vin)
   WHERE 0.50 + CASE WHEN b.year = a.year THEN 0.15 ELSE 0.05 END
         + CASE WHEN a.vin IS NOT NULL AND a.vin = b.vin THEN 0.30 ELSE 0 END
         + CASE WHEN b.model = a.model THEN 0.05 ELSE 0 END >= cfg.r_dup - 1e-9
),
-- Duplicate REVIEW pairs: the same gates as dup (same make, year within one, same model family, VIN equal or one missing) with a score in
-- [dup_review_min_score (0.60), dup_min_score (0.70)). One row per pair (a < b by text).
revp AS MATERIALIZED (
  SELECT a.vid AS a, b.vid AS b, s.score, a.year AS a_year, b.year AS b_year,
         (a.vin IS NULL) <> (b.vin IS NULL) AS one_vin, a.no_photos AS a_no_photos, b.no_photos AS b_no_photos,
         array_remove(ARRAY[
           CASE WHEN a.f_color IS NOT NULL AND b.f_color IS NOT NULL AND a.f_color <> b.f_color THEN 'color' END,
           CASE WHEN a.f_trim IS NOT NULL AND b.f_trim IS NOT NULL AND a.f_trim <> b.f_trim THEN 'trim' END,
           CASE WHEN a.f_body IS NOT NULL AND b.f_body IS NOT NULL AND a.f_body <> b.f_body THEN 'body_style' END,
           CASE WHEN a.f_engine IS NOT NULL AND b.f_engine IS NOT NULL AND a.f_engine <> b.f_engine THEN 'engine' END,
           CASE WHEN a.f_trans IS NOT NULL AND b.f_trans IS NOT NULL AND a.f_trans <> b.f_trans THEN 'transmission' END], NULL) AS conflicts,
         a.vin_listing OR b.vin_listing AS vin_listing, cfg.r_vis
    FROM dv a CROSS JOIN cfg JOIN dv b ON b.vid::text > a.vid::text AND a.mk <> '' AND b.mk = a.mk
     AND a.year IS NOT NULL AND b.year IS NOT NULL AND abs(b.year - a.year) <= 1
     AND a.fam IS NOT NULL AND b.fam = a.fam
     AND (a.vin IS NULL OR b.vin IS NULL OR a.vin = b.vin)
    CROSS JOIN LATERAL (SELECT 0.50 + CASE WHEN b.year = a.year THEN 0.15 ELSE 0.05 END
         + CASE WHEN a.vin IS NOT NULL AND a.vin = b.vin THEN 0.30 ELSE 0 END
         + CASE WHEN b.model = a.model THEN 0.05 ELSE 0 END AS score) s
   WHERE (s.score >= cfg.r_dup_rev - 1e-9 AND s.score < cfg.r_dup - 1e-9)
      -- a year gap of one whose VIN is on a listing (and whose model families match, above) is reviewed one 0.05 step below the band floor
      OR (abs(b.year - a.year) = 1 AND (a.vin_listing OR b.vin_listing) AND s.score >= cfg.r_dup_rev - 0.05 - 1e-9 AND s.score < cfg.r_dup_rev - 1e-9)
),
-- Visual judgments of each review pair (either order): a confident 'same vehicle' and a confident 'different vehicle' verdict.
vdj AS MATERIALIZED (
  SELECT r.a, r.b,
         bool_or(j.verdict = 'true' AND coalesce(j.confidence, 0) >= r.r_vis) AS yes,
         bool_or(j.verdict = 'false' AND coalesce(j.confidence, 0) >= r.r_vis) AS no,
         jsonb_agg(jsonb_build_object('verdict', j.verdict, 'confidence', j.confidence, 'model', j.model, 'rationale', j.rationale,
                     'run_id', j.run_id) ORDER BY j.confidence DESC NULLS LAST, j.run_id::text) AS js
    FROM revp r JOIN visual_dup_judgments j ON (j.a_id = r.a AND j.b_id = r.b) OR (j.a_id = r.b AND j.b_id = r.a)
   GROUP BY r.a, r.b
),
-- A review pair joins a cluster when (visual) an independent viewer judged the photos the same vehicle at confidence >= dup_visual_min_confidence
-- (and no confident 'different' verdict), or (absence_of_contradiction) one side has no photo at all, the year is the same, exactly one side
-- carries a VIN, and no colour / trim / body / engine / transmission present on both sides differs (and no confident 'different' verdict).
-- A year gap of one joins by the visual judgment only (also the year-gap pairs admitted below the band because a VIN matches a listing).
revx AS MATERIALIZED (
  SELECT x.*, CASE WHEN x.vis_ok THEN 'visual' WHEN x.abs_ok THEN 'absence_of_contradiction' END AS basis,
         x.vis_ok OR x.abs_ok AS joined
    FROM (SELECT r.a, r.b, r.score, r.a_year, r.b_year, r.a_no_photos, r.b_no_photos, r.conflicts, r.one_vin, r.vin_listing,
                 coalesce(d.js, '[]'::jsonb) AS js,
                 coalesce(d.yes, false) AND NOT coalesce(d.no, false) AS vis_ok,
                 r.a_year = r.b_year AND r.one_vin AND (r.a_no_photos OR r.b_no_photos) AND cardinality(r.conflicts) = 0
                   AND NOT coalesce(d.no, false) AS abs_ok
            FROM revp r LEFT JOIN vdj d ON d.a = r.a AND d.b = r.b) x
),
-- Shared strong evidence between two vehicles of the account that agree on make, year, model family and VIN (compatible): the same
-- file (file_hash) in photos the account uploaded to both, or the same approved title document.
shev AS MATERIALIZED (
  SELECT DISTINCT x.a, x.b
    FROM (
      SELECT p.vehicle_id AS a, q.vehicle_id AS b
        FROM vehicle_images p CROSS JOIN cfg
        CROSS JOIN LATERAL (SELECT q0.vehicle_id FROM vehicle_images q0
                             WHERE q0.file_hash = p.file_hash AND q0.vehicle_id <> p.vehicle_id AND q0.user_id = cfg.u OFFSET 0) q
       WHERE p.user_id = cfg.u AND p.file_hash IS NOT NULL
      UNION ALL
      SELECT v1.vehicle_id, v2.vehicle_id
        FROM ownership_verifications v1 CROSS JOIN cfg
        JOIN ownership_verifications v2 ON v2.title_document_url = v1.title_document_url AND v2.vehicle_id <> v1.vehicle_id
         AND v2.user_id = cfg.u AND v2.status = 'approved' AND to_jsonb(v2)->>'revoked_at' IS NULL
       WHERE v1.user_id = cfg.u AND v1.status = 'approved' AND to_jsonb(v1)->>'revoked_at' IS NULL AND v1.title_document_url ~ '^https://'
    ) x
    JOIN dv va ON va.vid = x.a JOIN dv vb ON vb.vid = x.b
   WHERE va.mk <> '' AND vb.mk = va.mk AND va.year IS NOT NULL AND vb.year = va.year AND va.fam IS NOT NULL AND vb.fam = va.fam
     AND (va.vin IS NULL OR vb.vin IS NULL OR va.vin = vb.vin)
),
-- Duplicate cluster edges (symmetric): a high-score duplicate pair (dup), a review pair that passed its judgment (revx) or a pair with
-- shared strong evidence (shev). Nothing is merged.
cedge AS MATERIALIZED (
  SELECT d.a, d.b FROM dup d
  UNION SELECT x.a, x.b FROM revx x WHERE x.joined
  UNION SELECT x.b, x.a FROM revx x WHERE x.joined
  UNION SELECT s.a, s.b FROM shev s
  UNION SELECT s.b, s.a FROM shev s
),
-- Cluster of each requested vehicle: everything reachable over cedge. ck = the smallest member id (text order), members sorted.
clk AS MATERIALIZED (
  SELECT m.vid, (array_agg(m.member ORDER BY m.member::text))[1] AS ck, array_agg(m.member ORDER BY m.member::text) AS members
    FROM (WITH RECURSIVE r(vid, member) AS (
            SELECT c.vid, c.vid FROM cand c
            UNION SELECT r.vid, e.b FROM r JOIN cedge e ON e.a = r.member)
          SELECT r.vid, r.member FROM r) m
   GROUP BY m.vid
),
cl AS MATERIALIZED (SELECT DISTINCT k.ck, k.members FROM clk k),
-- member -> cluster key, for every member of every requested cluster
clm AS MATERIALIZED (SELECT DISTINCT k.ck, mm.vid FROM cl k CROSS JOIN LATERAL unnest(k.members) AS mm(vid)),
candx AS MATERIALIZED (SELECT DISTINCT m.vid FROM clm m),
-- The review pairs that touch each cluster, with their judgments (cited in evidence.cluster / evidence.duplicate_review).
rvc AS MATERIALIZED (
  SELECT q.ck, jsonb_agg(jsonb_build_object('a', q.a, 'b', q.b, 'score', q.score, 'joined', q.joined, 'basis', q.basis,
           'years', jsonb_build_array(q.a_year, q.b_year), 'vehicles_without_photos',
           to_jsonb(ARRAY(SELECT z FROM (SELECT q.a AS z WHERE q.a_no_photos UNION ALL SELECT q.b WHERE q.b_no_photos) zz)),
           'one_side_has_vin', q.one_vin, 'vin_matches_listing', q.vin_listing, 'conflicting_fields', to_jsonb(q.conflicts), 'judgments', q.js)
         ORDER BY q.a::text, q.b::text) AS cites
    FROM (SELECT DISTINCT cm.ck, x.* FROM revx x JOIN clm cm ON cm.vid IN (x.a, x.b)) q
   GROUP BY q.ck
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
          -- taken_at / GPS count as capture facts only when the row carries EXIF; on an EXIF-less row they were filled from
          -- the upload or the listing (e.g. a scraped listing's location), not read from a camera.
          OR ((vi.taken_at IS NOT NULL OR vi.latitude IS NOT NULL OR vi.longitude IS NOT NULL)
              AND coalesce(x.j->'exif_data', '{}'::jsonb) NOT IN ('{}'::jsonb, 'null'::jsonb))) AS has_fact,
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
-- vid here is the cluster key (the vehicle itself when it is in no cluster); mvid is the vehicle the photo is filed on.
ps1 AS (
  SELECT pp.id, pp.vid AS mvid, coalesce(cm.ck, pp.vid) AS vid, pp.t, pp.lat, pp.lon,
         lag(pp.t) OVER (PARTITION BY coalesce(cm.ck, pp.vid) ORDER BY pp.t, pp.id) AS prev_t
    FROM pp LEFT JOIN clm cm ON cm.vid = pp.vid WHERE pp.own
),
ps2 AS MATERIALIZED (
  SELECT ps1.id, ps1.vid, ps1.mvid, ps1.t, ps1.lat, ps1.lon,
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
    FROM candx cand JOIN vehicles v ON v.id = cand.vid
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
        WHEN kt.tf ~ '(dealer|auction|consign)' AND kt.tf !~ '(restor|upholster|body_shop|paint|fabricat|garage|builder|mechanic)' THEN 'dealer'
        WHEN kt.tf ~ '(restor|upholster|body_shop|paint|fabricat|garage|builder|mechanic)' AND kt.tf !~ '(dealer|auction|consign)' THEN 'shop'
        WHEN kt.tf !~ '(dealer|auction|consign|restor|upholster|body_shop|paint|fabricat|garage|builder|mechanic)' THEN
          CASE WHEN kt.sf ~ '(dealer|auction|consign)' AND kt.sf !~ '(restor|upholster|body_shop|paint|fabricat|garage|builder|mechanic)' THEN 'dealer'
               WHEN kt.sf ~ '(restor|upholster|body_shop|paint|fabricat|garage|builder|mechanic)' AND kt.sf !~ '(dealer|auction|consign)' THEN 'shop' END
        END AS okind) kk
    CROSS JOIN LATERAL (SELECT btrim(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(lower(coalesce(o.name, '')), '[''’`]', '', 'g'),
                                      '[^a-z0-9]+', ' ', 'g'),
                       '\m(custom|llc|inc|incorporated|corp|co|ltd|the)\M', ' ', 'g'),
        '\s+', ' ', 'g')) AS nn) n2
    CROSS JOIN LATERAL (SELECT regexp_replace(split_part(split_part(split_part(
        regexp_replace(lower(coalesce(o.website, '')), '^[a-z]+://', ''), '/', 1), '?', 1), ':', 1), '^www\.', '') AS host) h
),
-- Seller handles the evidence names for each candidate vehicle: [vehicle, handle, confidence, source, ref].
sel AS MATERIALIZED (
  SELECT cand.vid, s.seller, s.conf, s.src, s.ref FROM candx cand CROSS JOIN LATERAL (
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
  SELECT cand.vid, x.org, x.conf, x.src, x.ref FROM candx cand CROSS JOIN LATERAL (
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
                  WHERE ov.vehicle_id IN (SELECT m.vid FROM clm m WHERE m.ck = poc.vid UNION SELECT poc.vid)
                    AND coalesce(om.canon, ov.organization_id) = poc.canon) AS ov_rel
    FROM poc GROUP BY poc.vid, poc.canon
),
-- Place matches (scripts/garage/match-places.mjs): one row per (vehicle, session, viewer) -> one decision per session. Two viewers count
-- only when they agree (same organization, or both 'neither'); the confidence is then the lower one. A decision is usable at confidence >= 0.7.
slv AS MATERIALIZED (
  SELECT DISTINCT ON (x.vehicle_id, x.session_key, x.viewer) x.*
    FROM (SELECT sl.*, 1 AS viewer FROM scene_labels sl UNION ALL SELECT s2.*, 2 FROM scene_labels_v2 s2) x
   ORDER BY x.vehicle_id, x.session_key, x.viewer, x.confidence DESC NULLS LAST, x.run_id::text
),
plv AS MATERIALIZED (
  SELECT DISTINCT ON (p.vehicle_id, p.session_key, coalesce(p.viewer, 1)) p.run_id, p.vehicle_id, p.session_key, p.image_ids, p.photo_count,
         p.org_id, p.confidence, p.model, coalesce(p.viewer, 1) AS viewer, p.rationale
    FROM place_matches p
   ORDER BY p.vehicle_id, p.session_key, coalesce(p.viewer, 1), p.confidence DESC NULLS LAST, p.run_id::text
),
-- Sign evidence: a session with a sign row whose organization is within range of the session's own-device photos (same test as pmo) is decided by the
-- sign alone (status sign_in_range): it counts as an agreed usable match to that organization and replaces every viewer result of the session (neither,
-- disagreement, needs_second_viewer included). Its confidence 0.7 is only the usable threshold, not a measurement. A sign row for an organization not
-- in range is cited (sign_not_in_range) and the viewer decision stands.
sgi AS MATERIALIZED (
  SELECT DISTINCT ON (r.vehicle_id, r.session_key) r.vehicle_id, r.session_key, r.org_id, r.quote, r.source_run_id, r.image_ids, r.photo_count, r.in_range
    FROM (SELECT s.vehicle_id, s.session_key, s.org_id, s.quote, s.source_run_id, pv.image_ids, pv.photo_count,
                 EXISTS (SELECT 1 FROM ps2 p JOIN poc ON poc.photo_id = p.id
                          WHERE p.mvid = s.vehicle_id AND (p.id = ANY (coalesce(pv.image_ids, '{}'::uuid[])) OR p.id::text = s.session_key)
                            AND poc.canon = coalesce(om.canon, s.org_id)) AS in_range
            FROM sign_matches s
            LEFT JOIN orgmap om ON om.org_id = s.org_id
            LEFT JOIN LATERAL (SELECT x.image_ids, x.photo_count FROM plv x WHERE x.vehicle_id = s.vehicle_id AND x.session_key = s.session_key
                                ORDER BY x.viewer LIMIT 1) pv ON true) r
   ORDER BY r.vehicle_id, r.session_key, r.in_range DESC, r.org_id::text, r.source_run_id::text
),
plc AS MATERIALIZED (
  SELECT cm.ck AS vid, g.vehicle_id, g.session_key, g.image_ids, g.photo_count, g.n_viewers, g.agree, g.org_id, g.conf,
         g.conf >= 0.7 AND (g.n_viewers = 1 OR g.agree)
           -- an organization match that would decide the organization alone (no informative scene label >= 0.6 on the session) needs two agreeing viewers
           AND (g.org_id IS NULL OR g.n_viewers >= 2
                OR EXISTS (SELECT 1 FROM slv l WHERE l.vehicle_id = g.vehicle_id AND l.session_key = g.session_key
                              AND l.scene_label IN ('dealer_lot', 'showroom', 'shop_interior', 'upholstery_work', 'paint_body') AND l.confidence >= 0.6)) AS ok,
         g.org_id IS NOT NULL AND g.n_viewers = 1 AND g.conf >= 0.7
           AND NOT EXISTS (SELECT 1 FROM slv l WHERE l.vehicle_id = g.vehicle_id AND l.session_key = g.session_key
                              AND l.scene_label IN ('dealer_lot', 'showroom', 'shop_interior', 'upholstery_work', 'paint_body') AND l.confidence >= 0.6) AS needs_v2, g.cite
    FROM (SELECT f.vehicle_id, f.session_key, f.image_ids, f.photo_count, f.org_id, a.n_viewers, a.agree,
                 CASE WHEN a.n_viewers >= 2 AND a.agree THEN a.min_conf ELSE f.confidence END AS conf, a.cite
            FROM (SELECT DISTINCT ON (x.vehicle_id, x.session_key) x.vehicle_id, x.session_key, x.image_ids, x.photo_count, x.org_id, x.confidence
                    FROM plv x ORDER BY x.vehicle_id, x.session_key, x.viewer) f
            JOIN (SELECT x.vehicle_id, x.session_key, count(*) AS n_viewers,
                         count(DISTINCT coalesce(x.org_id::text, 'none')) = 1 AS agree, min(x.confidence) AS min_conf,
                         jsonb_agg(jsonb_build_object('viewer', x.viewer, 'run_id', x.run_id, 'organization_id', x.org_id, 'confidence', x.confidence,
                                     'model', x.model, 'rationale', x.rationale) ORDER BY x.viewer) AS cite
                    FROM plv x GROUP BY x.vehicle_id, x.session_key) a ON a.vehicle_id = f.vehicle_id AND a.session_key = f.session_key
           WHERE NOT EXISTS (SELECT 1 FROM sgi i WHERE i.in_range AND i.vehicle_id = f.vehicle_id AND i.session_key = f.session_key)) g
    JOIN clm cm ON cm.vid = g.vehicle_id
  UNION ALL
  SELECT cm.ck, i.vehicle_id, i.session_key, i.image_ids, i.photo_count, 2, true, i.org_id, 0.7::numeric, true, false,
         jsonb_build_array(jsonb_build_object('source', 'sign', 'run_id', i.source_run_id, 'organization_id', i.org_id, 'quote', i.quote,
                                              'rationale', i.quote))
    FROM sgi i JOIN clm cm ON cm.vid = i.vehicle_id
   WHERE i.in_range
),
-- A usable match counts when the matched organization is within range of the session's own-device photos (poc); otherwise it is cited and ignored.
pmo AS MATERIALIZED (
  SELECT DISTINCT k.vid, poc.canon, k.vehicle_id, k.session_key, k.conf, k.n_viewers, k.cite,
         greatest(1, coalesce(k.photo_count, nullif(cardinality(k.image_ids), 0), 1)) AS w
    FROM plc k
    LEFT JOIN orgmap om ON om.org_id = k.org_id
    JOIN ps2 p ON p.mvid = k.vehicle_id AND (p.id = ANY (coalesce(k.image_ids, '{}'::uuid[])) OR p.id::text = k.session_key)
    JOIN poc ON poc.photo_id = p.id
   WHERE k.ok AND k.org_id IS NOT NULL AND poc.canon = coalesce(om.canon, k.org_id)
),
-- Status of every place decision (cited whether or not it was used).
pmx AS MATERIALIZED (
  SELECT k.vid, k.vehicle_id, k.session_key, k.conf, k.cite, k.org_id, k.n_viewers, k.image_ids, k.photo_count,
         CASE WHEN EXISTS (SELECT 1 FROM sgi i WHERE i.in_range AND i.vehicle_id = k.vehicle_id AND i.session_key = k.session_key)
                   AND EXISTS (SELECT 1 FROM pmo o WHERE o.vehicle_id = k.vehicle_id AND o.session_key = k.session_key) THEN 'sign_in_range'
              WHEN k.n_viewers >= 2 AND NOT k.agree THEN 'viewer_disagreement'
              WHEN k.needs_v2 THEN 'needs_second_viewer'
              WHEN NOT k.ok THEN 'below_confidence'
              WHEN k.org_id IS NULL AND k.n_viewers >= 2 THEN 'neither'
              WHEN k.org_id IS NULL THEN 'neither_single_viewer'
              WHEN EXISTS (SELECT 1 FROM pmo o WHERE o.vehicle_id = k.vehicle_id AND o.session_key = k.session_key) THEN 'matched_in_range'
              ELSE 'organization_not_in_range' END AS st,
         (SELECT o.canon FROM pmo o WHERE o.vehicle_id = k.vehicle_id AND o.session_key = k.session_key LIMIT 1) AS canon,
         greatest(1, coalesce(k.photo_count, nullif(cardinality(k.image_ids), 0), 1)) AS w
    FROM plc k
),
pmagg AS MATERIALIZED (
  SELECT o.vid, o.canon, count(*) AS n_sess, sum(o.w) AS w,
         jsonb_agg(jsonb_build_object('session_key', o.session_key, 'member_vehicle_id', o.vehicle_id, 'confidence', o.conf, 'photos', o.w,
                     'organization_id', o.canon, 'viewers', o.cite) ORDER BY o.conf DESC, o.session_key, o.vehicle_id::text) AS cites
    FROM pmo o GROUP BY o.vid, o.canon
),
pmd AS MATERIALIZED (
  SELECT x.vid, jsonb_agg(jsonb_build_object('session_key', x.session_key, 'member_vehicle_id', x.vehicle_id, 'status', x.st,
                     'confidence', x.conf, 'photos', x.w, 'viewers', x.cite) ORDER BY x.session_key, x.vehicle_id::text, x.st) AS cites
    FROM (SELECT y.vid, y.session_key, y.vehicle_id, y.st, y.conf, y.w, y.cite FROM pmx y
          UNION ALL
          SELECT cm.ck, i.session_key, i.vehicle_id::uuid, 'sign_not_in_range', NULL::numeric,
                 greatest(1, coalesce(i.photo_count, nullif(cardinality(i.image_ids), 0), 1)),
                 jsonb_build_array(jsonb_build_object('source', 'sign', 'run_id', i.source_run_id, 'organization_id', i.org_id, 'quote', i.quote))
            FROM sgi i JOIN clm cm ON cm.vid = i.vehicle_id WHERE NOT i.in_range) x
   GROUP BY x.vid
),
-- Scene sessions of each cluster, one row per (vehicle, session): a session labelled more than once by one viewer counts once (its most confident
-- label); when two viewers labelled it they count only if they agree (same label, confidence = the lower one), else the session is DROPPED
-- (viewer_disagreement) and both are cited. A session votes with the number of its photos (photo_count, else the length of its image_ids, at
-- least 1). It is DROPPED, not counted, and cited as dropped when its label is non-informative (outdoor_street, other) or its confidence is below
-- the floor of 0.6. Its kind (sk) is dealer (dealer_lot / showroom) or shop (shop_interior / upholstery_work / paint_body); a usable place match to
-- an organization in range overrides it with that organization's kind and restricts the session's vote to that organization (pm_canon); a
-- usable 'neither' on which two viewers agree drops the session (place_neither): the scene then attributes nothing; a single viewer's 'neither'
-- (neither_single_viewer) is cited but does not veto a confident scene label. A place-matched session without a generic label is a row too.
sc AS MATERIALIZED (
  SELECT d.*, greatest(1, coalesce(d.photo_count, nullif(cardinality(d.image_ids), 0), 1)) AS w,
         CASE WHEN d.pm_st IN ('matched_in_range', 'sign_in_range') AND d.pm_kind IS NOT NULL THEN d.pm_kind
              WHEN d.scene_label IN ('dealer_lot', 'showroom') THEN 'dealer'
              WHEN d.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body') THEN 'shop' END AS sk,
         CASE WHEN d.pm_st IN ('matched_in_range', 'sign_in_range') AND d.pm_kind IS NOT NULL THEN NULL
              WHEN d.pm_st = 'neither' THEN 'place_neither'
              WHEN d.scene_label IS NULL THEN 'non_informative'
              WHEN d.n_viewers >= 2 AND NOT d.agree THEN 'viewer_disagreement'
              WHEN coalesce(d.confidence, 0) < 0.6 THEN 'below_confidence_floor'
              WHEN d.scene_label IN ('outdoor_street', 'other') THEN 'non_informative' END AS dropped,
         CASE WHEN d.pm_st IN ('matched_in_range', 'sign_in_range') THEN d.pm_c END AS pm_canon,
         jsonb_build_object('run_id', d.run_id, 'session_key', d.session_key, 'scene_label', d.scene_label, 'model', d.model,
                            'confidence', d.confidence, 'rationale', d.rationale, 'member_vehicle_id', d.vehicle_id,
                            'photos', greatest(1, coalesce(d.photo_count, nullif(cardinality(d.image_ids), 0), 1)),
                            'place_match_status', d.pm_st, 'place_match', d.pm_cite, 'viewers', d.vcite) AS cite
    FROM (SELECT cm.ck AS vid, c.run_id, c.vehicle_id, c.session_key, c.image_ids, c.scene_label, c.model, c.confidence, c.rationale, c.photo_count,
                 c.n_viewers, c.agree, c.vcite, pm.st AS pm_st, pm.canon AS pm_c, pm.cite AS pm_cite, og.okind AS pm_kind
            FROM (SELECT f.run_id, f.vehicle_id, f.session_key, f.image_ids, f.scene_label, f.model,
                         CASE WHEN a.n_viewers >= 2 AND a.agree THEN a.min_conf ELSE f.confidence END AS confidence,
                         f.rationale, f.photo_count, a.n_viewers, a.agree, a.vcite
                    FROM (SELECT DISTINCT ON (x.vehicle_id, x.session_key) x.vehicle_id, x.session_key, x.run_id, x.image_ids, x.scene_label, x.model,
                                 x.confidence, x.rationale, x.photo_count
                            FROM slv x ORDER BY x.vehicle_id, x.session_key, x.viewer) f
                    JOIN (SELECT x.vehicle_id, x.session_key, count(*) AS n_viewers, count(DISTINCT x.scene_label) = 1 AS agree, min(x.confidence) AS min_conf,
                                 jsonb_agg(jsonb_build_object('viewer', x.viewer, 'run_id', x.run_id, 'scene_label', x.scene_label, 'model', x.model,
                                             'confidence', x.confidence, 'rationale', x.rationale) ORDER BY x.viewer) AS vcite
                            FROM slv x GROUP BY x.vehicle_id, x.session_key) a ON a.vehicle_id = f.vehicle_id AND a.session_key = f.session_key
                  ) c
            JOIN clm cm ON cm.vid = c.vehicle_id
            LEFT JOIN pmx pm ON pm.vehicle_id = c.vehicle_id AND pm.session_key = c.session_key
            LEFT JOIN orgn og ON og.id = pm.canon
          UNION ALL
          SELECT pm.vid, (pm.cite->0->>'run_id')::uuid, pm.vehicle_id, pm.session_key, pm.image_ids, NULL::text, pm.cite->0->>'model', pm.conf,
                 pm.cite->0->>'rationale', pm.photo_count, 1, true, NULL::jsonb, pm.st, pm.canon, pm.cite, og.okind
            FROM pmx pm LEFT JOIN orgn og ON og.id = pm.canon
           WHERE NOT EXISTS (SELECT 1 FROM slv sl WHERE sl.vehicle_id = pm.vehicle_id AND sl.session_key = pm.session_key)) d
),
-- Scene kind of each candidate vehicle: photo-weighted vote of its counted sessions (sk: dealer / shop). A vehicle whose sessions read as both
-- without a 2:1 majority has no kind.
vscene AS MATERIALIZED (
  SELECT k.vid, k.wd, k.ws,
         CASE WHEN k.wd > 0 AND k.wd >= 2 * k.ws THEN 'dealer' WHEN k.ws > 0 AND k.ws >= 2 * k.wd THEN 'shop' END AS kind,
         k.cites, k.dropped_cites
    FROM (SELECT sc.vid,
                 coalesce(sum(sc.w) FILTER (WHERE sc.dropped IS NULL AND sc.sk = 'dealer'), 0) AS wd,
                 coalesce(sum(sc.w) FILTER (WHERE sc.dropped IS NULL AND sc.sk = 'shop'), 0) AS ws,
                 jsonb_agg(sc.cite ORDER BY sc.confidence DESC, sc.session_key, sc.vehicle_id::text) FILTER (WHERE sc.dropped IS NULL) AS cites,
                 jsonb_agg(sc.cite || jsonb_build_object('dropped', sc.dropped) ORDER BY sc.confidence DESC, sc.session_key, sc.vehicle_id::text)
                   FILTER (WHERE sc.dropped IS NOT NULL) AS dropped_cites
            FROM sc GROUP BY sc.vid) k
),
-- The same vote per organization: counted sessions whose photos (scene image_ids, or the session_key photo) were taken, on an own device, within
-- range of that organization. Where a vehicle has such sessions at an organization, they - not the vehicle-wide vote - say what kind of scene
-- it was photographed in there.
sorg AS MATERIALIZED (
  SELECT x.vid, x.canon,
         coalesce(sum(x.w) FILTER (WHERE x.sk = 'dealer'), 0) AS wd,
         coalesce(sum(x.w) FILTER (WHERE x.sk = 'shop'), 0) AS ws,
         CASE WHEN sum(x.w) FILTER (WHERE x.sk = 'dealer') > 0
                   AND coalesce(sum(x.w) FILTER (WHERE x.sk = 'dealer'), 0)
                       >= 2 * coalesce(sum(x.w) FILTER (WHERE x.sk = 'shop'), 0) THEN 'dealer'
              WHEN sum(x.w) FILTER (WHERE x.sk = 'shop') > 0
                   AND coalesce(sum(x.w) FILTER (WHERE x.sk = 'shop'), 0)
                       >= 2 * coalesce(sum(x.w) FILTER (WHERE x.sk = 'dealer'), 0) THEN 'shop' END AS kind,
         jsonb_agg(x.cite || jsonb_build_object('organization_id', x.canon) ORDER BY x.confidence DESC, x.session_key, x.vehicle_id::text) AS cites
    FROM (SELECT DISTINCT sc.vid, poc.canon, sc.vehicle_id, sc.session_key, sc.sk, sc.w, sc.confidence, sc.cite
            FROM sc
            JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
            JOIN poc ON poc.photo_id = p.id AND (sc.pm_canon IS NULL OR sc.pm_canon = poc.canon)
           WHERE sc.dropped IS NULL) x
   GROUP BY x.vid, x.canon
),
-- Pre-auction inventory: dealer_lot / showroom scenes (confidence >= 0.6) whose session photos (scene image_ids, or the session_key
-- photo) were taken, on an own device, at a dealer / auction / consignor organization (orgn.okind = 'dealer').
pa_rows AS MATERIALIZED (
  SELECT p.vid, sc.vehicle_id AS member_vid, sc.run_id, sc.session_key, sc.scene_label, sc.model, sc.confidence, sc.rationale, poc.canon AS org, sc.w,
         sg.wd, sg.ws, sg.kind
    FROM sc
    JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
    JOIN poc ON poc.photo_id = p.id AND (sc.pm_canon IS NULL OR sc.pm_canon = poc.canon)
    JOIN orgn o ON o.id = poc.canon AND o.okind = 'dealer'
    -- the photo-weighted vote at that organization must read dealer, and the vehicle-wide vote must not read shop
    JOIN sorg sg ON sg.vid = p.vid AND sg.canon = poc.canon AND sg.kind = 'dealer'
    LEFT JOIN vscene vs ON vs.vid = p.vid
   WHERE sc.sk = 'dealer' AND sc.dropped IS NULL AND vs.kind IS DISTINCT FROM 'shop'
   GROUP BY p.vid, sc.vehicle_id, sc.run_id, sc.session_key, sc.scene_label, sc.model, sc.confidence, sc.rationale, poc.canon, sc.w, sg.wd, sg.ws, sg.kind
),
pa AS MATERIALIZED (
  SELECT r.vid, array_agg(DISTINCT r.org) AS orgs,
         jsonb_agg(jsonb_build_object('run_id', r.run_id, 'session_key', r.session_key, 'scene_label', r.scene_label, 'model', r.model,
                     'confidence', r.confidence, 'rationale', r.rationale, 'organization_id', r.org, 'member_vehicle_id', r.member_vid, 'photos', r.w)
                   ORDER BY r.confidence DESC, r.session_key, r.org::text, r.member_vid::text) AS cites,
         jsonb_agg(DISTINCT jsonb_build_object('organization_id', r.org, 'kind', r.kind, 'dealer_weight', r.wd, 'shop_weight', r.ws)) AS aggs
    FROM pa_rows r GROUP BY r.vid
),
-- Shop custody: counted shop_interior / upholstery_work / paint_body sessions photographed (own device) at the same shop-kind organization
-- (orgn.okind = 'shop'), in at least 2 distinct sessions, where the vote at that organization reads shop. One organization per vehicle: the
-- one with most sessions.
shopc AS MATERIALIZED (
  SELECT DISTINCT ON (y.vid) y.vid, y.canon, y.n_sess, y.cites, y.wd, y.ws
    FROM (SELECT x.vid, x.canon, count(*) AS n_sess, sg.wd, sg.ws,
                 jsonb_agg(x.cite || jsonb_build_object('organization_id', x.canon) ORDER BY x.confidence DESC, x.session_key, x.vehicle_id::text) AS cites
            FROM (SELECT DISTINCT sc.vid, poc.canon, sc.vehicle_id, sc.session_key, sc.confidence, sc.cite
                    FROM sc
                    JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
                    JOIN poc ON poc.photo_id = p.id AND (sc.pm_canon IS NULL OR sc.pm_canon = poc.canon)
                    JOIN orgn o ON o.id = poc.canon AND o.okind = 'shop'
                   WHERE sc.dropped IS NULL AND sc.sk = 'shop') x
            JOIN sorg sg ON sg.vid = x.vid AND sg.canon = x.canon AND sg.kind = 'shop'
           GROUP BY x.vid, x.canon, sg.wd, sg.ws HAVING count(*) >= 2) y
   ORDER BY y.vid, y.n_sess DESC, y.canon::text
),
-- Shop-then-dealer sequence: the vehicle (as its duplicate cluster) has counted shop-scene sessions in range of a shop-kind organization (the vote
-- there reads shop) and a LATER listing attributed to a dealer-kind organization (bat_listings / external_listings organization, a bat seller handle
-- via org_seller_aliases, or a matched listing incl. hist_listings), whose end / listed date is after the first shop session. shopt = the shop
-- organization (most sessions) with the first shop-session time; dlst = dated dealer-organization listings; seqx = the earliest such listing.
shopt AS MATERIALIZED (
  SELECT y.vid, y.canon, y.n_sess, y.first_t, y.cites
    FROM (SELECT z.vid, z.canon, z.n_sess, min(z.first_t) OVER (PARTITION BY z.vid) AS first_t, z.cites,
                 row_number() OVER (PARTITION BY z.vid ORDER BY z.n_sess DESC, z.first_t, z.canon::text) AS rn
            FROM (SELECT x.vid, x.canon, count(*) AS n_sess, min(x.t) AS first_t,
                         jsonb_agg(x.cite || jsonb_build_object('organization_id', x.canon, 'first_photo_at', x.t)
                                   ORDER BY x.t, x.session_key, x.vehicle_id::text) AS cites
                    FROM (SELECT sc.vid, poc.canon, sc.vehicle_id, sc.session_key, sc.confidence, sc.cite, min(p.t) AS t
                            FROM sc
                            JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
                            JOIN poc ON poc.photo_id = p.id AND (sc.pm_canon IS NULL OR sc.pm_canon = poc.canon)
                            JOIN orgn o ON o.id = poc.canon AND o.okind = 'shop'
                           WHERE sc.dropped IS NULL AND sc.sk = 'shop'
                           GROUP BY sc.vid, poc.canon, sc.vehicle_id, sc.session_key, sc.confidence, sc.cite) x
                    JOIN sorg sg ON sg.vid = x.vid AND sg.canon = x.canon AND sg.kind = 'shop'
                   GROUP BY x.vid, x.canon) z) y
   WHERE y.rn = 1
),
dlst AS MATERIALIZED (
  SELECT cm.ck AS vid, coalesce(om.canon, d.org) AS org, d.src, d.ref, d.dt
    FROM (SELECT bl.vehicle_id AS mv, bl.organization_id AS org, 'bat_listings.organization_id' AS src, bl.bat_listing_url AS ref,
                 coalesce(bl.auction_end_date, bl.sale_date)::timestamptz AS dt
            FROM bat_listings bl JOIN candx cx ON cx.vid = bl.vehicle_id WHERE bl.organization_id IS NOT NULL
          UNION ALL
          SELECT el.vehicle_id, el.organization_id, 'external_listings.organization_id', el.listing_url,
                 coalesce(el.end_date, el.sold_at, el.start_date)::timestamptz
            FROM external_listings el JOIN candx cx ON cx.vid = el.vehicle_id WHERE el.organization_id IS NOT NULL
          UNION ALL
          SELECT bl.vehicle_id, a.organization_id, 'bat_listings.seller_username via org_seller_aliases', bl.bat_listing_url,
                 coalesce(bl.auction_end_date, bl.sale_date)::timestamptz
            FROM bat_listings bl JOIN candx cx ON cx.vid = bl.vehicle_id
            JOIN org_seller_aliases a ON a.platform = 'bat' AND a.seller_username = lower(btrim(bl.seller_username))
           WHERE bl.organization_id IS NULL
          UNION ALL
          SELECT ml.vid, coalesce(ml.organization_id, a.organization_id), 'matched listing (' || array_to_string(ml.sigs, '+') || ')', ml.ref,
                 coalesce(b.auction_end_date, b.sale_date, h.end_date)::timestamptz
            FROM ml
            LEFT JOIN bat_listings b ON b.id = ml.listing_id
            LEFT JOIN hist_listings h ON md5(h.url)::uuid = ml.listing_id
            LEFT JOIN org_seller_aliases a ON ml.organization_id IS NULL AND a.platform = 'bat' AND a.seller_username = ml.seller
           WHERE coalesce(ml.organization_id, a.organization_id) IS NOT NULL) d
    JOIN clm cm ON cm.vid = d.mv
    LEFT JOIN orgmap om ON om.org_id = d.org
    JOIN orgn o ON o.id = coalesce(om.canon, d.org) AND o.okind = 'dealer'
   WHERE d.dt IS NOT NULL
),
seqx AS MATERIALIZED (
  SELECT DISTINCT ON (s.vid) s.vid, s.canon AS shop_org, s.n_sess, s.first_t, s.cites, d.org AS dealer_org, d.src, d.ref, d.dt
    FROM shopt s JOIN dlst d ON d.vid = s.vid AND d.dt > s.first_t
   ORDER BY s.vid, d.dt, d.org::text, d.ref
),
-- Dealer-kind organizations also in range of the vehicle's counted shop-scene photos (a place match to one organization narrows the session to it).
shopd AS MATERIALIZED (
  SELECT x.vid, array_agg(DISTINCT x.canon ORDER BY x.canon) AS dorgs
    FROM (SELECT DISTINCT sc.vid, poc.canon
            FROM sc
            JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
            JOIN poc ON poc.photo_id = p.id AND (sc.pm_canon IS NULL OR sc.pm_canon = poc.canon)
            JOIN orgn o ON o.id = poc.canon AND o.okind = 'dealer'
           WHERE sc.dropped IS NULL AND sc.sk = 'shop') x
   GROUP BY x.vid
),
-- Span (days) of the vehicle's own-device photos taken at geotagged places within range of no organization: a long-term personal pattern.
awayc AS MATERIALIZED (
  SELECT p.vid, extract(epoch FROM max(p.t) - min(p.t)) / 86400.0 AS span
    FROM ps2 p WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL AND NOT EXISTS (SELECT 1 FROM poc WHERE poc.photo_id = p.id)
   GROUP BY p.vid
),
-- Span (days) of the vehicle's own-device photos taken anywhere but at those organizations: an own long-term pattern if it exceeds
-- the shop-shoot window (max_span_days).
away AS MATERIALIZED (
  SELECT p.vid, extract(epoch FROM max(p.t) - min(p.t)) / 86400.0 AS span
    FROM ps2 p JOIN pa ON pa.vid = p.vid
   WHERE NOT EXISTS (SELECT 1 FROM poc WHERE poc.photo_id = p.id AND poc.canon = ANY (pa.orgs))
   GROUP BY p.vid
),
-- Session co-occurrence: other vehicles of the account photographed (own device) within the sessions of this vehicle
-- (its first to last capture, widened by the session gap), and the organizations those vehicles are linked / listed at.
cooc AS MATERIALIZED (
  SELECT r.vid, coalesce(om.canon, l.org) AS canon, count(DISTINCT p2.vid) AS n
    FROM (SELECT ps2.vid, min(ps2.t) AS a, max(ps2.t) AS b FROM ps2 GROUP BY ps2.vid) r CROSS JOIN cfg
    JOIN ps2 p2 ON p2.vid <> r.vid
     AND p2.t BETWEEN r.a - make_interval(secs => cfg.r_gap_h * 3600) AND r.b + make_interval(secs => cfg.r_gap_h * 3600)
    JOIN vlink l ON l.vid = p2.mvid
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
-- The account's live statements (stored and inline), one row per statement, read as a relationship claim; shared by every member of a
-- duplicate cluster. A superseded statement is already excluded (is_superseded is set by the sanctioned writer from 'supersedes').
stm AS MATERIALIZED (
  SELECT o.id, o.vehicle_id, o.observed_at, o.ingested_at, o.content_text, o.sd, fpx.v AS fp, rr.roles,
         coalesce((o.sd->'correction'->'relationship'->>'disputed')::boolean, false) OR 'claimed_interest' = ANY (rr.roles) AS disputed_flag,
         coalesce((o.sd->'correction'->'relationship'->>'ownership_denied')::boolean, false) AS denied_flag,
         coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(o.sd->'correction'->'evidence_ids') = 'array'
                                          THEN o.sd->'correction'->'evidence_ids' END), 0) > 0
           OR nullif(btrim(coalesce(o.content_text, '')), '') IS NOT NULL AS cited
    FROM cfg
    CROSS JOIN LATERAL (
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
    CROSS JOIN LATERAL (SELECT ARRAY(SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.sd->'correction'->'relationship'->'roles') = 'array'
                                                    THEN o.sd->'correction'->'relationship'->'roles' ELSE '[]'::jsonb END) x) AS roles) rr
   WHERE o.sd->'correction' ? 'relationship' OR o.sd->>'claim_contract' = 'owner_statement_v1'
),
f AS (
  SELECT cl.ck AS vid, cl.members, cfg.u, cfg.months, cfg.r_max_s, cfg.r_max_span, cfg.r_min_ph, cfg.r_min_geo, cfg.r_pers_span,
         ver.id AS ver_id, ver.ver_vid,
         dsp.id AS dsp_id, dsp.observed_at AS dsp_t, dsp.vehicle_id AS dsp_vid, ows.id AS ows_id, ows.observed_at AS ows_t, ows.vehicle_id AS ows_vid,
         perm.co_by_other, perm.self_granted, perm.owner_perm, perm.any_perm,
         obs.id AS obs_id, obs.stmt_vid, obs.content_text, obs.structured_data, obs.first_person,
         ph.n AS photos, ph.n_own, ph.n_origin, ph.n_unk, ph.n_scraped, ph.n_imp, ph.n_fact, ph.imp_cites, ph.scraped_cite, ph.first_t, ph.last_t, ph.gps_n, ph.recent_gps_n, ph.devices, ph.by_member,
         ol.t AS obs_last,
         EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = ANY (cl.members) AND vc.user_id = cfg.u) AS contrib,
         EXISTS (SELECT 1 FROM vehicle_ownerships vo WHERE vo.vehicle_id = ANY (cl.members) AND vo.owner_profile_id = cfg.u
                   AND vo.is_current = true) AS cur_own,
         EXISTS (SELECT 1 FROM discovered_vehicles dv WHERE dv.vehicle_id = ANY (cl.members) AND dv.user_id = cfg.u
                   AND dv.is_active = true AND dv.relationship_type = 'previously_owned') AS disc_prev,
         EXISTS (SELECT 1 FROM bat_listings bl WHERE bl.vehicle_id = ANY (cl.members))
           OR EXISTS (SELECT 1 FROM external_listings el WHERE el.vehicle_id = ANY (cl.members))
           OR EXISTS (SELECT 1 FROM ml WHERE ml.vid = ANY (cl.members)) AS v_listed,
         org.org_id, org.org_conf, org.n_orgs, org.srcs, mt.matches,
         lu.listing_url AS src_listing_url, lu.source AS src_source,
         lu.src_listing AS src_listing
  FROM cl CROSS JOIN cfg
  -- Origin-fact import rule (step 1): a vehicle created by a listing scrape, with a listing URL, whose photos from the account
  -- carry no camera make / model, taken_at or GPS, was imported by the account from that listing.
  LEFT JOIN LATERAL (
    SELECT v.source, coalesce(nullif(btrim(v.discovery_url), ''), nullif(btrim(v.listing_url), '')) AS listing_url,
           regexp_replace(lower(btrim(coalesce(v.source, ''))), '[-\s]+', '_', 'g')
             IN ('craigslist', 'bat', 'mecum', 'classic_com', 'cars_and_bids', 'facebook_marketplace', 'ebay', 'url_scraper')
           AND coalesce(nullif(btrim(v.discovery_url), ''), nullif(btrim(v.listing_url), '')) ~* '^https?://[^/\s]+\.[^/\s]+/.+'
           AS src_listing
      FROM vehicles v WHERE v.id = ANY (cl.members) ORDER BY src_listing DESC, v.id::text LIMIT 1) lu ON true
  -- Step 4 evidence: approved, https document, not revoked (revoked_at read defensively; the column may not exist).
  LEFT JOIN LATERAL (
    SELECT ov.id, ov.vehicle_id AS ver_vid FROM ownership_verifications ov
     WHERE ov.vehicle_id = ANY (cl.members) AND ov.user_id = cfg.u AND ov.status = 'approved'
       AND ov.title_document_url ~ '^https://' AND to_jsonb(ov)->>'revoked_at' IS NULL
     ORDER BY ov.created_at DESC, ov.id::text LIMIT 1) ver ON true
  -- A grant counts only if someone other than the account itself made it.
  LEFT JOIN LATERAL (
    SELECT coalesce(bool_or(p.role = 'co_owner' AND p.revoked_at IS NULL AND coalesce(p.is_active, true)
                            AND p.granted_by IS NOT NULL AND p.granted_by <> p.user_id), false) AS co_by_other,
           coalesce(bool_or(p.granted_by = p.user_id AND p.role IN ('owner','co_owner') AND p.revoked_at IS NULL), false) AS self_granted,
           coalesce(bool_or(p.role = 'owner' AND p.revoked_at IS NULL), false) AS owner_perm,
           count(*) > 0 AS any_perm
      FROM vehicle_user_permissions p WHERE p.vehicle_id = ANY (cl.members) AND p.user_id = cfg.u) perm ON true
  -- Step 5 evidence: the live account statement on any member of the duplicate cluster (the cluster is one subject). A first-person
  -- statement outranks an agent paraphrase; newest first.
  LEFT JOIN LATERAL (
    SELECT o.id, o.content_text, o.sd AS structured_data, o.fp AS first_person, o.vehicle_id AS stmt_vid
      FROM stm o WHERE o.vehicle_id = ANY (cl.members)
     ORDER BY o.fp DESC, o.observed_at DESC NULLS LAST, o.ingested_at DESC, o.id::text LIMIT 1) obs ON true
  -- Statement recency: the newest CITED dispute (any speaker) and the newest first-person ownership statement (not itself a dispute or a
  -- denial) of the cluster. A first-person ownership statement observed AFTER the dispute supersedes it; an older one does not.
  LEFT JOIN LATERAL (
    SELECT o.id, o.observed_at, o.vehicle_id FROM stm o
     WHERE o.vehicle_id = ANY (cl.members) AND o.disputed_flag AND o.cited
     ORDER BY o.observed_at DESC NULLS LAST, o.ingested_at DESC, o.id::text LIMIT 1) dsp ON true
  LEFT JOIN LATERAL (
    SELECT o.id, o.observed_at, o.vehicle_id FROM stm o
     WHERE o.vehicle_id = ANY (cl.members) AND o.fp AND 'owner_current' = ANY (o.roles) AND NOT o.denied_flag AND NOT o.disputed_flag
     ORDER BY o.observed_at DESC NULLS LAST, o.ingested_at DESC, o.id::text LIMIT 1) ows ON true
  -- Step 1 evidence: the account's photos; capture facts count only for own-device photos.
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, count(*) FILTER (WHERE p.own) AS n_own, count(*) FILTER (WHERE p.origin) AS n_origin,
           count(*) FILTER (WHERE p.unk) AS n_unk, count(*) FILTER (WHERE p.scraped_match IS NOT NULL) AS n_scraped,
           count(*) FILTER (WHERE p.imp) AS n_imp, count(*) FILTER (WHERE p.has_fact) AS n_fact,
           (SELECT jsonb_agg(e.c) FROM (SELECT p2.imp_cite AS c FROM pp p2 WHERE p2.vid = ANY (cl.members) AND p2.imp
                                         ORDER BY (p2.imp_cite->>'via') IS NULL, p2.id LIMIT 3) e) AS imp_cites,
           (jsonb_agg(p.scraped_match ORDER BY p.id) FILTER (WHERE p.scraped_match IS NOT NULL))->0 AS scraped_cite,
           min(p.t) FILTER (WHERE p.own) AS first_t, max(p.t) FILTER (WHERE p.own) AS last_t,
           count(*) FILTER (WHERE p.own AND p.lat IS NOT NULL AND p.lon IS NOT NULL) AS gps_n,
           count(*) FILTER (WHERE p.own AND p.lat IS NOT NULL AND p.lon IS NOT NULL
                              AND p.t >= now() - make_interval(months => cfg.months)) AS recent_gps_n,
           count(DISTINCT p.dev) FILTER (WHERE p.own) AS devices,
           (SELECT jsonb_object_agg(q.vid, jsonb_build_object('photos', q.n, 'own_device', q.n_own))
              FROM (SELECT p3.vid, count(*) AS n, count(*) FILTER (WHERE p3.own) AS n_own FROM pp p3
                     WHERE p3.vid = ANY (cl.members) GROUP BY p3.vid) q) AS by_member
      FROM pp p WHERE p.vid = ANY (cl.members)) ph ON true
  LEFT JOIN LATERAL (
    SELECT max(o.observed_at) AS t FROM vehicle_observations o
     WHERE o.vehicle_id = ANY (cl.members) AND o.submitted_by_user_id = cfg.u) ol ON true
  -- Step 2 evidence: listings and the (duplicate-collapsed) organization their seller resolves to.
  LEFT JOIN LATERAL (
    SELECT (array_agg(x.org ORDER BY x.conf DESC, x.org::text))[1] AS org_id, max(x.conf) AS org_conf,
           count(DISTINCT x.org) AS n_orgs,
           jsonb_agg(jsonb_build_object('source', x.src, 'organization_id', x.org, 'as_listed', x.listed_org,
                                        'confidence', x.conf, 'ref', x.ref, 'member_vehicle_id', x.vid)
                          ORDER BY x.conf DESC, x.src, x.org::text, x.vid::text) AS srcs
      FROM lsc x WHERE x.vid = ANY (cl.members)) org ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('listing_id', ml.listing_id, 'score', ml.score, 'signals', to_jsonb(ml.sigs), 'member_vehicle_id', ml.vid)
                     ORDER BY ml.score DESC, ml.listing_id::text, ml.vid::text) AS matches
      FROM ml WHERE ml.vid = ANY (cl.members)) mt ON true
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
         g2.dsp_id IS NOT NULL AND g2.ows_id IS NOT NULL AND g2.ows_t > g2.dsp_t AS dsp_sup,
         coalesce(g2.photos, 0) AS n_photos,
         coalesce(g2.n_own, 0) AS own_n,
         coalesce(g2.n_imp, 0) AS imp_n,
         greatest(g2.last_t, g2.obs_last) AS act_last
  FROM g2
),
g4 AS MATERIALIZED (
  SELECT g3.*,
         -- a cited dispute stands unless a newer first-person ownership statement supersedes it
         g3.dsp_id IS NOT NULL AND NOT g3.dsp_sup AS disputed,
         (g3.denied_raw OR g3.disputed_raw) AND NOT g3.cited AS uncited_ignored,
         g3.act_last IS NOT NULL AND g3.act_last < now() - make_interval(months => g3.months) AS decayed,
         g3.own_n > 0 OR (g3.n_photos > 0 AND g3.obs_id IS NOT NULL) AS doc_ok,
         g3.n_photos > 0 AND g3.imp_n * 2 > g3.n_photos AS pred_imp,
         coalesce(g3.src_listing, false) AND g3.n_photos > 0 AND coalesce(g3.n_fact, 0) = 0 AS src_imp,
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
         so.tb_decided, so.s_orgs, so.s_cooc, so.s_okind, so.s_sm, so.s_sx, so.s_vkind, so.s_scites, so.s_sagg, so.s_sdrop, so.s_pmc, pd.cites AS s_pmd,
         st.n_sess, st.span_days, st.n_days, st.n_months, st.geo_n, st.at_any_org,
         (SELECT count(*) FROM orgmap om WHERE om.canon = so.s_org AND om.org_id <> om.canon) AS s_aliases
  FROM g4
  LEFT JOIN st ON st.vid = g4.vid
  LEFT JOIN pmd pd ON pd.vid = g4.vid
  LEFT JOIN LATERAL (
    SELECT q.canon AS s_org, q.n_at, q.min_m, q.ov_rel, q.listed AS s_listed, q.cooc AS s_cooc,
           q.cnt - 1 AS s_other,
           -- decided by session co-occurrence (c) or by scene + organization kind (a + b); each must not be contradicted by the
           -- other, and an organization whose kind contradicts the scene never wins a tie
           (NOT q.sx AND ((q.cooc > q.next_cooc AND q.sm >= q.next_sm)
                          OR (q.cooc = q.next_cooc AND (q.sm > q.next_sm OR (q.sm = q.next_sm AND q.bt < q.next_bt))))) AS tb_decided,
           q.orgs AS s_orgs, q.okind AS s_okind, q.sm AS s_sm, q.sx AS s_sx, q.vkind AS s_vkind, q.scites AS s_scites, q.sagg AS s_sagg, q.sdrop AS s_sdrop, q.pmc AS s_pmc
      FROM (SELECT t.canon, t.n_at, t.min_m, t.ov_rel, (t.canon IS NOT DISTINCT FROM g4.org_id) AS listed,
                   coalesce(cc.n, 0) AS cooc, z.sm, z.sx, o.okind, ek.kind AS vkind, ek.cites AS scites, ek.agg AS sagg, vs.dropped_cites AS sdrop, pm.cites AS pmc,
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
              LEFT JOIN sorg sg ON sg.vid = t.vid AND sg.canon = t.canon
              LEFT JOIN pmagg pm ON pm.vid = t.vid AND pm.canon = t.canon
              -- scene aggregate for this organization: the vote of the sessions photographed there, else the vehicle-wide vote
              CROSS JOIN LATERAL (SELECT CASE WHEN sg.vid IS NOT NULL THEN sg.kind ELSE vs.kind END AS kind,
                                         CASE WHEN sg.vid IS NOT NULL THEN sg.cites ELSE vs.cites END AS cites,
                                         CASE WHEN sg.vid IS NOT NULL THEN jsonb_build_object('scope', 'organization', 'organization_id', t.canon,
                                                'kind', sg.kind, 'dealer_weight', sg.wd, 'shop_weight', sg.ws)
                                              WHEN vs.vid IS NOT NULL THEN jsonb_build_object('scope', 'vehicle', 'kind', vs.kind,
                                                'dealer_weight', vs.wd, 'shop_weight', vs.ws) END AS agg) ek
              -- a usable place match at this organization (sm = 2) outranks the generic scene kind (sm = 1) and is never contradicted by it
              CROSS JOIN LATERAL (SELECT CASE WHEN pm.vid IS NOT NULL THEN 2 WHEN ek.kind IS NOT NULL AND o.okind = ek.kind THEN 1 ELSE 0 END AS sm,
                                         (pm.vid IS NULL AND ek.kind IS NOT NULL AND o.okind IS NOT NULL AND o.okind <> ek.kind) AS sx) z
             WHERE t.vid = g4.vid
            WINDOW w AS (ORDER BY (t.canon IS NOT DISTINCT FROM g4.org_id) DESC, t.ov_rel DESC, coalesce(cc.n, 0) DESC, z.sm DESC,
                                  CASE WHEN g4.v_listed THEN o.bt_rank ELSE 2 END, t.n_at DESC, t.min_m, t.canon::text)) q
     WHERE q.rn = 1) so ON true
),
-- Scene context also applies to a single organization in range: a scene whose kind contradicts the organization's kind (a dealer
-- lot at a shop-only organization) withholds the GPS attribution to it (cited as attribution_withheld_by_scene); an organization
-- that lists or is linked to the vehicle keeps its attribution (a listing outranks a model label); a matching scene supports it.
g5w AS (
  SELECT g5.*, g5.s_org IS NOT NULL AND coalesce(g5.s_sx, false) AND NOT (coalesce(g5.s_listed, false) OR coalesce(g5.s_rel, false)) AS scene_w,
         pa.cites AS pa_cites, pa.orgs AS pa_orgs, pa.aggs AS pa_aggs, aw.span AS away_span,
         sh.canon AS cust_org, sh.n_sess AS cust_n, sh.cites AS cust_cites, sh.wd AS cust_wd, sh.ws AS cust_ws, ac.span AS cust_away,
         sq.dealer_org AS seq_dealer, sq.shop_org AS seq_shop, sq.n_sess AS seq_n, sq.first_t AS seq_first_t, sq.cites AS seq_cites,
         sq.src AS seq_src, sq.ref AS seq_ref, sq.dt AS seq_dt, sd.dorgs AS cust_dorgs
  FROM g5 LEFT JOIN pa ON pa.vid = g5.vid LEFT JOIN away aw ON aw.vid = g5.vid
  LEFT JOIN shopc sh ON sh.vid = g5.vid LEFT JOIN awayc ac ON ac.vid = g5.vid
  LEFT JOIN seqx sq ON sq.vid = g5.vid LEFT JOIN shopd sd ON sd.vid = g5.vid
),
g6 AS (
  SELECT g5w.*,
         g5w.s_org IS NOT NULL AND NOT g5w.scene_w AND g5w.n_sess <= g5w.r_max_s AND g5w.span_days <= g5w.r_max_span
           AND g5w.own_n >= g5w.r_min_ph AND g5w.geo_n >= g5w.r_min_geo * g5w.own_n AND g5w.s_n_at = g5w.geo_n AS shoot,
         g5w.span_days >= g5w.r_pers_span AND g5w.geo_n - g5w.at_any_org > 0 AS personal,
         -- pre-auction inventory: a dealer scene at a dealer / consignor organization and no own long-term pattern of the account
         g5w.pa_cites IS NOT NULL AND NOT (g5w.span_days >= g5w.r_pers_span AND g5w.geo_n - g5w.at_any_org > 0)
           AND coalesce(g5w.away_span, 0) <= g5w.r_max_span AS pre_auc,
         -- shop custody: >= 2 shop-scene sessions at one shop organization, unless the vehicle's own-device photos at places within range of no
         -- organization span more than the shop-shoot window (a long-term personal pattern)
         g5w.cust_org IS NOT NULL AND coalesce(g5w.cust_away, 0) <= g5w.r_max_span AS custody,
         -- shop-then-dealer sequence: shop-scene sessions, then a later dealer-organization listing (the dealer is the custodian, the shop the work provider)
         g5w.seq_dealer IS NOT NULL AS seq,
         -- shop custody would fire but a dealer-kind organization is in range of the same shop scenes as well
         g5w.cust_org IS NOT NULL AND coalesce(g5w.cust_away, 0) <= g5w.r_max_span AND cardinality(coalesce(g5w.cust_dorgs, '{}'::uuid[])) > 0 AS cust_amb,
         g5w.s_org IS NOT NULL AND g5w.s_other > 0 AND NOT (g5w.s_listed OR g5w.s_rel) AND NOT coalesce(g5w.tb_decided, false) AS amb
  FROM g5w
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
      WHEN g6.disputed THEN jsonb_build_array('claimed_interest', 0.6, 'cited dispute')
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
      -- shop work first, dealer listing later: the dealer organization holds the vehicle (custodian); the shop is the work provider. Above the
      -- organization-listing rungs, since the dealer listing is what makes this vehicle organization-listed
      WHEN g6.seq
        THEN jsonb_build_array('business_handling', 0.6, 'pre-auction inventory: shop-scene sessions at a shop organization (work provider) before the vehicle was listed by a dealer organization (custodian)', 'pre_auction_inventory')
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
      -- below listing, title and statement evidence (all above): inventory photographed on a dealer lot / showroom before its listing
      WHEN g6.pre_auc
        THEN jsonb_build_array('business_handling', 0.6, 'pre-auction inventory: own-device photos on a dealer lot / showroom at a dealer or consignor organization; no listing, title or statement; no long-term pattern', 'pre_auction_inventory')
      -- below listing, title and statement evidence (all above): the vehicle was in a shop's custody (client work), even if the photos are not shoot-shaped
      WHEN g6.cust_amb
        THEN jsonb_build_array('contributor', 0.2, 'contributor: org_ambiguous, shop scenes in range of both a shop and a dealer organization and no later dealer listing; not ownership', 'org_ambiguous')
      WHEN g6.custody
        THEN jsonb_build_array('business_handling', 0.6, 'shop custody: shop-interior / upholstery / paint scenes in ' || g6.cust_n || ' sessions at a shop organization; client work, not ownership', 'shop_custody')
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
    CASE WHEN g6.s_org IS NULL OR g6.scene_w THEN NULL
         ELSE (CASE WHEN g6.shoot THEN (CASE WHEN g6.s_listed THEN 0.7 ELSE 0.5 END) ELSE 0.15 END)
              * (CASE WHEN g6.amb THEN 0.5 ELSE 1 END) END AS s_conf
  FROM g6
)
SELECT m.vid AS vehicle_id,
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
         'sub_reason', h.d->>3,
         'custodian_organization_id', CASE WHEN h.seq THEN h.seq_dealer END,
         'work_provider', CASE WHEN h.seq THEN jsonb_build_object('organization_id', h.seq_shop, 'sessions', h.seq_cites) END,
         -- duplicate cluster: the members are ONE subject here (never merged); every member row carries the same derived role and the
         -- evidence of all members, each item saying which member it came from
         'cluster', CASE WHEN cardinality(h.members) > 1 THEN jsonb_build_object(
             'key', h.vid, 'members', to_jsonb(h.members), 'this_member', m.vid,
             'evidence_from', jsonb_build_object(
               'title_verification_vehicle_id', h.ver_vid, 'statement_vehicle_id', h.stmt_vid,
               'listing_member_vehicle_ids', (SELECT coalesce(jsonb_agg(DISTINCT e->>'member_vehicle_id'), '[]'::jsonb) FROM jsonb_array_elements(coalesce(h.srcs, '[]'::jsonb)) e),
               'photos_by_member', coalesce(h.by_member, '{}'::jsonb)),
             'review_pairs_joined', (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM rvc, jsonb_array_elements(rvc.cites) e
                                      WHERE rvc.ck = h.vid AND (e->>'joined')::boolean)) END,
         'duplicate_review', (SELECT rvc.cites FROM rvc WHERE rvc.ck = h.vid),
         'flags', CASE WHEN h.amb OR h.d->>3 = 'org_ambiguous' THEN '["org_ambiguous"]'::jsonb ELSE '[]'::jsonb END,
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
             'evidence', jsonb_build_object('organization_id', CASE WHEN h.scene_w THEN NULL ELSE h.s_org END,
               'withheld_organization_id', CASE WHEN h.scene_w THEN h.s_org END, 'distance_m', h.s_m,
               'pattern', CASE WHEN h.shoot THEN 'shop_shoot' WHEN h.personal THEN 'long_term_personal'
                               WHEN h.s_org IS NOT NULL AND NOT h.scene_w THEN 'at_organization' END,
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
                 'scene_matches_organization', h.s_sm >= 1, 'scene_supports_organization', coalesce(h.s_sm >= 1, false),
                 'place_matched_organization', coalesce(h.s_sm = 2, false), 'place_matches', coalesce(h.s_pmc, '[]'::jsonb),
                 'place_match_decisions', coalesce(h.s_pmd, '[]'::jsonb),
                 'scene_contradicts_organization', coalesce(h.s_sx, false), 'attribution_withheld_by_scene', coalesce(h.scene_w, false),
                 'aggregate', h.s_sagg, 'vote_rule', 'photo-weighted, sessions below confidence 0.6 and outdoor_street / other dropped, 2:1 majority',
                 'dropped_sessions', coalesce(h.s_sdrop, '[]'::jsonb),
                 'sessions', coalesce(h.s_scites, '[]'::jsonb)), 'organizations', to_jsonb(h.s_orgs),
               'pre_auction', jsonb_build_object('conditions_met', coalesce(h.pre_auc, false), 'decides', coalesce(h.d->>3 = 'pre_auction_inventory', false),
                 'organizations', to_jsonb(h.pa_orgs), 'scenes', coalesce(h.pa_cites, '[]'::jsonb), 'aggregates', coalesce(h.pa_aggs, '[]'::jsonb),
                 'own_pattern_outside_organization_days', round(h.away_span::numeric, 1), 'long_term_personal', coalesce(h.personal, false)),
               'sequence', jsonb_build_object('conditions_met', coalesce(h.seq, false), 'decides', coalesce(h.seq AND h.d->>3 = 'pre_auction_inventory', false),
                 'custodian_organization_id', h.seq_dealer,
                 'work_provider', CASE WHEN h.seq THEN jsonb_build_object('organization_id', h.seq_shop, 'sessions', h.seq_cites, 'session_count', h.seq_n,
                                                                         'first_session_photo_at', h.seq_first_t) END,
                 'listing', CASE WHEN h.seq THEN jsonb_build_object('source', h.seq_src, 'ref', h.seq_ref, 'date', h.seq_dt) END),
               'shop_custody', jsonb_build_object(
                 'ambiguous_organizations', CASE WHEN h.cust_amb THEN to_jsonb(array_prepend(h.cust_org, h.cust_dorgs)) END,
                 'conditions_met', coalesce(h.custody, false), 'decides', coalesce(h.d->>3 = 'shop_custody', false),
                 'organization_id', h.cust_org, 'sessions', coalesce(h.cust_cites, '[]'::jsonb), 'session_count', h.cust_n,
                 'aggregate', CASE WHEN h.cust_org IS NOT NULL THEN jsonb_build_object('scope', 'organization', 'kind', 'shop', 'dealer_weight', h.cust_wd, 'shop_weight', h.cust_ws) END,
                 'own_pattern_outside_organizations_days', round(h.cust_away::numeric, 1), 'long_term_personal_exception', h.cust_org IS NOT NULL AND NOT coalesce(h.custody, false)),
               'recent_photos', coalesce(h.recent_gps_n, 0) > 0,
               'hypothesis', CASE WHEN h.shoot THEN 'shop shoot at organization'
                                  WHEN h.s_org IS NOT NULL AND NOT h.scene_w THEN 'photographed at organization' END,
               'decides', coalesce(h.shoot, false)),
             'eliminated', '[]'::jsonb),
           jsonb_build_object('step', 4, 'name', 'titles', 'confidence', CASE WHEN h.ver_id IS NOT NULL THEN 0.98 END,
             'evidence', jsonb_build_object('title_verification_id', h.ver_id,
               'conflict_with_organization_listing', h.ver_id IS NOT NULL AND h.org_id IS NOT NULL,
               'title_verification_vehicle_id', h.ver_vid),
             'eliminated', CASE WHEN h.ver_id IS NOT NULL
               THEN '["owner_reported","contributor","documenting","previously_documented","profile_record","imported_by_user"]'::jsonb
               ELSE '["owner_verified","co_owner_verified"]'::jsonb END),
           jsonb_build_object('step', 5, 'name', 'account_statements',
             'confidence', CASE WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL THEN (h.d->>1)::numeric END,
             'evidence', jsonb_build_object('observation_id', h.obs_id, 'statement_vehicle_id', h.stmt_vid,
               'statement_from_duplicate', h.stmt_vid IS NOT NULL AND h.stmt_vid <> m.vid, 'roles', to_jsonb(h.roles), 'cited', h.cited,
               'first_person', h.first_person,
               'intake_actor', h.structured_data->>'intake_actor',
               'uncited_downgrade_ignored', h.uncited_ignored, 'long_tenure', h.tenure, 'title_denied', h.title_denied,
               'dispute', CASE WHEN h.dsp_id IS NOT NULL THEN jsonb_build_object('observation_id', h.dsp_id, 'observed_at', h.dsp_t,
                   'vehicle_id', h.dsp_vid, 'superseded', h.dsp_sup, 'superseded_by_observation_id', CASE WHEN h.dsp_sup THEN h.ows_id END) END,
               'ownership_statement', CASE WHEN h.ows_id IS NOT NULL THEN jsonb_build_object('observation_id', h.ows_id,
                   'observed_at', h.ows_t, 'vehicle_id', h.ows_vid, 'first_person', true) END),
             'eliminated', CASE WHEN h.uncited_ignored THEN '["claimed_interest"]'::jsonb
                                WHEN h.obs_id IS NOT NULL AND h.ver_id IS NULL AND h.d->>0 IN ('owner_reported','previously_owned')
                                  THEN '["contributor","documenting","profile_record","imported_by_user"]'::jsonb
                                ELSE '[]'::jsonb END))
       ) AS evidence,
       (h.d->>2) || CASE WHEN notes.t <> '' THEN ' (' || notes.t || ')' ELSE '' END AS reason,
       ARRAY(SELECT x.i FROM (SELECT u.i, min(u.o) AS o FROM unnest(ARRAY[h.obs_id, h.ver_id, h.dsp_id, h.ows_id]) WITH ORDINALITY u(i, o)
                               WHERE u.i IS NOT NULL GROUP BY u.i) x ORDER BY x.o) AS evidence_ids,
       h.ver_id AS title_verification_id,
       CASE WHEN h.own_n > 0 THEN h.first_t END AS documented_from,
       CASE WHEN h.own_n > 0 THEN h.last_t END AS documented_to
FROM h
JOIN clm m ON m.ck = h.vid
JOIN cand c0 ON c0.vid = m.vid
LEFT JOIN cur ON cur.vid = m.vid
CROSS JOIN LATERAL (SELECT concat_ws('; ',
    CASE WHEN h.self_granted THEN 'self-granted permission ignored' END,
    CASE WHEN h.uncited_ignored THEN 'uncited downgrade ignored' END,
    CASE WHEN h.dsp_sup THEN 'cited dispute ' || h.dsp_id || ' superseded by the newer first-person ownership statement ' || h.ows_id END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NULL AND 'owner_current' = ANY (h.roles)
         THEN 'owner statement set aside: listing shows organization inventory' END,
    CASE WHEN h.org_id IS NOT NULL AND h.ver_id IS NOT NULL THEN 'CONFLICT: title verification vs organization listing' END,
    CASE WHEN h.org_id IS NOT NULL AND h.personal THEN 'long-term personal photo pattern conflicts with organization listing' END,
    CASE WHEN h.amb THEN 'more than one organization in range of the photos: ' || array_to_string(h.s_orgs, ', ') END,
    CASE WHEN h.stmt_vid IS NOT NULL AND h.stmt_vid <> m.vid THEN 'statement taken from duplicate vehicle ' || h.stmt_vid END,
    CASE WHEN coalesce(h.n_orgs, 0) > 1 THEN 'listings name more than one organization' END) AS t) notes
ORDER BY m.vid;
