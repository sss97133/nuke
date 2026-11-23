-- Contract for 20261120140000_image_reading_tiers.sql, on a fresh disposable database: a reading whose agent_tier is not a reviewed
-- tier (a thin one: the automatic reader, or any tier nobody listed) may carry only the closed values the database admits for it and
-- never displaces a reviewed reading; it is stored as its observation alone (the photo row, the search rows and the cover are left
-- exactly as they were); a reading that lands replaces the thin reading before it and that reading's keyed children;
-- a reviewed-tier reading is checked exactly as before. The verdicts below are the shared examples of the reader's fixture
-- (scripts/photo-pipeline/fixtures/automatic-thin-verdicts.json on PR 3609), embedded as literals: 4 accepted, 26 refused.
-- Synthetic images; no network, no model calls. The production triggers on vehicle_observations that are not part of the intake
-- (UPDATE guards for other claim families, analysis queues) are not in this fixture; the migration's header names what they do.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database';
 END IF;
END $$;

\ir fixtures/reviewed_image_analysis_base.sql
\ir ../migrations/20261110020000_reviewed_extractor_uuid_contract.sql
-- the columns supersede_observation writes (the fixture's table has the intake's columns only)
ALTER TABLE vehicle_observations ADD COLUMN superseded_by uuid REFERENCES vehicle_observations(id),
  ADD COLUMN superseded_at timestamptz, ADD COLUMN lineage_chain uuid[];
-- The ledger's own clock (ingested_at) orders two automatic readings of one photo (Rule 3). Production's default is now(), one value
-- per transaction, and every reading is posted in a transaction of its own. The blocks below post several readings in one
-- transaction, so here the default is clock_timestamp(): each reading gets the instant it was posted.
ALTER TABLE vehicle_observations ALTER COLUMN ingested_at SET DEFAULT clock_timestamp();
CREATE TABLE platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);

INSERT INTO observation_sources(slug) VALUES('photo_pipeline');
INSERT INTO vehicles VALUES('20000000-0000-4000-8000-000000000101','Fixture','Coupe',NULL);
INSERT INTO vehicles VALUES('20000000-0000-4000-8000-000000000102','Fixture','Sedan',NULL);

