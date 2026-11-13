-- The day's paper, second reading: the vendor's mark, the page itself, and each line's install proof.
--
-- Owner, 2026-11-06, on the Firebird's 2024-09-11 Classic Industries invoice in the day drawer: "cool but incomplete ...
-- id like to see classic industries logo.. id like to see the replica invoice on click somewher.. id like that when
-- i click on the date of the invoice it illuminates on the timeline proof of when the part was installed, itemize cuz
-- the cost of labor doesnt land until the proof of install lands". Three additions to get_vehicle_day_documents,
-- one vendor landed, nothing else changed:
--
--   vendor_org   the organization behind the vendor name, through the reviewed supply register
--                (supply_vendor_key -> supply_vendor_aliases -> supply_vendors -> organizations): name, logo, website;
--                the id only when that organization is public. Classic Industries joins the register here (33 receipts
--                on the Firebird print classicindustries.com); supply_resolve_counterparties() creates its organization
--                the same way it did the other create_by_domain vendors, and the logo is the mark served from
--                nuke.ag/source-logos.
--   page         the original page in the private user-documents bucket (bucket, path, bytes, page_no) and page_paths
--                for every page, tied viewers only (masked with the payer and the card). The client signs the path
--                with its own storage policy; nothing public is minted here.
--   install      per line: the photo zone the line's description names (receipt_line_photo_zone), and the first photo
--                of that zone taken after the page date (Apple's on-device labels, apple_ml_labels). Status
--                'photographed' is a candidate proof the owner can look at, never a confirmation; 'no_photo' says the
--                zone has no photo after this date yet; 'no_zone' says the line names nothing a photo would show.
--                Clock for the proof: the photo's taken_at, in UTC, strictly after the page date.
--
-- Additive: two immutable helpers, one replaced reader (its gate, masks and grants unchanged), one supply vendor row.
-- Revert: supabase/sql/revert_20261111090000_day_documents_vendor_page_install.sql.
-- Contract: supabase/sql/test_receipt_document_pages.sql (composes this migration).

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─── Classic Industries in the supply register ───────────────────────────────────────────────────────────────
DO $$
DECLARE org uuid;
BEGIN
  IF to_regclass('public.supply_vendors') IS NULL OR to_regclass('public.supply_vendor_aliases') IS NULL THEN
    RAISE NOTICE 'supply register absent; vendor row skipped';
    RETURN;
  END IF;
  INSERT INTO public.supply_vendors (vendor_slug, business_name, decision, organization_id, domain, supply_kinds, basis, reviewed_at)
  VALUES ('classic_industries', 'Classic Industries', 'create_by_domain', NULL, 'classicindustries.com', ARRAY['restoration_parts'],
          'receipts print classicindustries.com; 33 receipts on vehicle 20d21fb0 reviewed 2026-11-06', '2026-11-06')
  ON CONFLICT (vendor_slug) DO NOTHING;
  INSERT INTO public.supply_vendor_aliases (alias_key, vendor_slug) VALUES ('classic industries', 'classic_industries')
  ON CONFLICT (alias_key) DO NOTHING;
  IF to_regprocedure('public.supply_resolve_counterparties()') IS NOT NULL THEN
    PERFORM public.supply_resolve_counterparties();
  END IF;
  SELECT s.organization_id INTO org FROM public.supply_vendors s WHERE s.vendor_slug = 'classic_industries';
  IF org IS NOT NULL THEN
    UPDATE public.organizations o SET logo_url = 'https://nuke.ag/source-logos/classic-industries.png'
     WHERE o.id = org AND o.logo_url IS NULL;
  ELSE
    RAISE NOTICE 'classic_industries has no organization yet (resolver absent or no receipt under the alias)';
  END IF;
END $$;

-- ─── What a line's words say a photo would show ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receipt_line_photo_zone(p_description text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN d ~* '\m(dash|cluster|gauge|tach|clock|speedo|instrument|glove ?box|console|radio|steering|horn|shifter|bezel|heater control|ash ?tray|lighter)' THEN 'dashboard'
    WHEN d ~* '\m(seat|upholst|foam|headrest|carpet|headliner|door panel|sill plate|kick panel|visor|dome light|arm ?rest)' THEN 'interior'
    WHEN d ~* '\m(engine|carb|intake|valve cover|header|manifold|distributor|alternator|water pump|radiator|starter|spark|plug wire|pulley|air cleaner|fuel pump|oil pan|timing|thermostat|piston|cylinder|crank|cam|lifter|rocker|gasket|bore|hone)' THEN 'engine'
    WHEN d ~* '\m(wheel|tire|rim|hub ?cap|lug|center cap)' THEN 'wheel'
  END
  FROM (SELECT coalesce(p_description, '') AS d) s
$$;
COMMENT ON FUNCTION public.receipt_line_photo_zone(text) IS
  'The photo zone a receipt line''s printed description names: dashboard, interior, engine, wheel, or null when a photo would not show the part (hardware, fluids, shipping, body trim). Reviewed keywords, first match wins; dashboard before interior so a cluster lens is not a seat.';

CREATE OR REPLACE FUNCTION public.receipt_zone_labels(p_zone text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_zone
    WHEN 'dashboard' THEN ARRAY['dashboard']
    WHEN 'interior'  THEN ARRAY['seat', 'dashboard']
    WHEN 'engine'    THEN ARRAY['engine_vehicle', 'engine']
    WHEN 'wheel'     THEN ARRAY['wheel', 'rim', 'tire']
  END
$$;
COMMENT ON FUNCTION public.receipt_zone_labels(text) IS
  'The on-device photo labels (vehicle_images.apple_ml_labels) that show a zone from receipt_line_photo_zone. Null for an unknown zone.';

-- ─── The reader, second reading ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vehicle_day_documents(p_vehicle_id uuid, p_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS MATERIALIZED (
    SELECT auth.uid() AS uid, auth.role() AS role
  ),
  gate AS MATERIALIZED (
    -- the vehicle, only if this caller may see it; tied = may see amounts, the payer's name and the page itself
    SELECT v.id,
           (me.role = 'service_role'
            OR (me.uid IS NOT NULL AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                                        OR vehicle_user_has_access(v.id, me.uid)))) AS tied
      FROM vehicles v CROSS JOIN me
     WHERE v.id = p_vehicle_id
       AND ((v.is_public IS TRUE AND v.deleted_at IS NULL)
            OR (me.uid IS NOT NULL
                AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                     OR vehicle_user_has_access(v.id, me.uid))))
  ),
  docs AS (
    SELECT r.id, r.source_document_id, r.vendor_name, r.vendor_address, r.invoice_number, r.document_kind::text AS document_kind,
           r.raw_json #>> '{data_v2,document_type}' AS document_type,
           r.raw_json #>> '{data_v2,payer_as_named}' AS payer_as_named,
           r.raw_json #> '{document_pages,date_basis}' AS date_basis,
           coalesce(jsonb_array_length(r.raw_json #> '{document_pages,pages}'), 1) AS pages,
           CASE WHEN jsonb_typeof(r.raw_json #> '{document_pages,pages}') = 'array' THEN r.raw_json #> '{document_pages,pages}' END AS pages_json,
           r.file_url,
           r.subtotal, (r.raw_json #>> '{data_v2,discount}')::numeric AS discount, (r.raw_json #>> '{data_v2,shipping}')::numeric AS shipping,
           r.tax, r.total, r.currency, r.payment_method,
           l.page_date, l.page_date_source, l.basis::text AS basis, l.confidence
      FROM receipt_vehicle_links l
      JOIN receipts r ON r.id = l.receipt_id
     WHERE EXISTS (SELECT 1 FROM gate)
       AND l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL AND l.page_date = p_date
       AND COALESCE(r.is_superseded, false) = false AND r.duplicate_of IS NULL
  ),
  -- the original page(s): the binder's page list, or the receipt's own file when it lives in the private bucket
  pages AS (
    SELECT d.id AS receipt_id, p.path, p.bytes, p.page_no
      FROM docs d
      CROSS JOIN LATERAL (
        SELECT e->>'storage_path' AS path, NULLIF(regexp_replace(coalesce(e->>'byte_size', ''), '\D', '', 'g'), '')::bigint AS bytes,
               NULLIF(regexp_replace(coalesce(e->>'page_no', ''), '\D', '', 'g'), '')::int AS page_no
          FROM jsonb_array_elements(d.pages_json) e
         WHERE e->>'storage_path' IS NOT NULL
        UNION ALL
        SELECT substring(d.file_url FROM '/user-documents/(.+)$'), NULL::bigint, 1
         WHERE d.pages_json IS NULL AND d.file_url ~ '/storage/v1/object/(public|sign|authenticated)/user-documents/'
      ) p
  ),
  page_shape AS (
    SELECT receipt_id,
           (array_agg(jsonb_build_object('bucket', 'user-documents', 'path', path, 'bytes', bytes, 'page_no', page_no) ORDER BY page_no NULLS LAST, path))[1] AS page,
           jsonb_agg(path ORDER BY page_no NULLS LAST, path) AS page_paths
      FROM pages
     GROUP BY receipt_id
  ),
  -- the organization behind the vendor name, through the reviewed supply register
  vendor AS (
    SELECT d.id AS receipt_id,
           jsonb_strip_nulls(jsonb_build_object('id', CASE WHEN o.is_public IS TRUE THEN o.id END,
                                                'name', o.name, 'logo_url', o.logo_url, 'website', o.website)) AS vendor_org
      FROM docs d
      JOIN supply_vendor_aliases a ON a.alias_key = public.supply_vendor_key(d.vendor_name)
      JOIN supply_vendors s ON s.vendor_slug = a.vendor_slug
      JOIN organizations o ON o.id = s.organization_id
  ),
  items AS (
    SELECT i.receipt_id,
           jsonb_agg(jsonb_build_object('line_number', i.line_number, 'description', i.description, 'part_number', i.part_number,
                                        'quantity', i.quantity, 'unit_price', i.unit_price, 'amount', i.total_price,
                                        'line_date', i.line_date, 'hours', i.hours, 'performer', i.performer,
                                        'install', jsonb_build_object(
                                          'zone', z.zone,
                                          'status', CASE WHEN z.zone IS NULL THEN 'no_zone' WHEN pr.first_day IS NULL THEN 'no_photo' ELSE 'photographed' END,
                                          'photo_day', pr.first_day, 'photo_count', pr.n, 'image_id', pr.first_image))
                     ORDER BY i.line_number) AS lines
      FROM receipt_items i
      JOIN docs d ON d.id = i.receipt_id
      CROSS JOIN LATERAL (SELECT public.receipt_line_photo_zone(i.description) AS zone) z
      LEFT JOIN LATERAL (
        SELECT min(v.taken_at AT TIME ZONE 'UTC')::date AS first_day, count(*)::int AS n,
               (array_agg(v.id ORDER BY v.taken_at))[1] AS first_image
          FROM vehicle_images v
         WHERE z.zone IS NOT NULL
           AND v.vehicle_id = p_vehicle_id
           AND v.taken_at >= ((d.page_date + 1)::timestamp AT TIME ZONE 'UTC')
           AND v.is_duplicate IS NOT TRUE AND v.is_superseded IS NOT TRUE
           AND v.apple_ml_labels && public.receipt_zone_labels(z.zone)
      ) pr ON true
     GROUP BY i.receipt_id
  ),
  shaped AS (
    SELECT jsonb_build_object(
             'receipt_id', d.id, 'document_id', d.source_document_id, 'vendor', d.vendor_name, 'vendor_address', d.vendor_address,
             'vendor_org', ven.vendor_org,
             'document_type', d.document_type, 'document_kind', d.document_kind, 'document_number', d.invoice_number,
             'date', d.page_date, 'date_source', d.page_date_source, 'date_basis', d.date_basis, 'pages', d.pages,
             'page', ps.page, 'page_paths', ps.page_paths,
             'payer_as_named', d.payer_as_named, 'payment_method', d.payment_method,
             'subtotal', d.subtotal, 'discount', d.discount, 'shipping', d.shipping, 'tax', d.tax, 'total', d.total, 'currency', d.currency,
             'link_basis', d.basis, 'link_confidence', d.confidence,
             'lines', coalesce(i.lines, '[]'::jsonb)) AS j,
           d.vendor_name, d.invoice_number
      FROM docs d
      LEFT JOIN items i ON i.receipt_id = d.id
      LEFT JOIN page_shape ps ON ps.receipt_id = d.id
      LEFT JOIN vendor ven ON ven.receipt_id = d.id
  )
  SELECT jsonb_build_object(
    'date', p_date,
    'tied', coalesce((SELECT tied FROM gate), false),
    'documents', coalesce((
      SELECT jsonb_agg(CASE WHEN (SELECT tied FROM gate) THEN s.j
                            ELSE jsonb_mask_keys(jsonb_mask_money(s.j), ARRAY['payer_as_named', 'vendor_address', 'payment_method', 'page', 'page_paths']) END
                       ORDER BY s.vendor_name, s.invoice_number)
        FROM shaped s), '[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.get_vehicle_day_documents(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_day_documents(uuid, date) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_vehicle_day_documents(uuid, date) IS
  'The receipts linked to a vehicle on one page date, with their lines, for the day drawer. Visible for a public vehicle or to anyone tied to it; amounts, the payer as named, the vendor address, the payment method and the page paths are null unless the caller is tied (jsonb_mask_money, jsonb_mask_keys). vendor_org: the organization behind the vendor name through the supply register (id only when public). Each line carries install: the photo zone its words name and the first photo of that zone after the page date (status photographed / no_photo / no_zone), a candidate the owner looks at, never a confirmation. Grain: one page date. Clock: the date printed on the paper (receipt_vehicle_links.page_date); photo proofs by taken_at in UTC.';

DO $$ BEGIN
  IF to_regprocedure('public.get_vehicle_day_documents(uuid,date)') IS NULL
     OR to_regprocedure('public.receipt_line_photo_zone(text)') IS NULL
     OR to_regprocedure('public.receipt_zone_labels(text)') IS NULL THEN
    RAISE EXCEPTION 'day documents second reading did not land';
  END IF;
  IF public.receipt_line_photo_zone('73-75 FBIRD TACH/CLOCK ASMBLY') IS DISTINCT FROM 'dashboard'
     OR public.receipt_line_photo_zone('70-81 FBRD INST CLUSTER LENS (SET)') IS DISTINCT FROM 'dashboard'
     OR public.receipt_line_photo_zone('Shop supplies') IS NOT NULL THEN
    RAISE EXCEPTION 'receipt_line_photo_zone keyword check failed';
  END IF;
END $$;
