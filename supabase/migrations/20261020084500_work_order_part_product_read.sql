-- Open reader of one part line on a job as a product page.
--   work_order_part_read(p_part_id): the part line (name, brand, part number, category, quantity; name and brand withheld
--     from non-parties when they name the customer or carry contact details, as in work_order_operations_read), its
--     recorded line status (not a completion Sign), its recorded prices, the supplier label (parties only: live labels
--     carry addresses, phone numbers and people's names) and its http(s) buy link and image, the labor lines that share
--     its job_op_code, the part's current product link (work_order_part_product_card, 20261020074500: the seller page that
--     evidenced the product, its photo and match basis), a catalog listing matched by exact normalized part number (and
--     brand when the line records one), and the retailer offers recorded against it (part_alternatives; store location
--     and notes to parties only). Part rows carry no key to an operation row (work_order_line_items has no job_op_code;
--     parts_used is empty), so no operation and no evidence photo is attributed to a part; coverage says so. A product
--     link or catalog listing describes the product, at its own clock, never the installed item. Links open the seller's
--     page; nothing is ordered or charged. Same gate as work_order_operations_read; 'Part unavailable' otherwise.
--     work_order_operations_read already carries each part's product card (20261020074500); it is not edited here.
--   idx_catalog_parts_pn_norm_any: the normalized part number over every catalog row (the existing index covers priced
--     rows only).
-- Contract: supabase/sql/test_work_order_part_product_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE INDEX IF NOT EXISTS idx_catalog_parts_pn_norm_any
  ON public.catalog_parts (upper(regexp_replace(part_number, '[^A-Za-z0-9]', '', 'g')));