-- Before the migration: a thin-shaped reading and a rich one of an unlisted tier both land (no tier rule exists yet).
CREATE FUNCTION tt_image(p_vehicle uuid DEFAULT '20000000-0000-4000-8000-000000000101', p_meta jsonb DEFAULT '{}', p_match text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE id uuid := gen_random_uuid();
BEGIN
 INSERT INTO vehicle_images(id,vehicle_id,user_id,source,image_url,vision_gate_status,file_size,ai_scan_metadata,image_vehicle_match_status)
 VALUES(id,p_vehicle,'40000000-0000-4000-8000-000000000101','iphoto','https://example.invalid/'||id||'.jpg','approved',3500000,p_meta,p_match);
 RETURN id;
END $$;
-- The reading as the intake stores it: the verdict plus the keys the intake adds, with the review envelope the guard checks.
-- p_reviewed: when the reader says it read the photo (default: this instant).
CREATE FUNCTION tt_obs(p_image uuid, p_tier text, p_verdict jsonb, p_prov jsonb DEFAULT '{}', p_extra jsonb DEFAULT '{}', p_raw jsonb DEFAULT '{}', p_reviewed timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i vehicle_images%ROWTYPE; v jsonb; oid uuid; h text := md5(random()::text || clock_timestamp()::text) || md5(random()::text); reviewed timestamptz := coalesce(p_reviewed, clock_timestamp());
BEGIN
 SELECT * INTO i FROM vehicle_images WHERE id=p_image;
 v := p_verdict || jsonb_build_object('image_id',i.id,'vehicle_id',i.vehicle_id,'analysis_kind','image_deep_byok','witness_image_id',i.id,'is_inferred',true) || p_raw;
 INSERT INTO vehicle_observations(vehicle_id,kind,source_id,source_url,source_identifier,observed_at,content_text,confidence_score,agent_model,agent_tier,
   extraction_method,extractor_id,raw_source_ref,structured_data,extraction_metadata,analysis_deferred)
 VALUES(i.vehicle_id,'condition',(SELECT id FROM observation_sources WHERE slug='photo_pipeline'),i.image_url,
   'reviewed_image_analysis_v1:'||i.id||':'||h,reviewed,v->>'narrative_one_line',least((v->>'confidence')::numeric,0.6),'fixture-model',p_tier,
   'reviewed_image_analysis_v1',NULL,'vehicle_images:'||i.id,v,
   jsonb_build_object('review_hash',h,'reviewed_image',jsonb_build_object('image_url',i.image_url,'expected_updated_at',i.updated_at,'reviewed_url',i.image_url,
     'reviewed_sha256',repeat('b',64),'reviewed_at',reviewed),
     'reviewer_provenance',jsonb_build_object('agent_model','fixture-model','agent_tier',p_tier,'extraction_method','fixture review','run_id','fixture') || p_prov) || p_extra,true)
 RETURNING id INTO oid;
 RETURN oid;
END $$;
-- A reviewed-tier reading with rich content (what the reviewed producer posts).
CREATE FUNCTION tt_rich(p_scene text DEFAULT 'body_exterior') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('scene_type',p_scene,'build_phase_guess','final_assembly','intent','unknown','intent_confidence',0,'needs_clarification',true,
 'components_seen','[]'::jsonb,'state_observations',jsonb_build_object('rust_severity','unknown','paint_state','unknown','completeness','assembled'),
 'workshop_signals',jsonb_build_object('tools_visible','[]'::jsonb,'fixturing','unknown','lighting','natural_outdoor'),
 'presence',jsonb_build_object('person',false),'camera_pose',jsonb_build_object('framing','full vehicle','azimuth_deg',45,'distance_est','~3m'),
 'narrative_one_line','Whole assembled car with clear surroundings','confidence',0.95) $$;
-- The shared examples (accepted: verdicts; refused: {why, verdict}), image and vehicle ids are the fixture's placeholders.
CREATE FUNCTION tt_accepted() RETURNS jsonb LANGUAGE sql AS $j$ SELECT $json$[
 {
  "image_id": "11111111-1111-4111-8111-111111111111",
  "vehicle_id": "22222222-2222-4222-8222-222222222222",
  "scene_type": "undercarriage",
  "build_phase_guess": "unknown",
  "intent": "unknown",
  "intent_confidence": 0,
  "needs_clarification": true,
  "components_seen": [],
  "text_regions": [],
  "damage_localized": [],
  "state_observations": {
   "rust_severity": "surface",
   "paint_state": "unknown",
   "completeness": "unknown",
   "damage_callouts": []
  },
  "workshop_signals": {
   "tools_visible": [],
   "fixturing": "unknown",
   "lighting": "unknown"
  },
  "presence": {
   "person": false,
   "dog": false,
   "place_hint": null
  },
  "camera_pose": {
   "method": "automatic two-pass read; no pose measured",
   "framing": "unknown",
   "azimuth_deg": null,
   "elevation_deg": null,
   "distance_est": null,
   "exif_present": null
  },
  "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
  "confidence": 0.72,
  "context_complete": false,
  "open_questions": [],
  "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
 },
 {
  "image_id": "11111111-1111-4111-8111-111111111111",
  "vehicle_id": "22222222-2222-4222-8222-222222222222",
  "scene_type": "unknown",
  "build_phase_guess": "unknown",
  "intent": "unknown",
  "intent_confidence": 0,
  "needs_clarification": true,
  "components_seen": [],
  "text_regions": [],
  "damage_localized": [],
  "state_observations": {
   "rust_severity": "unknown",
   "paint_state": "unknown",
   "completeness": "unknown",
   "damage_callouts": []
  },
  "workshop_signals": {
   "tools_visible": [],
   "fixturing": "unknown",
   "lighting": "unknown"
  },
  "presence": {
   "person": true,
   "dog": false,
   "place_hint": null
  },
  "camera_pose": {
   "method": "automatic two-pass read; no pose measured",
   "framing": "unknown",
   "azimuth_deg": null,
   "elevation_deg": null,
   "distance_est": null,
   "exif_present": null
  },
  "narrative_one_line": "Automatic read: scene unknown; rust unknown; paint unknown.",
  "confidence": 0.55,
  "context_complete": false,
  "open_questions": [
   "Two independent reads of this photo disagree on scene_type: undercarriage vs data_plate; posted as unknown.",
   "Both reads say rust_severity is none; this reader may not post that value yet."
  ],
  "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
 },
 {
  "image_id": "11111111-1111-4111-8111-111111111111",
  "vehicle_id": "22222222-2222-4222-8222-222222222222",
  "scene_type": "body_exterior",
  "build_phase_guess": "unknown",
  "intent": "unknown",
  "intent_confidence": 0,
  "needs_clarification": true,
  "components_seen": [],
  "text_regions": [],
  "damage_localized": [],
  "state_observations": {
   "rust_severity": "unknown",
   "paint_state": "unknown",
   "completeness": "unknown",
   "damage_callouts": []
  },
  "workshop_signals": {
   "tools_visible": [],
   "fixturing": "unknown",
   "lighting": "unknown"
  },
  "presence": {
   "person": false,
   "dog": false,
   "place_hint": null
  },
  "camera_pose": {
   "method": "automatic two-pass read; no pose measured",
   "framing": "unknown",
   "azimuth_deg": null,
   "elevation_deg": null,
   "distance_est": null,
   "exif_present": null
  },
  "narrative_one_line": "Automatic read: scene body_exterior; rust unknown; paint unknown.",
  "confidence": 0.8,
  "context_complete": false,
  "open_questions": [
   "Both reads say paint_state is clear; this reader may not post that value yet.",
   "Both reads say completeness is assembled; this reader may not post that value yet."
  ],
  "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
 },
 {
  "image_id": "11111111-1111-4111-8111-111111111111",
  "vehicle_id": "22222222-2222-4222-8222-222222222222",
  "scene_type": "body_exterior",
  "build_phase_guess": "unknown",
  "intent": "unknown",
  "intent_confidence": 0,
  "needs_clarification": true,
  "components_seen": [],
  "text_regions": [],
  "damage_localized": [],
  "state_observations": {
   "rust_severity": "unknown",
   "paint_state": "unknown",
   "completeness": "unknown",
   "damage_callouts": []
  },
  "workshop_signals": {
   "tools_visible": [],
   "fixturing": "unknown",
   "lighting": "unknown"
  },
  "presence": {
   "person": false,
   "dog": false,
   "place_hint": null
  },
  "camera_pose": {
   "method": "automatic two-pass read; no pose measured",
   "framing": "unknown",
   "azimuth_deg": null,
   "elevation_deg": null,
   "distance_est": null,
   "exif_present": null
  },
  "narrative_one_line": "Automatic read: scene body_exterior; rust unknown; paint unknown.",
  "confidence": 0.7,
  "context_complete": false,
  "open_questions": [
   "Two independent reads of this photo disagree on completeness: partial vs unknown; posted as unknown."
  ],
  "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
 }
]$json$::jsonb $j$;
CREATE FUNCTION tt_refused() RETURNS jsonb LANGUAGE sql AS $j$ SELECT $json$[
 {
  "why": "build_phase_guess asserted",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "final_assembly",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "a component with a part number guess",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [
    {
     "label": "brake booster",
     "confidence": 0.9,
     "bbox": [
      10,
      10,
      200,
      200
     ],
     "part_number_guess": "D1234"
    }
   ],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "completeness asserted",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "assembled",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "rust value the database does not admit",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "none",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust none; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "paint value the database does not admit",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "clear",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint clear.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "scene value the database does not admit",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "data_plate",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene data_plate; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "state asserted while the scene is unknown",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "unknown",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene unknown; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "free-text narrative",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Glossy red car parked in a shop with an engine on a stand behind.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "narrative that does not match the posted values",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust unknown; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "text region",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [
    {
     "text": "3857584GM",
     "bbox": [
      10,
      10,
      200,
      200
     ],
     "confidence": 0.9
    }
   ],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "localized damage",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [
    {
     "label": "dent",
     "bbox": [
      10,
      10,
      200,
      200
     ],
     "severity": "minor"
    }
   ],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "damage callout",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": [
     "dent in the fender"
    ]
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "free-text open question",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [
    "Is this the original engine?"
   ],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "intent asserted",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "labor",
   "intent_confidence": 0.9,
   "needs_clarification": false,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "intent confidence above zero",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0.4,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "tools listed",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [
     "welder"
    ],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "weld quality stated",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown",
    "weld_quality": "clean beads"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "lighting described",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "bright shop light"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "free-text agent notes",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "The owner should be told the frame is bent."
  }
 },
 {
  "why": "camera framing described",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "wide view from the front left",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "camera distance stated",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": "~3 m",
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "place hint",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": "a shop yard"
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "dog asserted",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": true,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "context marked complete",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": true,
   "open_questions": [],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "a question that names a word outside the closed values",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [
    "Both reads say scene_type is rebuilt_motor; this reader may not post that value yet."
   ],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 },
 {
  "why": "more than eight questions",
  "verdict": {
   "image_id": "11111111-1111-4111-8111-111111111111",
   "vehicle_id": "22222222-2222-4222-8222-222222222222",
   "scene_type": "undercarriage",
   "build_phase_guess": "unknown",
   "intent": "unknown",
   "intent_confidence": 0,
   "needs_clarification": true,
   "components_seen": [],
   "text_regions": [],
   "damage_localized": [],
   "state_observations": {
    "rust_severity": "surface",
    "paint_state": "unknown",
    "completeness": "unknown",
    "damage_callouts": []
   },
   "workshop_signals": {
    "tools_visible": [],
    "fixturing": "unknown",
    "lighting": "unknown"
   },
   "presence": {
    "person": false,
    "dog": false,
    "place_hint": null
   },
   "camera_pose": {
    "method": "automatic two-pass read; no pose measured",
    "framing": "unknown",
    "azimuth_deg": null,
    "elevation_deg": null,
    "distance_est": null,
    "exif_present": null
   },
   "narrative_one_line": "Automatic read: scene undercarriage; rust surface; paint unknown.",
   "confidence": 0.72,
   "context_complete": false,
   "open_questions": [
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet.",
    "Both reads say paint_state is clear; this reader may not post that value yet."
   ],
   "agent_notes": "Automatic two-pass reading. Posted: closed values both passes agree on and the database admits for this reader. Components, text, damage, phase and intent are not read at this tier."
  }
 }
]$json$::jsonb $j$;

DO $$ DECLARE img uuid; BEGIN
 img := tt_image();
 PERFORM tt_obs(img,'subscription automatic',tt_rich());
 RAISE NOTICE 'PASS: before the migration the intake holds every tier to the same checks (no tier rule yet)';
END $$;

\ir ../migrations/20261120140000_image_reading_tiers.sql

