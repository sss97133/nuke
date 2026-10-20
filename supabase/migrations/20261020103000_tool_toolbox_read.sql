-- Tool pack shots and list values.
--   tool_catalog_page_captures: append-only captures of a tool_catalog product's maker page (product name and part number
--     as printed, list price and currency, page URL, method, capture clock). tool_catalog.msrp stays as it is.
--   record_tool_catalog_page_capture(...): service-role writer; an identical capture of the same page is a duplicate.
--   user_toolbox_read(p_user_id): each user_tools row matched to its tool_catalog product by same brand and exact
--     normalized part number, with the catalog's primary image (the maker's pack shot, not a photo of the user's tool),
--     the latest captured name and list price with its clock, and quantity. Paid amounts and purchase dates (from the
--     user's receipts) go to the owner only. Visitors get the itemized list only when profiles.tool_inventory_public is
--     true, and never paid amounts. Rows without a catalog match are counted, never described (some are receipt headers).
--     List value = list price x quantity, labelled as the maker's current list price, not resale value or what was paid.
-- Contract: supabase/sql/test_tool_toolbox_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.tool_catalog_page_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_catalog_id uuid NOT NULL REFERENCES public.tool_catalog(id),
  page_url text NOT NULL CHECK (page_url ~ '^https?://'),
  product_name text NOT NULL CHECK (length(btrim(product_name)) BETWEEN 2 AND 300),
  part_number_as_printed text NOT NULL CHECK (length(btrim(part_number_as_printed)) BETWEEN 1 AND 80),
  list_price numeric(12,2) CHECK (list_price > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK (length(method) BETWEEN 3 AND 80),
  captured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ((list_price IS NULL) = (currency IS NULL))
);
CREATE INDEX tool_catalog_page_captures_latest ON public.tool_catalog_page_captures (tool_catalog_id, captured_at DESC);
ALTER TABLE public.tool_catalog_page_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_catalog_page_captures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tool_catalog_page_captures TO service_role;
COMMENT ON TABLE public.tool_catalog_page_captures IS 'Maker-page captures of tool_catalog products (grain: product x capture): name and part number as printed, list price, page, clock. Append-only; written by record_tool_catalog_page_capture; read through user_toolbox_read.';

CREATE FUNCTION public.tool_catalog_page_captures_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'tool_catalog_page_captures rows are kept as captured; record a new capture instead';
END $$;
CREATE TRIGGER tool_catalog_page_captures_guard BEFORE UPDATE OR DELETE ON public.tool_catalog_page_captures
  FOR EACH ROW EXECUTE FUNCTION public.tool_catalog_page_captures_guard();

CREATE FUNCTION public.record_tool_catalog_page_capture(p_tool_catalog_id uuid, p_page_url text, p_product_name text,
  p_part_number text, p_list_price numeric, p_currency text, p_method text, p_captured_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  existing uuid;
  cap uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tool_catalog WHERE id = p_tool_catalog_id) THEN
    RAISE EXCEPTION 'Tool product unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_captured_at IS NULL OR p_captured_at > statement_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'captured_at must be a past clock';
  END IF;
  SELECT id INTO existing FROM public.tool_catalog_page_captures
  WHERE tool_catalog_id = p_tool_catalog_id AND page_url = p_page_url AND product_name = btrim(p_product_name)
    AND part_number_as_printed = btrim(p_part_number) AND list_price IS NOT DISTINCT FROM p_list_price
    AND currency IS NOT DISTINCT FROM p_currency
  ORDER BY captured_at DESC LIMIT 1;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('capture_id', existing, 'duplicate', true); END IF;
  INSERT INTO public.tool_catalog_page_captures(tool_catalog_id, page_url, product_name, part_number_as_printed, list_price,
    currency, method, captured_at)
  VALUES (p_tool_catalog_id, p_page_url, btrim(p_product_name), btrim(p_part_number), p_list_price, p_currency, p_method, p_captured_at)
  RETURNING id INTO cap;
  RETURN jsonb_build_object('capture_id', cap, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.record_tool_catalog_page_capture(uuid,text,text,text,numeric,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tool_catalog_page_capture(uuid,text,text,text,numeric,text,text,timestamptz) TO service_role;
COMMENT ON FUNCTION public.record_tool_catalog_page_capture(uuid,text,text,text,numeric,text,text,timestamptz) IS 'Service-role writer of tool_catalog_page_captures; an identical capture of the same page returns the existing row.';

CREATE FUNCTION public.user_toolbox_read(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  is_owner boolean := (auth.uid() IS NOT NULL AND auth.uid() = p_user_id) OR coalesce(auth.role(), '') = 'service_role';
  is_public boolean;
  items jsonb;
  unmatched integer;
BEGIN
  SELECT p.tool_inventory_public INTO is_public FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT is_owner AND is_public IS NOT TRUE THEN
    RAISE EXCEPTION 'Toolbox not shared' USING ERRCODE = '42501';
  END IF;

  WITH matched AS (
    SELECT t.id AS user_tool_id, t.total_quantity, t.total_spent, t.first_purchase_date, t.last_purchase_date,
      cardinality(t.receipt_ids) AS receipts, t.category AS user_category, c.id AS catalog_id, c.part_number, c.name AS catalog_name,
      b.name AS brand
    FROM public.user_tools t
    JOIN public.tool_catalog c ON upper(regexp_replace(c.part_number, '[^A-Za-z0-9]', '', 'g'))
      = upper(regexp_replace(t.part_number, '[^A-Za-z0-9]', '', 'g'))
    JOIN public.tool_brands b ON b.id = c.brand_id AND lower(b.name) = lower(btrim(t.brand))
    WHERE t.user_id = p_user_id
  ), shaped AS (
    SELECT m.*, img.image_url, cap.product_name, cap.part_number_as_printed, cap.list_price, cap.currency, cap.page_url, cap.captured_at
    FROM matched m
    LEFT JOIN LATERAL (SELECT i.image_url FROM public.tool_catalog_images i WHERE i.catalog_id = m.catalog_id AND i.image_url ~ '^https?://'
      ORDER BY (i.image_type = 'primary') DESC, i.sort_order NULLS LAST, i.created_at LIMIT 1) img ON true
    LEFT JOIN LATERAL (SELECT x.* FROM public.tool_catalog_page_captures x WHERE x.tool_catalog_id = m.catalog_id
      ORDER BY x.captured_at DESC LIMIT 1) cap ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_tool_id', s.user_tool_id, 'tool_catalog_id', s.catalog_id, 'brand', s.brand,
      'part_number', COALESCE(s.part_number_as_printed, s.part_number),
      'name', COALESCE(s.product_name, regexp_replace(s.catalog_name, '\s+\d+\s+RA\s+Sale\M.*$', '')),
      'name_basis', CASE WHEN s.product_name IS NOT NULL THEN 'maker_page' ELSE 'receipt_line' END,
      'category', s.user_category, 'quantity', s.total_quantity,
      'pack_shot', CASE WHEN s.image_url IS NULL THEN NULL ELSE jsonb_build_object('image_url', s.image_url,
        'basis', 'maker''s catalog photo of the product, not a photo of this tool') END,
      'list_price', CASE WHEN s.list_price IS NULL THEN NULL ELSE jsonb_build_object('amount', s.list_price, 'currency', s.currency,
        'page_url', s.page_url, 'captured_at', s.captured_at) END,
      'list_value', CASE WHEN s.list_price IS NULL OR s.total_quantity IS NULL THEN NULL ELSE round(s.list_price * s.total_quantity, 2) END,
      'match_basis', 'same_brand_exact_part_number')
    || CASE WHEN is_owner THEN jsonb_build_object('paid', jsonb_build_object('total', s.total_spent, 'receipts', s.receipts,
        'first_purchase', s.first_purchase_date, 'last_purchase', s.last_purchase_date, 'basis', 'your receipts')) ELSE '{}'::jsonb END
    ORDER BY s.list_price * COALESCE(s.total_quantity, 1) DESC NULLS LAST, s.part_number), '[]'::jsonb)
  INTO items FROM shaped s;

  SELECT count(*) INTO unmatched FROM public.user_tools t WHERE t.user_id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM public.tool_catalog c JOIN public.tool_brands b ON b.id = c.brand_id
      WHERE upper(regexp_replace(c.part_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(t.part_number, '[^A-Za-z0-9]', '', 'g'))
        AND lower(b.name) = lower(btrim(t.brand)));

  RETURN jsonb_build_object('user_id', p_user_id, 'as_of', statement_timestamp(), 'viewer', jsonb_build_object('owner', is_owner),
    'items', items,
    'totals', jsonb_build_object(
      'list_value', (SELECT round(sum((i->>'list_value')::numeric), 2) FROM jsonb_array_elements(items) i),
      'list_value_currency', (SELECT CASE WHEN count(DISTINCT i#>>'{list_price,currency}') = 1 THEN min(i#>>'{list_price,currency}') END
        FROM jsonb_array_elements(items) i WHERE i->'list_price' IS NOT NULL AND i->'list_price' <> 'null'::jsonb),
      'paid', CASE WHEN is_owner THEN (SELECT round(sum((i#>>'{paid,total}')::numeric), 2) FROM jsonb_array_elements(items) i) END),
    'coverage', jsonb_build_object('tool_records', jsonb_array_length(items) + unmatched, 'matched_to_catalog', jsonb_array_length(items),
      'unmatched_records', unmatched,
      'with_pack_shot', (SELECT count(*) FROM jsonb_array_elements(items) i WHERE i->'pack_shot' <> 'null'::jsonb),
      'with_list_price', (SELECT count(*) FROM jsonb_array_elements(items) i WHERE i->'list_price' <> 'null'::jsonb)),
    'basis', jsonb_build_object(
      'list_value', 'maker''s list price at capture x quantity; not resale value and not what was paid',
      'pack_shot', 'maker''s catalog photo of the product',
      'unmatched', 'tool records without a same-brand exact part-number catalog match are counted, never described'));
END $$;
REVOKE ALL ON FUNCTION public.user_toolbox_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_toolbox_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.user_toolbox_read(uuid) IS 'A user''s tools with maker pack shots and captured list values; paid amounts to the owner only; visitors only when profiles.tool_inventory_public.';

NOTIFY pgrst, 'reload schema';
COMMIT;
