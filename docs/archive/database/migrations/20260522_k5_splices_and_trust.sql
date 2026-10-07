-- =========================================================================
-- 2026-05-22 — Two further substrate moves:
--
-- 1. Calibrate observation_sources.base_trust_score.
--    Cut list and closure receipts were both 0.95, but receipts triangulate
--    against multiple sources (per the wire-closure protocol) while the cut
--    list has been amended multiple times (Tefzel correction, gauge fixes).
--    Nudge receipts up, cut list down — modest delta, enough to break ties
--    in vehicle_canonical when both sources have observations for the same
--    (wire_id, property_id).
--
-- 2. Seed the 4 known K5 Y-splices as vehicle_observations with kind='splice'.
--    structured_data carries splice_pn (unknown for now — substrate flag),
--    splice_type, input/output wire_ids, location landmark.
--    Per research §5: coil distribution, injector distribution, BAT_NEG bus,
--    ETB connector branch.
-- =========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1: trust calibration
-- ---------------------------------------------------------------------------
UPDATE public.observation_sources
   SET base_trust_score = 0.97,
       notes = COALESCE(notes, '') || E'\n[2026-05-22 calibration] Bumped 0.95→0.97. Wire-closure protocol requires each cell to be cited or explicitly unknown; receipts triangulate against the cut list, connector report, and MoTeC datasheets simultaneously. Higher trust than primary cut list because of multi-source convergence.'
 WHERE slug = 'k5_wire_closure_receipts';

UPDATE public.observation_sources
   SET base_trust_score = 0.90,
       notes = COALESCE(notes, '') || E'\n[2026-05-22 calibration] Nudged 0.95→0.90. Cut list has been amended multiple times (Tefzel placeholder replaced 2026-05-11, gauge audits, 3-stripe remap). Still high-trust but lower than closure receipts that triangulate against multiple sources.'
 WHERE slug = 'k5_cut_list_v2';

-- ---------------------------------------------------------------------------
-- Part 2: 4 K5 Y-splice observations
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_source uuid;
  v_research text := 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md';