-- ===== the config row and the helpers
DO $$ DECLARE cfg jsonb; BEGIN
 SELECT config_value INTO cfg FROM platform_config WHERE config_key='image_reading_tiers';
 ASSERT cfg IS NOT NULL, 'the migration inserts image_reading_tiers';
 ASSERT jsonb_typeof(cfg->'reviewed_tiers')='array' AND (cfg->'reviewed_tiers') ? 'caller-byok subscription' AND (cfg->'reviewed_tiers') ? 'caller-byok',
   'live reviewed tiers are listed';
 ASSERT NOT ((cfg->'reviewed_tiers') ? 'subscription automatic'), 'the automatic tier is not reviewed';
 ASSERT cfg #> '{automatic,admits,scene_type}' = '["undercarriage","engine_bay","body_exterior","body_interior","wheel_assembly"]'::jsonb
    AND cfg #> '{automatic,admits,rust_severity}' = '["surface"]'::jsonb AND cfg #> '{automatic,admits,paint_state}' = '[]'::jsonb, 'admits as the contract seeds them';
 ASSERT image_reading_tier_is_reviewed('caller-byok subscription') AND image_reading_tier_is_reviewed('caller-byok')
   AND NOT image_reading_tier_is_reviewed('subscription automatic') AND NOT image_reading_tier_is_reviewed('never seen')
   AND image_reading_tier_is_reviewed(NULL) AND image_reading_tier_is_reviewed('') AND NOT image_reading_tier_is_reviewed('   '),
   'tier test: listed = reviewed, unlisted = thin, no tier = legacy = reviewed, blanks are a tier nobody listed';
 ASSERT NOT has_function_privilege('anon','image_reading_thin_violation(jsonb,jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','image_reading_thin_violation(jsonb,jsonb)','EXECUTE')
   AND has_function_privilege('service_role','image_reading_thin_violation(jsonb,jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','image_reading_tier_is_reviewed(text,boolean)','EXECUTE')
   AND NOT has_function_privilege('authenticated','image_reading_tier_is_reviewed(text,boolean)','EXECUTE')
   AND has_function_privilege('service_role','image_reading_tier_is_reviewed(text,boolean)','EXECUTE')
   AND NOT has_function_privilege('anon','image_reading_tier_is_automatic(text)','EXECUTE') AND NOT has_function_privilege('authenticated','image_reading_tier_is_automatic(text)','EXECUTE')
   AND has_function_privilege('service_role','image_reading_tier_is_automatic(text)','EXECUTE')
   AND NOT has_function_privilege('anon','image_reading_thin_envelope_violation(jsonb,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','image_reading_thin_envelope_violation(jsonb,jsonb)','EXECUTE')
   AND has_function_privilege('service_role','image_reading_thin_envelope_violation(jsonb,jsonb)','EXECUTE'), 'helpers: service_role only';
 ASSERT image_reading_tier_is_automatic('subscription automatic') AND NOT image_reading_tier_is_automatic('caller-byok') AND NOT image_reading_tier_is_automatic('never seen')
   AND NOT image_reading_tier_is_automatic(NULL) AND NOT image_reading_tier_is_automatic(''), 'a stored reading is automatic only when its tier is the configured automatic tier';
 -- total: garbage in, a word out, never an error
 ASSERT image_reading_thin_violation('[]'::jsonb,NULL)='shape' AND image_reading_thin_violation('null'::jsonb,NULL) IS NOT NULL
   AND image_reading_thin_violation(NULL,NULL) IS NOT NULL AND image_reading_thin_violation('{}'::jsonb,'[1]'::jsonb) IS NOT NULL
   AND image_reading_thin_violation('{"scene_type":5}'::jsonb,'"x"'::jsonb)='scene_type'
   AND image_reading_thin_violation('{"scene_type":"unknown","state_observations":[]}'::jsonb,NULL)='rust_severity', 'the thin test is total';
 RAISE NOTICE 'PASS: config row, tier test and thin test: service_role only, total';
END $$;

-- ===== Rule 1: the shared examples
DO $$ DECLARE a jsonb; n int := 0; img uuid; oid uuid; r jsonb; before_cover text; before_photo text; BEGIN
 FOR a IN SELECT jsonb_array_elements(tt_accepted()) LOOP
   n := n + 1;
   img := tt_image();
   SELECT primary_image_url INTO before_cover FROM vehicles WHERE id='20000000-0000-4000-8000-000000000101';
   SELECT to_jsonb(vi)::text INTO before_photo FROM vehicle_images vi WHERE vi.id=img;
   -- the thin shape alone is not enough: the placeholder ids are replaced by tt_obs
   ASSERT image_reading_thin_violation(a || jsonb_build_object('image_id',img,'vehicle_id','20000000-0000-4000-8000-000000000101','analysis_kind','image_deep_byok','witness_image_id',img,'is_inferred',true),
     (SELECT config_value->'automatic'->'admits' FROM platform_config WHERE config_key='image_reading_tiers')) IS NULL, 'accepted example '||n||' passes the helper';
   oid := tt_obs(img,'subscription automatic',a);
   r := project_reviewed_image_analysis(oid);
   ASSERT r->>'success'='true' AND r#>>'{cover,reason}'='thin_tier_reading' AND r->>'thin_tier'='true'
     AND r->'image_observation_id'='null'::jsonb AND r->'search_vehicle_id'='null'::jsonb AND r->'projection_duplicate'='null'::jsonb
     AND r->>'superseded_readings'='0' AND r->>'observation_id'=oid::text, 'accepted example '||n||' lands as a thin reading: '||r::text;
   ASSERT (SELECT primary_image_url IS NOT DISTINCT FROM before_cover FROM vehicles WHERE id='20000000-0000-4000-8000-000000000101'), 'a thin reading does not move the cover';
   -- containment: the whole photo row is byte for byte what it was (no stamp, the same updated_at, nothing else), no search row
   -- exists and nothing is queued for attribution
   ASSERT (SELECT to_jsonb(vi)::text = before_photo FROM vehicle_images vi WHERE vi.id=img), 'accepted example '||n||': the photo row is untouched by a thin landing';
   ASSERT (SELECT NOT (ai_scan_metadata ? 'byok_deep_analysis') FROM vehicle_images WHERE id=img), 'accepted example '||n||': no stamp';
   ASSERT NOT EXISTS(SELECT FROM image_observations WHERE image_id=img), 'accepted example '||n||': a thin reading places no search row';
   ASSERT NOT EXISTS(SELECT FROM vehicle_image_attribution_queue WHERE image_id=img), 'accepted example '||n||': and queues no attribution';
   -- what does exist: the observation, current, and its witness
   ASSERT (SELECT count(*)=1 FROM vehicle_observations WHERE structured_data->>'image_id'=img::text) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=oid)
     AND EXISTS(SELECT FROM observation_witnesses WHERE observation_id=oid AND image_id=img AND witness_role='derived'), 'accepted example '||n||': the observation and its witness';
 END LOOP;
 ASSERT n = 4, 'four accepted examples, saw '||n;
 RAISE NOTICE 'PASS: 4 accepted examples land as an observation and its witness; the photo row, the search rows and the cover are untouched';
END $$;
DO $$ DECLARE a jsonb; n int := 0; img uuid; BEGIN
 FOR a IN SELECT jsonb_array_elements(tt_refused()) LOOP
   n := n + 1;
   img := tt_image();
   BEGIN
     PERFORM tt_obs(img,'subscription automatic',a->'verdict');
     RAISE EXCEPTION 'refused example % (%) unexpectedly landed', n, a->>'why';
   EXCEPTION WHEN check_violation THEN
     ASSERT SQLERRM = 'thin_review_asserts_unchecked_field', 'refused example '||n||' ('||(a->>'why')||'): '||SQLERRM;
   END;
   ASSERT NOT EXISTS(SELECT FROM vehicle_observations WHERE structured_data->>'image_id'=img::text), 'a refused example leaves no observation';
 END LOOP;
 ASSERT n = 26, '26 refused examples, saw '||n;
 RAISE NOTICE 'PASS: 26 refused examples refused with thin_review_asserts_unchecked_field';
