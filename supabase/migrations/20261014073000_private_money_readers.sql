-- Member-checked readers for the owner's money, and the readers that re-expose it stop doing so.
--
-- Measured 2026-10-14 05:40-06:30Z as the anon role (counts only):
--   organization_vehicles  row policy USING (true) and table-wide SELECT for anon and authenticated: cost_basis 14
--                          rows (all organization c433d27e), sale_price 592, asking_price 87, internal_notes 0.
--   vehicles               every column of 689,707 public rows: purchase_price 39, purchase_date 5,
--                          purchase_location 28 (52 vehicles).
--   get_vehicle_profile_data (SECURITY DEFINER, the vehicle page's read) returns row_to_json(v.*), so the
--                          purchase facts of any public vehicle reach a logged-out visitor.
--   vehicle_price_signal   (SECURITY DEFINER, no visibility check) labels the purchase price PAID or PURCHASE and
--                          returns signals for private vehicles.
--   sold_vehicle_proof     (owner-run view, anon SELECT) carries the link's sale_price.
--   vehicles_inventory     (owner-run, auto-updatable view, anon SELECT/INSERT/UPDATE/DELETE) carries the purchase
--                          facts and accepts writes past the vehicles row policies. No code reads or writes it.
--   vehicle_price_history  50 'purchase' rows of public vehicles readable by anon.
--
-- This migration (no revoke of table columns yet; that follows once the web stops selecting them):
--   caller_manages_organization(uuid)    true for an active owner, manager or board member of the organization:
--                                        the organization clause of the organization_vehicles write policy.
--   organization_vehicle_books(uuid)     the links' asking_price, cost_basis, sale_price, internal_notes for
--                                        those managers; no rows for anyone else.
--   vehicle_owner_books(uuid[])          purchase_price, purchase_date, purchase_location for the vehicles the
--                                        caller owns, uploaded, created or holds access to (the rule of #1001,
--                                        #1037 and 20261013170000); no rows for anyone else; 500 ids per call.
--   vehicle_row_read(uuid)               the vehicles row as jsonb as the caller may see it: NULL when the row
--                                        policies hide it, the purchase facts nulled unless the caller is an
--                                        insider. Replaces the web's single-row select('*') reads.
--   get_vehicle_profile_data             same signature; non-insiders get the purchase facts nulled and
--                                        money_masked = true.
--   vehicle_price_signal                 same signature; the purchase price only for insiders; private vehicles
--                                        only for insiders.
--   sold_vehicle_proof                   same columns; sale_price only for the organization's managers.
--   vehicles_inventory                   no access for anon or authenticated.
--   vehicle_price_history                its public-vehicles read policy leaves out 'purchase' rows; owners keep
--                                        theirs through "Owners can view all price history for their vehicles".
-- Built from the live definitions in supabase/sql/helpers/{get_vehicle_profile_data,vehicle_price_signal,
-- sold_vehicle_proof}_live_20261014.sql, guarded by their source hashes; the last block checks this migration's
-- own result. Contract: supabase/sql/test_private_money_readers.sql (CI job private-money-readers-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $guard$
DECLARE g text; p text; v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO g FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO p FROM pg_proc WHERE oid = 'public.vehicle_price_signal(uuid[])'::regprocedure;
  SELECT encode(sha256(convert_to(pg_get_viewdef('public.sold_vehicle_proof'::regclass), 'UTF8')), 'base64') INTO v;
  IF g NOT IN ('pfSCC/mXgFBy4SoZ9Eafe4f+WAhYp413HxamX1QajJo=', 'mWToLtKizvhnI1D4ZuzMeZRe/UaK6CW1b3FBt2UbdQg=') THEN
    RAISE EXCEPTION 'get_vehicle_profile_data is not the 2026-10-14 source this migration was written from (sha256 %)', g;
  END IF;
  IF p NOT IN ('b6226lg3uqOKaT5sGeXRGYHGNr0vKgAusSZTi/4ZiI4=', 'NrcBGoqcFJHQWuyqsbj1whm8xR/4Bx9z2CcOXflqXMU=') THEN
    RAISE EXCEPTION 'vehicle_price_signal is not the 2026-10-14 source this migration was written from (sha256 %)', p;
  END IF;
  IF v NOT IN ('Jo1Yi/q1GTWkK9HsG2RXVTDf0MJkkJCEtMpfWbK29A4=', 'mngfhZNZNk2Twg7SRRvZ5ZGTPYueYi4ukZ2ZFZScoxY=') THEN
    RAISE EXCEPTION 'sold_vehicle_proof is not the 2026-10-14 definition this migration was written from (sha256 %)', v;
  END IF;
  IF to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL
     OR to_regprocedure('public.jsonb_mask_keys(jsonb,text[])') IS NULL THEN
    RAISE EXCEPTION 'vehicle_user_has_access or jsonb_mask_keys is missing';
  END IF;
END $guard$;

-- 1. Who keeps an organization's books: the organization clause of the "Users/owners manage links" policy.
CREATE OR REPLACE FUNCTION public.caller_manages_organization(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = p_organization_id
      AND oc.user_id = auth.uid()
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager', 'board_member')), false)
$function$;
COMMENT ON FUNCTION public.caller_manages_organization(uuid) IS
  'True when the signed-in caller is an active owner, manager or board member of the organization (the organization clause of the organization_vehicles write policy). Gates the organization''s books.';
REVOKE ALL ON FUNCTION public.caller_manages_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_manages_organization(uuid) TO anon, authenticated, service_role;

-- 2. The organization's books on its vehicle links, for its managers only.
CREATE OR REPLACE FUNCTION public.organization_vehicle_books(p_organization_id uuid)
RETURNS TABLE(id uuid, vehicle_id uuid, asking_price numeric, cost_basis numeric, sale_price numeric, internal_notes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.caller_manages_organization(p_organization_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT ov.id, ov.vehicle_id, ov.asking_price, ov.cost_basis, ov.sale_price, ov.internal_notes
    FROM public.organization_vehicles ov
    WHERE ov.organization_id = p_organization_id
      AND (ov.asking_price IS NOT NULL OR ov.cost_basis IS NOT NULL
           OR ov.sale_price IS NOT NULL OR ov.internal_notes IS NOT NULL);
END;
$function$;
COMMENT ON FUNCTION public.organization_vehicle_books(uuid) IS
  'The organization''s books on its vehicle links (asking_price, cost_basis, sale_price, internal_notes) for its active owners, managers and board members; no rows for anyone else.';
REVOKE ALL ON FUNCTION public.organization_vehicle_books(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_vehicle_books(uuid) TO anon, authenticated, service_role;

-- 3. The owner's purchase facts, for the owner only.
CREATE OR REPLACE FUNCTION public.vehicle_owner_books(p_vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, purchase_price numeric, purchase_date date, purchase_location text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_vehicle_ids IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v.id, v.purchase_price, v.purchase_date, v.purchase_location
    FROM public.vehicles v
    WHERE v.id = ANY (p_vehicle_ids[1:500])
      AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
           OR public.vehicle_user_has_access(v.id, v_uid));
END;
$function$;
COMMENT ON FUNCTION public.vehicle_owner_books(uuid[]) IS
  'purchase_price, purchase_date and purchase_location for the vehicles (first 500 ids) the caller owns, uploaded, created or holds access to; no rows for anyone else.';
REVOKE ALL ON FUNCTION public.vehicle_owner_books(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_owner_books(uuid[]) TO anon, authenticated, service_role;

-- 4. One vehicles row as the caller may see it.
CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false),
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.jsonb_mask_keys(v_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location']);
END;
$function$;
COMMENT ON FUNCTION public.vehicle_row_read(uuid) IS
  'One vehicles row as jsonb as the caller may see it: NULL when the row policies hide it; purchase_price, purchase_date and purchase_location null unless the caller owns, uploaded, created or holds access to the vehicle.';
REVOKE ALL ON FUNCTION public.vehicle_row_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_row_read(uuid) TO anon, authenticated, service_role;

-- 5. The vehicle page's read: the same document, the purchase facts nulled for non-insiders.
CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  v_uid uuid := auth.uid();
  v_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_public boolean;
  v_insider boolean;     -- same test as vehicles_private_select
  v_org_member boolean;  -- same test as "Organization members can view org vehicle images"
BEGIN
  -- COALESCE: a NULL owner_id/uploaded_by makes the comparison NULL, and NOT (false OR NULL)
  -- is NULL, which IF treats as false -- that let a signed-in stranger open a private vehicle
  -- in the local test.
  SELECT COALESCE(v.is_public, false),
         COALESCE(v_service OR (v_uid IS NOT NULL AND (
           v_uid = v.user_id
           OR v_uid = v.owner_id
           OR v_uid = v.uploaded_by
           OR public.vehicle_user_has_access(v.id, v_uid))), false)
    INTO v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;

  v_org_member := v_uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.vehicle_id = p_vehicle_id
      AND oc.user_id = v_uid
      AND oc.status = 'active'
  );

  SELECT json_build_object(
    -- The owner's purchase facts reach insiders only (owner rule 2026-09-28): everyone else reads the
    -- row with purchase_price, purchase_date and purchase_location set to null, and money_masked = true.
    'vehicle', (
      SELECT CASE WHEN v_insider THEN row_to_json(v.*)
                  ELSE public.jsonb_mask_keys(to_jsonb(v.*), ARRAY['purchase_price', 'purchase_date', 'purchase_location'])::json END
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id
    ),
    'money_masked', NOT v_insider,
    'images', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', vi.id,
            'vehicle_id', vi.vehicle_id,
            'image_url', vi.image_url,
            'thumbnail_url', vi.thumbnail_url,
            'medium_url', vi.medium_url,
            'large_url', vi.large_url,
            'variants', vi.variants,
            'is_primary', vi.is_primary,
            'is_document', vi.is_document,
            'position', vi.position,
            'created_at', vi.created_at,
            'storage_path', vi.storage_path,
            'caption', vi.caption,
            'image_type', vi.image_type,
            'category', vi.category,
            'file_name', vi.file_name,
            'source', vi.source,
            'has_analysis', (vi.ai_scan_metadata ? 'byok_deep_analysis'),
            'analysis', (
              CASE WHEN vi.ai_scan_metadata ? 'byok_deep_analysis' THEN
                json_build_object(
                  'scene_type',   vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type',
                  'build_phase',  vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess',
                  'intent',       vi.ai_scan_metadata->'byok_deep_analysis'->>'intent',
                  'narrative',    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line',
                  'confidence',   vi.ai_scan_metadata->'byok_deep_analysis'->>'confidence',
                  'component_count', jsonb_array_length(COALESCE(vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen', '[]'::jsonb))
                )
              ELSE NULL END
            )
          )
        ),
        '[]'::json
      )
      FROM (
        SELECT id, vehicle_id, image_url, thumbnail_url, medium_url, large_url,
               variants, is_primary, is_document, position, created_at,
               storage_path, caption, image_type, category, file_name, source,
               ai_scan_metadata
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND public.vehicle_image_gallery_eligible(vehicle_images)
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
          AND COALESCE(is_superseded, false) = false
          AND (v_insider OR v_org_member
               OR COALESCE(is_sensitive, false) = false
               OR user_id = v_uid)
        ORDER BY
          COALESCE(is_primary, false) DESC,
          position ASC NULLS LAST,
          created_at ASC,
          id ASC
        LIMIT 50
      ) vi
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM (
        -- Every column the page reads. Left out: search_vector (a tsvector the browser cannot use,
        -- 32 KB of the K5's 100 rows), photo_analysis, verification_documents and
        -- location_coordinates (read nowhere in the frontend). Fewer TOAST reads cold, less JSON warm.
        SELECT id, vehicle_id, user_id, event_type, source, title, description, event_date, image_urls,
               metadata, created_at, updated_at, mileage_at_event, cost_amount, cost_currency,
               duration_hours, location_name, location_address, service_provider_name,
               service_provider_type, invoice_number, warranty_info, parts_used, is_insurance_claim,
               insurance_claim_number, next_service_due_date, next_service_due_mileage, data_source,
               confidence_score, source_type, event_category, activity_type, automated_tags, manual_tags,
               receipt_data, parts_mentioned, tools_mentioned, labor_hours, cost_estimate, organization_id,
               client_id, is_monetized, work_started, work_completed, contract_id, applied_labor_rate,
               applied_shop_rate, rate_source, contextual_analysis_status, documented_by,
               primary_technician, quality_rating, quality_justification, value_impact, ai_confidence_score,
               concerns, industry_standard_comparison, work_order_id
        FROM public.timeline_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY event_date DESC
        LIMIT 100
      ) te
    ),
    'work_sessions', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', ws.id,
          'session_date', ws.session_date,
          'title', ws.title,
          'work_type', ws.work_type,
          'image_count', ws.image_count,
          'duration_minutes', ws.duration_minutes,
          'total_parts_cost', ws.total_parts_cost,
          'total_labor_cost', ws.total_labor_cost,
          'total_job_cost', ws.total_job_cost,
          'work_description', ws.work_description,
          'status', ws.status
        )
        ORDER BY ws.session_date DESC
      ), '[]'::json)
      FROM public.work_sessions ws
      WHERE ws.vehicle_id = p_vehicle_id
        AND (v_insider OR ws.user_id = v_uid)
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM public.vehicle_comments
        WHERE vehicle_id = p_vehicle_id
        ORDER BY created_at DESC
        LIMIT 50
      ) vc
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*)
      FROM public.vehicle_valuations vv
      WHERE vv.vehicle_id = p_vehicle_id
      ORDER BY vv.valuation_date DESC
      LIMIT 1
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ),
    'stats', json_build_object(
      'image_count', (
        SELECT COUNT(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id AND COALESCE(is_superseded, false) = false
      ),
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (
        (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id) +
        (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id)
      ),
      'observation_count', (SELECT COUNT(*) FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id),
      'document_count', (
        SELECT COUNT(*) FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      ),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'total_documented_costs', (
        SELECT COALESCE(SUM(d.amount), 0)
        FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND d.document_type IN ('receipt', 'invoice')
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      )
    )
  ) INTO result;

  RETURN result;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'get_vehicle_profile_data failed for vehicle %: %', p_vehicle_id, SQLERRM;
    RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_vehicle_profile_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_profile_data(uuid) TO anon, authenticated, service_role;

-- 6. Price signals: the purchase price only for insiders, private vehicles only for insiders.
CREATE OR REPLACE FUNCTION public.vehicle_price_signal(vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, primary_label text, primary_value numeric, anchor_label text, anchor_value numeric, delta_amount numeric, delta_pct numeric, confidence integer, sources text[], missing_fields text[], updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH caller AS (
  SELECT auth.uid() AS uid
),
v AS (
  -- The owner's purchase price reaches the owner only (owner rule 2026-09-28): the owner, user, creator,
  -- uploader or a contributor with access. For everyone else it is absent from the signal (no PAID label,
  -- no PURCHASE anchor, no delta or confidence from it, not listed as missing), and a private vehicle
  -- returns no row.
  SELECT
    vh.id AS vehicle_id,
    NULLIF(vh.msrp, 0) AS msrp,
    NULLIF(vh.current_value, 0) AS current_value,
    CASE WHEN ins.insider THEN NULLIF(vh.purchase_price, 0) END AS purchase_price,
    NOT ins.insider AS purchase_masked,
    NULLIF(vh.asking_price, 0) AS asking_price,
    NULLIF(vh.sale_price, 0) AS sale_price,
    vh.is_for_sale,
    vh.updated_at
  FROM vehicles vh
  CROSS JOIN caller c
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.uid IS NULL THEN false
                ELSE coalesce(c.uid IN (vh.owner_id, vh.user_id, vh.created_by_user_id, vh.uploaded_by), false)
                     OR public.vehicle_user_has_access(vh.id, c.uid) END AS insider
  ) ins
  WHERE vh.id = ANY(vehicle_ids)
    AND (coalesce(vh.is_public, false) OR ins.insider)
),
sale AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    COALESCE(
      NULLIF(NULLIF((metadata->'what'->>'sold_price')::numeric, 0), NULL),
      NULLIF(NULLIF((metadata->'what'->>'sale_price')::numeric, 0), NULL)
    ) AS sold_price,
    event_date::timestamptz AS sold_date
  FROM vehicle_timeline_events
  WHERE vehicle_id = ANY(vehicle_ids)
    AND (event_type IN ('ownership_transfer','auction_sale','sold') OR title ILIKE 'Sold%')
    AND ((metadata->'what' ? 'sold_price') OR (metadata->'what' ? 'sale_price'))
  ORDER BY vehicle_id, event_date DESC
),
live AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    platform,
    listing_url,
    current_bid,
    end_date,
    COALESCE(updated_at, created_at) AS ts
  FROM external_listings
  WHERE vehicle_id = ANY(vehicle_ids)
    AND listing_status = 'active'
    AND current_bid IS NOT NULL
    AND current_bid > 0
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY
    vehicle_id,
    COALESCE(end_date, 'infinity'::timestamptz) ASC,
    COALESCE(updated_at, created_at) DESC
),
base AS (
  SELECT
    v.vehicle_id,
    v.msrp,
    v.current_value,
    v.purchase_price,
    v.asking_price,
    COALESCE(v.sale_price, sale.sold_price) AS sale_price,
    v.is_for_sale,
    sale.sold_date,
    live.current_bid AS live_bid,
    live.platform AS live_platform,
    live.listing_url AS live_listing_url,
    (v.sale_price IS NOT NULL) AS vehicle_sale_exists,
    (sale.sold_price IS NOT NULL) AS event_sale_exists,
    (live.current_bid IS NOT NULL) AS live_bid_exists,
    v.purchase_masked,
    v.updated_at
  FROM v
  LEFT JOIN sale ON sale.vehicle_id = v.vehicle_id
  LEFT JOIN live ON live.vehicle_id = v.vehicle_id
),
picked AS (
  SELECT
    b.*,
    CASE
      WHEN b.sale_price IS NOT NULL THEN 'SOLD'
      WHEN b.live_bid IS NOT NULL THEN 'BID'
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN 'ASK'
      WHEN b.current_value IS NOT NULL THEN 'EST'
      WHEN b.purchase_price IS NOT NULL THEN 'PAID'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS primary_label,
    CASE
      WHEN b.sale_price IS NOT NULL THEN b.sale_price
      WHEN b.live_bid IS NOT NULL THEN b.live_bid
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN b.asking_price
      WHEN b.current_value IS NOT NULL THEN b.current_value
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS primary_value,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN 'PURCHASE'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS anchor_label,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS anchor_value
  FROM base b
)
SELECT
  p.vehicle_id,
  p.primary_label,
  p.primary_value,
  p.anchor_label,
  p.anchor_value,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL THEN p.primary_value - p.anchor_value END AS delta_amount,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL AND p.anchor_value <> 0 THEN ((p.primary_value - p.anchor_value)/p.anchor_value)*100 END AS delta_pct,
  GREATEST(
    0,
    (CASE
      WHEN p.primary_label = 'SOLD' THEN 40
      WHEN p.primary_label = 'BID' THEN 30
      WHEN p.primary_label IN ('ASK','EST') THEN 25
      ELSE 0
    END)
    + (CASE WHEN p.purchase_price IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN p.msrp IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN p.sold_date IS NOT NULL AND p.sold_date > NOW() - INTERVAL '365 days' THEN 10 ELSE 0 END)
  ) AS confidence,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.vehicle_sale_exists THEN 'vehicles.sale_price'::text END,
    CASE WHEN p.event_sale_exists THEN 'vehicle_timeline_events.sale'::text END,
    CASE WHEN p.live_bid_exists THEN 'external_listings.current_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NOT NULL THEN 'vehicles.asking_price'::text END,
    CASE WHEN p.current_value IS NOT NULL THEN 'vehicles.current_value'::text END,
    CASE WHEN p.purchase_price IS NOT NULL THEN 'vehicles.purchase_price'::text END,
    CASE WHEN p.msrp IS NOT NULL THEN 'vehicles.msrp'::text END
  ], NULL) AS sources,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.purchase_price IS NULL AND NOT p.purchase_masked THEN 'purchase_price'::text END,
    CASE WHEN p.msrp IS NULL THEN 'msrp'::text END,
    CASE WHEN p.live_bid IS NULL THEN 'live_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NULL THEN 'asking_price'::text END,
    CASE WHEN p.current_value IS NULL THEN 'current_value'::text END
  ], NULL) AS missing_fields,
  COALESCE(p.updated_at, NOW()) AS updated_at
