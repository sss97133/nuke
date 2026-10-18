-- Reuse the property registry and existing observation/property FK. These are
-- image-scoped observations, not whole-vehicle condition grades or taxonomy
-- aliases. Values were discovered in stored BYOK state_observations.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

INSERT INTO public.observation_properties
  (property_key, label, data_type, namespace, category, applies_to_kinds,
   cardinality, discriminator_key, verification_scope, description, ratified_at)
VALUES
  ('image_visible_rust_severity', 'Visible rust severity in image', 'enum', 'core', 'condition',
   ARRAY['condition']::public.observation_kind[], 'multi', 'image_id', 'instance',
   'Grain: one source analysis of one image. Values: none, surface, pitting, perforation. Unknown is absent. A model reading of visible material only; none never establishes rust-free vehicle/frame. Source analysis, confidence and image witness remain attached. Does not assert structural-frame corrosion.', now()),
  ('image_visible_paint_stage', 'Visible paint stage in image', 'enum', 'core', 'condition',
   ARRAY['condition']::public.observation_kind[], 'multi', 'image_id', 'instance',
   'Grain: one source analysis of one image. Values: bare_metal, primer, sealer, base, clear, aged. Unknown is absent. Describes visible coating stage only; aged does not mean fading and primer does not establish respray. Not an originality, quality or whole-vehicle condition claim.', now()),
  ('image_visible_assembly_state', 'Visible assembly state in image', 'enum', 'core', 'condition',
   ARRAY['condition']::public.observation_kind[], 'multi', 'image_id', 'instance',
   'Grain: one source analysis of one image. Values: stripped, partial, assembled. Unknown is absent. Describes the visible subject only; assembled does not establish vehicle completeness, operability or roadworthiness.', now())
ON CONFLICT (property_key) DO NOTHING;

-- No historical rewrite, model invocation, new queue, schedule or condition
-- grade fold. ingest-observation resolves/validates property_key to property_id;
-- project_observation_image_witness appends its same-vehicle edge atomically;
-- the existing get_field_provenance(vehicle_id, property_key) reads these claims.
