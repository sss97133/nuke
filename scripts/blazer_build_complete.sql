-- Complete SQL for 1977 Blazer Build Management System
-- Total Investment: $125,840.33
-- Run this in Supabase SQL Editor

-- 1. First ensure vehicle exists
INSERT INTO vehicles (id, year, make, model, user_id) 
VALUES (
  'e08bf694-970f-4cbe-8a74-8715158a0f2e', 
  1977, 
  'Chevrolet', 
  'Blazer K5',
  auth.uid()
)
ON CONFLICT (id) DO UPDATE 
SET year = 1977, make = 'Chevrolet', model = 'Blazer K5';

-- 2. Clear any existing build data for clean import
DELETE FROM build_line_items 
WHERE build_id IN (
  SELECT id FROM vehicle_builds 
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
);

DELETE FROM vehicle_builds 
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

-- 3. Create the main build with actual totals
INSERT INTO vehicle_builds (
  vehicle_id, 
  name, 
  description, 
  status, 
  total_budget, 
  total_spent, 
  total_hours_actual,
  total_hours_estimated,
  start_date
) VALUES (
  'e08bf694-970f-4cbe-8a74-8715158a0f2e',
  '1977 Blazer K5 - Complete Scott Performance Build',
  'Frame-off restoration with LS3 swap, 6L90 transmission, Motec M130 ECU & PDM wiring',
  'in_progress',
  150000.00,
  125840.33,
  110,
  110,
  '2023-01-01'
);

-- Get the build ID for line items
WITH build AS (
  SELECT id FROM vehicle_builds 
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  LIMIT 1
)

-- 4. Insert all actual line items from Scott Performance build log
INSERT INTO build_line_items (build_id, name, quantity, unit_price, total_price, status, days_to_install, condition)
SELECT 
  build.id,
  item.name,
  item.quantity,
  item.unit_price,
  item.total_price,
  item.status,
  item.days_to_install,
  item.condition
