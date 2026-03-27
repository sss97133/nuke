-- ============================================
-- WORK ORDER INTELLIGENCE: Seed Data
-- ============================================
-- Re-runs the 51 original labor operations from migration 20251206 + 7 exhaust/brake ops.
-- All ON CONFLICT (code) DO NOTHING. Safe to re-run infinite times.

INSERT INTO labor_operations (code, name, base_hours, system, model_year_min, model_year_max, notes) VALUES
-- BODY WORK (per panel)
('BODY-DENT-SMALL', 'Small dent repair (2" or less)', 0.5, 'body', 1960, 2000, 'PDR or minor bodywork'),
('BODY-DENT-MED', 'Medium dent repair (2-6")', 1.5, 'body', 1960, 2000, 'Fill and sand required'),
('BODY-DENT-LARGE', 'Large dent repair (6"+)', 3.0, 'body', 1960, 2000, 'Significant fill work'),
('BODY-RUST-SPOT', 'Rust spot repair (small)', 2.0, 'body', 1960, 2000, 'Cut, weld patch, grind'),
('BODY-RUST-PANEL', 'Panel section replacement', 6.0, 'body', 1960, 2000, 'Cut panel, weld new section'),
('BODY-REPLACE-FENDER', 'Fender R&R', 2.0, 'body', 1960, 2000, 'Remove and reinstall'),
('BODY-REPLACE-DOOR', 'Door R&R', 2.5, 'body', 1960, 2000, 'Remove and reinstall'),
('BODY-REPLACE-HOOD', 'Hood R&R', 1.0, 'body', 1960, 2000, 'Remove and reinstall'),
('BODY-REPLACE-TAILGATE', 'Tailgate R&R', 1.5, 'body', 1960, 2000, 'Remove and reinstall'),
('BODY-REPLACE-BEDSIDES', 'Bedside R&R (each)', 4.0, 'body', 1960, 2000, 'Welded panel, significant work'),

-- PAINT (per panel or stage)
('PAINT-PREP-PANEL', 'Paint prep per panel', 2.0, 'paint', 1960, 2000, 'Sand, prime, block'),
('PAINT-BASE-PANEL', 'Base coat per panel', 1.0, 'paint', 1960, 2000, 'Spray base coat'),
('PAINT-CLEAR-PANEL', 'Clear coat per panel', 0.5, 'paint', 1960, 2000, 'Spray clear coat'),
('PAINT-COMPLETE-PANEL', 'Complete paint per panel', 4.0, 'paint', 1960, 2000, 'Prep through clear'),
('PAINT-COMPLETE-CAB', 'Complete cab paint', 24.0, 'paint', 1960, 2000, 'Full cab exterior'),
('PAINT-COMPLETE-TRUCK', 'Complete truck paint', 40.0, 'paint', 1960, 2000, 'Full truck exterior'),
('PAINT-JAMBS', 'Door jambs and edges', 4.0, 'paint', 1960, 2000, 'All jamb surfaces'),
('PAINT-ENGINE-BAY', 'Engine bay paint', 8.0, 'paint', 1960, 2000, 'Firewall, inner fenders'),

-- DISASSEMBLY/REASSEMBLY
('DISASM-FRONT-CLIP', 'Front clip removal', 4.0, 'body', 1960, 2000, 'Hood, fenders, grille, lights'),
('DISASM-DOORS', 'Doors removal (both)', 2.0, 'body', 1960, 2000, 'Both front doors'),
('DISASM-BED', 'Bed removal', 3.0, 'body', 1960, 2000, 'Truck bed complete'),
('DISASM-CAB-INTERIOR', 'Cab interior strip', 6.0, 'interior', 1960, 2000, 'Seats, dash, carpet, headliner'),
('DISASM-GLASS-ALL', 'All glass removal', 4.0, 'body', 1960, 2000, 'Windshield, back glass, door glass'),
('REASSM-FRONT-CLIP', 'Front clip installation', 5.0, 'body', 1960, 2000, 'Alignment critical'),
('REASSM-DOORS', 'Doors installation (both)', 3.0, 'body', 1960, 2000, 'Alignment and adjustment'),
('REASSM-BED', 'Bed installation', 4.0, 'body', 1960, 2000, 'Alignment critical'),

