-- Two image readings for trim and option evidence: a badge's printed text, and the RPO codes on a GM SPID label.
-- Grain: one model reading of one image (discriminator image_id). Each claim names its model and leaves originality
-- and factory configuration unknown; a badge can be swapped and a SPID label can belong to another truck.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

INSERT INTO public.observation_properties
  (property_key, label, data_type, namespace, category, applies_to_kinds,
   cardinality, discriminator_key, verification_scope, expected_source_categories, description, ratified_at)
VALUES
  ('image_visible_badge_text', 'Badge text visible in image', 'string', 'core', 'identity',
   ARRAY['specification']::public.observation_kind[], 'multi', 'image_id', 'instance',
   ARRAY['media', 'owner']::public.source_category[],
   'Grain: one model reading of one image. The printed words of a badge, script or plate in capitals as shown (e.g. SILVERADO, CHEYENNE SUPER 10). Evidence that the badge is present, not that it is original or that the vehicle was built with that trim.', now()),
  ('image_spid_rpo_codes', 'RPO codes on a SPID label in image', 'jsonb', 'core', 'identity',
   ARRAY['specification']::public.observation_kind[], 'multi', 'image_id', 'instance',
   ARRAY['media', 'owner']::public.source_category[],
   'Grain: one model reading of one image of a GM Service Parts Identification label. A list of distinct three-character RPO codes as read. The label''s VIN is not matched to the vehicle here; originality and factory configuration remain unknown.', now())
ON CONFLICT (property_key) DO NOTHING;