END $$;
-- a tier nobody listed is thin: rich content refused, thin shape lands
DO $$ DECLARE img uuid; oid uuid; BEGIN
 img := tt_image();
 BEGIN
   PERFORM tt_obs(img,'a tier nobody listed',tt_rich());
   RAISE EXCEPTION 'unlisted tier with rich content unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM = 'thin_review_asserts_unchecked_field', SQLERRM; END;
 oid := tt_obs(img,'a tier nobody listed',(SELECT jsonb_array_elements(tt_accepted()) LIMIT 1));
 ASSERT oid IS NOT NULL, 'unlisted tier with the thin shape lands';
 -- no key outside the closed list, nested keys included
 ASSERT image_reading_thin_violation((SELECT jsonb_array_elements(tt_accepted()) LIMIT 1) || '{"extra":1}'::jsonb, NULL) LIKE 'key:%', 'unknown key refused';
 RAISE NOTICE 'PASS: an unlisted tier is held to the thin shape';
END $$;
-- a reviewed-tier reading with rich content lands exactly as before, cover recomputed
DO $$ DECLARE img uuid; oid uuid; r jsonb; BEGIN
 img := tt_image();
 oid := tt_obs(img,'caller-byok subscription',tt_rich());
 r := project_reviewed_image_analysis(oid);
 ASSERT r->>'success'='true' AND r#>>'{cover,chosen_image_id}' IS NOT NULL AND r#>>'{cover,reason}' IS NULL, 'reviewed reading recomputes the cover as before: '||r::text;
 ASSERT (SELECT ai_scan_metadata#>>'{byok_deep_analysis,agent_tier}'='caller-byok subscription' AND ai_scan_metadata#>>'{byok_deep_analysis,build_phase_guess}'='final_assembly' FROM vehicle_images WHERE id=img), 'rich stamp';
 RAISE NOTICE 'PASS: a reviewed-tier reading lands as before';
END $$;
-- why a thin reading is not stamped: a stamp alone moves a frame to the scored cover tier for every caller of
-- recompute_vehicle_primary_image. After a thin landing a later recompute by anyone sees what it saw before; a reviewed stamp is scored.
DO $$ DECLARE img uuid; r1 jsonb; r2 jsonb; oid uuid; BEGIN
 img := tt_image('20000000-0000-4000-8000-000000000102','{}','confirmed');
 r1 := recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000102');
 ASSERT r1->>'tier'='confirmed_any', r1::text;
 oid := tt_obs(img,'subscription automatic',(SELECT jsonb_array_elements(tt_accepted()) LIMIT 1));
 r2 := project_reviewed_image_analysis(oid);
 ASSERT r2#>>'{cover,reason}'='thin_tier_reading', 'the projection recomputed no cover';
 r2 := recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000102');
 ASSERT r2->>'tier'='confirmed_any', 'a later recompute by anyone still sees an unscored frame: '||r2::text;
 -- the same frame once a reviewed reading lands on it (the landing supersedes the thin reading and stamps the photo)
 PERFORM project_reviewed_image_analysis(tt_obs(img,'caller-byok subscription',tt_rich()));
 r2 := recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000102');
 ASSERT r2->>'tier'='hero_score', 'a reviewed stamp is what moves a frame to the scored tier: '||r2::text;
 RAISE NOTICE 'PASS: a thin landing leaves the cover choice as it was for every later caller; a reviewed stamp is scored';
END $$;

-- ===== Rule 2: a thin reading never displaces a reviewed one
DO $$ DECLARE img uuid; oid uuid; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); BEGIN
 -- over a reviewed reading (cache and observation)
 img := tt_image();
 PERFORM project_reviewed_image_analysis(tt_obs(img,'caller-byok subscription',tt_rich()));
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over reviewed unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- over a reviewed observation that has no cache yet
 img := tt_image();
 PERFORM tt_obs(img,'caller-byok subscription',tt_rich());
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a reviewed observation unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- over a legacy stamp with no agent_tier
 img := tt_image('20000000-0000-4000-8000-000000000101','{"byok_deep_analysis":{"scene_type":"body_exterior","confidence":0.9}}');
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a legacy stamp unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- over a stamp whose tier is a reviewed one
 img := tt_image('20000000-0000-4000-8000-000000000101','{"byok_deep_analysis":{"scene_type":"body_exterior","agent_tier":"caller-byok"}}');
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a caller-byok stamp unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- over a stamp that names the automatic tier: refused too. The intake never stamps a thin reading, so a stamp is someone else's
 -- reading whatever tier it names
 img := tt_image('20000000-0000-4000-8000-000000000101','{"byok_deep_analysis":{"scene_type":"body_exterior","agent_tier":"subscription automatic"}}');
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a stamp unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- a stamp key that holds no object is not a reading: the thin reading lands, and the key is left as it was
 img := tt_image('20000000-0000-4000-8000-000000000101','{"byok_deep_analysis":null}');
 oid := tt_obs(img,'subscription automatic',thin);
 ASSERT oid IS NOT NULL AND (project_reviewed_image_analysis(oid)->>'success')='true', 'thin over a null stamp key lands';
 ASSERT (SELECT ai_scan_metadata='{"byok_deep_analysis":null}'::jsonb FROM vehicle_images WHERE id=img), 'and leaves the key as it was';
 -- over its own kind (an automatic reading, which is an observation only): allowed; the newer replaces the older (Rule 3)
 img := tt_image();
 PERFORM project_reviewed_image_analysis(tt_obs(img,'subscription automatic',thin));
 oid := tt_obs(img,'subscription automatic',thin);
 ASSERT oid IS NOT NULL, 'thin over thin lands';
 RAISE NOTICE 'PASS: thin over reviewed refused (cache, observation, legacy stamp, listed stamp, any stamp at all); thin over thin allowed';
END $$;
-- Rule 2 holds at the projection too: the insert was admitted when nothing stood, and a reading landed before the thin one was projected
DO $$ DECLARE img uuid; t1 uuid; rv uuid; before_photo text; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); BEGIN
 -- a reviewed observation posted in between (not projected yet, so no stamp)
 img := tt_image();
 t1 := tt_obs(img,'subscription automatic',thin);
 rv := tt_obs(img,'caller-byok subscription',tt_rich());
 BEGIN PERFORM project_reviewed_image_analysis(t1); RAISE EXCEPTION 'a thin reading projected beside a reviewed observation';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=rv), 'the reviewed reading is untouched by the refused thin projection';
 -- the reviewed reading then lands and replaces the thin one that never did
 PERFORM project_reviewed_image_analysis(rv);
 ASSERT (SELECT is_superseded AND superseded_by=rv FROM vehicle_observations WHERE id=t1), 'the reviewed landing supersedes the thin reading that never landed';
 -- a stamp written in between by a producer outside this intake
 img := tt_image();
 t1 := tt_obs(img,'subscription automatic',thin);
 UPDATE vehicle_images SET ai_scan_metadata=ai_scan_metadata||'{"byok_deep_analysis":{"scene_type":"engine_bay","agent_tier":"caller-byok"}}' WHERE id=img;
 SELECT to_jsonb(vi)::text INTO before_photo FROM vehicle_images vi WHERE vi.id=img;
 BEGIN PERFORM project_reviewed_image_analysis(t1); RAISE EXCEPTION 'a thin reading projected over a stamp';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 ASSERT (SELECT to_jsonb(vi)::text = before_photo FROM vehicle_images vi WHERE vi.id=img), 'and the stamp is as its writer left it';
 RAISE NOTICE 'PASS: Rule 2 at the projection: a thin reading does not land beside a reading posted or stamped since its insert';
