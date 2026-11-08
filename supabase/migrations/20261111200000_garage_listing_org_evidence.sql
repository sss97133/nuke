-- Listing->vehicle matches, seller derivations, duplicate-organization aliases, shop-shoot vs long-term-own, own-device
-- photos, statement precedence. Everything is additive and reversible; generic rules only (no vehicle id, user label or
-- organization name is an input).
--  1 listing_vehicle_matches        proposals (listing -> vehicle, score, signals) from match_bat_listings_to_vehicles();
--                                   append-only (supersede, never edit). VIN / chassis / URL are strong, lot alone is weak, a
--                                   title (year + make + model family) is weak and counts only when unique in the candidate pool.
--  2 listing_seller_derivations     seller handle read from raw_data / the linked or matched vehicle's snapshot, per listing;
--                                   bat_listings is never written. derive_listing_sellers() fills it.
--  3 organization_aliases           duplicate organizations (normalized name, website host, GPS within 100 m) proposed by
--                                   propose_organization_aliases(); a pair is applied by the chain only when name or website
--                                   agrees (score >= 0.6); GPS alone (0.3) is a candidate, never an alias. organizations is not edited.
--  4 derive_vehicle_relationships   body generated from supabase/sql/derive_vehicle_relationships_preview.sql (see its header
--                                   for the ordered chain). New role 'imported_by_user' (zero own-device photos, no org link, no
--                                   title, no statement); get_user_garage hides it. The chain computes matches and aliases inline
--                                   from base tables, so the preview and the function never depend on the three tables above.
--  6 own_origin_source              the one list of photo sources / paths that are the account's own library or upload (scrapers are not)
--  7 parse_owner_statement, record_owner_statement   first-person chat statements stored as owner_statement_v1 testimony
--  8 listing_detail_enrichments     lot / chassis / seller / title read from public listing pages (append-only); the matcher uses it
--  9 vehicle_photo_session_scenes   per photo session scene label from a vision model (dealer_lot, showroom, shop_interior,
--                                   upholstery_work, paint_body, outdoor_street, other); append-only. The chain reads it (through
--                                   the scene_labels placeholder CTE, like inline_stmts): breaks an organization tie when scene +
--                                   organization kind agree, supports a single organization whose kind matches, withholds the GPS
--                                   attribution when the kind contradicts (unless the organization lists / is linked to the vehicle);
--                                   nothing in the function reads this table yet (scripts/garage/label-scenes.mjs fills it).
--    Duplicate clusters (high-score duplicate pairs, or the same file / title document on same-year, same-family vehicles) are
--    derived as ONE subject: evidence is unioned across members, every member row keeps its vehicle_id and gets the same role;
--    evidence.cluster cites the members. Records are never merged.
--    Also in the chain: import provenance for user photos (download / screenshot / web-export / hash match to a listing scrape),
--    hist_listings placeholder (listings read from public seller pages), organization kind for the tie-break.
--  5 garage_shop_shoot_rules        platform_config row with the shoot / personal-pattern thresholds; change the row, not the code.
-- Rollback: re-apply 20261111180000's function body and 20261111170000's reader, restore the old role CHECK, then
--   DROP FUNCTION match_bat_listings_to_vehicles, derive_listing_sellers, propose_organization_aliases;
--   DROP TABLE listing_vehicle_matches, listing_seller_derivations, organization_aliases, vehicle_photo_session_scenes; DROP FUNCTION derived_rows_append_only;
--   DELETE FROM platform_config WHERE config_key = 'garage_shop_shoot_rules'. Derivation rows are superseded, never deleted.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.platform_config(config_key, config_value, description)
VALUES ('garage_shop_shoot_rules',
        '{"org_radius_m": 60, "session_gap_hours": 2, "max_sessions": 2, "max_span_days": 30, "min_photos": 5, "min_geotag_share": 0.8, "personal_span_days": 365}',
        'Thresholds for telling a shop shoot (few dense sessions at an organization) from long-term personal capture (derive_vehicle_relationships step 3).')
ON CONFLICT (config_key) DO NOTHING;