FROM build, (VALUES
  -- WHEELS & TIRES
  ('Tires', 1, 1300.00, 1300.00, 'completed', 0, 'new'),
  ('Wheels', 1, 600.00, 600.00, 'completed', 0, 'new'),
  ('Wheel powder coat', 1, 300.00, 300.00, 'completed', 0, 'new'),
  ('Mount and balance', 1, 130.00, 130.00, 'completed', 0, 'new'),
  ('Lug nuts', 1, 80.00, 80.00, 'completed', 0, 'new'),
  
  -- VEHICLE/CHASSIS
  ('Rolling chassis assembly', 1, 7500.00, 7500.00, 'completed', 0, 'new'),
  ('Disassembly', 1, 2500.00, 2500.00, 'completed', 0, 'new'),
  ('Initial Purchase & shipping', 1, 2250.00, 2250.00, 'completed', 0, 'new'),
  ('Powder Coat', 1, 1800.00, 1800.00, 'completed', 0, 'new'),
  ('Motec engine wiring M130', 1, 15000.00, 15000.00, 'completed', 0, 'new'),
  ('Motec body wiring PDM', 1, 15000.00, 15000.00, 'planning', 0, 'new'),
  
  -- TRANSMISSION (6L90 - CORRECT!)
  ('6L90', 1, 1600.00, 1600.00, 'completed', 0, 'new'),
  ('Torque converter bolts', 1, 30.00, 30.00, 'completed', 0, 'new'),
  ('6L90 Rife', 1, 500.00, 500.00, 'completed', 1, 'new'),
  ('6L90 M control', 1, 500.00, 500.00, 'completed', 0, 'new'),
  ('Trans fluid test', 1, 360.00, 360.00, 'ordered', 0, 'new'),
  ('Dry ice transmission', 1, 250.00, 250.00, 'ordered', 0, 'new'),
  ('Trans cooler', 1, 250.00, 250.00, 'ordered', 1, 'new'),
  ('6L90 linkage', 1, 200.00, 200.00, 'ordered', 0, 'new'),
  ('Trans cover', 1, 200.00, 200.00, 'completed', 1, 'new'),
  ('Transmission bushings', 1, 120.00, 120.00, 'ordered', 1, 'new'),
  
  -- TRANSFER CASE
  ('Case rebuild', 1, 1200.00, 1200.00, 'completed', 0, 'new'),
  ('205 T case', 1, 1000.00, 1000.00, 'completed', 0, 'new'),
  ('Case adapt', 1, 800.00, 800.00, 'completed', 0, 'new'),
  ('Transfer case linkage', 1, 250.00, 250.00, 'ordered', 1, 'new'),
  ('Case machine work', 1, 150.00, 150.00, 'completed', 1, 'new'),
  
  -- SUSPENSION
  ('Lift kit', 1, 800.00, 800.00, 'completed', 0, 'new'),
  ('Rear shackles', 1, 140.00, 140.00, 'completed', 0, 'new'),
  ('Steering box', 1, 400.00, 400.00, 'completed', 0, 'new'),
  ('Front shackles', 1, 100.00, 100.00, 'completed', 0, 'new'),
  ('Cross over bars', 1, 100.00, 100.00, 'completed', 1, 'new'),
  ('Cross over drop arm', 1, 100.00, 100.00, 'completed', 0, 'new'),
  ('Cross over ball joints', 1, 100.00, 100.00, 'completed', 0, 'new'),
  ('Drop sway bar', 1, 600.00, 600.00, 'completed', 0, 'new'),
  ('Gearbox support', 1, 150.00, 150.00, 'completed', 0, 'new'),
  
  -- INTERIOR
  ('LMC order', 1, 300.00, 300.00, 'completed', 0, 'new'),
  ('SMS fabric', 1, 260.00, 260.00, 'completed', 0, 'new'),
  ('Precision felt kit', 1, 150.00, 150.00, 'completed', 1, 'new'),
  ('Interior upholstery', 1, 2900.00, 2900.00, 'completed', 1, 'new'),
  ('Dash', 1, 600.00, 600.00, 'ordered', 1, 'new'),
  ('Carpet', 1, 455.00, 455.00, 'ordered', 1, 'new'),
  ('Dynamat', 1, 440.00, 440.00, 'completed', 7, 'new'),
  ('Seat panels refurbish', 1, 400.00, 400.00, 'completed', 2, 'new'),
  ('Center console restore', 1, 300.00, 300.00, 'completed', 7, 'new'),
  ('Seat belts', 1, 250.00, 250.00, 'ordered', 2, 'new'),
  ('Vinyl fabric', 1, 100.00, 100.00, 'ordered', 1, 'new'),
  ('Headliner material', 1, 100.00, 100.00, 'ordered', 1, 'new'),
  ('Kick plates', 1, 100.00, 100.00, 'ordered', 0, 'new'),
  
  -- FUEL DELIVERY
  ('Fuel line kit', 1, 120.00, 120.00, 'completed', 2, 'new'),
  ('Fuel line frame clips', 1, 40.00, 40.00, 'completed', 0, 'new'),
  ('Fuel pump sending unit', 1, 400.00, 400.00, 'completed', 1, 'new'),
  ('Tank fillers', 1, 110.00, 110.00, 'ordered', 0, 'new'),
  
  -- EXHAUST
  ('304 stainless Borla', 1, 1500.00, 1500.00, 'completed', 5, 'new'),
  
  -- ENGINE (LS3)
  ('LS3', 1, 6200.00, 6200.00, 'completed', 0, 'new'),
  ('Pulley kit', 1, 2000.00, 2000.00, 'completed', 1, 'new'),
  ('Del S3', 2, 1039.00, 1039.00, 'completed', 0, 'new'),
  ('Intake', 1, 310.00, 310.00, 'completed', 0, 'new'),
  ('Fuel rails', 1, 280.00, 280.00, 'completed', 0, 'new'),
  ('Ignition coil set', 1, 200.00, 200.00, 'completed', 0, 'new'),
  ('Flexplate', 1, 110.00, 110.00, 'completed', 0, 'new'),
  ('Throttle body', 1, 100.00, 100.00, 'completed', 0, 'new'),
  ('Spark plugs', 1, 70.00, 70.00, 'completed', 0, 'new'),
  ('Flexplate bolts', 1, 30.00, 30.00, 'completed', 0, 'new'),
  ('Upgraded alternator', 1, 500.00, 500.00, 'ordered', 0, 'new'),
  ('Radiator', 1, 500.00, 500.00, 'completed', 0, 'new'),
  ('Fluids', 1, 300.00, 300.00, 'ordered', 2, 'new'),
  ('Starter', 1, 250.00, 250.00, 'completed', 0, 'new'),
  ('Oil cooler', 1, 250.00, 250.00, 'ordered', 1, 'new'),
  ('Radiator steam hoses', 1, 150.00, 150.00, 'completed', 0, 'new'),
  ('Fittings for engine coolant', 1, 100.00, 100.00, 'ordered', 0, 'new'),
  ('Radiator overflow', 1, 100.00, 100.00, 'completed', 0, 'new'),
  
  -- BRAKES
  ('Tesla brake booster', 1, 300.00, 300.00, 'completed', 2, 'new'),
  ('Brake line kit', 1, 250.00, 250.00, 'completed', 1, 'new'),
  ('Brake proportioning valve', 1, 60.00, 60.00, 'completed', 0, 'new'),
  ('E brake assembly', 1, 300.00, 300.00, 'ordered', 2, 'new'),
  ('Billet adapter', 1, 200.00, 200.00, 'ordered', 0, 'new'),
  ('Booster angle bracket', 1, 75.00, 75.00, 'ordered', 0, 'new'),
  ('Brake pads front', 1, 80.00, 80.00, 'ordered', 0, 'new'),
  
  -- BODY
  ('Rocker panel repairs', 1, 1700.00, 1700.00, 'completed', 0, 'new'),
  ('Trim polish', 1, 800.00, 800.00, 'completed', 0, 'new'),
  ('Rust repair', 1, 750.00, 750.00, 'completed', 0, 'new'),
  ('Raptor liner', 1, 520.00, 520.00, 'completed', 0, 'new'),
  ('Body fasteners', 2, 620.00, 620.00, 'completed', 0, 'new'),
  ('Dent pull', 1, 300.00, 300.00, 'completed', 0, 'new'),
  ('Body mounts', 1, 175.00, 175.00, 'completed', 0, 'new'),
  ('Radiator support rubber kit', 1, 70.00, 70.00, 'completed', 0, 'new'),
  ('Metallic red paint', 1, 600.00, 600.00, 'completed', 1, 'new'),
  ('Rad support', 1, 320.00, 320.00, 'completed', 0, 'new'),
  ('Clear coat', 1, 300.00, 300.00, 'completed', 7, 'new'),
  ('Front bumper', 1, 250.00, 250.00, 'planning', 0, 'new'),
  ('Rear bumper', 1, 250.00, 250.00, 'planning', 0, 'new'),
  ('Owner badge', 1, 250.00, 250.00, 'planning', 2, 'new'),
  ('Redrobright LED', 1, 600.00, 600.00, 'planning', 1, 'new'),
  ('Windshield', 1, 300.00, 300.00, 'planning', 1, 'new'),
  ('Side mirrors', 1, 100.00, 100.00, 'planning', 0, 'new'),
  ('Hood hinges', 1, 100.00, 100.00, 'planning', 0, 'new'),
  ('Windshield trim + rubber', 1, 80.00, 80.00, 'planning', 1, 'new'),
  ('Bumper bolts', 1, 60.00, 60.00, 'planning', 0, 'new'),
  ('Hood heat shield', 1, 50.00, 50.00, 'planning', 0, 'new'),
  ('Under carriage repaint', 1, 250.00, 250.00, 'completed', 1, 'new'),
  ('Paint work round 1', 1, 5000.00, 5000.00, 'completed', 0, 'new'),
  ('Paint work round 2', 1, 5000.00, 5000.00, 'completed', 0, 'new'),
  
  -- AXLES
  ('Rear axle rebuild', 1, 1500.00, 1500.00, 'completed', 0, 'new'),
  ('Front axle rebuild', 1, 1500.00, 1500.00, 'completed', 0, 'new'),
  ('Rear Disc brake kit', 1, 600.00, 600.00, 'completed', 0, 'new'),
  ('Cross over steering', 1, 425.00, 425.00, 'completed', 0, 'new'),
  ('Rear Driveshaft', 1, 500.00, 500.00, 'planning', 1, 'new'),
  ('Front driveshaft', 1, 500.00, 500.00, 'planning', 1, 'new'),
  
  -- ASSEMBLY
  ('110 hours assembly', 1, 13750.00, 13750.00, 'planning', 14, 'new'),
  
  -- AC SYSTEM
  ('AC Compressor', 1, 500.00, 500.00, 'planning', 2, 'new'),
  ('AC Condenser', 1, 300.00, 300.00, 'planning', 0, 'new'),
  ('AC Blower motor', 1, 300.00, 300.00, 'planning', 0, 'new'),
  ('AC lines', 1, 250.00, 250.00, 'planning', 2, 'new'),
  ('AC Evaporator', 1, 110.00, 110.00, 'planning', 1, 'new'),
  ('AC Accumulator', 1, 100.00, 100.00, 'planning', 0, 'new'),
  ('Additional AC parts', 1, 100.00, 100.00, 'planning', 0, 'new'),
  ('AC brackets', 1, 100.00, 100.00, 'planning', 0, 'new'),
  
  -- LABOR
  ('Installation - Joey', 1, 1000.00, 1000.00, 'completed', 0, 'new'),
  ('Paint - Tommy', 1, 2500.00, 2500.00, 'completed', 0, 'new'),
  
  -- TAX (included in totals)
  ('Sales Tax', 1, 4721.33, 4721.33, 'completed', 0, 'new')
) AS item(name, quantity, unit_price, total_price, status, days_to_install, condition);

-- Verify the totals
SELECT 
  'Build Summary' as report,
  COUNT(*) as total_parts,
  SUM(total_price) as total_invested,
  SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END) as completed_value,
  SUM(CASE WHEN status = 'ordered' THEN total_price ELSE 0 END) as ordered_value,
  SUM(CASE WHEN status = 'planning' THEN total_price ELSE 0 END) as planned_value
FROM build_line_items 
WHERE build_id IN (
  SELECT id FROM vehicle_builds 
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
);