END $$;

-- ===== Rule 3: a reading that lands replaces the thin reading before it and its keyed children
CREATE FUNCTION tt_child(p_image uuid, p_parent uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
 INSERT INTO vehicle_observations(vehicle_id,kind,source_id,source_identifier,observed_at,extraction_method,agent_tier,analysis_deferred,structured_data,raw_source_ref)
 VALUES((SELECT vehicle_id FROM vehicle_images WHERE id=p_image),'condition',(SELECT id FROM observation_sources WHERE slug='photo_pipeline'),
   'byok_image_properties_v1:'||p_parent||':'||md5(random()::text)||':image_visible_assembly_state',now(),'cached_byok_property_projection_v1','subscription automatic',true,
   jsonb_build_object('image_id',p_image,'analysis_kind','image_property_projection','source_observation_id',p_parent,'property_key','image_visible_assembly_state'),
   'vehicle_observations:'||p_parent)
 RETURNING id INTO cid;
 RETURN cid;
END $$;
DO $$ DECLARE img uuid; t1 uuid; c1 uuid; rv uuid; r jsonb; t_at timestamptz; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); BEGIN
 -- a reviewed reading lands over a thin one
 img := tt_image();
 t1 := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(t1);
 c1 := tt_child(img,t1);
 rv := tt_obs(img,'caller-byok subscription',tt_rich()); PERFORM project_reviewed_image_analysis(rv);
 ASSERT (SELECT is_superseded AND superseded_by=rv AND superseded_at IS NOT NULL AND lineage_chain=ARRAY[rv] FROM vehicle_observations WHERE id=t1), 'the thin reading is superseded by the reviewed one';
 ASSERT (SELECT is_superseded AND superseded_by=rv AND superseded_at IS NOT NULL AND lineage_chain=ARRAY[rv] FROM vehicle_observations WHERE id=c1), 'its keyed child is superseded with it';
 ASSERT (SELECT NOT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id=rv), 'the new reading is current';
 ASSERT (SELECT ai_scan_metadata#>>'{byok_deep_analysis,observation_id}'=rv::text AND ai_scan_metadata#>>'{byok_deep_analysis,agent_tier}'='caller-byok subscription' FROM vehicle_images WHERE id=img),
   'the reviewed reading is stamped on the photo, as before';
 ASSERT EXISTS(SELECT FROM image_observations WHERE image_id=img AND is_active AND observed_by='caller-byok' AND agent_version='reviewed_image_analysis_v1'),
   'and it places its search row, as before';
 ASSERT (SELECT count(*)=1 FROM vehicle_observations WHERE structured_data->>'image_id'=img::text AND structured_data->>'analysis_kind'='image_deep_byok' AND NOT is_superseded), 'one current reading';
 -- replay of the reviewed reading: a projection_duplicate, as before, and it supersedes nothing twice
 ASSERT (project_reviewed_image_analysis(rv)->>'projection_duplicate')='true', 'replay of a reviewed reading is a projection_duplicate';
 ASSERT (SELECT lineage_chain=ARRAY[rv] FROM vehicle_observations WHERE id=t1) AND (SELECT lineage_chain=ARRAY[rv] FROM vehicle_observations WHERE id=c1), 'a reviewed replay supersedes nothing twice';
 -- a newer thin reading replaces the older thin one (and its child)
 img := tt_image();
 t1 := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(t1);
 c1 := tt_child(img,t1);
 rv := tt_obs(img,'subscription automatic',(SELECT jsonb_array_elements(tt_accepted()) OFFSET 2 LIMIT 1));
 r := project_reviewed_image_analysis(rv);
 ASSERT r->>'thin_tier'='true' AND r->>'superseded_readings'='1', 'thin over thin: the answer counts the reading it replaced: '||r::text;
 ASSERT (SELECT is_superseded AND superseded_by=rv FROM vehicle_observations WHERE id=t1) AND (SELECT is_superseded AND superseded_by=rv FROM vehicle_observations WHERE id=c1), 'thin over thin: previous reading and child superseded';
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=rv), 'the newer thin reading is current';
 ASSERT (SELECT NOT (ai_scan_metadata ? 'byok_deep_analysis') FROM vehicle_images WHERE id=img) AND NOT EXISTS(SELECT FROM image_observations WHERE image_id=img),
   'thin over thin: still no stamp and no search row';
 -- the same thin observation projected again (the reader finishing a landing it could not confirm): it supersedes nothing twice and
 -- never itself, and it does not matter that the photo row has moved since the reading was made (nothing of the photo is written,
 -- so no updated_at is held)
 SELECT superseded_at INTO t_at FROM vehicle_observations WHERE id=t1;
 UPDATE vehicle_images SET file_name='touched-since.jpg' WHERE id=img;
 ASSERT (SELECT vi.updated_at > (o.extraction_metadata#>>'{reviewed_image,expected_updated_at}')::timestamptz FROM vehicle_images vi, vehicle_observations o WHERE vi.id=img AND o.id=rv),
   'fixture: the photo row moved after the reading was made';
 r := project_reviewed_image_analysis(rv);
 ASSERT r->>'success'='true' AND r->>'thin_tier'='true' AND r->>'superseded_readings'='0', 'a second projection of a thin reading succeeds and does nothing: '||r::text;
 ASSERT (SELECT NOT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id=rv), 'a second projection does not supersede the reading itself';
 ASSERT (SELECT superseded_at=t_at AND lineage_chain=ARRAY[rv] FROM vehicle_observations WHERE id=t1), 'a second projection supersedes nothing twice';
 -- reviewed over reviewed stays as today: the previous reviewed reading and its child are untouched
 img := tt_image();
 t1 := tt_obs(img,'caller-byok subscription',tt_rich()); PERFORM project_reviewed_image_analysis(t1);
 c1 := tt_child(img,t1);
 rv := tt_obs(img,'caller-byok subscription',tt_rich('engine_bay')); PERFORM project_reviewed_image_analysis(rv);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=t1) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=c1), 'a previous reviewed reading is left alone';
 -- a thin reading landing over a reading with no tier (legacy observation) cannot happen (Rule 2); a reading of another producer is not this intake's to supersede
 RAISE NOTICE 'PASS: a landing reading supersedes the thin reading and its children; a thin reading projects twice to the same state; reviewed replay and reviewed over reviewed unchanged';
END $$;
-- a refused projection undoes the supersession (same transaction): the search placement fails after the supersession ran
CREATE FUNCTION tt_refuse_search() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('tt.refuse',true)='true' THEN RAISE EXCEPTION 'fixture search unavailable'; END IF; RETURN NEW; END$$;
CREATE TRIGGER tt_refuse_search BEFORE INSERT ON image_observations FOR EACH ROW EXECUTE FUNCTION tt_refuse_search();
DO $$ DECLARE img uuid; t1 uuid; c1 uuid; rv uuid; BEGIN
 img := tt_image();
 t1 := tt_obs(img,'subscription automatic',(SELECT jsonb_array_elements(tt_accepted()) LIMIT 1)); PERFORM project_reviewed_image_analysis(t1);
 c1 := tt_child(img,t1);
 rv := tt_obs(img,'caller-byok subscription',tt_rich());
 PERFORM set_config('tt.refuse','true',true);
 BEGIN PERFORM project_reviewed_image_analysis(rv); RAISE EXCEPTION 'projection unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='fixture search unavailable', SQLERRM; END;
 PERFORM set_config('tt.refuse','false',true);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=t1) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=c1),
   'a refused projection leaves the thin reading and its child current';
 ASSERT (SELECT NOT (ai_scan_metadata ? 'byok_deep_analysis') FROM vehicle_images WHERE id=img), 'and the photo is still unstamped';
 RAISE NOTICE 'PASS: refused projection supersedes nothing';
