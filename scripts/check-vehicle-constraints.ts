import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_VEHICLE = 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d';

async function test() {
  // Get a working vehicle with images
  const { data: workingImage } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .eq('source', 'bat_import')
    .limit(1)
    .single();

  const workingVehicleId = workingImage?.vehicle_id;
  console.log('Working vehicle ID:', workingVehicleId);

  // Compare both vehicles
  const { data: targetVehicle } = await supabase
    .from('vehicles')
    .select('id, user_id, owner_id, organization_id, created_by')
    .eq('id', TARGET_VEHICLE)
    .single();

  const { data: workingVehicle } = await supabase
    .from('vehicles')
    .select('id, user_id, owner_id, organization_id, created_by')
    .eq('id', workingVehicleId)
    .single();

  console.log('\nTarget vehicle (failing):');
  console.log(targetVehicle);

  console.log('\nWorking vehicle:');
  console.log(workingVehicle);

  // Try inserting to working vehicle
  const testRow = {
    vehicle_id: workingVehicleId,
    image_url: 'https://test-' + Date.now() + '.jpg',
    source: 'cab_import',
    is_external: true,
    is_approved: true,
    verification_status: 'approved',
    approval_status: 'auto_approved',
    redaction_level: 'none',
    image_type: 'general',
    category: 'general',
    optimization_status: 'pending',
    ai_processing_status: 'pending',
    organization_status: 'unorganized',
    position: 999,
    display_order: 999,
  };

  console.log('\nTrying insert to WORKING vehicle...');
  const { error: error1 } = await supabase.from('vehicle_images').insert(testRow);
  if (error1) console.log('Error:', error1.message);
  else {
    console.log('Success! Cleaning up...');
    await supabase.from('vehicle_images').delete().eq('image_url', testRow.image_url);
  }

  // Try inserting to target vehicle
  testRow.vehicle_id = TARGET_VEHICLE;
  testRow.image_url = 'https://test2-' + Date.now() + '.jpg';

  console.log('\nTrying insert to TARGET vehicle...');
  const { error: error2 } = await supabase.from('vehicle_images').insert(testRow);
  if (error2) console.log('Error:', error2.message);
  else {
    console.log('Success! Cleaning up...');
    await supabase.from('vehicle_images').delete().eq('image_url', testRow.image_url);
  }
}
test();
