-- Replica accuracy rework + programmatic byok → keyed component fold.
--
-- Skylar review 2026-11-22 (PR split from documented-spend):
--   * Identity/cowl WS4 absence is definitional for a Firebird-bodied replica — record as
--     base chassis, exclude from accuracy score.
--   * Replace one-car casting literals with replica_target_specs.
--   * Drivetrain/appearance must evaluate against the target table (never dead unknown branches).
--   * Persist image groups + per-component decisions (supersession, evidence ids).
--   * Priority: deterministic raw byok_deep_analysis → keyed observations (idempotent).
--
-- No production apply / dry_run=false without owner approval.
-- Contracts: supabase/sql/test_fold_byok_component_observations.sql
--            supabase/sql/test_vehicle_replica_accuracy.sql
-- Revert:    supabase/sql/revert_20261122081000_replica_target_byok_component_fold.sql

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET search_path = public;

-- =============================================================================
-- 1. Target specs (catalog, not one-car literals)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.replica_target_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key text NOT NULL,
  year_from int,
  year_to int,
  make text,
  model text,
  trim_label text,
  component_key text NOT NULL,
  weight numeric NOT NULL CHECK (weight > 0),
  factory_value text,
  acceptable_categories text[] NOT NULL DEFAULT ARRAY['factory_correct','correct_reproduction'],
  match_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  citation_url text,
  cited_on date,
  sourced boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_key, component_key)
);

COMMENT ON TABLE public.replica_target_specs IS
  'Declared replica target components (e.g. 1973-74 Trans Am SD-455). Weights and '
  'acceptable match categories live here; vehicle_replica_accuracy reads them. '
  'sourced=false means the factory_value is provisional / unsourced.';

REVOKE ALL ON TABLE public.replica_target_specs FROM PUBLIC;
GRANT SELECT ON TABLE public.replica_target_specs TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.replica_target_specs TO service_role;

-- Seed 1973-74 Trans Am SD-455. Sourced rows cite a URL; others are marked unsourced.
INSERT INTO public.replica_target_specs (
  target_key, year_from, year_to, make, model, trim_label,
  component_key, weight, factory_value, acceptable_categories, match_rules,
  citation_url, cited_on, sourced, notes
) VALUES
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'engine_block', 20, '485248',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"castings_factory":["485248"],"castings_period_455":["9799140","3970010"],"stamps_period":["YH","YS","XP"]}'::jsonb,
   NULL, NULL, false,
   'SD-455 block casting often cited as 485248 family; unsourced here until a primary manual page is bound'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'engine_heads', 5, '16',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"codes_factory":["16"]}'::jsonb,
   NULL, NULL, false, 'Round-port SD heads; unsourced pending primary citation'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'transmission', 10, 'Muncie / TH400 era',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"case_castings_period":["3851325","3925661"],"id_stamp_prefix":["P"]}'::jsonb,
   NULL, NULL, false, 'Period Muncie/TH400 case castings accepted as substitute until sourced SD list'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'rear_axle', 5, '3.42',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"ratios_factory":["3.42","3.08"]}'::jsonb,
   NULL, NULL, false, 'Common SD axle ratios; unsourced'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'hood_scoop', 15, 'shaker',
   ARRAY['factory_correct','correct_reproduction'],
   '{"labels_any":["shaker"]}'::jsonb,
   NULL, NULL, false, 'Functional shaker scoop is definitional for SD-455 Trans Am appearance'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'hood_bird_decal', 10, 'present',
   ARRAY['factory_correct','correct_reproduction'],
   '{"labels_any":["hood bird","bird graphic","screaming chicken"]}'::jsonb,
   NULL, NULL, false, 'Hood bird decal'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'rear_spoiler', 10, 'present',
   ARRAY['factory_correct','correct_reproduction'],
   '{"labels_any":["rear spoiler","deck spoiler"]}'::jsonb,
   NULL, NULL, false, 'Trans Am rear spoiler'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'wheels', 8, 'rally_ii',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"labels_any":["wheel","rally","white-letter"]}'::jsonb,
   NULL, NULL, false, 'Period wheels / white-letter tires as substitute'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'brakes', 5, 'power_disc',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"labels_any":["brake booster","master cylinder","disc brake"]}'::jsonb,
   NULL, NULL, false, 'Power brake hardware visible'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'interior', 7, 'ta_interior',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"labels_any":["formula steering","engine-turned","rally gauge","bucket seat"]}'::jsonb,
   NULL, NULL, false, 'TA interior cues; mostly unknown until keyed'),
  ('1973_trans_am_sd455', 1973, 1974, 'Pontiac', 'Firebird', 'Trans Am SD-455',
   'intake_carb', 5, 'sd_intake',
   ARRAY['factory_correct','correct_reproduction','period_correct_substitute'],
   '{"labels_any":["intake manifold","carburetor","carb"]}'::jsonb,
   NULL, NULL, false, 'Intake/carb presence only until casting IDs are keyed')