CREATE FUNCTION public.work_order_http_url(p_url text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN btrim(p_url) ~* '^https?://[^\s/?#]+' AND btrim(p_url) !~ '\s' THEN btrim(p_url) END
$$;

CREATE FUNCTION public.work_order_url_host(p_url text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT regexp_replace(lower(substring(public.work_order_http_url(p_url) FROM '^[A-Za-z]+://(?:[^/?#@]*@)?([^/:?#]+)')), '^www\.', '')
$$;

-- A catalog listing for the same part number. With a recorded brand, the catalog manufacturer must agree (equal, or one
-- contains the other, after normalization); without one, the part number must be at least 5 characters and unique.
CREATE FUNCTION public.work_order_part_catalog_match(p_part_number text, p_brand text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  pn text := upper(regexp_replace(COALESCE(p_part_number, ''), '[^A-Za-z0-9]', '', 'g'));
  br text := lower(regexp_replace(COALESCE(p_brand, ''), '[^A-Za-z0-9]', '', 'g'));
  n_rows integer;
  n_agree integer;
  n_disagree integer;
  hit_id uuid;
  state text;
  match_basis text;
  m jsonb;
BEGIN
  IF pn = '' THEN
    RETURN jsonb_build_object('state', 'no_part_number', 'match_basis', NULL, 'catalog_rows_same_part_number', 0, 'match', NULL);
  END IF;
  SELECT count(*), count(*) FILTER (WHERE agrees), count(*) FILTER (WHERE agrees IS FALSE),
         (array_agg(id ORDER BY updated_at DESC NULLS LAST, id) FILTER (WHERE agrees))[1]
  INTO n_rows, n_agree, n_disagree, hit_id
  FROM (SELECT cp.id, cp.updated_at,
          CASE WHEN length(br) < 3 OR length(mf) < 3 THEN NULL ELSE (mf = br OR position(br IN mf) > 0 OR position(mf IN br) > 0) END AS agrees
        FROM public.catalog_parts cp,
          LATERAL (SELECT lower(regexp_replace(COALESCE(cp.manufacturer, ''), '[^A-Za-z0-9]', '', 'g')) AS mf) x
        WHERE upper(regexp_replace(cp.part_number, '[^A-Za-z0-9]', '', 'g')) = pn) c;
  IF n_rows = 0 THEN
    state := 'no_catalog_row';
  ELSIF length(br) >= 3 THEN
    IF n_agree > 0 THEN state := 'matched'; match_basis := 'exact_part_number_and_brand';
    ELSIF n_disagree > 0 THEN state := 'not_matched_brand_disagrees';
    ELSE state := 'not_matched_manufacturer_not_recorded'; END IF;
  ELSIF n_rows = 1 AND length(pn) >= 5 THEN
    state := 'matched'; match_basis := 'exact_part_number_brand_not_recorded';
    SELECT cp.id INTO hit_id FROM public.catalog_parts cp WHERE upper(regexp_replace(cp.part_number, '[^A-Za-z0-9]', '', 'g')) = pn;
  ELSE
    state := 'not_matched_part_number_ambiguous';
  END IF;
  IF state = 'matched' THEN
    SELECT jsonb_build_object('catalog_part_id', cp.id, 'part_number', cp.part_number, 'name', cp.name,
        'description', left(cp.description, 2000), 'category', cp.category, 'subcategory', cp.subcategory,
        'manufacturer', cp.manufacturer, 'condition', cp.condition, 'price_current', cp.price_current, 'currency', cp.currency,
        'in_stock', cp.in_stock, 'fits_models', to_jsonb(cp.fits_models), 'year_start', cp.year_start, 'year_end', cp.year_end,
        'installation_difficulty', cp.installation_difficulty,
        'product_image_url', public.work_order_http_url(cp.product_image_url),
        'supplier_url', public.work_order_http_url(cp.supplier_url),
        'source', jsonb_build_object('name', cs.name, 'provider', cs.provider, 'base_url', public.work_order_http_url(cs.base_url)),
        'clock', cp.updated_at, 'clock_basis', 'catalog row updated_at')
    INTO m FROM public.catalog_parts cp LEFT JOIN public.catalog_sources cs ON cs.id = cp.catalog_id WHERE cp.id = hit_id;
  END IF;
  RETURN jsonb_build_object('state', state, 'match_basis', match_basis, 'catalog_rows_same_part_number', n_rows,
    'catalog_rows_brand_disagrees', n_disagree, 'match', m,
    'basis', 'a catalog listing for the same part number, as the catalog states it at its clock; not a fact about the installed item');
END $$;

CREATE FUNCTION public.work_order_part_read(p_part_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  p public.work_order_parts%ROWTYPE;
  w public.work_orders%ROWTYPE;
  my_slots text[];
  issuer text;
  party boolean;
  ctx text;
  part jsonb;
  labor jsonb;
  catalog jsonb;
  link jsonb;
  linked_cp uuid;
  brand_withheld boolean;
  offers jsonb;
  buy_url text;
  image_url text;
  attachments integer;
BEGIN
  SELECT * INTO p FROM public.work_order_parts WHERE id = p_part_id;
  IF NOT FOUND OR p.work_order_id IS NULL THEN RAISE EXCEPTION 'Part unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p.work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  issuer := public.work_order_quote_issuer_role(uid, w.id);
  IF issuer = 'accepted_provider' THEN my_slots := array_append(my_slots, 'accepted_provider'); END IF;
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Part unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots) OR issuer IS NOT NULL;
  ctx := public.job_reader_context(my_slots);
  IF ctx = 'visitor' AND issuer IS NOT NULL THEN ctx := 'provider'; END IF;

  part := jsonb_build_object('id', p.id, 'part_name', p.part_name, 'brand', p.brand, 'part_number', p.part_number,
    'category', p.category, 'quantity', p.quantity);
  IF NOT party THEN part := public.work_order_quote_redact(w.id, jsonb_build_array(part), ARRAY['part_name', 'brand'])->0; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'task_name', l.task_name, 'task_category', l.task_category,
      'hours', l.hours, 'status', l.status) ORDER BY l.id), '[]'::jsonb)
  INTO labor FROM public.work_order_labor l
  WHERE p.job_op_code IS NOT NULL AND l.work_order_id = w.id AND l.job_op_code = p.job_op_code;
  IF NOT party THEN labor := public.work_order_quote_redact(w.id, labor, ARRAY['task_name']); END IF;

  brand_withheld := NOT party AND part->>'brand_visibility' IS NOT NULL;
  SELECT l.catalog_part_id INTO linked_cp FROM public.work_order_part_products l
  WHERE l.work_order_part_id = p.id AND l.superseded_at IS NULL;
  IF brand_withheld THEN
    catalog := jsonb_build_object('state', 'withheld_with_brand', 'match_basis', NULL, 'match', NULL,
      'basis', 'the brand on this line is withheld from you, so no catalog listing is matched against it');
  ELSE
    catalog := public.work_order_part_catalog_match(p.part_number, p.brand);
    link := public.work_order_part_product_card(p.id);
    IF link IS NOT NULL THEN
      link := link || jsonb_build_object('image_url', public.work_order_http_url(link->>'image_url'),
        'page_url', public.work_order_http_url(link->>'page_url'), 'page_host', public.work_order_url_host(link->>'page_url'));
    END IF;
  END IF;
  catalog := catalog || jsonb_build_object('same_as_product_link',
    COALESCE(catalog#>>'{match,catalog_part_id}' = linked_cp::text, false));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'retailer', pa.retailer, 'brand', pa.brand,
      'part_number', pa.part_number, 'condition', pa.condition, 'price', pa.price, 'in_stock', pa.in_stock,
      'url', public.work_order_http_url(pa.url), 'url_host', public.work_order_url_host(pa.url),
      'is_selected', pa.is_selected, 'recorded_at', pa.created_at)
      || CASE WHEN party THEN jsonb_build_object('store_location', pa.store_location, 'notes', pa.notes) ELSE '{}'::jsonb END
    ORDER BY pa.is_selected IS TRUE DESC, pa.price NULLS LAST, pa.id), '[]'::jsonb)
  INTO offers FROM public.part_alternatives pa WHERE pa.work_order_part_id = p.id;
  IF NOT party THEN offers := public.work_order_quote_redact(w.id, offers, ARRAY['brand']); END IF;

  buy_url := public.work_order_http_url(p.buy_url);
  image_url := public.work_order_http_url(p.image_url);
  SELECT count(*) INTO attachments FROM public.work_order_evidence_attachments a JOIN public.vehicle_observations s ON s.id = a.id
  WHERE a.work_order_id = w.id AND s.is_superseded IS FALSE;

  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object(
    'part_id', p.id, 'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,
    'part', part,
    'line', jsonb_build_object('status', p.status,
      'status_basis', 'the status recorded on the part line (quoted, installed, not_used, cancelled); a line status is not a completion Sign',
      'recorded_at', p.created_at, 'updated_at', p.updated_at, 'ai_extracted', p.ai_extracted, 'user_verified', p.user_verified)
      || CASE WHEN party THEN jsonb_build_object('notes', p.notes) ELSE '{}'::jsonb END,
    'price', jsonb_build_object('unit_price', p.unit_price, 'total_price', p.total_price, 'is_comped', p.is_comped, 'currency', NULL,
      'basis', 'recorded line prices, not payments; part lines record no currency'),
    'supplier', jsonb_build_object('label', CASE WHEN party THEN p.supplier END,
      'label_visibility', CASE WHEN p.supplier IS NULL THEN 'not_recorded' WHEN party THEN 'shown' ELSE 'parties_only' END,
      'buy_url', buy_url, 'buy_url_host', public.work_order_url_host(p.buy_url),
      'basis', 'the supplier and link recorded on the part line; a link opens the seller''s page, Nuke places no order'),
    'image', jsonb_build_object('url', image_url, 'basis', CASE WHEN image_url IS NOT NULL THEN 'recorded_on_part_line' END),
    'operation', jsonb_build_object('job_op_code', p.job_op_code, 'labor', labor, 'line_item', NULL,
      'line_item_basis', 'not_linkable: operation rows (work_order_line_items) carry no job_op_code or part key',
      'labor_basis', 'labor lines on this work order recording the same job_op_code'),
    'product_link', link,
    'product_link_basis', CASE WHEN brand_withheld THEN 'withheld_with_brand' WHEN link IS NULL THEN 'no_current_link'
      ELSE 'the current product link of this part (work_order_part_products): the seller page that evidenced the product; it describes the product, not the installed item' END,
    'catalog', catalog,
    'offers', offers,
    'offers_basis', 'retailer offers recorded against this part line, each at its own clock; not current prices, not purchases',
    'evidence', jsonb_build_object('state', 'not_linkable', 'images', '[]'::jsonb, 'images_withheld', 0,
      'basis', 'evidence is filed to an operation; a part line has no key to an operation, so no photo is attributed to this part',
      'job_attachments', attachments, 'job_reader', 'work_order_evidence_read'),
    'coverage', jsonb_build_object('offers', jsonb_array_length(offers),
      'offers_with_link', (SELECT count(*) FROM jsonb_array_elements(offers) o WHERE o->>'url' IS NOT NULL),
      'catalog', catalog->>'state', 'product_link', link IS NOT NULL, 'part_image', image_url IS NOT NULL, 'buy_link', buy_url IS NOT NULL,
      'operation_link', CASE WHEN p.job_op_code IS NULL THEN 'no_job_op_code'
        WHEN jsonb_array_length(labor) > 0 THEN 'labor_by_job_op_code' ELSE 'job_op_code_without_labor' END,
      'operation_row', 'not_linkable', 'evidence', 'not_linkable',
      'prices', 'open; recorded line prices, not payments', 'customer_contact', 'never_returned'),
    'viewer', public.job_reader_viewer(ctx, my_slots, public.viewer_identity_bridge(uid), party)
      || jsonb_build_object('party', party, 'quote_issuer_role', issuer, 'actions', '[]'::jsonb),
    'people_basis', 'no people are returned; supplier labels and offer notes go to parties only',
    'payment_authorized', false);
END $$;

REVOKE ALL ON FUNCTION public.work_order_part_catalog_match(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_part_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_part_read(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_part_catalog_match(text, text) TO service_role;
COMMENT ON FUNCTION public.work_order_part_read(uuid) IS 'Open reader of one job part line as a product page: identity, line status, recorded prices, http(s) links, same-op-code labor, the current product link, an exact part-number catalog listing and recorded retailer offers. No people, no payments, no orders.';
COMMENT ON FUNCTION public.work_order_part_catalog_match(text, text) IS 'Catalog listing for an exact normalized part number, with brand/manufacturer agreement when a brand is recorded. Internal to the job part readers.';

NOTIFY pgrst, 'reload schema';
COMMIT;