-- MECHANICAL
('MECH-BRAKES-ALL', 'Complete brake job', 6.0, 'mechanical', 1960, 2000, 'All 4 corners'),
('MECH-BRAKES-FRONT', 'Front brakes', 2.0, 'mechanical', 1960, 2000, 'Pads or shoes, rotors/drums'),
('MECH-BRAKES-REAR', 'Rear brakes', 2.5, 'mechanical', 1960, 2000, 'Shoes, drums, hardware'),
('MECH-SUSPENSION-FRONT', 'Front suspension rebuild', 8.0, 'mechanical', 1960, 2000, 'Control arms, ball joints'),
('MECH-RADIATOR-RR', 'Radiator R&R', 1.5, 'mechanical', 1960, 2000, 'Remove and reinstall'),
('MECH-ENGINE-RR', 'Engine R&R', 12.0, 'mechanical', 1960, 2000, 'Pull and reinstall'),
('MECH-TRANS-RR', 'Transmission R&R', 6.0, 'mechanical', 1960, 2000, 'Manual trans'),

-- INTERIOR
('INT-SEATS-RR', 'Seats R&R (pair)', 1.0, 'interior', 1960, 2000, 'Remove and reinstall'),
('INT-CARPET-RR', 'Carpet R&R', 2.0, 'interior', 1960, 2000, 'Complete carpet kit'),
('INT-HEADLINER-RR', 'Headliner R&R', 4.0, 'interior', 1960, 2000, 'Replace headliner'),
('INT-DASH-RR', 'Dash R&R', 6.0, 'interior', 1960, 2000, 'Complete dash removal'),
('INT-DOOR-PANELS', 'Door panels R&R (pair)', 1.5, 'interior', 1960, 2000, 'Both door panels'),

-- GLASS
('GLASS-WINDSHIELD', 'Windshield R&R', 1.5, 'glass', 1960, 2000, 'Remove and install'),
('GLASS-BACK', 'Back glass R&R', 1.0, 'glass', 1960, 2000, 'Remove and install'),
('GLASS-DOOR', 'Door glass R&R (each)', 1.0, 'glass', 1960, 2000, 'Per door'),
('GLASS-VENT', 'Vent window R&R (each)', 0.5, 'glass', 1960, 2000, 'Per vent window'),

-- ELECTRICAL
('ELEC-WIRING-HARNESS', 'Wiring harness R&R', 8.0, 'electrical', 1960, 2000, 'Main harness'),
('ELEC-HEADLIGHTS', 'Headlight assembly (pair)', 1.0, 'electrical', 1960, 2000, 'Both headlights'),
('ELEC-TAILLIGHTS', 'Taillight assembly (pair)', 0.5, 'electrical', 1960, 2000, 'Both taillights'),
('ELEC-GAUGES', 'Gauge cluster R&R', 2.0, 'electrical', 1960, 2000, 'Instrument cluster'),

-- TRIM/CHROME
('TRIM-BUMPERS-FRONT', 'Front bumper R&R', 1.0, 'trim', 1960, 2000, 'Remove and install'),
('TRIM-BUMPERS-REAR', 'Rear bumper R&R', 0.75, 'trim', 1960, 2000, 'Remove and install'),
('TRIM-GRILLE', 'Grille R&R', 0.5, 'trim', 1960, 2000, 'Remove and install'),
('TRIM-MOLDINGS-SIDE', 'Side moldings R&R', 1.0, 'trim', 1960, 2000, 'Both sides'),
('TRIM-MIRRORS', 'Mirrors R&R (pair)', 0.5, 'trim', 1960, 2000, 'Both mirrors'),

-- ============================================
-- EXHAUST (added 2026-03-26 for K2500 custom exhaust build)
-- ============================================
('EXH-CUSTOM-FAB', 'Custom exhaust fabrication', 12.0, 'exhaust', 1960, 2000, 'Full custom system: headers to tips'),
('EXH-MUFFLER-RR', 'Muffler R&R (each)', 1.0, 'exhaust', 1960, 2000, 'Remove and reinstall one muffler'),
('EXH-CUTOUT-INSTALL', 'Electric cutout install (each)', 1.5, 'exhaust', 1960, 2000, 'QTP or similar electric cutout'),
('EXH-Y-PIPE-FAB', 'Y-pipe fabrication', 2.0, 'exhaust', 1960, 2000, 'Merge collector to single or dual'),
('EXH-HANGER-WELD', 'Exhaust hanger fabrication', 0.5, 'exhaust', 1960, 2000, 'Per hanger point'),
('EXH-TIP-INSTALL', 'Exhaust tip install (each)', 0.5, 'exhaust', 1960, 2000, 'Weld or clamp-on tip'),

-- BRAKES (additional granularity for K2500 rear brake rebuild)
('MECH-EBRAKE-REBUILD', 'Emergency brake rebuild', 2.0, 'mechanical', 1960, 2000, 'Cables, shoes, adjuster, hardware')

ON CONFLICT (code) DO NOTHING;