FROM picked p;
$function$;
REVOKE ALL ON FUNCTION public.vehicle_price_signal(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_price_signal(uuid[]) TO anon, authenticated, service_role;

-- 7. Sold proof: the link's sale price only for the organization's managers; every other column unchanged.
CREATE OR REPLACE VIEW public.sold_vehicle_proof AS
 SELECT ov.id AS org_vehicle_id,
    ov.vehicle_id,
    ov.organization_id,
    ov.listing_status,
    ov.sale_date,
    CASE WHEN public.caller_manages_organization(ov.organization_id) THEN ov.sale_price END AS sale_price,
    ov.relationship_type,
    ov.created_at AS marked_sold_at,
    ov.notes AS org_vehicle_notes,
    v.year,
    v.make,
    v.model,
    v.vin,
    COALESCE(el.listing_url, v.bat_auction_url, (te.metadata ->> 'bat_url'::text), v.discovery_url) AS proof_url,
    COALESCE(el.platform,
        CASE
            WHEN ((v.bat_auction_url IS NOT NULL) OR ((te.metadata ->> 'bat_url'::text) IS NOT NULL)) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%bringatrailer%'::text) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%carsandbids%'::text) THEN 'cars_and_bids'::text
            WHEN (v.discovery_url ~~ '%ebay%'::text) THEN 'ebay_motors'::text
            ELSE 'unknown'::text
        END) AS proof_platform,
    el.id AS external_listing_id,
    el.listing_status AS external_listing_status,
    el.final_price AS external_final_price,
    el.sold_at AS external_sold_at,
    el.end_date AS external_end_date,
    te.id AS timeline_event_id,
    te.event_date AS timeline_sale_date,
    te.title AS timeline_title,
    te.description AS timeline_description,
    te.cost_amount AS timeline_sale_price,
    (te.metadata ->> 'source'::text) AS timeline_source,
    (te.metadata ->> 'bat_url'::text) AS timeline_bat_url,
    (te.metadata ->> 'lot_number'::text) AS lot_number,
    ( SELECT json_agg(json_build_object('field', dv.field_name, 'value', dv.field_value, 'source', dv.validation_source, 'confidence', dv.confidence_score, 'url', dv.source_url)) AS json_agg
           FROM data_validations dv
          WHERE ((dv.entity_type = 'vehicle'::text) AND (dv.entity_id = ov.vehicle_id) AND (dv.field_name = ANY (ARRAY['sale_price'::text, 'sale_date'::text])) AND (dv.validation_source ~~ '%bat%'::text))) AS validation_proof,
        CASE
            WHEN (el.id IS NOT NULL) THEN 'external_listing'::text
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text)) THEN 'timeline_bat_import'::text
            WHEN (v.bat_auction_url IS NOT NULL) THEN 'vehicle_bat_url'::text
            WHEN (te.id IS NOT NULL) THEN 'timeline_event'::text
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 'notes_reference'::text
            ELSE 'manual_mark'::text
        END AS proof_type,
        CASE
            WHEN ((el.id IS NOT NULL) AND (el.listing_status = 'sold'::text) AND (el.final_price IS NOT NULL)) THEN 100
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text) AND (te.cost_amount IS NOT NULL)) THEN 90
            WHEN ((v.bat_auction_url IS NOT NULL) AND (ov.sale_price IS NOT NULL)) THEN 80
            WHEN ((te.id IS NOT NULL) AND (te.event_type = 'sale'::text)) THEN 70
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 60
            ELSE 50
        END AS proof_confidence
   FROM (((organization_vehicles ov
     JOIN vehicles v ON ((v.id = ov.vehicle_id)))
     LEFT JOIN external_listings el ON (((el.vehicle_id = ov.vehicle_id) AND (el.organization_id = ov.organization_id) AND (el.listing_status = 'sold'::text))))
     LEFT JOIN timeline_events te ON (((te.vehicle_id = ov.vehicle_id) AND (te.event_type = 'sale'::text))))
  WHERE (ov.listing_status = 'sold'::text);