BEGIN
  -- Need a source for splice substrate. Use a new "k5_splice_design" source
  -- under category=internal — these are design-time entities, not yet
  -- physically built or verified.
  INSERT INTO public.observation_sources
    (slug, display_name, category, base_trust_score, supported_observations, notes, tier)
  VALUES
    ('k5_splice_design',
     'K5 Splice Design (research-derived, awaiting build documentation)',
     'internal',
     0.60,
     ARRAY['splice']::observation_kind[],
     'Design-time identification of splice points on the K5 harness. Research §5 named 4 known Y-splices; PNs and physical locations are pending build decisions. Confidence is moderate — these splices exist as concepts but no physical PN has been documented yet.',
     2)
  ON CONFLICT (slug) DO UPDATE SET updated_at = now();

  SELECT id INTO v_source FROM public.observation_sources WHERE slug = 'k5_splice_design';

  -- Splice 1: Coil pack +12V distribution
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES (
    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'splice'::observation_kind,
    jsonb_build_object(
      'splice_id', 'splice_coil_12v_dist',
      'name', 'Coil Pack +12V Distribution',
      'loom', 'ENGINE LOOM',
      'splice_type', jsonb_build_object('unknown', true, 'needs', 'Decide: AS81765/1 transition boot (1-to-8) OR Raychem distribution block OR built-up SCL+DR-25 layered'),
      'splice_pn', jsonb_build_object('unknown', true, 'needs', 'Pending splice_type decision; Glenair Series 77 W/X transition boots if going molded'),
      'location_landmark', jsonb_build_object('value', 'L01', 'source', 'Engine bay top center, coil pack ridge per K5_wire_paths.yaml'),
      'input_wire_ids', jsonb_build_array(),
      'input_wire_count_expected', 1,
      'input_wire_note', 'One +12V trunk feed from PDM30 OUT (8A output channel — TBD which one)',
      'output_wire_ids', jsonb_build_array('5','7','8','9','10','11','12','12'),
      'output_wire_count', 8,
      'output_wire_note', 'Branches to 8 ignition coils (Coil 1-8). Cut list IDs 5-12 are the M130 signal wires; the +12V feed branches are NOT enumerated in K5_cut_list_v2.txt yet (known gap per LOOP_LOG iter 1)',
      'citation', v_research || ' §5'
    ),
    v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.60,
    'Splice: Coil Pack +12V Distribution (1→8) — physical PN pending'
  );

  -- Splice 2: Injector +12V distribution
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES (
    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'splice'::observation_kind,
    jsonb_build_object(
      'splice_id', 'splice_inj_12v_dist',
      'name', 'Injector +12V Distribution',
      'loom', 'ENGINE LOOM',
      'splice_type', jsonb_build_object('unknown', true, 'needs', 'Same decision tree as coil distribution'),
      'splice_pn', jsonb_build_object('unknown', true, 'needs', 'Pending'),
      'location_landmark', jsonb_build_object('value', 'L02', 'source', 'Intake manifold center per K5_wire_paths.yaml'),
      'input_wire_ids', jsonb_build_array(),
      'input_wire_count_expected', 1,
      'input_wire_note', 'One +12V trunk feed from PDM30',
      'output_wire_ids', jsonb_build_array('13','14','15','16','17','18','19','20'),
      'output_wire_count', 8,
      'output_wire_note', 'Branches to 8 fuel injectors. Cut list IDs 13-20 are the M130 INJ_PH signal wires; the +12V branches are NOT in cut list yet.',
      'citation', v_research || ' §5'
    ),
    v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.60,
    'Splice: Injector +12V Distribution (1→8) — physical PN pending'
  );

  -- Splice 3: M130 BAT_NEG paralleled bus
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES (
    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'splice'::observation_kind,
    jsonb_build_object(
      'splice_id', 'splice_m130_bat_neg',
      'name', 'M130 Battery Negative (paralleled)',
      'loom', 'ENGINE LOOM',
      'splice_type', jsonb_build_object('value', 'commoned_at_connector', 'source', 'CONNECTOR_DATA_REPORT.md §2.4 — pins A10 and A11 are both BAT_NEG'),
      'splice_pn', jsonb_build_object('value', 'N/A (commoned at chassis ground stud, no in-line splice)', 'source', 'motorsport convention — multiple BAT_NEG pins land on a single ring lug at the engine block ground point'),
      'location_landmark', jsonb_build_object('unknown', true, 'needs', 'Identify the chassis ground stud location — likely engine block thread per LS3 service manual'),
      'input_wire_ids', jsonb_build_array(),
      'input_wire_count_expected', 2,
      'input_wire_note', 'Two BAT_NEG wires from M130 A10 + A11. Cut list does not enumerate the M130-side wires — see K5_cut_list_v2.txt and confirm.',
      'output_wire_ids', jsonb_build_array(),
      'output_wire_count', 1,
      'output_wire_note', 'One trunk to chassis ground. Cut list entry TBD.',
      'citation', 'CONNECTOR_DATA_REPORT.md §2.4 (M130 pinout) + ' || v_research || ' §5'
    ),
    v_source, v_user, now(), 'normal'::vfc_rank, 'medium'::confidence_level, 0.70,
    'Splice: M130 BAT_NEG paralleled bus (2→1)'
  );

  -- Splice 4: ETB connector branch
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES (
    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'splice'::observation_kind,
    jsonb_build_object(
      'splice_id', 'splice_etb_branch',
      'name', 'ETB Connector Branch',
      'loom', 'ENGINE LOOM',
      'splice_type', jsonb_build_object('value', 'molded_connector_branch', 'source', 'GM 12605109 ETB connector — 6 pins on one connector, each going to a different M130 pin. Not a heat-shrink splice; the connector itself is the branch point.'),
      'splice_pn', jsonb_build_object('value', 'GM 12605109', 'source', 'K5_cut_list_v2.txt:8 (ETB TAC Motor + TPS + 5V + GND wires all originate at this single connector)'),
      'location_landmark', jsonb_build_object('value', 'L05', 'source', 'ETB position per K5_wire_paths.yaml — driver-side intake'),
      'input_wire_ids', jsonb_build_array(),
      'input_wire_count_expected', 0,
      'input_wire_note', 'No trunk input — the 6 wires originate AT this connector and fan out to different M130 pins',
      'output_wire_ids', jsonb_build_array('4a','4b','4c','4d','4e','4f'),
      'output_wire_count', 6,
      'output_wire_note', 'Wires #4a-4f exit ETB connector to M130 (A01, A18, A14, A17, A02, B15)',
      'citation', 'K5_cut_list_v2.txt §ENGINE LOOM rows for #4a-#4f + ' || v_research || ' §5'
    ),
    v_source, v_user, now(), 'normal'::vfc_rank, 'high'::confidence_level, 0.90,
    'Splice: ETB Connector Branch (0→6) — connector is the branch point'
  );

  RAISE NOTICE 'Inserted 4 splice observations under k5_splice_design source.';
END $$;

-- Verification
\echo '=== source trust scores ==='
SELECT slug, base_trust_score, tier, category::text
FROM public.observation_sources
WHERE slug LIKE 'k5_%'
ORDER BY slug;

\echo '=== splice observations ==='
SELECT
  vo.structured_data->>'splice_id' AS splice_id,
  vo.structured_data->>'name' AS name,
  vo.structured_data->>'output_wire_count' AS outputs,
  vo.confidence::text AS conf,
  vo.confidence_score
FROM public.vehicle_observations vo
WHERE vo.kind = 'splice'::observation_kind
  AND vo.is_superseded = false;

\echo '=== final K5 substrate state ==='
SELECT
  (SELECT count(*) FROM public.observation_properties WHERE category='wiring') AS wiring_props,
  (SELECT count(*) FROM public.vehicle_observations
    WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND property_id IS NOT NULL AND is_superseded=false) AS k5_cited_cells_by_property,
  (SELECT count(*) FROM public.vehicle_observations
    WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND kind='splice'::observation_kind AND is_superseded=false) AS k5_splices;

COMMIT;
