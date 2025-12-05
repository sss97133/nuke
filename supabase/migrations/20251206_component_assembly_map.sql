-- Component Assembly Map
-- 
-- AI needs to KNOW what a "door" IS - all 24+ parts that make it up
-- So it can recognize:
--   - Door installed = shell + hinges + glass + regulator + trim + handle + lock + weatherstrip
--   - Door with sag = worn hinges/bushings, needs hinge pin kit
--   - New door on ground = bare shell, no components
--   - Door in primer = prepped, missing all trim/glass

CREATE TABLE IF NOT EXISTS component_assembly_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The assembly (high-level component)
  assembly_name TEXT NOT NULL,      -- 'door', 'front_clip', 'engine'
  assembly_category TEXT NOT NULL,  -- 'body', 'mechanical', 'interior'
  
  -- Description for AI context
  assembly_description TEXT,
  
  -- Sub-components (what makes up this assembly)
  -- AI uses this to identify what's PRESENT vs MISSING in an image
  sub_components JSONB DEFAULT '[]',
  
  -- Catalog part numbers for each sub-component
  -- Links to our 4,951+ indexed parts
  catalog_part_map JSONB DEFAULT '{}',
  
  -- States this assembly can be in (for AI state recognition)
  possible_states JSONB DEFAULT '[]',
  
  -- Visual indicators for each state (what AI should look for)
  state_indicators JSONB DEFAULT '{}',
  
  -- Application (which vehicles)
  application_years TEXT,
  application_models TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_component_assembly_map_name ON component_assembly_map(assembly_name);
CREATE INDEX IF NOT EXISTS idx_component_assembly_map_category ON component_assembly_map(assembly_category);

-- Seed common assemblies for 73-87 trucks

-- DOOR ASSEMBLY
INSERT INTO component_assembly_map (assembly_name, assembly_category, assembly_description, sub_components, possible_states, state_indicators, application_years, application_models)
VALUES (
  'door',
  'body',
  'Complete door assembly including shell and all components',
  '["shell", "outer_skin", "inner_panel", "hinges", "hinge_pins", "hinge_bushings", "door_latch", "lock_cylinder", "lock_rod", "outer_handle", "inner_handle", "window_glass", "window_regulator", "window_crank_or_motor", "window_run_channel", "vent_window", "vent_frame", "weatherstrip_door", "weatherstrip_window", "mirror_mount", "door_panel_trim", "armrest", "speaker_grille", "courtesy_light"]'::JSONB,
  '["original", "removed", "bare_shell", "rust_repaired", "in_primer", "in_paint", "painted", "assembled_no_trim", "installed_complete"]'::JSONB,
  '{
    "original": ["mounted on vehicle", "may show wear/sag", "all components present"],
    "removed": ["off vehicle", "on stand or ground"],
    "bare_shell": ["no glass", "no trim", "no weatherstrip", "exposed metal"],
    "with_sag": ["gap at top", "worn hinges", "hinge pin wear visible"],
    "in_primer": ["gray primer visible", "no color paint", "taped edges"],
    "in_paint": ["fresh paint", "in booth", "masking visible"],
    "painted": ["fresh color", "no masking", "waiting for assembly"],
    "assembled_no_trim": ["glass installed", "no door panel", "no armrest"],
    "installed_complete": ["all glass present", "all trim present", "weatherstrip installed", "handles installed"]
  }'::JSONB,
  '1973-1987',
  ARRAY['C10', 'K10', 'C20', 'K20', 'Blazer', 'Jimmy', 'Suburban']
) ON CONFLICT DO NOTHING;

