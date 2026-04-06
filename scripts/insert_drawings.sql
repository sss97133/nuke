-- Fix AEM harness note
UPDATE component_drawings
SET notes = 'AEM 36-3824 Rev A. TA2 LS3 Engine Harness Component Diagram for M130 ECU. Shows all connector face views with GM part numbers. This is the canonical harness layout for the M130+LS3 combination.'
WHERE id = '15256773-bbc2-4a3b-91db-7f633f8d79cc';

-- Insert Holley Mid-Mount as a component
INSERT INTO component_library (manufacturer, part_number, name, category, subcategory, description, notes)
VALUES (
  'Holley',
  '20-290',
  'Mid-Mount Complete Accessory Drive System',
  'accessory_drive',
  'bracket_system',
  'Complete mid-mount accessory drive kit for LS engines. Includes timing cover, brackets, and hardware for alternator, A/C compressor, and power steering pump.',
  'Bracket-less design mounts all accessories to timing cover. Pulls accessories in tighter than other drives. Compatible with Gen III/IV LS and Gen III Hemi.'
)
ON CONFLICT (manufacturer, part_number) DO NOTHING;

-- Now insert the Holley drawing linked to the new component
INSERT INTO component_drawings (component_id, drawing_type, view_angle, image_path, source_page, dimensions_extracted, notes)
SELECT id, 'dimensional', 'front',
  'reference_documents/component_drawings/extracted/holley_midmount_dimensional.png', 2,
  '{"description": "Front-of-engine dimensional drawing showing overall accessory drive envelope with alternator and A/C compressor positions"}'::jsonb,
  'From Holley Mid-Mount Accessory Drive Kit manual page 2. Shows overall dimensions with accessories mounted.'
FROM component_library WHERE manufacturer = 'Holley' AND part_number = '20-290';

-- Insert ACDelco catalog pages as reference drawings (not linked to individual components, using a catalog component)
-- First, create an ACDelco pigtail catalog entry
INSERT INTO component_library (manufacturer, part_number, name, category, subcategory, description, notes)
VALUES (
  'ACDelco',
  'PIGTAIL-CATALOG-2013',
  '2013 Wiring Pigtails & Sockets Identification Guide',
  'connector',
  'reference_catalog',
  'Complete visual catalog of ACDelco pigtails and sockets with GM part number cross-references. Covers 1-12+ cavity connectors.',
  'Reference document for identifying correct pigtail for LS3 sensor connections. Includes EV6/USCAR, Metri-Pack, Weather-Pack, and GT series connectors.'
)
ON CONFLICT (manufacturer, part_number) DO NOTHING;

-- 6a. ACDelco 2-pin connectors
INSERT INTO component_drawings (component_id, drawing_type, view_angle, image_path, source_page, dimensions_extracted, notes)
SELECT id, 'connector_catalog', 'face_view',
  'reference_documents/component_drawings/extracted/acdelco_pigtail_2pin.png', 5,
  '{"cavity_count": 2, "page_range": "5-6", "connector_types": "Includes Weather-Pack, Metri-Pack 150/280, GT series 2-way connectors"}'::jsonb,
  'ACDelco 2013 catalog pages 5-6. Two-cavity pigtails. Includes connectors used for LS3 coolant temp, oil pressure, and other 2-pin sensors.'
FROM component_library WHERE manufacturer = 'ACDelco' AND part_number = 'PIGTAIL-CATALOG-2013';

-- 6b. ACDelco 3-pin connectors
INSERT INTO component_drawings (component_id, drawing_type, view_angle, image_path, source_page, dimensions_extracted, notes)
SELECT id, 'connector_catalog', 'face_view',
  'reference_documents/component_drawings/extracted/acdelco_pigtail_3pin.png', 15,
  '{"cavity_count": 3, "page_range": "15-16", "connector_types": "Includes Metri-Pack 280, Weather-Pack 3-way connectors"}'::jsonb,
  'ACDelco 2013 catalog pages 15-16. Three-cavity pigtails. Includes connectors for LS3 MAP sensor, cam position, and other 3-pin sensors.'
FROM component_library WHERE manufacturer = 'ACDelco' AND part_number = 'PIGTAIL-CATALOG-2013';

-- 6c. ACDelco 4-pin connectors
INSERT INTO component_drawings (component_id, drawing_type, view_angle, image_path, source_page, dimensions_extracted, notes)
SELECT id, 'connector_catalog', 'face_view',
  'reference_documents/component_drawings/extracted/acdelco_pigtail_4pin.png', 19,
  '{"cavity_count": 4, "page_range": "19-20", "connector_types": "Includes Metri-Pack 280/480, GT series 4-way connectors"}'::jsonb,
  'ACDelco 2013 catalog pages 19-20. Four-cavity pigtails. Includes connectors for LS3 knock sensor, oxygen sensor, and other 4-pin sensors.'
FROM component_library WHERE manufacturer = 'ACDelco' AND part_number = 'PIGTAIL-CATALOG-2013';

-- Verify all records
SELECT cd.id, cl.manufacturer, cl.part_number, cd.drawing_type, cd.source_page,
       length(cd.image_path) as path_len,
       cd.dimensions_extracted IS NOT NULL as has_dims,
       cd.notes IS NOT NULL as has_notes
FROM component_drawings cd
JOIN component_library cl ON cl.id = cd.component_id
ORDER BY cl.manufacturer, cl.part_number, cd.source_page;
