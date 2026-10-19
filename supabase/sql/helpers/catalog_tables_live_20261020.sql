-- Live catalog tables and columns used by 20261020074500_work_order_part_product_matches.sql (subset; synthetic fixtures only).
CREATE TABLE IF NOT EXISTS public.catalog_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, provider text NOT NULL,
  base_url text, pdf_document_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.catalog_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text NOT NULL);
ALTER TABLE public.catalog_parts ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES public.catalog_sources(id),
  ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS manufacturer text, ADD COLUMN IF NOT EXISTS product_image_url text,
  ADD COLUMN IF NOT EXISTS supplier_url text, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