-- FRONT CLIP ASSEMBLY
INSERT INTO component_assembly_map (assembly_name, assembly_category, assembly_description, sub_components, possible_states, state_indicators, application_years, application_models)
VALUES (
  'front_clip',
  'body',
  'Complete front clip assembly - everything forward of firewall',
  '["hood", "fenders_lh", "fenders_rh", "inner_fenders", "grille", "grille_support", "headlight_bezels", "headlights", "parking_lights", "turn_signals", "bumper", "bumper_brackets", "core_support", "hood_hinges", "hood_latch", "fender_bolts", "hood_pad", "wiring_harness_front"]'::JSONB,
  '["original", "removed", "disassembled", "stored", "rust_repaired", "in_primer", "in_paint", "painted", "ready_to_install", "installed"]'::JSONB,
  '{
    "removed": ["no hood", "no fenders", "no grille", "firewall exposed", "engine visible"],
    "disassembled": ["components separated", "on stands or floor", "not assembled"],
    "in_primer": ["gray primer", "no color", "body work visible"],
    "painted": ["fresh color coat", "no masking", "ready for clear or assembly"],
    "installed": ["hood mounted", "fenders bolted", "grille installed", "lights connected"]
  }'::JSONB,
  '1973-1987',
  ARRAY['C10', 'K10', 'C20', 'K20', 'Blazer', 'Jimmy', 'Suburban']
) ON CONFLICT DO NOTHING;

-- SEAT ASSEMBLY
INSERT INTO component_assembly_map (assembly_name, assembly_category, assembly_description, sub_components, possible_states, state_indicators, application_years, application_models)
VALUES (
  'seat_assembly',
  'interior',
  'Complete seat including frame, foam, and upholstery',
  '["seat_frame", "springs", "foam_bottom", "foam_back", "cover_bottom", "cover_back", "headrest", "headrest_guides", "seat_tracks", "track_bolts", "seat_belt_anchor", "lumbar_support", "side_bolsters", "trim_pieces", "adjustment_handle"]'::JSONB,
  '["original", "removed", "frame_only", "new_foam", "being_covered", "recovered", "installed"]'::JSONB,
  '{
    "original": ["worn fabric", "may have tears", "sun fade possible", "springs may sag"],
    "frame_only": ["bare metal frame", "no foam", "no fabric", "springs visible"],
    "new_foam": ["fresh foam visible", "no cover yet", "yellow or gray foam"],
    "being_covered": ["fabric being stretched", "hog rings visible", "work in progress"],
    "recovered": ["fresh fabric", "no wrinkles", "tight stitching", "like new"],
    "installed": ["mounted in vehicle", "bolted to floor", "functional"]
  }'::JSONB,
  '1973-1987',
  ARRAY['C10', 'K10', 'C20', 'K20', 'Blazer', 'Jimmy', 'Suburban']
) ON CONFLICT DO NOTHING;

-- BED ASSEMBLY
INSERT INTO component_assembly_map (assembly_name, assembly_category, assembly_description, sub_components, possible_states, state_indicators, application_years, application_models)
VALUES (
  'bed',
  'body',
  'Truck bed assembly including floor, sides, and tailgate',
  '["bed_floor", "bed_sides_lh", "bed_sides_rh", "front_panel", "tailgate", "tailgate_chains", "tailgate_hinges", "tailgate_handle", "bed_strips", "bed_bolts", "wheel_wells", "tie_down_hooks", "stake_pockets", "bed_wood", "bed_liner"]'::JSONB,
  '["original", "removed", "floor_replaced", "sides_replaced", "sandblasted", "in_primer", "in_bedliner", "painted", "wood_installed", "complete"]'::JSONB,
  '{
    "original": ["may have rust", "dents possible", "original floor"],
    "floor_replaced": ["new floor panel", "fresh welds visible"],
    "sandblasted": ["bare metal", "no rust", "ready for coating"],
    "in_bedliner": ["spray liner visible", "textured surface"],
    "wood_installed": ["bed wood strips", "stainless strips optional"],
    "complete": ["painted or lined", "all components installed"]
  }'::JSONB,
  '1973-1987',
  ARRAY['C10', 'K10', 'C20', 'K20']
) ON CONFLICT DO NOTHING;

COMMENT ON TABLE component_assembly_map IS 'Provides AI context: what parts make up each assembly, and visual indicators for each state';

