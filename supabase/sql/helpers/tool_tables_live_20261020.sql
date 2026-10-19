-- Live tool tables and columns read by 20261020030000_tool_requirement_keys.sql (subset; synthetic fixtures only).
ALTER TABLE public.user_tools ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS catalog_id uuid;
ALTER TABLE public.tool_inventory ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS brand text, ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS source text;
CREATE TABLE IF NOT EXISTS public.tool_categories(id uuid PRIMARY KEY, name text);
CREATE TABLE IF NOT EXISTS public.tool_catalog(id uuid PRIMARY KEY, name text, description text, category_id uuid);
CREATE TABLE IF NOT EXISTS public.equipment_usage_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), equipment_id uuid, derived_from_image_id uuid);
