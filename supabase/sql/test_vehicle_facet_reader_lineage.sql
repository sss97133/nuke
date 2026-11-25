-- Disposable PG17: a photo reading's reader family is its lineage (reader_lineages), not its method name
-- (facet_reader_lineage_v1, 20261124193000; asked once per model, 20261124193200). Reuses the facet fixture; every fixture is synthetic. Proves on a public car:
-- two models of one lineage reading one photo are one reader (reading); two lineages reading one photo establish; two
-- methods of one lineage on two photos stay a reading (they established before); two lineages that read the same stamp
-- differently are a conflict whose sides each carry their reader; a model with no row is its own lineage; a reading
-- with no model recorded keeps the old rule; a walk-in caller's provider is not a family; anon gets a family from
-- reader_lineage and no row of model_registry; the patch applies once.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS agent_model text;
-- model_registry as live (its CREATE is not in the migrations): RLS on, no policy, so only a definer reads it.
CREATE TABLE public.model_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, provider text,
  version text, capabilities jsonb NOT NULL DEFAULT '{}', caller_kind text NOT NULL CHECK (caller_kind IN ('platform', 'user_byok', 'walkin', 'rule')),
  base_trust numeric NOT NULL DEFAULT 0.50, first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), notes text);
ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.model_registry TO anon, authenticated;
-- an unknown walk-in caller's provider is not a family
INSERT INTO public.model_registry (slug, provider, caller_kind) VALUES ('model-y', 'anthropic', 'walkin');
INSERT INTO public.observation_properties VALUES
 ('40000000-0000-0000-0000-0000000000b1', 'engine_block_casting'),
 ('40000000-0000-0000-0000-0000000000b2', 'transmission_case_casting'),
 ('40000000-0000-0000-0000-0000000000b3', 'engine_code_stamp'),
 ('40000000-0000-0000-0000-0000000000b4', 'transmission_tailhousing_casting'),
 ('40000000-0000-0000-0000-0000000000b5', 'transmission_id_stamp'),
 ('40000000-0000-0000-0000-0000000000b6', 'bellhousing_casting');
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES
 ('5a000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003'),
 ('5a000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003'),
 ('5a000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003'),
 ('5a000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
 ('5a000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003'),
 ('5a000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003');
INSERT INTO public.vehicle_observations (vehicle_id, kind, extraction_method, observed_at, structured_data, property_id, agent_model)
SELECT '10000000-0000-0000-0000-000000000003', 'specification', x.method, '2026-11-01T12:00Z',
       jsonb_build_object(x.pk, x.val, 'image_id', x.img), x.prop::uuid, x.model
FROM (VALUES
  -- block casting: Opus then a Sonnet blind re-read of the same photo: one lineage
  ('engine_block_casting', '40000000-0000-0000-0000-0000000000b1', '9799140', '5a000000-0000-0000-0000-000000000001', 'engine_block_decode_v1', 'claude-opus-5-5'),
  ('engine_block_casting', '40000000-0000-0000-0000-0000000000b1', '9799140', '5a000000-0000-0000-0000-000000000001', 'fact_doubt_reread_v1', 'claude-sonnet-5-5'),
  -- case casting: Claude and Codex read the same photo alike: two lineages
  ('transmission_case_casting', '40000000-0000-0000-0000-0000000000b2', '3851325', '5a000000-0000-0000-0000-000000000002', 'trans_id_stamp_decode_v1', 'claude-opus-5-5'),
  ('transmission_case_casting', '40000000-0000-0000-0000-0000000000b2', '3851325', '5a000000-0000-0000-0000-000000000002', 'reviewed_image_analysis_v1', 'Codex interactive assistant; exact model version not exposed'),
  -- engine code: two methods of one model on two photos
  ('engine_code_stamp', '40000000-0000-0000-0000-0000000000b3', 'YH', '5a000000-0000-0000-0000-000000000003', 'engine_block_decode_v1', 'claude-opus-5-5'),
  ('engine_code_stamp', '40000000-0000-0000-0000-0000000000b3', 'YH', '5a000000-0000-0000-0000-000000000004', 'physical_transcription_v1', 'claude-opus-5-5'),
  -- tailhousing: two lineages read the stamp with and without a suffix
  ('transmission_tailhousing_casting', '40000000-0000-0000-0000-0000000000b4', '3857584', '5a000000-0000-0000-0000-000000000005', 'trans_id_stamp_decode_v1', 'claude-opus-5-5'),
  ('transmission_tailhousing_casting', '40000000-0000-0000-0000-0000000000b4', '3857584GM', '5a000000-0000-0000-0000-000000000005', 'fact_doubt_reread_v1', 'model-without-a-row'),
  -- id stamp: two models with no row on one photo: each its own lineage
  ('transmission_id_stamp', '40000000-0000-0000-0000-0000000000b5', 'P0118', '5a000000-0000-0000-0000-000000000006', 'method_a', 'model-x'),
  ('transmission_id_stamp', '40000000-0000-0000-0000-0000000000b5', 'P0118', '5a000000-0000-0000-0000-000000000006', 'method_b', 'model-y'),
  -- bellhousing: two methods, no model recorded, one photo: the old rule (one source per photo)
  ('bellhousing_casting', '40000000-0000-0000-0000-0000000000b6', '547975', '5a000000-0000-0000-0000-000000000006', 'method_a', NULL),
  ('bellhousing_casting', '40000000-0000-0000-0000-0000000000b6', '547975', '5a000000-0000-0000-0000-000000000006', 'method_b', NULL)
) x(pk, prop, val, img, method, model);

-- Before: the method name is the family.
SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
BEGIN
  PERFORM public.t_assert(public.t_item('10000000-0000-0000-0000-000000000003', 'engine', 'engine.current.engine_code_stamp')->>'status' = 'established',
    'before: two methods of one model on two photos established');
END $$;
RESET ROLE;

\ir ../migrations/20261124193000_facet_reader_lineage.sql
\ir ../migrations/20261124193000_facet_reader_lineage.sql
-- the family asked once per model (20261124193200): same output
\ir ../migrations/20261124193200_facet_reader_lineage_once.sql
\ir ../migrations/20261124193200_facet_reader_lineage_once.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb; d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  PERFORM public.t_assert((length(d) - length(replace(d, 'facet_reader_lineage_v1', ''))) / length('facet_reader_lineage_v1') = 1,
    'patched once');
  PERFORM public.t_assert((length(d) - length(replace(d, 'facet_reader_lineage_v2', ''))) / length('facet_reader_lineage_v2') = 1
      AND position('public.reader_lineage(o.agent_model)' IN d) = 0, 'v2 patched once; no per-row lookup left');
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'engine', 'engine.current.block_casting');
  PERFORM public.t_assert(item->>'status' = 'reading', format('Opus + Sonnet on one photo is one reader; got %s', item->>'status'));
  PERFORM public.t_assert(item#>>'{sources,0,reader}' = 'anthropic', format('source names its lineage; got %s', item->'sources'));
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'transmission', 'transmission.current.case_casting');
  PERFORM public.t_assert(item->>'status' = 'established' AND item->>'value' = '3851325',
    format('two lineages reading one photo alike establish; got %s', item));
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'engine', 'engine.current.engine_code_stamp');
  PERFORM public.t_assert(item->>'status' = 'reading', format('two methods of one model stay a reading; got %s', item->>'status'));
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'transmission', 'transmission.current.tailhousing_casting');
  PERFORM public.t_assert(item->>'status' = 'conflict' AND jsonb_array_length(item->'sides') = 2,
    format('a stamp read with and without a suffix is a conflict with two sides; got %s', item));
  PERFORM public.t_assert((SELECT bool_and(s#>>'{sources,0,reader}' IS NOT NULL) FROM jsonb_array_elements(item->'sides') s),
    'each side names its reader');
  PERFORM public.t_assert((SELECT count(DISTINCT s#>>'{sources,0,reader}') FROM jsonb_array_elements(item->'sides') s) = 2,
    'the sides are two lineages; a model with no row is its own');
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'transmission', 'transmission.current.id_stamp');
  PERFORM public.t_assert(item->>'status' = 'established', format('two models with no row are two lineages; got %s', item->>'status'));
  item := public.t_item('10000000-0000-0000-0000-000000000003', 'transmission', 'transmission.current.bellhousing_casting');
  PERFORM public.t_assert(item->>'status' = 'reading', format('no model recorded: one source per photo, as before; got %s', item->>'status'));
  PERFORM public.t_assert(public.reader_lineage('claude-opus-5-5') = 'anthropic' AND public.reader_lineage(' claude-sonnet-5-5 ') = 'anthropic'
      AND public.reader_lineage('Codex interactive assistant; exact model version not exposed') = 'openai'
      AND public.reader_lineage('model-y') = 'model-y' AND public.reader_lineage('') IS NULL AND public.reader_lineage(NULL) IS NULL,
    'anon gets a family, never a registry row: provider for a known caller, else the model itself');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.model_registry), 'anon still reads no registry row');
END $$;
RESET ROLE;
\echo facet_reader_lineage: ok