CREATE FUNCTION public.derived_rows_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only: supersede, never delete', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by' - 'superseded_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by' - 'superseded_reason') THEN
    RAISE EXCEPTION '% is append-only: only an active row can be superseded', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TABLE public.listing_vehicle_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  score numeric NOT NULL CHECK (score >= 0 AND score <= 1),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  signals jsonb NOT NULL,
  run_id uuid NOT NULL,
  producer_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text
);
CREATE UNIQUE INDEX listing_vehicle_matches_active ON public.listing_vehicle_matches(listing_id, vehicle_id) WHERE superseded_at IS NULL;
CREATE INDEX listing_vehicle_matches_vehicle ON public.listing_vehicle_matches(vehicle_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.listing_vehicle_matches IS
  'Proposed bat_listings -> vehicles links with score and cited signals (url, vin, chassis, lot, title). Append-only; a proposal never edits bat_listings. Written by match_bat_listings_to_vehicles.';

CREATE TABLE public.listing_seller_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  seller_username text NOT NULL CHECK (seller_username = lower(btrim(seller_username)) AND seller_username <> ''),
  source text NOT NULL,
  vehicle_id uuid,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  run_id uuid NOT NULL,
  producer_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text
);
CREATE UNIQUE INDEX listing_seller_derivations_active ON public.listing_seller_derivations(listing_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.listing_seller_derivations IS
  'Seller handle derived for a bat_listings row whose seller_username is empty (raw_data, linked or matched vehicle snapshot). bat_listings is not overwritten. Written by derive_listing_sellers.';

CREATE TABLE public.organization_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_org_id uuid NOT NULL,
  canonical_org_id uuid NOT NULL,
  score numeric NOT NULL CHECK (score >= 0 AND score <= 1),
  signals jsonb NOT NULL,
  run_id uuid NOT NULL,
  producer_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text,
  CHECK (alias_org_id <> canonical_org_id)
);
CREATE UNIQUE INDEX organization_aliases_active ON public.organization_aliases(alias_org_id, canonical_org_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.organization_aliases IS
  'Organizations that are probably the same business (normalized name, website host, GPS within 100 m). score >= 0.6 means name or website agrees; 0.3 is GPS alone (a candidate, not an alias). organizations rows are never edited. Written by propose_organization_aliases.';

-- Detail-page enrichment of public listings (scripts/garage/enrich-bat-listing.mjs). Append-only; bat_listings is never
-- written. The matcher reads the newest active row: chassis / VIN, lot, seller handle (lowercased), title.
CREATE TABLE public.listing_detail_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid,
  listing_url text NOT NULL,
  lot_number text,
  chassis text CHECK (chassis IS NULL OR chassis = upper(btrim(chassis))),
  seller_username text CHECK (seller_username IS NULL OR seller_username = lower(btrim(seller_username))),
  title text,
  http_status integer,
  content_sha256 text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL,
  producer_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text
);
CREATE UNIQUE INDEX listing_detail_enrichments_active ON public.listing_detail_enrichments(listing_url) WHERE superseded_at IS NULL;
CREATE INDEX listing_detail_enrichments_listing ON public.listing_detail_enrichments(listing_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.listing_detail_enrichments IS
  'Lot, chassis/VIN, seller handle and title read from a public listing detail page. Append-only (supersede, never edit); bat_listings is not overwritten. Written by scripts/garage/enrich-bat-listing.mjs.';

-- Scene label of one photo session of one vehicle, produced by a vision model from sample images of the session (run_id
-- groups one labelling run). Testimony of the model, not a fact about the world: model, confidence and rationale are kept.
CREATE TABLE public.vehicle_photo_session_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  session_key text NOT NULL,
  image_ids uuid[] NOT NULL DEFAULT '{}',
  scene_label text NOT NULL CHECK (scene_label IN ('dealer_lot', 'showroom', 'shop_interior', 'upholstery_work', 'paint_body', 'outdoor_street', 'other')),
  model text NOT NULL,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text,
  UNIQUE (run_id, vehicle_id, session_key)
);
CREATE INDEX vehicle_photo_session_scenes_vehicle ON public.vehicle_photo_session_scenes(vehicle_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.vehicle_photo_session_scenes IS
  'Scene label (dealer_lot, showroom, shop_interior, upholstery_work, paint_body, outdoor_street, other) a vision model gave to one capture session of one vehicle (session_key = the session''s first image id or start time; image_ids = the images shown), with model, confidence and rationale. Append-only (supersede, never edit). Read by derive_vehicle_relationships only to break an organization tie, together with the organization''s business kind; scene alone never decides a role.';

DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listing_vehicle_matches', 'listing_seller_derivations', 'organization_aliases', 'listing_detail_enrichments', 'vehicle_photo_session_scenes'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.derived_rows_append_only()', t || '_append_only', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$t$;

-- Proposals: listing -> vehicle. Dry run by default; the pool for title-only matches is the account's vehicles (p_user) or,
-- with no account, vehicles whose recorded seller is the listing's seller. Unmatched listings stay unmatched.
CREATE FUNCTION public.match_bat_listings_to_vehicles(
  p_limit integer DEFAULT 500, p_user uuid DEFAULT NULL, p_run_id uuid DEFAULT gen_random_uuid(), p_dry_run boolean DEFAULT true)
RETURNS TABLE(listing_id uuid, vehicle_id uuid, score numeric, signals jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  r record; v_prev uuid; v_prev_score numeric; v_prev_sig jsonb; v_new uuid;
  v_ver constant text := 'match_bat_listings_to_vehicles/1';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  p_limit := least(greatest(coalesce(p_limit, 500), 1), 20000);
  FOR r IN
    WITH ul AS MATERIALIZED (
      SELECT bl.id AS lid,
             regexp_replace(regexp_replace(lower(btrim(coalesce(bl.bat_listing_url, ''))), '[?#].*$', ''), '/+$', '') AS u,
             upper(regexp_replace(coalesce(bl.raw_data->>'vin', bl.raw_data->>'VIN', ''), '[^A-Za-z0-9]', '', 'g')) AS vin,
             upper(regexp_replace(coalesce(bl.raw_data->>'chassis', bl.raw_data->>'chassis_number', en.chassis, ''), '[^A-Za-z0-9]', '', 'g')) AS chassis,
             nullif(btrim(coalesce(bl.bat_lot_number::text, en.lot_number)), '') AS lot,
             (regexp_match(coalesce(bl.bat_listing_title, en.title, ''), '\m(19[0-9]{2}|20[0-4][0-9])\M'))[1]::int AS ty,
             btrim(regexp_replace(lower(coalesce(bl.bat_listing_title, en.title, '')), '[^a-z0-9]+', ' ', 'g')) AS tl,
             lower(btrim(coalesce(nullif(btrim(bl.seller_username), ''), bl.raw_data->>'seller_username', bl.raw_data->>'seller',
                                  en.seller_username))) AS seller
        FROM bat_listings bl
        LEFT JOIN LATERAL (SELECT e.chassis, e.lot_number, e.title, e.seller_username FROM listing_detail_enrichments e
                            WHERE e.superseded_at IS NULL AND e.listing_id = bl.id ORDER BY e.created_at DESC LIMIT 1) en ON true
       WHERE bl.vehicle_id IS NULL
       ORDER BY bl.scraped_at DESC NULLS LAST, bl.id
       LIMIT p_limit
    ),
    cv AS MATERIALIZED (
      SELECT v.id AS vid, v.year, lower(btrim(v.make)) AS make, normalize_vehicle_model_family(v.model) AS fam,
             upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g')) AS vin,
             upper(regexp_replace(coalesce(v.origin_metadata->'bat_snapshot_parsed'->>'chassis', v.origin_metadata->>'chassis', ''),
                   '[^A-Za-z0-9]', '', 'g')) AS chassis,
             nullif(btrim(coalesce(v.origin_metadata->'bat_snapshot_parsed'->>'lot_number', v.origin_metadata->>'lot_number')), '') AS lot,
             lower(btrim(coalesce(nullif(btrim(v.bat_seller), ''), v.origin_metadata->'bat_snapshot_parsed'->>'seller_username'))) AS seller,
             ARRAY(SELECT DISTINCT regexp_replace(regexp_replace(lower(btrim(u.x)), '[?#].*$', ''), '/+$', '')
                     FROM unnest(ARRAY[v.bat_auction_url, v.listing_url, v.origin_metadata->>'bat_auction_url',
                                       v.origin_metadata->>'listing_url', v.origin_metadata->>'url']) u(x)
                    WHERE nullif(btrim(u.x), '') IS NOT NULL) AS urls
        FROM vehicles v
       WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
         AND (p_user IS NULL OR v.user_id = p_user
              OR EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.user_id = p_user))
    ),
    mm AS (
      SELECT ul.lid, cv.vid, 'url' AS sig FROM ul JOIN cv ON ul.u <> '' AND ul.u = ANY (cv.urls)
      UNION ALL
      SELECT ul.lid, cv.vid, 'vin' FROM ul JOIN cv ON length(cv.vin) >= 9 AND cv.vin IN (ul.vin, ul.chassis)
      UNION ALL
      SELECT ul.lid, cv.vid, 'chassis' FROM ul JOIN cv ON length(cv.chassis) >= 6 AND cv.chassis IN (ul.vin, ul.chassis)
      UNION ALL
      SELECT ul.lid, cv.vid, 'lot' FROM ul JOIN cv ON ul.lot IS NOT NULL AND ul.lot = cv.lot
      UNION ALL
      SELECT t.lid, t.vid, 'title' FROM (
        SELECT ul.lid, cv.vid, count(*) OVER (PARTITION BY ul.lid) AS n_title
          FROM ul JOIN cv ON ul.ty = cv.year AND cv.make <> '' AND cv.fam IS NOT NULL
           AND (p_user IS NOT NULL OR (ul.seller IS NOT NULL AND ul.seller = cv.seller))
           AND strpos(' ' || ul.tl || ' ', ' ' || cv.make || ' ') > 0
           AND strpos(' ' || ul.tl || ' ', ' ' || btrim(regexp_replace(cv.fam, '[^a-z0-9]+', ' ', 'g')) || ' ') > 0) t
       WHERE t.n_title = 1
    )
    SELECT mm.lid, mm.vid, array_agg(DISTINCT mm.sig ORDER BY mm.sig) AS sigs,
           CASE WHEN bool_or(mm.sig IN ('url', 'vin')) THEN 0.95
                WHEN bool_or(mm.sig = 'chassis') THEN 0.85
                WHEN bool_or(mm.sig = 'lot') AND bool_or(mm.sig = 'title') THEN 0.80
                WHEN bool_or(mm.sig = 'lot') THEN 0.60
                ELSE 0.35 END AS sc
      FROM mm GROUP BY mm.lid, mm.vid
     ORDER BY 4 DESC, 1, 2
  LOOP
    IF NOT p_dry_run THEN
      SELECT m.id, m.score, m.signals INTO v_prev, v_prev_score, v_prev_sig FROM listing_vehicle_matches m
       WHERE m.listing_id = r.lid AND m.vehicle_id = r.vid AND m.superseded_at IS NULL;
      IF v_prev IS NULL OR v_prev_score <> r.sc OR v_prev_sig <> to_jsonb(r.sigs) THEN
        v_new := gen_random_uuid();
        IF v_prev IS NOT NULL THEN
          UPDATE listing_vehicle_matches SET superseded_at = now(), superseded_by = v_new,
            superseded_reason = 'rematched run ' || p_run_id WHERE id = v_prev;
        END IF;
        INSERT INTO listing_vehicle_matches(id, listing_id, vehicle_id, score, confidence, signals, run_id, producer_version)
        VALUES (v_new, r.lid, r.vid, r.sc,
                CASE WHEN r.sc >= 0.8 THEN 'high' WHEN r.sc >= 0.5 THEN 'medium' ELSE 'low' END,
                to_jsonb(r.sigs), p_run_id, v_ver);
      END IF;
    END IF;
    listing_id := r.lid; vehicle_id := r.vid; score := r.sc; signals := to_jsonb(r.sigs);
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Seller backfill for listings with an empty seller_username: raw_data, then the linked vehicle's recorded seller, then
-- the vehicle of a high-confidence match. Writes only listing_seller_derivations.
CREATE FUNCTION public.derive_listing_sellers(
  p_limit integer DEFAULT 1000, p_run_id uuid DEFAULT gen_random_uuid(), p_dry_run boolean DEFAULT true)
RETURNS TABLE(listing_id uuid, seller_username text, source text, vehicle_id uuid, confidence numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  r record; v_ver constant text := 'derive_listing_sellers/1';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  p_limit := least(greatest(coalesce(p_limit, 1000), 1), 50000);
  FOR r IN
    SELECT b.lid, b.seller, b.src, b.vid, b.conf FROM (
      SELECT bl.id AS lid, bl.scraped_at, s.seller, s.src, s.vid, s.conf,
             row_number() OVER (PARTITION BY bl.id ORDER BY s.conf DESC, s.src) AS rn
        FROM (SELECT bl0.* FROM bat_listings bl0
               WHERE nullif(btrim(bl0.seller_username), '') IS NULL
                 AND NOT EXISTS (SELECT 1 FROM listing_seller_derivations d WHERE d.listing_id = bl0.id AND d.superseded_at IS NULL)
               ORDER BY bl0.scraped_at DESC NULLS LAST, bl0.id LIMIT p_limit) bl
        CROSS JOIN LATERAL (
          SELECT lower(btrim(coalesce(bl.raw_data->>'seller_username', bl.raw_data->>'seller'))) AS seller,
                 0.90 AS conf, 'bat_listings.raw_data' AS src, NULL::uuid AS vid
          UNION ALL
          SELECT e.seller_username, 0.92, 'listing_detail_enrichments', NULL::uuid
            FROM listing_detail_enrichments e WHERE e.listing_id = bl.id AND e.superseded_at IS NULL
          UNION ALL
          SELECT lower(btrim(coalesce(nullif(btrim(v.bat_seller), ''), v.origin_metadata->'bat_snapshot_parsed'->>'seller_username'))),
                 0.70, 'linked vehicle seller', v.id
            FROM vehicles v WHERE v.id = bl.vehicle_id
          UNION ALL
          SELECT lower(btrim(coalesce(nullif(btrim(v.bat_seller), ''), v.origin_metadata->'bat_snapshot_parsed'->>'seller_username'))),
                 least(0.70, m.score * 0.75), 'high-confidence matched vehicle seller', v.id
            FROM listing_vehicle_matches m JOIN vehicles v ON v.id = m.vehicle_id
           WHERE m.listing_id = bl.id AND m.superseded_at IS NULL AND m.score >= 0.8
        ) s
       WHERE nullif(btrim(s.seller), '') IS NOT NULL
    ) b WHERE b.rn = 1 ORDER BY b.scraped_at DESC NULLS LAST, b.lid
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO listing_seller_derivations(listing_id, seller_username, source, vehicle_id, confidence, run_id, producer_version)
      VALUES (r.lid, r.seller, r.src, r.vid, r.conf, p_run_id, v_ver)
      ON CONFLICT (listing_id) WHERE superseded_at IS NULL DO NOTHING;
    END IF;
    listing_id := r.lid; seller_username := r.seller; source := r.src; vehicle_id := r.vid; confidence := r.conf;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Duplicate organizations: name (possessives, punctuation, custom / llc / inc ... removed), website host, GPS within 100 m.
-- A pair needs name or website (>= 0.6) to be an alias; GPS alone is recorded at 0.3 as a candidate and never applied.
-- Names or hosts shared by more than 5 organizations are not identities; names must be 25 km apart at most when both have GPS.
CREATE FUNCTION public.propose_organization_aliases(
  p_limit integer DEFAULT 1000, p_run_id uuid DEFAULT gen_random_uuid(), p_dry_run boolean DEFAULT true)
RETURNS TABLE(alias_org_id uuid, canonical_org_id uuid, score numeric, signals jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  r record; v_prev uuid; v_prev_score numeric; v_new uuid;
  v_ver constant text := 'propose_organization_aliases/1';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  p_limit := least(greatest(coalesce(p_limit, 1000), 1), 20000);
  FOR r IN
    WITH orgn AS MATERIALIZED (
      SELECT o.id, o.latitude::float8 AS lat, o.longitude::float8 AS lon, n2.nn, h.host,
             CASE WHEN h.host = '' THEN 0 ELSE count(*) OVER (PARTITION BY h.host) END AS host_c,
             CASE WHEN n2.nn = '' THEN 0 ELSE count(*) OVER (PARTITION BY n2.nn) END AS nn_c,
             CASE WHEN o.latitude IS NULL OR o.longitude IS NULL THEN NULL ELSE floor(o.latitude::float8 / 0.002)::int END AS cy,
             CASE WHEN o.latitude IS NULL OR o.longitude IS NULL THEN NULL ELSE floor(o.longitude::float8 / 0.002)::int END AS cx
        FROM organizations o
        CROSS JOIN LATERAL (SELECT btrim(regexp_replace(
            regexp_replace(regexp_replace(regexp_replace(lower(coalesce(o.name, '')), '[''’`]', '', 'g'),
                                          '[^a-z0-9]+', ' ', 'g'),
                           '\m(custom|llc|inc|incorporated|corp|co|ltd|the)\M', ' ', 'g'),
            '\s+', ' ', 'g')) AS nn) n2
        CROSS JOIN LATERAL (SELECT regexp_replace(split_part(split_part(split_part(
            regexp_replace(lower(coalesce(o.website, '')), '^[a-z]+://', ''), '/', 1), '?', 1), ':', 1), '^www\.', '') AS host) h
    ),
    pairs AS (
      SELECT a.id AS a_id, m.id AS m_id FROM orgn a JOIN orgn m ON m.id > a.id AND a.nn <> '' AND length(a.nn) >= 6 AND m.nn = a.nn
      UNION
      SELECT a.id, m.id FROM orgn a JOIN orgn m ON m.id > a.id AND a.host <> '' AND m.host = a.host
      UNION
      SELECT a.id, m.id FROM orgn a
        CROSS JOIN generate_series(-1, 1) dy CROSS JOIN generate_series(-1, 1) dx
        JOIN orgn m ON m.id > a.id AND m.cy = a.cy + dy AND m.cx = a.cx + dx
       WHERE a.cy IS NOT NULL
    ),
    sc AS (
      SELECT p.a_id, p.m_id, a.lat AS alat, m.lat AS mlat,
             (a.nn <> '' AND length(a.nn) >= 6 AND a.nn_c <= 5 AND m.nn = a.nn
              AND (a.lat IS NULL OR m.lat IS NULL OR d.m <= 25000)) AS by_name,
             (a.host <> '' AND a.host_c <= 5 AND m.host = a.host) AS by_web,
             (d.m IS NOT NULL AND d.m <= 100) AS by_gps, d.m
        FROM pairs p JOIN orgn a ON a.id = p.a_id JOIN orgn m ON m.id = p.m_id
        CROSS JOIN LATERAL (SELECT CASE WHEN a.lat IS NULL OR m.lat IS NULL THEN NULL
          ELSE 12742000 * asin(sqrt(least(1, power(sin(radians(m.lat - a.lat) / 2), 2)
               + cos(radians(a.lat)) * cos(radians(m.lat)) * power(sin(radians(m.lon - a.lon) / 2), 2)))) END AS m) d
    ),
    scored AS (
      SELECT sc.*, least(0.99, (CASE WHEN by_name THEN 0.6 ELSE 0 END) + (CASE WHEN by_web THEN 0.7 ELSE 0 END)
                              + (CASE WHEN by_gps THEN 0.3 ELSE 0 END)) AS s,
             -- canonical = the member with GPS, then the lower id
             CASE WHEN (alat IS NULL) = (mlat IS NULL) THEN a_id::text < m_id::text ELSE alat IS NOT NULL END AS a_is_canon
        FROM sc
    )
    SELECT CASE WHEN a_is_canon THEN m_id ELSE a_id END AS alias_id, CASE WHEN a_is_canon THEN a_id ELSE m_id END AS canon_id,
           s AS sco, jsonb_build_object('name', by_name, 'website', by_web, 'gps_within_100m', by_gps,
                                        'distance_m', round(m::numeric)) AS sig
      FROM scored WHERE s > 0 AND (by_name OR by_web OR by_gps)
     ORDER BY s DESC, 1, 2 LIMIT p_limit
  LOOP
    IF NOT p_dry_run THEN
      SELECT x.id, x.score INTO v_prev, v_prev_score FROM organization_aliases x
       WHERE x.alias_org_id = r.alias_id AND x.canonical_org_id = r.canon_id AND x.superseded_at IS NULL;
      IF v_prev IS NULL OR v_prev_score <> r.sco THEN
        v_new := gen_random_uuid();
        IF v_prev IS NOT NULL THEN
          UPDATE organization_aliases SET superseded_at = now(), superseded_by = v_new,
            superseded_reason = 'reproposed run ' || p_run_id WHERE id = v_prev;
        END IF;
        INSERT INTO organization_aliases(id, alias_org_id, canonical_org_id, score, signals, run_id, producer_version)
        VALUES (v_new, r.alias_id, r.canon_id, r.sco, r.sig, p_run_id, v_ver);
      END IF;
    END IF;
    alias_org_id := r.alias_id; canonical_org_id := r.canon_id; score := r.sco; signals := r.sig;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Own-origin test, one source list for the preview and the function: is this photo's provenance chain the account's own
-- library / upload? Scraped and external sources are not. A bulk-scraper row (automation_script set) arrives as
-- '<source>#automated' and is never own. An image_intake row is own only when the uploader is the account.
CREATE FUNCTION public.own_origin_source(p_source text, p_storage_path text, p_uploader uuid, p_user uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT CASE
    WHEN p_user IS NULL THEN false
    WHEN s.v LIKE '%#automated' THEN false
    WHEN s.v IN ('bat', 'mecum', 'classic_com', 'classiccom', 'craigslist', 'url_scraper', 'ssd_blast') THEN false
    WHEN s.v IN ('iphoto', 'iphoto_60d', 'user_upload', 'capture_relay_ios', 'photo_auto_sync', 'photo_sync',
                 'drop_folder', 'library_recovery', 'hd_archive', 'daily_receipt', 'dropbox_import') THEN true
    WHEN s.v = 'image_intake' THEN p_uploader IS NOT NULL AND p_uploader = p_user
    WHEN lower(coalesce(p_storage_path, '')) ~ ('^users/' || lower(p_user::text) || '/(capture-relay|photo-sync)(/|$)') THEN true
    WHEN lower(coalesce(p_storage_path, '')) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iphoto(/|$)' THEN true
    WHEN lower(coalesce(p_storage_path, '')) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/hd-archive(/|$)'
      THEN p_uploader IS NOT NULL AND p_uploader = p_user
    ELSE false END
  FROM (SELECT regexp_replace(lower(btrim(coalesce(p_source, ''))), '[-\s]+', '_', 'g') AS v) s
$fn$;
COMMENT ON FUNCTION public.own_origin_source(text, text, uuid, uuid) IS
  'True when a photo''s source / storage path / uploader show the account''s own library or upload (iphoto, user_upload, capture relay, photo sync, drop folder, recovery, archive, receipts; image_intake by the account; users/<uid>/capture-relay|photo-sync; <vehicle>/iphoto; <vehicle>/hd-archive uploaded by the account). Scrapers (bat, mecum, classic-com, craigslist, url_scraper, ssd_blast) and ''#automated'' rows are false. Used by derive_vehicle_relationships and its preview.';

-- First-person statement facts, parsed generically: ownership claim, tenure ("owned N years"), title denial
-- ("not titled to me", "none of them are titled to me"). Nothing is inferred beyond the words.
CREATE FUNCTION public.parse_owner_statement(p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $fn$
DECLARE
  t text := lower(coalesce(p_text, ''));
  m text[]; w text; ten numeric; own boolean; denied boolean; fp boolean; scope text;
BEGIN
  fp := t ~ '(^|[^a-z])(i|we|my|me|mine|i''ve|i''m|i''d)([^a-z]|$)';
  own := (t ~ '\m(i|we)(''ve|''d| have| had| still| currently| also)*\s+(own|owned|bought|purchased)\M'
          OR t ~ '\m(is|are|was|were|it''s|that''s|these are|those are)\s+(all\s+)?(my|mine)\M'
          OR t ~ '\mmine\M'
          OR t ~ '\mowned\s+(it\s+|them\s+|for\s+)?(\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)'
          OR t ~ '\m(i|we)(''ve|''d| have)?\s*had\s+(it|them|this|that|these|those)\M'
          OR t ~ '\mhad\s+(it|them)\s+(for\s+)?(\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)')
         AND t !~ '\m(do not|don''t|never|no longer|did not|didn''t)\s+(own|bought|purchased)\M'
         AND t !~ '\m(not|isn''t|aren''t|wasn''t|never)\s+(my|mine)\M';
  IF own THEN
    m := regexp_match(t, '\m(\d{1,2}(?:\.\d)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\+?\s*(?:years?|yrs?)\M');
    IF m IS NOT NULL THEN
      w := m[1];
      ten := CASE WHEN w ~ '^[0-9]' THEN w::numeric
        ELSE CASE w WHEN 'one' THEN 1 WHEN 'two' THEN 2 WHEN 'three' THEN 3 WHEN 'four' THEN 4 WHEN 'five' THEN 5
          WHEN 'six' THEN 6 WHEN 'seven' THEN 7 WHEN 'eight' THEN 8 WHEN 'nine' THEN 9 WHEN 'ten' THEN 10
          WHEN 'eleven' THEN 11 WHEN 'twelve' THEN 12 WHEN 'fifteen' THEN 15 WHEN 'twenty' THEN 20 WHEN 'thirty' THEN 30 END END;
    END IF;
  END IF;
  denied := t ~ '(\mnot|n''t|\mnever)\s+(currently\s+|yet\s+|even\s+)?(titled|registered)\s+(to|in)\s+(me|my name|our name)'
         OR t ~ '\mnone of (them|these|those|it)\s+(are|is|were|was)\s+(\w+\s+)?(titled|registered)\s+(to|in)\s+(me|my name)';
  scope := CASE WHEN NOT denied THEN NULL
                WHEN t ~ '\m(none|all|any|neither|both|every)\s+of\s+(them|these|those)\M' THEN 'all_listed' ELSE 'single' END;
  RETURN jsonb_build_object('ownership_claim', own AND fp, 'tenure_years', ten, 'title_denied', denied,
                            'title_denial_scope', scope, 'first_person', fp, 'parser', 'parse_owner_statement/1');
END
$fn$;

-- Stores a first-person chat statement as testimony: vehicle_observations, extraction_method 'owner_statement_v1',
-- intake_actor 'owner_first_person', the quoted text in content_text, source_ref citing the chat message id. The vehicle
-- comes from the hint (year / make / model / vin; an array of hints is a listed set) among the account's related vehicles,
-- widened to the duplicate family (same make, model family, year within 1, VINs compatible). One family -> the member with
-- the account's most photos; several families or none -> the row is stored with vehicle_id NULL and every candidate listed.
-- Dry run by default. Idempotent per (account, source_ref, vehicle).
CREATE FUNCTION public.record_owner_statement(
  p_user uuid, p_text text, p_source_ref text, p_observed_at timestamptz DEFAULT now(),
  p_vehicle_hint jsonb DEFAULT '{}'::jsonb, p_dry_run boolean DEFAULT true)
RETURNS TABLE(observation_id uuid, vehicle_id uuid, resolution text, candidates jsonb, facts jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_facts jsonb; v_hint jsonb; v_hints jsonb; v_idx int := 0; v_n int;
  v_cands uuid[]; v_family uuid[]; v_pick uuid; v_res text; v_hash text; v_src uuid; v_oid uuid;
  v_year int; v_make text; v_fam text; v_vin text; v_payload jsonb; v_cl jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_user IS NULL OR nullif(btrim(p_text), '') IS NULL OR length(p_text) > 4000 OR nullif(btrim(p_source_ref), '') IS NULL THEN
    RAISE EXCEPTION 'account, bounded quoted text and a source_ref (chat message id) required' USING ERRCODE = '23514';
  END IF;
  v_facts := parse_owner_statement(p_text);
  v_hints := CASE WHEN jsonb_typeof(p_vehicle_hint) = 'array' THEN p_vehicle_hint ELSE jsonb_build_array(coalesce(p_vehicle_hint, '{}'::jsonb)) END;
  v_n := jsonb_array_length(v_hints);
  FOR v_idx IN 0 .. v_n - 1 LOOP
    v_hint := v_hints->v_idx;
    v_year := CASE WHEN v_hint->>'year' ~ '^[0-9]{4}$' THEN (v_hint->>'year')::int END;
    v_make := nullif(lower(btrim(v_hint->>'make')), '');
    v_fam := normalize_vehicle_model_family(v_hint->>'model');
    v_vin := nullif(upper(regexp_replace(coalesce(v_hint->>'vin', ''), '[^A-Za-z0-9]', '', 'g')), '');
    -- the account's related vehicles
    WITH rel AS (
      SELECT DISTINCT r.vid FROM (
        SELECT vi.vehicle_id AS vid FROM vehicle_images vi WHERE vi.user_id = p_user
        UNION SELECT vup.vehicle_id FROM vehicle_user_permissions vup WHERE vup.user_id = p_user
        UNION SELECT vo.vehicle_id FROM vehicle_ownerships vo WHERE vo.owner_profile_id = p_user
        UNION SELECT dv.vehicle_id FROM discovered_vehicles dv WHERE dv.user_id = p_user
        UNION SELECT vc.vehicle_id FROM vehicle_contributors vc WHERE vc.user_id = p_user
        UNION SELECT v.id FROM vehicles v WHERE v.user_id = p_user) r WHERE r.vid IS NOT NULL),
    rv AS (
      SELECT v.id, v.year, lower(btrim(v.make)) AS mk, normalize_vehicle_model_family(v.model) AS fam,
             nullif(upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g')), '') AS vin
        FROM rel JOIN vehicles v ON v.id = rel.vid WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL),
    direct AS (
      SELECT rv.id FROM rv
       WHERE (v_vin IS NOT NULL AND rv.vin = v_vin)
          OR (v_vin IS NULL AND v_year IS NOT NULL AND v_make IS NOT NULL AND v_fam IS NOT NULL
              AND rv.year = v_year AND rv.mk = v_make AND rv.fam = v_fam)),
    fam AS (
      SELECT rv.id, rv.year, rv.mk, rv.fam, rv.vin FROM rv
       WHERE rv.id IN (SELECT id FROM direct)
          OR EXISTS (SELECT 1 FROM rv d JOIN direct dd ON dd.id = d.id
                      WHERE d.id <> rv.id AND d.mk = rv.mk AND d.fam = rv.fam AND abs(d.year - rv.year) <= 1
                        AND (d.vin IS NULL OR rv.vin IS NULL OR d.vin = rv.vin)))
    SELECT coalesce(array_agg(DISTINCT d.id), '{}'),
           CASE WHEN (SELECT count(*) FROM fam) = 0 THEN '{}'::uuid[]
                WHEN (SELECT count(DISTINCT (mk, fam)) FROM fam) = 1 AND (SELECT max(year) - min(year) FROM fam) <= 1
                     AND (SELECT count(DISTINCT vin) FROM fam WHERE vin IS NOT NULL) <= 1
                THEN ARRAY(SELECT f.id FROM fam f ORDER BY f.id) ELSE '{}'::uuid[] END
      INTO v_cands, v_family
      FROM direct d;
    IF cardinality(v_cands) = 0 THEN
      v_res := 'unresolved'; v_pick := NULL;
    ELSIF cardinality(v_family) > 0 THEN
      v_res := 'resolved';
      SELECT f.id INTO v_pick FROM unnest(v_family) f(id)
       ORDER BY (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = f.id AND vi.user_id = p_user) DESC, f.id::text LIMIT 1;
    ELSE
      v_res := 'ambiguous'; v_pick := NULL;
    END IF;
    v_cl := to_jsonb(CASE WHEN cardinality(v_family) > 0 THEN v_family ELSE v_cands END);
    v_hash := md5('owner-statement:' || p_user::text || ':' || p_source_ref || ':' || coalesce(v_pick::text, v_idx::text));
    v_oid := NULL;
    IF NOT p_dry_run THEN
      SELECT s.id INTO v_src FROM observation_sources s WHERE s.slug = 'owner-input';
      IF v_src IS NULL THEN RAISE EXCEPTION 'owner input source unavailable'; END IF;
      SELECT o.id INTO v_oid FROM vehicle_observations o WHERE o.content_hash = v_hash AND o.source_id = v_src LIMIT 1;
      IF v_oid IS NULL THEN
        v_payload := jsonb_build_object('claim_contract', 'owner_statement_v1', 'speaker_user_id', p_user,
          'intake_actor', 'owner_first_person', 'is_public', false, 'source_ref', p_source_ref,
          'observed_at_basis', 'chat_message', 'facts', v_facts, 'resolution', v_res,
          'candidates', v_cl, 'cluster_vehicle_ids', to_jsonb(v_family), 'hint', v_hint);
        INSERT INTO vehicle_observations (vehicle_id, subject_type, subject_id, source_id, source_identifier, observed_at,
          content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method, kind,
          confidence, confidence_score)
        VALUES (v_pick, 'user', p_user, v_src, p_source_ref, coalesce(p_observed_at, now()), p_text, v_hash, v_payload, p_user,
                jsonb_build_object('user_id', p_user, 'intake_actor', 'owner_first_person'),
                'owner_statement_v1', 'provenance'::public.observation_kind, 'high', 0.95)
        RETURNING id INTO v_oid;
      END IF;
    END IF;
    observation_id := v_oid; vehicle_id := v_pick; resolution := v_res; candidates := v_cl; facts := v_facts;
    RETURN NEXT;
  END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION public.record_owner_statement(uuid, text, text, timestamptz, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_owner_statement(uuid, text, text, timestamptz, jsonb, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.parse_owner_statement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parse_owner_statement(text), public.own_origin_source(text, text, uuid, uuid) TO authenticated, service_role;

-- A stored first-person statement is private to its speaker, like a garage owner correction.
CREATE POLICY owner_statement_private_read ON public.vehicle_observations AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  extraction_method IS DISTINCT FROM 'owner_statement_v1' OR submitted_by_user_id = auth.uid());

REVOKE ALL ON FUNCTION public.match_bat_listings_to_vehicles(integer, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.derive_listing_sellers(integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.propose_organization_aliases(integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_bat_listings_to_vehicles(integer, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.derive_listing_sellers(integer, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_organization_aliases(integer, uuid, boolean) TO service_role;

ALTER TABLE public.vehicle_relationship_derivations DROP CONSTRAINT vehicle_relationship_derivations_derived_role_check;
ALTER TABLE public.vehicle_relationship_derivations ADD CONSTRAINT vehicle_relationship_derivations_derived_role_check
  CHECK (derived_role IN ('owner_verified','owner_reported','co_owner_verified','previously_owned','business_handling',
    'consignment','sales_representative','claimed_interest','transfer_pending','documenting','previously_documented',
    'contributor','profile_record','imported_by_user'));

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
-- BEGIN GENERATED FROM supabase/sql/derive_vehicle_relationships_preview.sql (scripts/garage/build-chain-function.mjs)
WITH cfg AS (
  SELECT p_user AS u,
         p_vehicle AS only_v,
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
         NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id) AS no_photos
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
         cfg.r_vis
    FROM dv a CROSS JOIN cfg JOIN dv b ON b.vid::text > a.vid::text AND a.mk <> '' AND b.mk = a.mk
     AND a.year IS NOT NULL AND b.year IS NOT NULL AND abs(b.year - a.year) <= 1
     AND a.fam IS NOT NULL AND b.fam = a.fam
     AND (a.vin IS NULL OR b.vin IS NULL OR a.vin = b.vin)
    CROSS JOIN LATERAL (SELECT 0.50 + CASE WHEN b.year = a.year THEN 0.15 ELSE 0.05 END
         + CASE WHEN a.vin IS NOT NULL AND a.vin = b.vin THEN 0.30 ELSE 0 END
         + CASE WHEN b.model = a.model THEN 0.05 ELSE 0 END AS score) s
   WHERE s.score >= cfg.r_dup_rev - 1e-9 AND s.score < cfg.r_dup - 1e-9
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
-- A year gap of one joins by the visual judgment only.
revx AS MATERIALIZED (
  SELECT x.*, CASE WHEN x.vis_ok THEN 'visual' WHEN x.abs_ok THEN 'absence_of_contradiction' END AS basis,
         x.vis_ok OR x.abs_ok AS joined
    FROM (SELECT r.a, r.b, r.score, r.a_year, r.b_year, r.a_no_photos, r.b_no_photos, r.conflicts, r.one_vin,
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
           'one_side_has_vin', q.one_vin, 'conflicting_fields', to_jsonb(q.conflicts), 'judgments', q.js)
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
-- Scene sessions of each cluster, one row per (vehicle, session): a session labelled more than once counts once (its most confident label). A session
-- votes with the number of its photos (photo_count, else the length of its image_ids, at least 1). It is DROPPED, not counted, and cited as
-- dropped when its label is non-informative (outdoor_street, other) or its confidence is below the floor of 0.6.
sc AS MATERIALIZED (
  SELECT d.*, greatest(1, coalesce(d.photo_count, nullif(cardinality(d.image_ids), 0), 1)) AS w,
         CASE WHEN coalesce(d.confidence, 0) < 0.6 THEN 'below_confidence_floor'
              WHEN d.scene_label IN ('outdoor_street', 'other') THEN 'non_informative' END AS dropped,
         jsonb_build_object('run_id', d.run_id, 'session_key', d.session_key, 'scene_label', d.scene_label, 'model', d.model,
                            'confidence', d.confidence, 'rationale', d.rationale, 'member_vehicle_id', d.vehicle_id,
                            'photos', greatest(1, coalesce(d.photo_count, nullif(cardinality(d.image_ids), 0), 1))) AS cite
    FROM (SELECT DISTINCT ON (sl.vehicle_id, sl.session_key) cm.ck AS vid, sl.run_id, sl.vehicle_id, sl.session_key, sl.image_ids,
                 sl.scene_label, sl.model, sl.confidence, sl.rationale, sl.photo_count
            FROM scene_labels sl JOIN clm cm ON cm.vid = sl.vehicle_id
           ORDER BY sl.vehicle_id, sl.session_key, sl.confidence DESC NULLS LAST, sl.run_id::text) d
),
-- Scene kind of each candidate vehicle: photo-weighted vote of its counted sessions. dealer_lot / showroom -> dealer;
-- shop_interior / upholstery_work / paint_body -> shop. A vehicle whose sessions read as both without a 2:1 majority has no kind.
vscene AS MATERIALIZED (
  SELECT k.vid, k.wd, k.ws,
         CASE WHEN k.wd > 0 AND k.wd >= 2 * k.ws THEN 'dealer' WHEN k.ws > 0 AND k.ws >= 2 * k.wd THEN 'shop' END AS kind,
         k.cites, k.dropped_cites
    FROM (SELECT sc.vid,
                 coalesce(sum(sc.w) FILTER (WHERE sc.dropped IS NULL AND sc.scene_label IN ('dealer_lot', 'showroom')), 0) AS wd,
                 coalesce(sum(sc.w) FILTER (WHERE sc.dropped IS NULL AND sc.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')), 0) AS ws,
                 jsonb_agg(sc.cite ORDER BY sc.confidence DESC, sc.session_key, sc.vehicle_id::text) FILTER (WHERE sc.dropped IS NULL) AS cites,
                 jsonb_agg(sc.cite || jsonb_build_object('dropped', sc.dropped) ORDER BY sc.confidence DESC, sc.session_key, sc.vehicle_id::text)
                   FILTER (WHERE sc.dropped IS NOT NULL) AS dropped_cites
            FROM sc GROUP BY sc.vid) k
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
-- The same vote per organization: counted sessions whose photos (scene image_ids, or the session_key photo) were taken, on an own device, within
-- range of that organization. Where a vehicle has such sessions at an organization, they - not the vehicle-wide vote - say what kind of scene
-- it was photographed in there.
sorg AS MATERIALIZED (
  SELECT x.vid, x.canon,
         coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('dealer_lot', 'showroom')), 0) AS wd,
         coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')), 0) AS ws,
         CASE WHEN sum(x.w) FILTER (WHERE x.scene_label IN ('dealer_lot', 'showroom')) > 0
                   AND coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('dealer_lot', 'showroom')), 0)
                       >= 2 * coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')), 0) THEN 'dealer'
              WHEN sum(x.w) FILTER (WHERE x.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')) > 0
                   AND coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')), 0)
                       >= 2 * coalesce(sum(x.w) FILTER (WHERE x.scene_label IN ('dealer_lot', 'showroom')), 0) THEN 'shop' END AS kind,
         jsonb_agg(x.cite || jsonb_build_object('organization_id', x.canon) ORDER BY x.confidence DESC, x.session_key, x.vehicle_id::text) AS cites
    FROM (SELECT DISTINCT sc.vid, poc.canon, sc.vehicle_id, sc.session_key, sc.scene_label, sc.w, sc.confidence, sc.cite
            FROM sc
            JOIN ps2 p ON p.mvid = sc.vehicle_id AND (p.id = ANY (coalesce(sc.image_ids, '{}'::uuid[])) OR p.id::text = sc.session_key)
            JOIN poc ON poc.photo_id = p.id
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
    JOIN poc ON poc.photo_id = p.id
    JOIN orgn o ON o.id = poc.canon AND o.okind = 'dealer'
    -- the photo-weighted vote at that organization must read dealer, and the vehicle-wide vote must not read shop
    JOIN sorg sg ON sg.vid = p.vid AND sg.canon = poc.canon AND sg.kind = 'dealer'
    LEFT JOIN vscene vs ON vs.vid = p.vid
   WHERE sc.scene_label IN ('dealer_lot', 'showroom') AND sc.dropped IS NULL AND vs.kind IS DISTINCT FROM 'shop'
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
                    JOIN poc ON poc.photo_id = p.id
                    JOIN orgn o ON o.id = poc.canon AND o.okind = 'shop'
                   WHERE sc.dropped IS NULL AND sc.scene_label IN ('shop_interior', 'upholstery_work', 'paint_body')) x
            JOIN sorg sg ON sg.vid = x.vid AND sg.canon = x.canon AND sg.kind = 'shop'
           GROUP BY x.vid, x.canon, sg.wd, sg.ws HAVING count(*) >= 2) y
   ORDER BY y.vid, y.n_sess DESC, y.canon::text
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
         so.tb_decided, so.s_orgs, so.s_cooc, so.s_okind, so.s_sm, so.s_sx, so.s_vkind, so.s_scites, so.s_sagg, so.s_sdrop,
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
           q.orgs AS s_orgs, q.okind AS s_okind, q.sm AS s_sm, q.sx AS s_sx, q.vkind AS s_vkind, q.scites AS s_scites, q.sagg AS s_sagg, q.sdrop AS s_sdrop
      FROM (SELECT t.canon, t.n_at, t.min_m, t.ov_rel, (t.canon IS NOT DISTINCT FROM g4.org_id) AS listed,
                   coalesce(cc.n, 0) AS cooc, z.sm, z.sx, o.okind, ek.kind AS vkind, ek.cites AS scites, ek.agg AS sagg, vs.dropped_cites AS sdrop,
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
              -- scene aggregate for this organization: the vote of the sessions photographed there, else the vehicle-wide vote
              CROSS JOIN LATERAL (SELECT CASE WHEN sg.vid IS NOT NULL THEN sg.kind ELSE vs.kind END AS kind,
                                         CASE WHEN sg.vid IS NOT NULL THEN sg.cites ELSE vs.cites END AS cites,
                                         CASE WHEN sg.vid IS NOT NULL THEN jsonb_build_object('scope', 'organization', 'organization_id', t.canon,
                                                'kind', sg.kind, 'dealer_weight', sg.wd, 'shop_weight', sg.ws)
                                              WHEN vs.vid IS NOT NULL THEN jsonb_build_object('scope', 'vehicle', 'kind', vs.kind,
                                                'dealer_weight', vs.wd, 'shop_weight', vs.ws) END AS agg) ek
              CROSS JOIN LATERAL (SELECT CASE WHEN ek.kind IS NOT NULL AND o.okind = ek.kind THEN 1 ELSE 0 END AS sm,
                                         (ek.kind IS NOT NULL AND o.okind IS NOT NULL AND o.okind <> ek.kind) AS sx) z
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
         sh.canon AS cust_org, sh.n_sess AS cust_n, sh.cites AS cust_cites, sh.wd AS cust_wd, sh.ws AS cust_ws, ac.span AS cust_away
  FROM g5 LEFT JOIN pa ON pa.vid = g5.vid LEFT JOIN away aw ON aw.vid = g5.vid
  LEFT JOIN shopc sh ON sh.vid = g5.vid LEFT JOIN awayc ac ON ac.vid = g5.vid
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
                 'scene_matches_organization', h.s_sm = 1, 'scene_supports_organization', coalesce(h.s_sm = 1, false),
                 'scene_contradicts_organization', coalesce(h.s_sx, false), 'attribution_withheld_by_scene', coalesce(h.scene_w, false),
                 'aggregate', h.s_sagg, 'vote_rule', 'photo-weighted, sessions below confidence 0.6 and outdoor_street / other dropped, 2:1 majority',
                 'dropped_sessions', coalesce(h.s_sdrop, '[]'::jsonb),
                 'sessions', coalesce(h.s_scites, '[]'::jsonb)), 'organizations', to_jsonb(h.s_orgs),
               'pre_auction', jsonb_build_object('conditions_met', coalesce(h.pre_auc, false), 'decides', coalesce(h.d->>3 = 'pre_auction_inventory', false),
                 'organizations', to_jsonb(h.pa_orgs), 'scenes', coalesce(h.pa_cites, '[]'::jsonb), 'aggregates', coalesce(h.pa_aggs, '[]'::jsonb),
                 'own_pattern_outside_organization_days', round(h.away_span::numeric, 1), 'long_term_personal', coalesce(h.personal, false)),
               'shop_custody', jsonb_build_object('conditions_met', coalesce(h.custody, false), 'decides', coalesce(h.d->>3 = 'shop_custody', false),
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
ORDER BY m.vid
-- END GENERATED
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

-- Reader: the 20261111170000 reader, plus it hides imported_by_user rows (the account only imported them).
DO $guard$
DECLARE actual text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64') INTO actual
  FROM pg_proc WHERE oid='public.get_user_garage(uuid)'::regprocedure;
  IF actual IS DISTINCT FROM '1leBLOwxqFKLLH/OeOJGckiFRk7bokQsnDE8h2KE0B4=' THEN
    RAISE EXCEPTION 'get_user_garage differs from reviewed reader (%)', actual;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  owned AS (
    SELECT vehicle_id, 1 pr FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 2 FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 3 FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    UNION SELECT v.id, 4 FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
        AND (SELECT is_own FROM viewer)
    -- A co_owner row is not ownership on its own; only an owner grant counts here (title-verified at write).
    UNION SELECT vehicle_id, 1 FROM vehicle_user_permissions WHERE user_id=p_user_id AND revoked_at IS NULL AND role = 'owner' AND NOT (SELECT is_own FROM viewer)
    -- A revoked verification is not title.
    UNION SELECT vehicle_id, 1 FROM ownership_verifications WHERE user_id=p_user_id AND status='approved' AND to_jsonb(ownership_verifications)->>'revoked_at' IS NULL
    -- A derived relationship brings its vehicle with it.
    UNION SELECT vehicle_id, 5 FROM vehicle_relationship_derivations WHERE user_id=p_user_id AND superseded_at IS NULL AND (SELECT is_own FROM viewer)
  ),
  dedup AS (SELECT vehicle_id, MIN(pr) pr FROM owned GROUP BY vehicle_id),
  rel AS (
    SELECT d.vehicle_id, d.pr, x.derived_role,
           CASE
             WHEN x.derived_role IN ('owner_verified','co_owner_verified') THEN 'owner'
             WHEN x.derived_role IS NOT NULL THEN x.derived_role
             WHEN d.pr = 1 THEN 'owner'
             WHEN d.pr = 2 THEN 'previously_owned'
             WHEN d.pr = 3 THEN 'contributor'
             ELSE 'profile_record' END AS relationship
    FROM dedup d
    LEFT JOIN vehicle_relationship_derivations x
      ON x.vehicle_id = d.vehicle_id AND x.user_id = p_user_id AND x.superseded_at IS NULL
  )
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         d.relationship
  FROM rel d JOIN vehicles v ON v.id=d.vehicle_id
  WHERE d.derived_role IS DISTINCT FROM 'imported_by_user'
    AND ((SELECT is_own FROM viewer)
     OR (v.is_public = true AND v.deleted_at IS NULL AND (d.derived_role IS NULL OR d.derived_role IN ('owner_verified','co_owner_verified'))))
  ORDER BY CASE d.relationship WHEN 'owner' THEN 1 WHEN 'owner_reported' THEN 2 WHEN 'previously_owned' THEN 3
                               WHEN 'contributor' THEN 4 WHEN 'profile_record' THEN 6 ELSE 5 END, v.year;
$function$;
COMMIT;