-- 8. An owner-run, auto-updatable view with the purchase facts that no code reads or writes.
REVOKE ALL ON public.vehicles_inventory FROM anon, authenticated;

-- 9. Price history of public vehicles, without the owner's purchase rows.
ALTER POLICY "Users can view price history for public vehicles" ON public.vehicle_price_history
  USING ((price_type IS DISTINCT FROM 'purchase') AND (EXISTS (SELECT 1 FROM vehicles v
    WHERE ((v.id = vehicle_price_history.vehicle_id) AND (v.is_public = true)))));

-- 10. This migration's own result.
DO $check$
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.organization_vehicle_books(uuid)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_owner_books(uuid[])'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure)
     OR NOT has_function_privilege('anon', 'public.organization_vehicle_books(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_vehicle_profile_data(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_price_signal(uuid[])', 'EXECUTE')
     OR has_table_privilege('anon', 'public.vehicles_inventory', 'SELECT')
     OR has_table_privilege('authenticated', 'public.vehicles_inventory', 'UPDATE')
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure) NOT LIKE '%money_masked%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_price_signal(uuid[])'::regprocedure) NOT LIKE '%purchase_masked%'
     OR pg_get_viewdef('public.sold_vehicle_proof'::regclass) NOT LIKE '%caller_manages_organization%'
     OR (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_price_history'
           AND policyname = 'Users can view price history for public vehicles') NOT LIKE '%purchase%' THEN
    RAISE EXCEPTION 'private money readers did not land as written';
  END IF;
END $check$;

COMMIT;
