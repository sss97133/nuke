-- Register body_style beside the existing core trim property so ingest-observation can bind a
-- body-style claim to the registry. First writer: the vehicle_title_facets_v1 selector, which
-- admits only a literal label from the vehicle record's title.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

INSERT INTO public.observation_properties
  (property_key, label, data_type, namespace, category, applies_to_kinds,
   cardinality, expected_source_categories, verification_scope, description, ratified_at)
VALUES
  ('body_style', 'Body style', 'string', 'core', 'identity',
   ARRAY['specification']::public.observation_kind[], 'single', ARRAY['registry', 'auction'], 'both',
   'A stated body configuration label (e.g. Fastback, Stepside, Split-Window Coupe). Each claim keeps its quote, source field and normalization version; factory configuration and current configuration remain unknown unless a build record or image witness establishes them.', now())
ON CONFLICT (property_key) DO NOTHING;