ON CONFLICT (target_key, component_key) DO NOTHING;

-- =============================================================================
-- 2. Image groups (member ids as array — not a per-photo reading table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_image_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  group_key text NOT NULL,
  scene_type text,
  build_phase text,
  member_image_ids uuid[] NOT NULL DEFAULT '{}',
  grouping_method text NOT NULL,
  grouping_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (vehicle_id, group_key, grouping_version)
);

COMMENT ON TABLE public.vehicle_image_groups IS
  'Coherent image sets for group-level reading (scene/phase/session). Stores member_image_ids; '
  'does not store photo readings (those stay on vehicle_observations).';

REVOKE ALL ON TABLE public.vehicle_image_groups FROM PUBLIC;
GRANT SELECT ON TABLE public.vehicle_image_groups TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.vehicle_image_groups TO service_role;

-- =============================================================================
-- 3. Component decisions (append-only via supersession)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_replica_component_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  target_key text NOT NULL,
  component_key text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'factory_correct','correct_reproduction','period_correct_substitute',
    'non_correct','unknown','base_chassis','excluded')),
  confidence numeric,
  evidence_observation_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_image_ids uuid[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  method text NOT NULL,
  logic_version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  is_superseded boolean NOT NULL DEFAULT false,
  superseded_by uuid,
  superseded_at timestamptz,
  supersede_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_replica_component_decisions_one_current
  ON public.vehicle_replica_component_decisions (vehicle_id, target_key, component_key)
  WHERE coalesce(is_superseded, false) IS NOT TRUE;

COMMENT ON TABLE public.vehicle_replica_component_decisions IS
  'Current and superseded replica-component decisions. Later passes supersede with a reason; '
  'never silently overwrite. vehicle_replica_accuracy reads current rows only.';

REVOKE ALL ON TABLE public.vehicle_replica_component_decisions FROM PUBLIC;
GRANT SELECT ON TABLE public.vehicle_replica_component_decisions TO authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.vehicle_replica_component_decisions TO service_role;

-- =============================================================================
-- 4. Observation properties for keyed byok component sightings
-- =============================================================================

INSERT INTO public.observation_properties (
  property_key, label, data_type, namespace, category, applies_to_kinds,
  cardinality, description, discriminator_key, verification_scope, ratified_at
)
SELECT * FROM (VALUES
  ('image_visible_hood_scoop_style', 'Visible hood scoop style in image', 'enum', 'core', 'appearance',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: shaker, none, other, not_visible, cannot_tell. Presence of a scoop style in pixels, not originality.',
   'image_id', 'instance', now()),
  ('image_visible_hood_bird_decal', 'Visible hood bird decal in image', 'enum', 'core', 'appearance',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: present, absent, not_visible, cannot_tell.',
   'image_id', 'instance', now()),
  ('image_visible_rear_spoiler', 'Visible rear spoiler in image', 'enum', 'core', 'appearance',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: present, absent, not_visible, cannot_tell.',
   'image_id', 'instance', now()),
  ('image_visible_wheel_style', 'Visible wheel style in image', 'enum', 'core', 'appearance',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: rally, other, not_visible, cannot_tell.',
   'image_id', 'instance', now()),
  ('image_visible_brake_booster', 'Visible brake booster in image', 'enum', 'core', 'drivetrain',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: present, absent, not_visible, cannot_tell.',
   'image_id', 'instance', now()),
  ('image_visible_intake_manifold', 'Visible intake manifold in image', 'enum', 'core', 'drivetrain',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: present, absent, not_visible, cannot_tell.',
   'image_id', 'instance', now()),
  ('image_visible_carburetor', 'Visible carburetor in image', 'enum', 'core', 'drivetrain',
   '{condition}'::text[], 'multi',
   'Grain: one byok reading of one image. Values: present, absent, not_visible, cannot_tell.',
   'image_id', 'instance', now())
) AS v(property_key, label, data_type, namespace, category, applies_to_kinds,
       cardinality, description, discriminator_key, verification_scope, ratified_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.observation_properties op WHERE op.property_key = v.property_key
);

-- =============================================================================
-- 5. Deterministic label → property normalizer
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_byok_component_label(p_label text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  lab text := lower(coalesce(p_label, ''));
BEGIN
  IF lab = '' THEN
    RETURN NULL;
  END IF;

  IF lab ~ 'shaker' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_hood_scoop_style',
      'value', 'shaker',
      'component_key', 'hood_scoop');
  END IF;

  IF lab ~ 'hood bird|bird graphic|screaming chicken' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_hood_bird_decal',
      'value', 'present',
      'component_key', 'hood_bird_decal');
  END IF;

  IF lab ~ 'rear (deck )?spoiler|deck spoiler' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_rear_spoiler',
      'value', 'present',
      'component_key', 'rear_spoiler');
  END IF;

  IF lab ~ 'wheel' AND lab ~ 'white-letter|rally' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_wheel_style',
      'value', 'rally',
      'component_key', 'wheels');
  END IF;

  IF lab ~ 'wheel' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_wheel_style',
      'value', 'other',
      'component_key', 'wheels');
  END IF;

  IF lab ~ 'brake booster|vacuum booster|master cylinder' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_brake_booster',
      'value', 'present',
      'component_key', 'brakes');
  END IF;

  IF lab ~ 'intake manifold' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_intake_manifold',
      'value', 'present',
      'component_key', 'intake_carb');
  END IF;

  IF lab ~ 'carburetor|(^| )carb($| )' THEN
    RETURN jsonb_build_object(
      'property_key', 'image_visible_carburetor',
      'value', 'present',
      'component_key', 'intake_carb');
  END IF;

  RETURN NULL; -- unparsed label; never invent a key
