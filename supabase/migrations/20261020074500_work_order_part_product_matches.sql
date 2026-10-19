-- Job parts linked to the product they name, so a job can show each part's product photo.
--   work_order_part_products: one current link per work_order_parts row to a catalog_parts row, with the match basis
--     (job_buy_url_page | brand_and_part_number_on_page | asin_page | brand_and_product_name_on_page), the page that
--     evidenced it, the method and the capture clock. A new link supersedes the previous one; links are never deleted.
--   record_work_order_part_product(...): service-role writer. Finds or adds the page's catalog_sources row (provider =
--     page host) and a catalog_parts row for the captured product (name, manufacturer, part number as printed, product
--     image, page URL); a changed capture adds a new catalog row instead of rewriting the old one. Then links the part.
--   work_order_part_product_card(part): the current link as a card (image, product name, manufacturer, part number as
--     printed, source host and page, match basis, captured_at). The image is the seller's product photo of the matched
--     product, not a photo of the installed part.
--   work_order_operations_read: each part carries 'product' (the card, or null). One anchored edit.
-- Contract: supabase/sql/test_work_order_part_product_matches.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_part_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_part_id uuid NOT NULL REFERENCES public.work_order_parts(id),
  catalog_part_id uuid NOT NULL REFERENCES public.catalog_parts(id),
  match_basis text NOT NULL CHECK (match_basis IN ('job_buy_url_page', 'brand_and_part_number_on_page', 'asin_page',
    'brand_and_product_name_on_page')),
  evidence_url text NOT NULL CHECK (evidence_url ~ '^https?://'),
  method text NOT NULL CHECK (length(method) BETWEEN 3 AND 80),
  captured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES public.work_order_part_products(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX work_order_part_products_one_current ON public.work_order_part_products (work_order_part_id)
  WHERE superseded_at IS NULL;
CREATE INDEX work_order_part_products_catalog ON public.work_order_part_products (catalog_part_id);
ALTER TABLE public.work_order_part_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_part_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_order_part_products TO service_role;
COMMENT ON TABLE public.work_order_part_products IS 'Job part to catalog product links (grain: work_order_parts row x capture). One current link per part; superseded, never deleted. Written only by record_work_order_part_product; read through work_order_part_product_card.';

CREATE FUNCTION public.work_order_part_products_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'work_order_part_products rows are kept; supersede instead'; END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
    RAISE EXCEPTION 'work_order_part_products rows are immutable except for being superseded once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_order_part_products_guard BEFORE UPDATE OR DELETE ON public.work_order_part_products
  FOR EACH ROW EXECUTE FUNCTION public.work_order_part_products_guard();

CREATE FUNCTION public.record_work_order_part_product(p_work_order_part_id uuid, p_page_url text, p_product_name text,
  p_manufacturer text, p_part_number text, p_image_url text, p_match_basis text, p_method text, p_captured_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  host text := lower(substring(p_page_url from '^https?://(?:www\.)?([^/:?#]+)'));
  src uuid;
  cp uuid;
  cur public.work_order_part_products%ROWTYPE;
  link uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.work_order_parts WHERE id = p_work_order_part_id) THEN
    RAISE EXCEPTION 'Part unavailable' USING ERRCODE = '42501';
  END IF;
  IF host IS NULL OR p_image_url !~ '^https?://' THEN RAISE EXCEPTION 'page and image must be http(s) URLs'; END IF;
  IF NULLIF(btrim(p_product_name), '') IS NULL OR NULLIF(btrim(p_part_number), '') IS NULL THEN
    RAISE EXCEPTION 'product name and part number as printed are required';
  END IF;
  IF p_captured_at IS NULL OR p_captured_at > statement_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'captured_at must be a past clock';
  END IF;

  SELECT id INTO src FROM public.catalog_sources WHERE provider = host AND base_url = 'https://' || host ORDER BY created_at LIMIT 1;
  IF src IS NULL THEN
    INSERT INTO public.catalog_sources(name, provider, base_url) VALUES (host || ' product pages', host, 'https://' || host)
    RETURNING id INTO src;
  END IF;

  SELECT id INTO cp FROM public.catalog_parts
  WHERE catalog_id = src AND supplier_url = p_page_url AND part_number = btrim(p_part_number) AND name = btrim(p_product_name)
    AND product_image_url = p_image_url AND manufacturer IS NOT DISTINCT FROM NULLIF(btrim(p_manufacturer), '')
  ORDER BY created_at LIMIT 1;
  IF cp IS NULL THEN
    INSERT INTO public.catalog_parts(catalog_id, part_number, name, manufacturer, product_image_url, supplier_url, created_at, updated_at)
    VALUES (src, btrim(p_part_number), btrim(p_product_name), NULLIF(btrim(p_manufacturer), ''), p_image_url, p_page_url,
      p_captured_at, p_captured_at)
    RETURNING id INTO cp;
  END IF;

  SELECT * INTO cur FROM public.work_order_part_products WHERE work_order_part_id = p_work_order_part_id AND superseded_at IS NULL;
  IF FOUND AND cur.catalog_part_id = cp AND cur.match_basis = p_match_basis THEN
    RETURN jsonb_build_object('link_id', cur.id, 'catalog_part_id', cp, 'duplicate', true);
  END IF;
  link := gen_random_uuid();
  IF cur.id IS NOT NULL THEN
    UPDATE public.work_order_part_products SET superseded_at = statement_timestamp(), superseded_by = link WHERE id = cur.id;
  END IF;
  INSERT INTO public.work_order_part_products(id, work_order_part_id, catalog_part_id, match_basis, evidence_url, method, captured_at)
  VALUES (link, p_work_order_part_id, cp, p_match_basis, p_page_url, p_method, p_captured_at);
  RETURN jsonb_build_object('link_id', link, 'catalog_part_id', cp, 'duplicate', false, 'superseded', cur.id);
END $$;
REVOKE ALL ON FUNCTION public.record_work_order_part_product(uuid,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_order_part_product(uuid,text,text,text,text,text,text,text,timestamptz) TO service_role;
COMMENT ON FUNCTION public.record_work_order_part_product(uuid,text,text,text,text,text,text,text,timestamptz) IS 'Service-role writer: records the captured product page of a job part in catalog_parts (source = page host) and links the part to it with its match basis; supersedes the previous link.';

CREATE FUNCTION public.work_order_part_product_card(p_work_order_part_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('image_url', c.product_image_url, 'product_name', c.name, 'manufacturer', c.manufacturer,
    'part_number_as_printed', c.part_number, 'source', s.provider, 'page_url', l.evidence_url, 'match_basis', l.match_basis,
    'captured_at', l.captured_at,
    'image_basis', 'seller''s product photo of the matched product; not a photo of the installed part')
  FROM public.work_order_part_products l
  JOIN public.catalog_parts c ON c.id = l.catalog_part_id
  LEFT JOIN public.catalog_sources s ON s.id = c.catalog_id
  WHERE l.work_order_part_id = p_work_order_part_id AND l.superseded_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.work_order_part_product_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_part_product_card(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_part_product_card(uuid) IS 'Internal: the current product link of a job part as a card for the open job readers; null when none.';

DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_operations_read(uuid)'::regprocedure);
  a1 text := $a$'job_op_code', p.job_op_code, 'is_comped', p.is_comped,$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 THEN
    RAISE EXCEPTION 'operations reader parts anchor not found exactly once';
  END IF;
  EXECUTE replace(rd, a1, a1 || $r$ 'product', public.work_order_part_product_card(p.id),$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
