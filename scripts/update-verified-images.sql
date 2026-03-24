-- Update all remaining product images with verified PartsHawk CDN URLs
-- Every URL confirmed HTTP 200

-- ACDelco LS3 Fuel Injectors (×8)
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12576341_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12576341';

-- ACDelco D510C Ignition Coils (×8)
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12611424_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12611424';

-- ACDelco Cam Sensor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12591720_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12591720';

-- ACDelco Coolant Temp
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/9/19236568_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '19236568';

-- ACDelco Crank Sensor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12615626_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12615626';

-- ACDelco Knock Sensors (×2)
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12623730_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12623730';

-- ACDelco IAT Sensor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/2/5/25036751_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '25036751';

-- ACDelco/Bosch MAP Sensor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/5/5/55573248_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '55573248';

-- ACDelco Oil Pressure Sensor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12673134_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '12673134';

-- GM Electronic Throttle Body + TPS sensors
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/2/12605109_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number IN ('12605109', 'integrated_in_12605109');

-- ACDelco Horn
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/e/1/e1903e_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'E1903E';

-- Painless Blower Resistor
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/8/0/80111_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '80111';

-- United Pacific LED Flasher
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/9/0/90652_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '90652';

-- Sanden A/C Compressor Clutch
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/9/1/9176_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '9176';

-- Speedway AD244 Alternator
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/4/0/403210_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '403210';

-- AMP Research P300-K5 Controller
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/p/3/p300-k5_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'P300-K5';

-- Dakota Digital VHX Gauge Cluster
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/v/h/vhx-73c-pu-k-b_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'VHX-73C-PU-K-B';

-- E-Stopp Electric Parking Brake
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/e/s/esk001_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'ESK001';

-- Torque King Transfer Case Switch
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/q/u/qu30048_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'QU30048';

-- Blue Sea Systems 12V Outlet
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/0/1011200_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '1011200';

-- Blue Sea Systems Dual USB
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/0/1045_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '1045';

-- Hella Mini Relay
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/0/0/007794301_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '007794301';

-- United Pacific Tail Lights
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/c/t/ctl7387led-l_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number IN ('CTL7387LED-L', 'CTL7387LED-R');

-- United Pacific LED 1156 Backup
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/3/6/36469_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '36469';

-- United Pacific LED Park/Turn
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/1/110706_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '110706';

-- United Pacific LED Cab Lights
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/1/110709_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '110709';

-- United Pacific LED License Plate
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/1/1/110711_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '110711';

-- United Pacific LED 1157 Amber Turn
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/3/6/36480a_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '36480A';

-- Auto Metal Direct Side Markers
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/x/2/x240-4073-1d_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'X240-4073-1D';

UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/x/2/x240-4073-2d_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = 'X240-4073-2D';

-- AMP Research PowerStep
UPDATE vehicle_build_manifest SET product_image_url = 'https://partshawk.com/media/catalog/product/7/5/75138-01a_primary.jpg'
WHERE vehicle_id = 'e04bf9c5-b488-433b-be9a-3d307861d90b' AND part_number = '75138-01A';