END
$fn$;

COMMENT ON FUNCTION public.normalize_byok_component_label(text) IS
  'Deterministic map from byok components_seen.label text to a closed property_key/value. '
  'Returns null when the label is not in the vocabulary (unknown stays unknown).';

REVOKE ALL ON FUNCTION public.normalize_byok_component_label(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_byok_component_label(text) TO anon, authenticated, service_role;

-- =============================================================================
-- 6. Group images (scene + phase + hour bucket)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.group_vehicle_images_for_reading(
  p_vehicle_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  groups jsonb := '[]'::jsonb;
  g record;
  new_id uuid;
  version text := 'group_vehicle_images_for_reading/20261122081000';
BEGIN
  FOR g IN
    SELECT
      coalesce(byok->>'scene_type', 'unknown') AS scene_type,
      coalesce(byok->>'build_phase_guess', 'unknown') AS build_phase,
      date_trunc('hour', coalesce(vi.taken_at, vi.created_at)) AS hour_bucket,
      array_agg(vi.id ORDER BY coalesce(vi.taken_at, vi.created_at), vi.id) AS member_ids,
      count(*)::int AS n
    FROM vehicle_images vi
    CROSS JOIN LATERAL (SELECT vi.ai_scan_metadata->'byok_deep_analysis' AS byok) b
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_superseded, false) IS NOT TRUE
      AND coalesce(vi.is_duplicate, false) IS NOT TRUE
      AND vi.ai_scan_metadata ? 'byok_deep_analysis'
    GROUP BY 1, 2, 3
  LOOP
    groups := groups || jsonb_build_object(
      'group_key', format('%s|%s|%s', g.scene_type, g.build_phase, g.hour_bucket),
      'scene_type', g.scene_type,
      'build_phase', g.build_phase,
      'hour_bucket', g.hour_bucket,
      'member_count', g.n,
      'member_image_ids', to_jsonb(g.member_ids)
    );
    IF NOT p_dry_run THEN
      new_id := gen_random_uuid();
      INSERT INTO vehicle_image_groups (
        id, vehicle_id, group_key, scene_type, build_phase, member_image_ids,
        grouping_method, grouping_version
      ) VALUES (
        new_id, p_vehicle_id,
        format('%s|%s|%s', g.scene_type, g.build_phase, g.hour_bucket),
        g.scene_type, g.build_phase, g.member_ids,
        'scene_phase_hour_bucket', version
      )
      ON CONFLICT (vehicle_id, group_key, grouping_version) DO UPDATE SET
        member_image_ids = EXCLUDED.member_image_ids,
        scene_type = EXCLUDED.scene_type,
        build_phase = EXCLUDED.build_phase;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'dry_run', p_dry_run,
    'group_count', jsonb_array_length(groups),
    'groups', groups,
    'logic_version', version,
    'as_of', now()
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.group_vehicle_images_for_reading(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.group_vehicle_images_for_reading(uuid, boolean) TO service_role;

-- =============================================================================
-- 7. Fold byok → keyed observations (priority step 4)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fold_byok_component_observations(
  p_vehicle_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  version text := 'fold_byok_component_observations/20261122081000';
  img record;
  lab jsonb;
  norm jsonb;
  prop_id uuid;
  claims jsonb := '[]'::jsonb;
  inserted int := 0;
  unchanged int := 0;
  images_with_byok int := 0;
  images_producing int := 0;
  labels_seen int := 0;
  labels_parsed int := 0;
  by_prop jsonb := '{}'::jsonb;
  existing_id uuid;
  new_obs_id uuid;
  sd jsonb;
  produced_this_image boolean;
BEGIN
  FOR img IN
    SELECT vi.id AS image_id,
           vi.taken_at,
           vi.created_at,
           vi.ai_scan_metadata->'byok_deep_analysis' AS byok,
           (SELECT vo.id FROM vehicle_observations vo
             WHERE vo.vehicle_id = p_vehicle_id
               AND coalesce(vo.is_superseded, false) IS NOT TRUE
               AND vo.structured_data->>'analysis_kind' = 'image_deep_byok'
               AND vo.structured_data->>'image_id' = vi.id::text
             ORDER BY vo.ingested_at DESC NULLS LAST
             LIMIT 1) AS source_observation_id
      FROM vehicle_images vi
     WHERE vi.vehicle_id = p_vehicle_id
       AND coalesce(vi.is_superseded, false) IS NOT TRUE
       AND coalesce(vi.is_duplicate, false) IS NOT TRUE
       AND vi.ai_scan_metadata ? 'byok_deep_analysis'
  LOOP
    images_with_byok := images_with_byok + 1;
    produced_this_image := false;

    FOR lab IN
      SELECT value FROM jsonb_array_elements(coalesce(img.byok->'components_seen', '[]'::jsonb))
    LOOP
      labels_seen := labels_seen + 1;
      norm := public.normalize_byok_component_label(lab->>'label');
      IF norm IS NULL THEN
        CONTINUE;
      END IF;
      labels_parsed := labels_parsed + 1;
      produced_this_image := true;

      SELECT id INTO prop_id FROM observation_properties
       WHERE property_key = norm->>'property_key' LIMIT 1;
      IF prop_id IS NULL THEN
        CONTINUE;
      END IF;

      sd := jsonb_build_object(
        'analysis_kind', 'byok_component_fold',
        'property_key', norm->>'property_key',
        (norm->>'property_key'), norm->>'value',
        'image_id', img.image_id,
        'source_observation_id', img.source_observation_id,
        'source_label', lab->>'label',
        'component_key', norm->>'component_key',
        'fold_method', version,
        'claim_role', 'inferred',
        'scene_type', img.byok->>'scene_type',
        'limitation', 'Deterministic parse of stored byok components_seen label. Not originality or whole-vehicle completeness.'
      );

      claims := claims || jsonb_build_object(
        'image_id', img.image_id,
        'property_key', norm->>'property_key',
        'value', norm->>'value',
        'component_key', norm->>'component_key',
        'source_label', lab->>'label',
        'property_id', prop_id,
        'structured_data', sd
      );

      by_prop := jsonb_set(
        by_prop,
        ARRAY[norm->>'property_key'],
        to_jsonb(coalesce((by_prop->> (norm->>'property_key'))::int, 0) + 1)
      );

      IF NOT p_dry_run THEN
        SELECT vo.id INTO existing_id
          FROM vehicle_observations vo
         WHERE vo.vehicle_id = p_vehicle_id
           AND vo.property_id = prop_id
           AND coalesce(vo.is_superseded, false) IS NOT TRUE
           AND vo.extraction_method = version
           AND vo.structured_data->>'image_id' = img.image_id::text
           AND vo.structured_data->> (norm->>'property_key') = norm->>'value'
         LIMIT 1;

        IF existing_id IS NOT NULL THEN
          unchanged := unchanged + 1;
        ELSE
          new_obs_id := gen_random_uuid();
          INSERT INTO vehicle_observations (
            id, vehicle_id, kind, property_id, extraction_method,
            structured_data, content_text, confidence_score,
            observed_at, ingested_at, is_superseded
          ) VALUES (
            new_obs_id, p_vehicle_id, 'condition', prop_id, version,
            sd,
            format('byok fold: %s=%s from label %s', norm->>'property_key', norm->>'value', lab->>'label'),
            least(0.95, greatest(0.5, coalesce((lab->>'confidence')::numeric, 0.7))),
            coalesce(img.taken_at, img.created_at, now()),
            now(), false
          );
          inserted := inserted + 1;
        END IF;
      END IF;
    END LOOP;

    IF produced_this_image THEN
      images_producing := images_producing + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'dry_run', p_dry_run,
    'images_with_byok', images_with_byok,
    'images_producing_keyed', images_producing,
    'fraction_images_producing_keyed',
      CASE WHEN images_with_byok > 0
           THEN round(images_producing::numeric / images_with_byok, 4)
           ELSE NULL END,
    'labels_seen', labels_seen,
    'labels_parsed', labels_parsed,
    'fraction_labels_parsed',
      CASE WHEN labels_seen > 0
           THEN round(labels_parsed::numeric / labels_seen, 4)
           ELSE NULL END,
    'claims_proposed', jsonb_array_length(claims),
    'claims_inserted', inserted,
    'claims_unchanged', unchanged,
    'by_property', by_prop,
    'sample_claims', (SELECT coalesce(jsonb_agg(c), '[]'::jsonb)
                        FROM (SELECT value AS c FROM jsonb_array_elements(claims) LIMIT 20) s),
    'logic_version', version,
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.fold_byok_component_observations(uuid, boolean) IS
  'Deterministic, idempotent fold: byok components_seen labels → keyed vehicle_observations '
  '(closed enums). dry_run defaults true. Unparsed labels stay unparsed (never guess).';

REVOKE ALL ON FUNCTION public.fold_byok_component_observations(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fold_byok_component_observations(uuid, boolean) TO service_role;

-- =============================================================================
-- 8. Decide replica components from evidence + target specs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.decide_replica_components(
  p_vehicle_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  version text := 'decide_replica_components/20261122081000';
  v record;
  v_target_key text;
  spec record;
  cat text;
  casting text;
  stamp text;
  case_cast text;
  id_stamp text;
  style text;
  absents text[];
  sight_count int;
  evid_imgs uuid[];
  evid_obs uuid[];
  actions jsonb := '[]'::jsonb;
  new_id uuid;
  old_id uuid;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vehicle_not_found');
  END IF;
  IF coalesce(v.is_replica, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('applicable', false, 'reason', 'not is_replica');
  END IF;

  v_target_key := CASE
    WHEN v.replica_quote ILIKE '%SD-455%' OR v.replica_quote ILIKE '%SD455%'
         OR v.replica_quote ILIKE '%Trans Am%'
      THEN '1973_trans_am_sd455'
    ELSE NULL
  END;
  IF v_target_key IS NULL THEN
    RETURN jsonb_build_object('applicable', false, 'reason', 'no matching replica_target_specs key');
  END IF;

  SELECT max(vo.structured_data->>'engine_block_casting'),
         max(vo.structured_data->>'engine_code_stamp')
    INTO casting, stamp
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('engine_block_casting', 'engine_code_stamp');

  SELECT max(vo.structured_data->>'transmission_case_casting'),
         max(vo.structured_data->>'transmission_id_stamp')
    INTO case_cast, id_stamp
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('transmission_case_casting', 'transmission_id_stamp');

  SELECT max(vo.structured_data->>'body_tag_style'),
         coalesce((
           SELECT array_agg(DISTINCT a)
             FROM vehicle_observations vo2
             JOIN observation_properties op2 ON op2.id = vo2.property_id
             CROSS JOIN LATERAL jsonb_array_elements_text(
               coalesce(vo2.structured_data->'absent_codes_checked', '[]'::jsonb)) a
            WHERE vo2.vehicle_id = p_vehicle_id
              AND coalesce(vo2.is_superseded, false) IS NOT TRUE
              AND op2.property_key = 'body_tag_option_codes'
         ), '{}'::text[])
    INTO style, absents
    FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE vo.vehicle_id = p_vehicle_id
     AND coalesce(vo.is_superseded, false) IS NOT TRUE
     AND op.property_key IN ('body_tag_style', 'body_tag_option_codes');

  -- Base chassis fact (excluded from score).
  cat := 'base_chassis';
  actions := actions || jsonb_build_object(
    'component_key', 'base_chassis',
    'category', cat,
    'evidence', jsonb_build_object(
      'body_tag_style', style,
      'absent_codes', to_jsonb(absents),
      'note', 'Declared Firebird-bodied replica; WS4 absence is definitional, not a penalty'
    )
  );

  FOR spec IN
    SELECT * FROM replica_target_specs WHERE replica_target_specs.target_key = v_target_key
  LOOP
    evid_imgs := '{}';
    evid_obs := '{}';
    cat := 'unknown';

    IF spec.component_key = 'engine_block' THEN
      IF casting IS NULL AND stamp IS NULL THEN
        cat := 'unknown';
      ELSIF casting = ANY (ARRAY(SELECT jsonb_array_elements_text(spec.match_rules->'castings_factory'))) THEN
        cat := 'factory_correct';
      ELSIF casting = ANY (ARRAY(SELECT jsonb_array_elements_text(spec.match_rules->'castings_period_455'))) THEN
        cat := 'period_correct_substitute';
      ELSE
        cat := 'non_correct';
      END IF;

    ELSIF spec.component_key = 'transmission' THEN
      IF case_cast IS NULL AND id_stamp IS NULL THEN
        cat := 'unknown';
      ELSIF case_cast = ANY (ARRAY(SELECT jsonb_array_elements_text(spec.match_rules->'case_castings_period'))) THEN
        cat := 'period_correct_substitute';
      ELSIF id_stamp IS NOT NULL THEN
        cat := 'period_correct_substitute';
      ELSE
        cat := 'unknown';
      END IF;

    ELSIF spec.component_key IN ('hood_scoop','hood_bird_decal','rear_spoiler','wheels','brakes','intake_carb','interior') THEN
      SELECT count(*),
             coalesce(array_agg(DISTINCT (vo.structured_data->>'image_id')::uuid)
                        FILTER (WHERE vo.structured_data->>'image_id' IS NOT NULL), '{}'),
             coalesce(array_agg(DISTINCT vo.id), '{}')
        INTO sight_count, evid_imgs, evid_obs
        FROM vehicle_observations vo
        JOIN observation_properties op ON op.id = vo.property_id
       WHERE vo.vehicle_id = p_vehicle_id
         AND coalesce(vo.is_superseded, false) IS NOT TRUE
         AND (
           (spec.component_key = 'hood_scoop' AND op.property_key = 'image_visible_hood_scoop_style'
              AND vo.structured_data->>'image_visible_hood_scoop_style' = 'shaker')
           OR (spec.component_key = 'hood_bird_decal' AND op.property_key = 'image_visible_hood_bird_decal'
              AND vo.structured_data->>'image_visible_hood_bird_decal' = 'present')
           OR (spec.component_key = 'rear_spoiler' AND op.property_key = 'image_visible_rear_spoiler'
              AND vo.structured_data->>'image_visible_rear_spoiler' = 'present')
           OR (spec.component_key = 'wheels' AND op.property_key = 'image_visible_wheel_style'
              AND vo.structured_data->>'image_visible_wheel_style' IN ('rally','other'))
           OR (spec.component_key = 'brakes' AND op.property_key = 'image_visible_brake_booster'
              AND vo.structured_data->>'image_visible_brake_booster' = 'present')
           OR (spec.component_key = 'intake_carb' AND op.property_key IN (
                 'image_visible_intake_manifold','image_visible_carburetor')
              AND (vo.structured_data->>'image_visible_intake_manifold' = 'present'
                   OR vo.structured_data->>'image_visible_carburetor' = 'present'))
           OR (spec.component_key = 'interior' AND false) -- reserved until interior labels keyed
         );

      IF sight_count > 0 THEN
        IF spec.component_key = 'wheels' THEN
          cat := 'period_correct_substitute';
        ELSIF spec.component_key IN ('brakes','intake_carb') THEN
          cat := 'period_correct_substitute';
        ELSE
          cat := 'factory_correct'; -- appearance presence matches target requirement
        END IF;
      ELSE
        cat := 'unknown';
      END IF;

    ELSE
      cat := 'unknown';
    END IF;

    actions := actions || jsonb_build_object(
      'component_key', spec.component_key,
      'weight', spec.weight,
      'category', cat,
      'sourced_spec', spec.sourced,
      'factory_value', spec.factory_value,
      'evidence_image_ids', to_jsonb(evid_imgs),
      'evidence_observation_ids', to_jsonb(evid_obs)
    );

    IF NOT p_dry_run THEN
      SELECT id INTO old_id FROM vehicle_replica_component_decisions
       WHERE vehicle_id = p_vehicle_id AND target_key = v_target_key
         AND component_key = spec.component_key
         AND coalesce(is_superseded, false) IS NOT TRUE
       LIMIT 1;

      IF old_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM vehicle_replica_component_decisions d
         WHERE d.id = old_id AND d.category = cat
           AND d.logic_version = version
      ) THEN
        NULL; -- unchanged
      ELSE
        new_id := gen_random_uuid();
        IF old_id IS NOT NULL THEN
          UPDATE vehicle_replica_component_decisions
             SET is_superseded = true, superseded_by = new_id, superseded_at = now(),
                 supersede_reason = 'newer decide_replica_components pass'
           WHERE id = old_id;
        END IF;
        INSERT INTO vehicle_replica_component_decisions (
          id, vehicle_id, target_key, component_key, category, confidence,
          evidence_observation_ids, evidence_image_ids, evidence,
          method, logic_version
        ) VALUES (
          new_id, p_vehicle_id, v_target_key, spec.component_key, cat,
          CASE cat WHEN 'unknown' THEN NULL ELSE 0.7 END,
          evid_obs, evid_imgs,
          jsonb_build_object('casting', casting, 'stamp', stamp, 'case_cast', case_cast, 'id_stamp', id_stamp),
          'decide_replica_components', version
        );
      END IF;
    END IF;
  END LOOP;

  -- Persist base_chassis decision too.
  IF NOT p_dry_run THEN
    SELECT id INTO old_id FROM vehicle_replica_component_decisions
     WHERE vehicle_id = p_vehicle_id AND target_key = v_target_key
       AND component_key = 'base_chassis'
       AND coalesce(is_superseded, false) IS NOT TRUE
     LIMIT 1;
    new_id := gen_random_uuid();
    IF old_id IS NOT NULL THEN
      UPDATE vehicle_replica_component_decisions
         SET is_superseded = true, superseded_by = new_id, superseded_at = now(),
             supersede_reason = 'newer decide_replica_components pass'
       WHERE id = old_id;
    END IF;
    INSERT INTO vehicle_replica_component_decisions (
      id, vehicle_id, target_key, component_key, category, confidence,
      evidence_observation_ids, evidence_image_ids, evidence, method, logic_version
    ) VALUES (
      new_id, p_vehicle_id, v_target_key, 'base_chassis', 'base_chassis', 0.9,
      '{}', '{}',
      jsonb_build_object('body_tag_style', style, 'absent_codes', to_jsonb(absents)),
      'decide_replica_components', version
    );
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'dry_run', p_dry_run,
    'target_key', v_target_key,
    'actions', actions,
    'logic_version', version,
    'as_of', now()
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.decide_replica_components(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_replica_components(uuid, boolean) TO service_role;

-- =============================================================================
-- 9. vehicle_replica_accuracy — reads decisions + specs; excludes base_chassis
-- =============================================================================

CREATE OR REPLACE FUNCTION public.vehicle_replica_accuracy(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v record;
  v_visible boolean;
  v_target_key text;
  components jsonb := '[]'::jsonb;
  known_weight numeric := 0;
  match_weight numeric := 0;
  unknown_weight numeric := 0;
  total_weight numeric := 0;
  score numeric;
  comp record;
  base_chassis jsonb;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vehicle_not_found');
  END IF;

  v_visible := v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR auth.role() = 'service_role'
         OR (auth.uid() IS NOT NULL AND (
               v.user_id = auth.uid() OR v.owner_id = auth.uid()
               OR v.uploaded_by = auth.uid()
               OR public.vehicle_user_has_access(v.id, auth.uid()))));
  IF v_visible IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  IF coalesce(v.is_replica, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'applicable', false,
      'reason', 'vehicle is not declared is_replica',
      'logic_version', 'vehicle_replica_accuracy/20261122081000'
    );
  END IF;

  v_target_key := CASE
    WHEN v.replica_quote ILIKE '%SD-455%' OR v.replica_quote ILIKE '%SD455%'
         OR v.replica_quote ILIKE '%Trans Am%'
      THEN '1973_trans_am_sd455'
    ELSE NULL
  END;

  IF v_target_key IS NULL THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'applicable', false,
      'reason', 'no replica_target_specs key for replica_quote',
      'logic_version', 'vehicle_replica_accuracy/20261122081000'
    );
  END IF;

  SELECT jsonb_build_object(
           'component', 'base_chassis',
           'category', bc.category,
           'evidence', bc.evidence,
           'excluded_from_score', true
         )
    INTO base_chassis
    FROM vehicle_replica_component_decisions bc
   WHERE bc.vehicle_id = p_vehicle_id AND bc.target_key = v_target_key
     AND bc.component_key = 'base_chassis'
     AND coalesce(bc.is_superseded, false) IS NOT TRUE
   LIMIT 1;

  IF base_chassis IS NULL THEN
    -- Live fallback from cowl without writing.
    base_chassis := jsonb_build_object(
      'component', 'base_chassis',
      'category', 'base_chassis',
      'excluded_from_score', true,
      'note', 'No decision row yet; identity/cowl is not scored as non_correct'
    );
  END IF;

  FOR comp IN
    SELECT s.component_key, s.weight, s.factory_value, s.sourced,
           coalesce(dec.category, 'unknown') AS category,
           dec.evidence, dec.evidence_image_ids, dec.evidence_observation_ids,
           dec.logic_version AS decision_version
      FROM replica_target_specs s
      LEFT JOIN vehicle_replica_component_decisions dec
        ON dec.vehicle_id = p_vehicle_id
       AND dec.target_key = s.target_key
       AND dec.component_key = s.component_key
       AND coalesce(dec.is_superseded, false) IS NOT TRUE
     WHERE s.target_key = v_target_key
     ORDER BY s.weight DESC, s.component_key
  LOOP
    total_weight := total_weight + comp.weight;
    components := components || jsonb_build_object(
      'component', comp.component_key,
      'weight', comp.weight,
      'category', comp.category,
      'factory_value', comp.factory_value,
      'sourced_spec', comp.sourced,
      'evidence', coalesce(comp.evidence, '{}'::jsonb),
      'evidence_image_ids', to_jsonb(coalesce(comp.evidence_image_ids, '{}'::uuid[])),
      'decision_version', comp.decision_version
    );
    IF comp.category = 'unknown' THEN
      unknown_weight := unknown_weight + comp.weight;
    ELSE
      known_weight := known_weight + comp.weight;
      match_weight := match_weight + comp.weight * CASE comp.category
        WHEN 'factory_correct' THEN 1.0
        WHEN 'correct_reproduction' THEN 0.85
        WHEN 'period_correct_substitute' THEN 0.55
        WHEN 'non_correct' THEN 0.0
        ELSE 0 END;
    END IF;
  END LOOP;

  IF known_weight > 0 THEN
    score := round((match_weight / known_weight) * 100, 1);
  ELSE
    score := NULL;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'applicable', true,
    'target_key', v_target_key,
    'target', jsonb_build_object(
      'key', v_target_key,
      'label', coalesce(nullif(btrim(v.replica_quote), ''), 'declared replica'),
      'basis', 'replica_target_specs + vehicles.is_replica'
    ),
    'base_chassis', base_chassis,
    'components', components,
    'known_weight', known_weight,
    'unknown_weight', unknown_weight,
    'total_weight', total_weight,
    'unknown_share', CASE WHEN total_weight > 0
      THEN round(unknown_weight / total_weight, 4) ELSE NULL END,
    'accuracy_score_known_only', score,
    'distinct_from', 'originality_score',
    'logic_version', 'vehicle_replica_accuracy/20261122081000',
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.vehicle_replica_accuracy(uuid) IS
  'Replica accuracy from replica_target_specs + current vehicle_replica_component_decisions. '
  'base_chassis (identity/cowl) is reported but excluded from the score. Unknown share always '
  'reported; never guesses. Public undeleted (or tied/service) only.';

REVOKE ALL ON FUNCTION public.vehicle_replica_accuracy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_replica_accuracy(uuid) TO anon, authenticated, service_role;
