-- =========================================================================
-- 20260522_k5_landmark_estimates.sql
-- Date:   2026-05-22
-- Status: PROPOSED — apply after explicit review.
--
-- Estimates the 30 K5 wiring landmarks (L01-L30) from cited dimensional
-- atoms + LS3 published specs + geometric reasoning. Each observation is
-- confidence='inferred' (~0.45-0.85 depending on anchor data quality).
-- Skylar's eventual tape-measure observations will supersede these.
--
-- VERIFICATION SCOPE: property is declared 'instance' — these are custom
-- to Skylar's K5 mount choices and routing. Class-level priors (LS3 cyl
-- pitch, engine bay dimensions) inform the estimates but don't verify them.
-- Per the 2026-05-22 conversation: wiring has lots of variation; consensus
-- across other K5 builds is irrelevant for these per-build measurements.
--
-- Pre-req: 20260522_add_verification_scope.sql applied first. This script
-- includes a guard re-run of that migration's key DDL in case it didn't.
-- =========================================================================
BEGIN;

-- Idempotent guard: ensure verification_scope column exists.
ALTER TABLE public.observation_properties
  ADD COLUMN IF NOT EXISTS verification_scope text;

DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_proposal_id uuid;
  v_property_id uuid;
  v_source_id uuid;
BEGIN
  -- File + approve the landmark_distance_in property if not yet existing
  IF NOT EXISTS (SELECT 1 FROM public.observation_properties WHERE property_key = 'landmark_distance_in') THEN
    INSERT INTO public.schema_proposals
      (proposed_by_user_id, proposal_type, payload, evidence, estimated_scope, backward_compatibility, status)
    VALUES (v_user, 'add_property',
      jsonb_build_object(
        'property_key', 'landmark_distance_in',
        'label', 'Landmark Distance (in)',
        'data_type', 'numeric',
        'unit', 'inches',
        'namespace_request', 'pending',
        'category', 'wiring',
        'cardinality', 'multi',
        'discriminator_key', 'landmark_id',
        'verification_scope', 'instance',
        'applies_to_kinds', jsonb_build_array('specification','work_record'),
        'expected_source_categories', jsonb_build_array('owner','documentation','internal'),
        'description', 'Tape-routed distance in inches between two named mount/grommet points on the harness route. One observation per landmark (L01..L30) per vehicle. Instance-scoped: each K5 build has its own landmarks because mount placements and routing are per-build. Class priors (LS3 cyl pitch, engine bay dimensions) inform initial estimates but do not verify them.'),
      jsonb_build_array(
        jsonb_build_object('kind','existing_substrate','path','docs/wiring/output/K5_landmarks.yaml','description','30 named landmarks with descriptions, distances null pending measurement'),
        jsonb_build_object('kind','existing_substrate','path','docs/wiring/output/K5_MASTER_MEASUREMENT_PLAN.md','description','Measurement protocol + cheat-sheet')),
      jsonb_build_object('affected_vehicles_count', 1, 'affected_claims_count_estimate', 30),
      jsonb_build_object('existing_data_behavior','preserved_unchanged','rollback_plan','Drop column.','read_api_impact','New optional field.'),
      'open')
    RETURNING id INTO v_proposal_id;

    INSERT INTO public.schema_proposal_reviews (proposal_id, reviewer_user_id, decision, reasoning)
    VALUES (v_proposal_id, v_user, 'approve',
      'Owner self-approval. Instance-scoped wiring property; estimates land at confidence=inferred and await owner-measurement supersession.');
  END IF;

  SELECT id INTO v_property_id FROM public.observation_properties WHERE property_key = 'landmark_distance_in';

  -- Register the estimation source
  INSERT INTO public.observation_sources
    (slug, display_name, category, base_trust_score, supported_observations, notes, tier)
  VALUES
    ('k5_landmark_estimate_2026_05_22',
     'K5 Landmark Distance Estimates (claude-opus-4-7 2026-05-22)',
     'internal',
     0.45,
     ARRAY['specification']::observation_kind[],
     'Geometric estimates of L01-L30 derived from K5_dimensions_atoms.yaml (engine bay dimensions, LS3 envelope, K5 frame stations) + LS3 published specs (cyl bore center) + standard automotive geometry. Confidence 0.45-0.85 per landmark based on anchor data quality. Designed to be superseded by owner tape-measurements (source=owner, confidence=high).',
     3)
  ON CONFLICT (slug) DO UPDATE SET updated_at = now();
  SELECT id INTO v_source_id FROM public.observation_sources WHERE slug = 'k5_landmark_estimate_2026_05_22';

  -- ---------------------------------------------------------------------
  -- 30 landmark observations, with cited reasoning per landmark.
  -- ---------------------------------------------------------------------

  -- Helper macro pattern: insert one observation per landmark with
  -- (id, value, confidence_score, reasoning, anchor_atoms).

  -- L01: M130 → FWG-MAIN (interior firewall, short hop, both on driver side)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L01','property_key','landmark_distance_in','value',8.0,'unit','inches',
      'description','M130 → FWG-MAIN',
      'reasoning','Both M130 and FWG-MAIN are on the driver side firewall, near each other per F3+F6 in K5_MASTER_MEASUREMENT_PLAN.md. Short interior hop.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md F3 (M130 mount: driver side, 4-6" right of brake pedal)','K5_MASTER_MEASUREMENT_PLAN.md F6 (bulkhead disconnect: engine-bay side, between M130 and FWG-MAIN)'),
      'verification_scope','instance'),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L01 estimate: 8.0in — M130 to FWG-MAIN (driver firewall, short hop)');

  -- L02: FWG-MAIN → intake valley junction (through grommet, over valve cover, to engine center top)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L02','property_key','landmark_distance_in','value',26.0,'unit','inches',
      'description','FWG-MAIN → intake valley junction (over valve cover top)',
      'reasoning','Engine bay length 59.96in (atom). Engine sits roughly centered → firewall to bellhousing ~5in, then LS3 envelope_length 27.95in / 2 ≈ 14in from bell to engine center. Plus ~6in routing up and over valve cover to top center.',
      'anchor_atoms', jsonb_build_array('engine_bay.length_firewall_to_radiator_support=59.96in','ls3_long_block.envelope_length=27.95in'),
      'verification_scope','instance'),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.55,
    'L02 estimate: 26.0in');

  -- L03: intake valley junction → Cyl 1 coil (DVC front)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L03','property_key','landmark_distance_in','value',17.0,'unit','inches',
      'description','Intake valley → Cyl 1 coil (DVC front)',
      'reasoning','Half LS3 envelope_length 13.97in from center to front cylinder + ~3in lateral offset from intake centerline to driver bank coil position.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_length=27.95in','ls3_long_block.envelope_width=27.75in (offset estimated as ~1/4 envelope width)'),
      'verification_scope','instance'),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L03 estimate: 17.0in');

  -- L04: cyl-to-cyl pitch DRIVER bank — CLASS-derived from LS3 bore center, high confidence
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L04','property_key','landmark_distance_in','value',4.6,'unit','inches',
      'description','Cyl-to-cyl pitch DRIVER bank',
      'reasoning','LS3 bore_center is 111.76 mm = 4.4 in (LS3-Marine datasheet page 3). Adding ~0.2in routing slack for wire wraparound at coil terminals → 4.6 in.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.bore_center=111.76mm=4.4in (LS3-Marine page 3)'),
      'class_prior_basis','LS3 bore center is a class-level fact (manufacturing constant); routing slack is the instance-specific addition'),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.85,
    'L04 estimate: 4.6in (LS3 bore center + slack)');

  -- L05: intake valley → Cyl 2 PASS front (across intake)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L05','property_key','landmark_distance_in','value',20.0,'unit','inches',
      'description','Intake valley → Cyl 2 coil (PASS front, across intake)',
      'reasoning','Similar to L03 + ~3in lateral cross-intake span. Half engine length to front + bank offset, but to passenger side requires going across the intake top.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_length=27.95in','ls3_long_block.envelope_width=27.75in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L05 estimate: 20.0in');

  -- L06: cyl-to-cyl pitch PASSENGER bank — same class-level prior as L04
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L06','property_key','landmark_distance_in','value',4.6,'unit','inches',
      'description','Cyl-to-cyl pitch PASSENGER bank',
      'reasoning','Same as L04 — LS3 bore_center 4.4in + ~0.2in routing slack.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.bore_center=111.76mm=4.4in'),
      'class_prior_basis','LS3 bore center identical both banks'),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.85,
    'L06 estimate: 4.6in');

  -- L07: coil-to-injector same cyl (vertical drop + small horizontal)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L07','property_key','landmark_distance_in','value',7.0,'unit','inches',
      'description','Coil top → injector at same cyl (side of fuel rail)',
      'reasoning','Coil sits atop valve cover, injector on side of head at fuel rail. Vertical drop ~5in + ~2in lateral.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_height=28.19in (top of intake to oil pan; valve cover top ~20% down from intake top)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L07 estimate: 7.0in');

  -- L08: intake valley → throttle body
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L08','property_key','landmark_distance_in','value',9.0,'unit','inches',
      'description','Intake valley junction → throttle body',
      'reasoning','LS3 cathedral intake length ~18in (typical). ETB at front. Half intake length = 9in.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_length=27.95in (intake spans most of this)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L08 estimate: 9.0in');

  -- L09: intake valley → MAP sensor port
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L09','property_key','landmark_distance_in','value',8.0,'unit','inches',
      'description','Intake valley → MAP sensor port',
      'reasoning','MAP typically rear or central on LS3 intake; per K5_wire_labels.md notes "rear of intake manifold". Short run from center.',
      'anchor_atoms', jsonb_build_array('K5_wire_labels.md MAP location notes')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L09 estimate: 8.0in');

  -- L10: M130 → CKP at bellhousing rear (shielded, away from coils)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L10','property_key','landmark_distance_in','value',40.0,'unit','inches',
      'description','M130 → CKP at bellhousing rear (shielded)',
      'reasoning','M130 at firewall + through FWG + down driver side of block to bellhousing rear. Rough path: 5in firewall to bell + 24in down side + 6in to CKP + shielded bypass 6in.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md §4 shielded_bypass +6in rule','ls3 bellhousing position at rear of engine')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L10 estimate: 40.0in (shielded)');

  -- L11: M130 → CMP at front timing cover
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L11','property_key','landmark_distance_in','value',45.0,'unit','inches',
      'description','M130 → CMP at front timing cover',
      'reasoning','M130 (rear of engine via firewall) all the way to front timing cover. Engine length 28in + firewall-to-bell 5in + routing along DVC to front ~12in.',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_length=27.95in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L11 estimate: 45.0in');

  -- L12: M130 → KS1 driver block (shielded)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L12','property_key','landmark_distance_in','value',34.0,'unit','inches',
      'description','M130 → KS1 driver block below exhaust (shielded)',
      'reasoning','Same path as L10 (M130 down driver side) but to mid-block knock sensor, not bellhousing. ~28in routing + 6in shielded bypass.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md §4 shielded_bypass +6in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L12 estimate: 34.0in (shielded)');

  -- L13: M130 → KS2 passenger block (shielded, cross engine)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L13','property_key','landmark_distance_in','value',40.0,'unit','inches',
      'description','M130 → KS2 passenger block (shielded)',
      'reasoning','Like L12 + cross-engine span ~6in (engine width 27.75in / ~4 since path goes up and over).',
      'anchor_atoms', jsonb_build_array('ls3_long_block.envelope_width=27.75in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L13 estimate: 40.0in (shielded)');

  -- L14: BAT+ → ALT stud
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L14','property_key','landmark_distance_in','value',30.0,'unit','inches',
      'description','BAT+ → ALT stud',
      'reasoning','Battery at passenger inner fender (F5 default). ALT at front-driver of engine. Path: across front of bay over rad support OR along inner fender. Engine bay width inner-tower-to-inner-tower 86.77in; half + small detour ≈ 30in.',
      'anchor_atoms', jsonb_build_array('engine_bay.inner_tower_to_inner_tower=86.77in (per atom)','K5_MASTER_MEASUREMENT_PLAN.md F5 (battery default: passenger inner fender)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L14 estimate: 30.0in');

  -- L15: BAT+ → STARTER stud
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L15','property_key','landmark_distance_in','value',52.0,'unit','inches',
      'description','BAT+ → STARTER stud',
      'reasoning','Battery passenger inner fender to starter (driver bellhousing). Across engine bay + down to bellhousing. Inner-tower width 86.77in + ~10in vertical drop to starter.',
      'anchor_atoms', jsonb_build_array('engine_bay.inner_tower_to_inner_tower=86.77in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L15 estimate: 52.0in');

  -- L16: PDM30 → FWG-MAIN (interior side)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L16','property_key','landmark_distance_in','value',20.0,'unit','inches',
      'description','PDM30 → FWG-MAIN interior side',
      'reasoning','PDM30 under dash driver side; FWG-MAIN at driver firewall. Under-dash hop down and forward.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md F4 (PDM30 default: above kick panel)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L16 estimate: 20.0in');

  -- L17: PDM30 → steering column
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L17','property_key','landmark_distance_in','value',15.0,'unit','inches',
      'description','PDM30 → steering column ignition switch',
      'reasoning','PDM30 above kick panel, column adjacent. Short reach up the column.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md F4 PDM30 location')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L17 estimate: 15.0in');

  -- L18: PDM30 → headlight switch in dash
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L18','property_key','landmark_distance_in','value',21.0,'unit','inches',
      'description','PDM30 → headlight switch in dash panel',
      'reasoning','PDM30 driver-side kick panel area; headlight switch typically driver-side dash face. Across under-dash + up to dash face.',
      'anchor_atoms', jsonb_build_array('typical K5 dash layout (driver-side headlight switch on factory panel)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L18 estimate: 21.0in');

  -- L19: PDM30 → brake pedal switch
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L19','property_key','landmark_distance_in','value',15.0,'unit','inches',
      'description','PDM30 → brake pedal switch',
      'reasoning','PDM30 down to brake pedal area. Short downward hop.',
      'anchor_atoms', jsonb_build_array('PDM30 kick panel area is adjacent to brake pedal mount')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.50,
    'L19 estimate: 15.0in');

  -- L20: PDM30 → driver door boot
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L20','property_key','landmark_distance_in','value',27.0,'unit','inches',
      'description','PDM30 → driver door boot (hinge area)',
      'reasoning','PDM30 to driver A-pillar through dash to door boot.',
      'anchor_atoms', jsonb_build_array('K5 cab geometry: kick panel to A-pillar door boot ~24-30in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L20 estimate: 27.0in');

  -- L21: driver door boot → door internals
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L21','property_key','landmark_distance_in','value',24.0,'unit','inches',
      'description','Driver door boot → door lock / window motor / speaker',
      'reasoning','K5 door is ~36in wide; boot at front-top of door, components spread inside. Average reach ~24in.',
      'anchor_atoms', jsonb_build_array('K5 cab door width typical 36in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L21 estimate: 24.0in');

  -- L22: PDM30 → passenger door boot
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L22','property_key','landmark_distance_in','value',54.0,'unit','inches',
      'description','PDM30 → passenger door boot (across cab)',
      'reasoning','Across the cab from driver kick panel to passenger A-pillar. K5 interior width ~60in; routing through kick panel and across dash adds path length.',
      'anchor_atoms', jsonb_build_array('K5 cab interior width approx 60in (industry typical for full-size 73-91 GM truck)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L22 estimate: 54.0in');

  -- L23: PDM30 → dome light at headliner center
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L23','property_key','landmark_distance_in','value',54.0,'unit','inches',
      'description','PDM30 → dome light at headliner center',
      'reasoning','Up A-pillar (~24in) then across headliner to center (~30in). Total ~54in.',
      'anchor_atoms', jsonb_build_array('K5 A-pillar height typical 24in; cab interior width ~60in, half = 30in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L23 estimate: 54.0in');

  -- L24: PDM30 → FLOOR-RR grommet (under driver seat)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L24','property_key','landmark_distance_in','value',36.0,'unit','inches',
      'description','PDM30 → FLOOR-RR grommet under driver seat or rocker entry',
      'reasoning','Down from kick panel through floor pan to under-seat grommet.',
      'anchor_atoms', jsonb_build_array('K5 cab geometry: kick panel down to driver seat floor ~30-40in')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L24 estimate: 36.0in');

  -- L25: FLOOR-RR → rear axle area (along frame to rear loom split)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L25','property_key','landmark_distance_in','value',90.0,'unit','inches',
      'description','FLOOR-RR → rear axle area',
      'reasoning','K5 wheelbase 106.5in. FLOOR-RR is under driver seat ~30in forward of rear axle. Along frame rail to rear axle.',
      'anchor_atoms', jsonb_build_array('frame.wheelbase=106.5in (FR-88 page 1)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.55,
    'L25 estimate: 90.0in');

  -- L26: rear junction → tailgate light cluster
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L26','property_key','landmark_distance_in','value',48.0,'unit','inches',
      'description','Rear junction → tailgate light cluster',
      'reasoning','Rear of K5: axle to bumper ~30in + tailgate light positions across rear.',
      'anchor_atoms', jsonb_build_array('K5 rear overhang typical 30in beyond axle')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L26 estimate: 48.0in');

  -- L27: rear junction → fuel tank sender / pump
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L27','property_key','landmark_distance_in','value',42.0,'unit','inches',
      'description','Rear junction → fuel tank sender / pump',
      'reasoning','K5 fuel tank between rear axle and bumper, slightly forward of axle. Short hop from rear loom junction.',
      'anchor_atoms', jsonb_build_array('K5 fuel tank position typical: ahead of axle')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L27 estimate: 42.0in');

  -- L28: PDM30 → 6L80E switches (through tunnel grommet)
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L28','property_key','landmark_distance_in','value',52.0,'unit','inches',
      'description','PDM30 → 6L80E switches via tunnel grommet',
      'reasoning','Down through tunnel to 6L80E which sits behind bellhousing. ~24in down through tunnel + ~28in along tunnel to gearbox.',
      'anchor_atoms', jsonb_build_array('6L80E length typical 27in; mounted behind bellhousing')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.45,
    'L28 estimate: 52.0in');

  -- L29: M130 → O2 bung driver exhaust
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L29','property_key','landmark_distance_in','value',36.0,'unit','inches',
      'description','M130 → O2 bung driver exhaust (away from header heat)',
      'reasoning','M130 firewall driver side, O2 in driver collector. Routing must avoid header heat — adds detour. Direct path 24in + heat detour 12in.',
      'anchor_atoms', jsonb_build_array('K5_MASTER_MEASUREMENT_PLAN.md §3.4 (heat avoidance routing)')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.40,
    'L29 estimate: 36.0in');

  -- L30: M130 → O2 bung passenger exhaust
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', 'specification'::observation_kind, v_property_id,
    jsonb_build_object('landmark_id','L30','property_key','landmark_distance_in','value',48.0,'unit','inches',
      'description','M130 → O2 bung passenger exhaust',
      'reasoning','Like L29 + cross engine bay span. M130 driver to passenger collector = full engine width + bay traversal + heat avoidance.',
      'anchor_atoms', jsonb_build_array('engine_bay.inner_tower_to_inner_tower=86.77in','K5_MASTER_MEASUREMENT_PLAN.md §3.4')),
    v_source_id, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.40,
    'L30 estimate: 48.0in');

  RAISE NOTICE 'Inserted 30 landmark distance estimates under source k5_landmark_estimate_2026_05_22.';
END $$;

NOTIFY pgrst, 'reload schema';

-- Verification readout
SELECT
  vo.structured_data->>'landmark_id' AS lm,
  (vo.structured_data->>'value')::numeric AS est_in,
  vo.confidence_score AS conf
FROM public.vehicle_observations vo
JOIN public.observation_properties op ON op.id = vo.property_id
WHERE op.property_key = 'landmark_distance_in'
  AND vo.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND vo.is_superseded = false
ORDER BY vo.structured_data->>'landmark_id';

SELECT
  count(*) AS k5_cited_cells,
  round(100.0 * count(*)::numeric / (162*25), 1) AS pct_of_target
FROM public.vehicle_observations
WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND property_id IS NOT NULL AND is_superseded = false;

COMMIT;
