-- Revert 20261120020000_vehicle_part_installation_evidence: drops the evidence function, its rule table and the two word readers.
DROP FUNCTION IF EXISTS public.vehicle_part_installation_evidence(uuid);
DROP FUNCTION IF EXISTS public.part_installation_rules();
DROP FUNCTION IF EXISTS public.part_text_side(text);
DROP FUNCTION IF EXISTS public.part_text_level(text);
