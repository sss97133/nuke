-- Live catalog columns, the part-offer table and work_order_parts columns read by
-- 20261020084500_work_order_part_product_read.sql beyond catalog_tables_live_20261020.sql (subset; synthetic fixtures only).
ALTER TABLE public.work_order_parts ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS buy_url text, ADD COLUMN IF NOT EXISTS image_url text, ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS ai_extracted boolean, ADD COLUMN IF NOT EXISTS user_verified boolean,
  ADD COLUMN IF NOT EXISTS is_comped boolean, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.work_order_labor ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS is_comped boolean;
ALTER TABLE public.catalog_parts ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS price_current numeric,
  ADD COLUMN IF NOT EXISTS currency text, ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS condition text, ADD COLUMN IF NOT EXISTS fits_models text[], ADD COLUMN IF NOT EXISTS year_start integer,
  ADD COLUMN IF NOT EXISTS year_end integer, ADD COLUMN IF NOT EXISTS in_stock boolean, ADD COLUMN IF NOT EXISTS installation_difficulty text;
CREATE INDEX IF NOT EXISTS idx_catalog_parts_pn_norm ON public.catalog_parts (upper(regexp_replace(part_number, '[^A-Za-z0-9]', '', 'g')))
  WHERE price_current IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.part_alternatives(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_part_id uuid REFERENCES public.work_order_parts(id), brand text, part_number text, condition text, retailer text, price numeric,
  store_location text, in_stock boolean, url text, is_selected boolean, notes text, created_at timestamptz DEFAULT now());