END $$;

-- ===== review findings: closed question tokens, the envelope, stored readings judged by the automatic tier, ordering of two thin readings
DO $$ DECLARE v jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); adm jsonb := (SELECT config_value->'automatic'->'admits' FROM platform_config WHERE config_key='image_reading_tiers'); q text; r text; BEGIN
 -- open questions: values of the closed vocabulary only, at most 8 of them
 ASSERT image_reading_thin_violation(v || '{"open_questions":["Two independent reads of this photo disagree on scene_type: undercarriage vs data_plate; posted as unknown.","Both reads say rust_severity is none; this reader may not post that value yet.","Both reads say completeness is assembled; this reader may not post that value yet."]}', adm) IS NULL, 'vocabulary questions pass';
 -- every scene value of the verdict contract (supabase/functions/_shared/byokImageVerdict.mjs SCENE_TYPES) can be named: the reader's grammar lets a read answer any of them
 FOREACH q IN ARRAY ARRAY['engine_bay','body_exterior','body_interior','undercarriage','receipt_document','data_plate','hand_drawn_diagram','shop_context','fabrication_in_progress','paint_booth','wheel_assembly','road_test','off_property','cross_reference','product_screenshot','spreadsheet','unknown'] LOOP
   r := image_reading_thin_violation(v || jsonb_build_object('open_questions',jsonb_build_array('Both reads say scene_type is '||q||'; this reader may not post that value yet.')), adm);
   ASSERT r IS NULL, 'a question may name the scene value '||q||': '||coalesce(r,'null');
 END LOOP;
 FOREACH q IN ARRAY ARRAY['Two independent reads of this photo disagree on scene_type: rebuilt_motor_with_new_pistons_and_cam vs matching_numbers_confirmed_by_owner; posted as unknown.',
     'Two independent reads of this photo disagree on scene_type: undercarriage vs rebuilt_motor; posted as unknown.',
     'Both reads say completeness is rebuilt_by_owner; this reader may not post that value yet.',
     'Both reads say paint_state is '||repeat('a',1000000)||'; this reader may not post that value yet.'] LOOP
   r := image_reading_thin_violation(v || jsonb_build_object('open_questions',jsonb_build_array(q)), adm);
   ASSERT r = 'open_questions', 'a question with words of its own is refused: '||left(q,60)||' -> '||coalesce(r,'null');
 END LOOP;
 ASSERT image_reading_thin_violation(v || jsonb_build_object('open_questions',(SELECT jsonb_agg('Both reads say paint_state is clear; this reader may not post that value yet.'::text) FROM generate_series(1,9))), adm) = 'open_questions', 'nine questions are refused';
 ASSERT image_reading_thin_violation(v || jsonb_build_object('open_questions',(SELECT jsonb_agg('Both reads say paint_state is clear; this reader may not post that value yet.'::text) FROM generate_series(1,8))), adm) IS NULL, 'eight questions pass';
 RAISE NOTICE 'PASS: open questions carry closed vocabulary tokens only, at most 8';
END $$;
DO $$ DECLARE v jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); img uuid; BEGIN
 -- the envelope: end to end through the trigger, then the helper directly
 FOR i IN 1..5 LOOP
   img := tt_image();
   BEGIN
     PERFORM CASE i
       WHEN 1 THEN tt_obs(img,'subscription automatic',v, '{"cost_basis":"free text: this car has a rebuilt 350 and new floors"}')
       WHEN 2 THEN tt_obs(img,'subscription automatic',v, '{"agent_duration_ms":{"a":"b"}}')
       WHEN 3 THEN tt_obs(img,'subscription automatic',v, '{"agent_cost_cents":"12"}')
       WHEN 4 THEN tt_obs(img,'subscription automatic',v, '{}', '{"free":"text"}')
       ELSE tt_obs(img,'subscription automatic',v, '{"extra":"text"}') END;
     RAISE EXCEPTION 'envelope case % unexpectedly landed', i;
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM = 'thin_review_asserts_unchecked_field', 'envelope case '||i||': '||SQLERRM; END;
 END LOOP;
 img := tt_image();
 BEGIN PERFORM tt_obs(img,'subscription automatic',v,'{}','{}',jsonb_build_object('witness_image_id',jsonb_build_object('free','text')));
   RAISE EXCEPTION 'witness object unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM = 'thin_review_asserts_unchecked_field', SQLERRM; END;
 -- the legitimate envelope: the reader's own cost_basis sentence, a numeric duration, a null cost
 PERFORM tt_obs(img,'subscription automatic',v, jsonb_build_object('agent_duration_ms',1234,'agent_cost_cents',NULL,
   'cost_basis','Owner subscription via the claude CLI; nothing is billed per photo. The CLI''s notional cost and token counts are kept in the stage receipt, not here. agent_duration_ms is the photo''s wall-clock (download, both reads, any retry).'));
 -- a reviewed tier keeps the free envelope it has today
 PERFORM tt_obs(tt_image(),'caller-byok subscription',tt_rich(),'{"cost_basis":"free text"}','{"free":"text"}');
 ASSERT image_reading_thin_envelope_violation('[]','{}') = 'envelope' AND image_reading_thin_envelope_violation(NULL,NULL) = 'envelope', 'the envelope test is total';
 RAISE NOTICE 'PASS: a thin reading carries a closed envelope too; a reviewed one is unchanged';
END $$;
-- stored readings: protected unless positively the automatic tier
DO $$ DECLARE img uuid; img2 uuid; r_int uuid; r_rv uuid; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1); cfg jsonb; BEGIN
 SELECT config_value INTO cfg FROM platform_config WHERE config_key='image_reading_tiers';
 -- a rich reading of a tier that is listed only for a moment (a producer nobody seeded), stored
 UPDATE platform_config SET config_value=jsonb_set(cfg,'{reviewed_tiers}',(cfg->'reviewed_tiers')||'"interactive"'::jsonb) WHERE config_key='image_reading_tiers';
 img := tt_image();
 r_int := tt_obs(img,'interactive',tt_rich()); PERFORM project_reviewed_image_analysis(r_int);
 UPDATE platform_config SET config_value=cfg WHERE config_key='image_reading_tiers';
 ASSERT NOT image_reading_tier_is_reviewed('interactive'), 'the tier is unlisted again';
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a stored unlisted-tier reading unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- the same through the photo's stamp alone (no observation): an unlisted tier on the stamp is protected
 img2 := tt_image('20000000-0000-4000-8000-000000000101','{"byok_deep_analysis":{"scene_type":"body_exterior","agent_tier":"interactive"}}');
 BEGIN PERFORM tt_obs(img2,'subscription automatic',thin); RAISE EXCEPTION 'thin over an unlisted-tier stamp unexpectedly landed';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- a reviewed reading landing over it does not supersede it (it is not the automatic tier)
 r_rv := tt_obs(img,'caller-byok subscription',tt_rich('engine_bay')); PERFORM project_reviewed_image_analysis(r_rv);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=r_int), 'a stored reading of an unlisted tier is not superseded';
 -- a damaged tier list does not expose stored reviewed readings: reviewed_tiers = [] and a reviewed reading is stored
 img := tt_image();
 r_rv := tt_obs(img,'caller-byok subscription',tt_rich()); PERFORM project_reviewed_image_analysis(r_rv);
 UPDATE platform_config SET config_value=jsonb_set(cfg,'{reviewed_tiers}','[]'::jsonb) WHERE config_key='image_reading_tiers';
 BEGIN PERFORM tt_obs(img,'subscription automatic',thin); RAISE EXCEPTION 'thin over a stored reviewed reading landed with an empty tier list';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 UPDATE platform_config SET config_value=cfg WHERE config_key='image_reading_tiers';
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=r_rv), 'the reviewed reading is current';
 -- the row without an automatic tier: nothing stored is automatic, so nothing is superseded
 img := tt_image();
 r_int := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(r_int);
 UPDATE platform_config SET config_value=cfg-'automatic' WHERE config_key='image_reading_tiers';
 r_rv := tt_obs(img,'caller-byok subscription',tt_rich()); PERFORM project_reviewed_image_analysis(r_rv);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=r_int), 'no automatic tier in the row: nothing is superseded';
 UPDATE platform_config SET config_value=cfg WHERE config_key='image_reading_tiers';
 RAISE NOTICE 'PASS: stored readings are protected unless positively the automatic tier (unlisted tier, emptied list, no automatic tier)';
