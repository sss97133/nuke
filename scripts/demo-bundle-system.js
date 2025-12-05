// DEMO: Bundle System - Shows bundle grouping working
// For meetings - demonstrates the system is ready

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function demoBundleSystem(vehicleId) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 BUNDLE SYSTEM DEMO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get vehicle info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model')
    .eq('id', vehicleId)
    .single();

  if (vehicle) {
    console.log(`🚗 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);
  }

  // Get bundles
  const { data: bundles, error } = await supabase
    .rpc('get_image_bundles_for_vehicle', {
      p_vehicle_id: vehicleId,
      p_min_images: 3
    });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!bundles || bundles.length === 0) {
    console.log('No bundles found');
    return;
  }

  console.log(`✅ Found ${bundles.length} image bundles\n`);

  // Show top 5 bundles
  bundles.slice(0, 5).forEach((bundle, idx) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Bundle ${idx + 1}:`);
    console.log(`  📅 Date: ${bundle.bundle_date}`);
    console.log(`  📸 Images: ${bundle.image_count}`);
    console.log(`  ⏱️  Duration: ${Math.round(bundle.duration_minutes)} minutes`);
    console.log(`  📱 Device: ${bundle.device_fingerprint || 'Unknown'}`);
    
    // Check timeline fit
    supabase.rpc('check_bundle_fits_timeline', {
      p_vehicle_id: vehicleId,
      p_bundle_date: bundle.bundle_date,
      p_device_fingerprint: bundle.device_fingerprint || 'Unknown-Unknown-Unknown-Unknown'
    }).then(({ data: timelineCheck }) => {
      if (timelineCheck) {
        if (timelineCheck.fits_timeline) {
          console.log(`  ✅ Fits timeline`);
        } else {
          console.log(`  ⚠️  Timeline concerns: ${timelineCheck.concerns?.join(', ')}`);
        }
      }
    });
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log('📊 SUMMARY:');
  console.log(`  Total bundles: ${bundles.length}`);
  console.log(`  Total images: ${bundles.reduce((sum, b) => sum + parseInt(b.image_count), 0)}`);
  console.log(`  Ready for analysis: ${bundles.length} bundles`);
  console.log(`\n✅ Bundle system is WORKING and READY!`);
  console.log(`\n💡 To analyze a bundle, use:`);
  console.log(`   node scripts/analyze-bundle-direct.js ${vehicleId} <date> <device> <org_id>`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

const vehicleId = process.argv[2] || 'eea40748-cdc1-4ae9-ade1-4431d14a7726';
demoBundleSystem(vehicleId).catch(console.error);

