-- Live columns read by 20261020060000_requirement_capability_keys.sql (subset; synthetic fixtures only).
ALTER TABLE public.work_order_line_items ADD COLUMN IF NOT EXISTS component_table text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expertise_areas text[], ADD COLUMN IF NOT EXISTS profession text;
ALTER TABLE public.actors ADD COLUMN IF NOT EXISTS specialties text[];