END $$;
-- Thin readings replace each other in the ledger's own order and in no other: "newer" means posted later (ingested_at; at one
-- instant the lowest id), the order image_stage_reading_parent uses to name a photo's current reading. Whatever order they are
-- projected in, the newest posted stands alone at the end and nothing is superseded by an older reading.
DO $$ DECLARE img uuid; a uuid; b uuid; c uuid; lo uuid; hi uuid; r jsonb; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1);
  thin2 jsonb := (SELECT jsonb_array_elements(tt_accepted()) OFFSET 1 LIMIT 1); BEGIN
 -- two readings posted before either is projected; the older is projected first: it supersedes nothing, then the newer replaces it
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); b := tt_obs(img,'subscription automatic',thin2);
 ASSERT (SELECT x.ingested_at < y.ingested_at FROM vehicle_observations x, vehicle_observations y WHERE x.id=a AND y.id=b), 'fixture: a was posted before b';
 PERFORM project_reviewed_image_analysis(a);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=b), 'the older thin reading did not supersede the newer, unprojected one';
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=a), 'the older reading is current until the newer one lands';
 PERFORM project_reviewed_image_analysis(b);
 ASSERT (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=a) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=b),
   'then the newer one lands and stands alone';
 -- the other order: the newer lands first and replaces the older one, which can then no longer be projected
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); b := tt_obs(img,'subscription automatic',thin2);
 PERFORM project_reviewed_image_analysis(b);
 ASSERT (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=a), 'the newer thin reading replaces the older, unprojected one';
 BEGIN PERFORM project_reviewed_image_analysis(a); RAISE EXCEPTION 'the superseded older reading projected';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_observation_not_eligible', SQLERRM; END;
 -- a reading made earlier by the reader's clock but posted later is the newer one in the ledger: it replaces the reading posted
 -- before it, and that reading's keyed child (until it lands, both readings and the child are current)
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(a);
 c := tt_child(img,a);
 b := tt_obs(img,'subscription automatic',thin2, p_reviewed => clock_timestamp() - interval '10 minutes');
 ASSERT (SELECT y.observed_at < x.observed_at AND y.ingested_at > x.ingested_at FROM vehicle_observations x, vehicle_observations y WHERE x.id=a AND y.id=b), 'fixture: read earlier, posted later';
 ASSERT (SELECT count(*)=2 FROM vehicle_observations WHERE structured_data->>'image_id'=img::text AND structured_data->>'analysis_kind'='image_deep_byok' AND NOT is_superseded)
   AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=c), 'posted and not yet landed: two current readings and the first one''s child';
 r := project_reviewed_image_analysis(b);
 ASSERT r->>'superseded_readings'='1', r::text;
 ASSERT (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=a) AND (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=c)
   AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=b), 'the reading posted last replaces the one before it and its child, whatever the reader''s clock said';
 -- the same instant in the ledger: the lowest id is the newer, in either projection order
 FOR k IN 1..2 LOOP
   img := tt_image();
   a := tt_obs(img,'subscription automatic',thin); b := tt_obs(img,'subscription automatic',thin2);
   UPDATE vehicle_observations SET ingested_at='2026-11-20 12:00:00+00' WHERE id IN (a,b);
   lo := least(a,b); hi := greatest(a,b);
   IF k = 1 THEN
     PERFORM project_reviewed_image_analysis(hi);
     ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=lo), 'tie: the higher id supersedes nothing';
     PERFORM project_reviewed_image_analysis(lo);
   ELSE
     PERFORM project_reviewed_image_analysis(lo);
     BEGIN PERFORM project_reviewed_image_analysis(hi); RAISE EXCEPTION 'the superseded reading projected';
     EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_observation_not_eligible', SQLERRM; END;
   END IF;
   ASSERT (SELECT is_superseded AND superseded_by=lo FROM vehicle_observations WHERE id=hi) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=lo),
     'tie at one instant, order '||k||': the lowest id stands and the other is superseded by it';
 END LOOP;
 -- a reading with no ledger clock at all is the oldest
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); b := tt_obs(img,'subscription automatic',thin2);
 UPDATE vehicle_observations SET ingested_at=NULL WHERE id=b;
 PERFORM project_reviewed_image_analysis(b);
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=a), 'a reading with no ledger clock supersedes nothing that has one';
 PERFORM project_reviewed_image_analysis(a);
 ASSERT (SELECT is_superseded AND superseded_by=a FROM vehicle_observations WHERE id=b) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=a), 'and is replaced by the one that has';
 RAISE NOTICE 'PASS: thin readings replace each other in the ledger''s order only: the newest posted stands alone, in any projection order';
END $$;
-- Rule 3 replaces only the keyed children of the readings it replaces. The landing reading's own child, and the child of a reading
-- that is not automatic, stay current even when another reading of the photo is superseded in the same projection.
DO $$ DECLARE img uuid; a uuid; b uuid; x uuid; rv uuid; ca uuid; cb uuid; cx uuid; crv uuid; r jsonb; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) LIMIT 1);
  thin2 jsonb := (SELECT jsonb_array_elements(tt_accepted()) OFFSET 1 LIMIT 1); BEGIN
 -- thin over thin, and the newer reading was keyed before its landing finished
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(a);
 ca := tt_child(img,a);
 b := tt_obs(img,'subscription automatic',thin2);
 cb := tt_child(img,b);
 r := project_reviewed_image_analysis(b);
 ASSERT r->>'superseded_readings'='1', r::text;
 ASSERT (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=a) AND (SELECT is_superseded AND superseded_by=b FROM vehicle_observations WHERE id=ca),
   'the replaced reading and its child are superseded';
 ASSERT (SELECT NOT is_superseded AND superseded_by IS NULL AND lineage_chain IS NULL FROM vehicle_observations WHERE id=cb), 'the landing reading''s own child stays current';
 -- a reviewed reading lands on a photo that holds an automatic reading and a reviewed reading posted but not yet projected, each keyed
 img := tt_image();
 a := tt_obs(img,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(a);
 ca := tt_child(img,a);
 x := tt_obs(img,'caller-byok subscription',tt_rich());
 cx := tt_child(img,x);
 rv := tt_obs(img,'caller-byok subscription',tt_rich('engine_bay'));
 crv := tt_child(img,rv);
 PERFORM project_reviewed_image_analysis(rv);
 ASSERT (SELECT is_superseded AND superseded_by=rv FROM vehicle_observations WHERE id=a) AND (SELECT is_superseded AND superseded_by=rv FROM vehicle_observations WHERE id=ca),
   'the automatic reading and its child are superseded by the reviewed landing';
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=x) AND (SELECT NOT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id=cx),
   'a reviewed reading posted beside it, and that reading''s child, are left alone';
 ASSERT (SELECT NOT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id=crv), 'the landing reviewed reading''s own child stays current';
 RAISE NOTICE 'PASS: Rule 3 supersedes only the children of the readings it replaces';
END $$;

-- ===== the config row is what keeps a reviewed producer working
DO $$ DECLARE img uuid; img_r uuid; img_t uuid; t1 uuid; c1 uuid; t2 uuid; thin jsonb := (SELECT jsonb_array_elements(tt_accepted()) OFFSET 1 LIMIT 1); BEGIN
 -- readings already on photos: a reviewed one, and a thin one with a keyed child and a newer thin reading posted behind it
 img_r := tt_image(); PERFORM project_reviewed_image_analysis(tt_obs(img_r,'caller-byok subscription',tt_rich()));
 img_t := tt_image(); t1 := tt_obs(img_t,'subscription automatic',thin); PERFORM project_reviewed_image_analysis(t1); c1 := tt_child(img_t,t1);
 t2 := tt_obs(img_t,'subscription automatic',thin);
 DELETE FROM platform_config WHERE config_key='image_reading_tiers';
 ASSERT NOT image_reading_tier_is_reviewed('caller-byok subscription'), 'row missing: every new reading is thin';
 ASSERT image_reading_tier_is_reviewed('caller-byok subscription', true), 'row missing: a reading already stored is not called thin';
 -- nothing stored is displaced without a tier list: Rule 2 refuses, Rule 3 supersedes nothing
 BEGIN PERFORM tt_obs(img_r,'subscription automatic',thin); RAISE EXCEPTION 'thin over a stored reading unexpectedly landed without the row';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 -- t2 was posted while the row existed. Without the row nothing stored is positively automatic, so t1 is protected and t2 does not
 -- land beside it
 BEGIN PERFORM project_reviewed_image_analysis(t2); RAISE EXCEPTION 'a thin reading landed over a stored reading without the row';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_over_reviewed', SQLERRM; END;
 ASSERT (SELECT NOT is_superseded FROM vehicle_observations WHERE id=t1) AND (SELECT NOT is_superseded FROM vehicle_observations WHERE id=c1),
   'without the row a landing reading supersedes no stored reading and no child';
 img := tt_image();
 BEGIN PERFORM tt_obs(img,'caller-byok subscription',tt_rich()); RAISE EXCEPTION 'reviewed producer unexpectedly admitted without the row';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_asserts_unchecked_field', SQLERRM; END;
 -- with no row nothing is admitted beyond unknown: the example with a scene is refused, the all-unknown one lands
 BEGIN PERFORM tt_obs(img,'subscription automatic',(SELECT jsonb_array_elements(tt_accepted()) LIMIT 1)); RAISE EXCEPTION 'scene admitted without the row';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='thin_review_asserts_unchecked_field', SQLERRM; END;
 PERFORM tt_obs(img,'subscription automatic',(SELECT jsonb_array_elements(tt_accepted()) OFFSET 1 LIMIT 1));
 RAISE NOTICE 'PASS: without the row a reviewed producer is refused loudly, nothing but unknown is admitted';
END $$;
\ir ../migrations/20261120140000_image_reading_tiers.sql
DO $$ DECLARE img uuid; BEGIN
 ASSERT (SELECT count(*)=1 FROM platform_config WHERE config_key='image_reading_tiers'), 'replaying the migration restores the row';
 img := tt_image();
 PERFORM tt_obs(img,'caller-byok subscription',tt_rich());
 -- a later edit of the row survives a replay (ON CONFLICT DO NOTHING)
 UPDATE platform_config SET config_value=jsonb_set(config_value,'{reviewed_tiers}',(config_value->'reviewed_tiers')||'"added later"'::jsonb) WHERE config_key='image_reading_tiers';
 RAISE NOTICE 'PASS: the migration insert restores the row; reviewed producer lands again';
END $$;
\ir ../migrations/20261120140000_image_reading_tiers.sql
DO $$ BEGIN
 ASSERT image_reading_tier_is_reviewed('added later'), 'a replay does not overwrite a later edit of the row';
 -- the intake still needs the service role
 SET LOCAL request.jwt.claim.role='anon';
 BEGIN PERFORM tt_obs(tt_image(),'caller-byok subscription',tt_rich()); RAISE EXCEPTION 'anon insert unexpectedly landed';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='review_requires_service_role', SQLERRM; END;
 RAISE NOTICE 'PASS: replay keeps a later edit; the intake still refuses callers that are not service_role';
END $$;

-- ===== the guard on the replaced bodies, and the revert
-- a body someone changed since it was read from production is refused (the whole migration rolls back)
DO $$ DECLARE d text; BEGIN
 d := replace(pg_get_functiondef('public.project_reviewed_image_analysis(uuid)'::regprocedure), 'RETURN jsonb_build_object(''success'',true,', 'RETURN jsonb_build_object(''changed_since'',true,''success'',true,');
 ASSERT d <> pg_get_functiondef('public.project_reviewed_image_analysis(uuid)'::regprocedure), 'the variation changed the body';
 EXECUTE d;
END $$;
DROP FUNCTION image_reading_thin_violation(jsonb, jsonb);
\set ON_ERROR_STOP off
\ir ../migrations/20261120140000_image_reading_tiers.sql
rollback;
\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT to_regprocedure('public.image_reading_thin_violation(jsonb,jsonb)') IS NULL, 'a changed body refused the whole migration: nothing it creates exists';
 ASSERT position('changed_since' in (SELECT prosrc FROM pg_proc WHERE oid='public.project_reviewed_image_analysis(uuid)'::regprocedure)) > 0, 'and the changed body is still there';
 RAISE NOTICE 'PASS: a body changed since production is refused';
END $$;
-- the revert restores the two bodies exactly as production held them, removes the helpers, keeps the row
\ir revert_20261120140000_image_reading_tiers.sql
DO $$ DECLARE img uuid; BEGIN
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.guard_reviewed_image_analysis()'::regprocedure)='4cce782e45863596f359e44bf1c602a6', 'guard body is production''s again';
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.project_reviewed_image_analysis(uuid)'::regprocedure)='c5d8f9b483490c82c90b23e7fc0cb042', 'projection body is production''s again';
 ASSERT (SELECT proconfig FROM pg_proc WHERE oid='public.project_reviewed_image_analysis(uuid)'::regprocedure)=ARRAY['search_path=public, pg_temp','lock_timeout=3s','statement_timeout=10s'], 'settings as live';
 ASSERT to_regprocedure('public.image_reading_thin_violation(jsonb,jsonb)') IS NULL AND to_regprocedure('public.image_reading_tier_is_reviewed(text,boolean)') IS NULL, 'helpers removed';
 ASSERT (SELECT count(*)=1 FROM platform_config WHERE config_key='image_reading_tiers'), 'the config row stays';
 img := tt_image();
 PERFORM tt_obs(img,'a tier nobody listed',tt_rich());
 RAISE NOTICE 'PASS: revert restores both production bodies exactly; an unlisted tier with rich content lands again';
END $$;
-- and the migration applies again on the restored bodies
\ir ../migrations/20261120140000_image_reading_tiers.sql
DO $$ BEGIN
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.guard_reviewed_image_analysis()'::regprocedure)='d3b859b91864aedd4c7e2146a188ea60', 'guard body is the migration''s';
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.project_reviewed_image_analysis(uuid)'::regprocedure)='9e53ed7082465cc63f5f937fe224a54d', 'projection body is the migration''s';
 RAISE NOTICE 'PASS: migration applies again after the revert';
END $$;
