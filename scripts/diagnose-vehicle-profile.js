/**
 * Quick diagnostic script to check vehicle profile data quality
 * Usage: node scripts/diagnose-vehicle-profile.js <vehicleId>
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseVehicle(vehicleId) {
  console.log(`\n🔍 Diagnosing vehicle: ${vehicleId}\n`);

  // Get vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (error) {
    console.error('❌ Error fetching vehicle:', error.message);
    return;
  }

  if (!vehicle) {
    console.error('❌ Vehicle not found');
    return;
  }

  console.log('📊 CORE FIELDS:');
  console.log(`  Year: ${vehicle.year || '❌ MISSING'}`);
  console.log(`  Make: ${vehicle.make || '❌ MISSING'}`);
  console.log(`  Model: ${vehicle.model || '❌ MISSING'}`);
  console.log(`  VIN: ${vehicle.vin || '❌ MISSING'}`);
  console.log(`  Color: ${vehicle.color || '❌ MISSING'}`);
  console.log(`  Mileage: ${vehicle.mileage ? vehicle.mileage.toLocaleString() + ' mi' : '❌ MISSING'}`);
  console.log(`  Transmission: ${vehicle.transmission || '❌ MISSING'}`);
  console.log(`  Engine: ${vehicle.engine || '❌ MISSING'}`);
  console.log(`  Description: ${vehicle.description ? (vehicle.description.length > 50 ? '✅ Present (' + vehicle.description.length + ' chars)' : '⚠️ Too short (' + vehicle.description.length + ' chars)') : '❌ MISSING'}`);

  console.log('\n💰 FINANCIAL FIELDS:');
  console.log(`  Asking Price: ${vehicle.asking_price ? '$' + vehicle.asking_price.toLocaleString() : '❌ MISSING'}`);
  console.log(`  Purchase Price: ${vehicle.purchase_price ? '$' + vehicle.purchase_price.toLocaleString() : '❌ MISSING'}`);
  console.log(`  Sale Price: ${vehicle.sale_price ? '$' + vehicle.sale_price.toLocaleString() : '❌ MISSING'}`);
  console.log(`  MSRP: ${vehicle.msrp ? '$' + vehicle.msrp.toLocaleString() : '❌ MISSING'}`);
  console.log(`  Current Value: ${vehicle.current_value ? '$' + vehicle.current_value.toLocaleString() : '❌ MISSING'}`);

  console.log('\n🔧 SPEC FIELDS:');
  console.log(`  Fuel Type: ${vehicle.fuel_type || '❌ MISSING'}`);
  console.log(`  Drivetrain: ${vehicle.drivetrain || '❌ MISSING'}`);
  console.log(`  Body Style: ${vehicle.body_style || '❌ MISSING'}`);
  console.log(`  Doors: ${vehicle.doors || '❌ MISSING'}`);
  console.log(`  Seats: ${vehicle.seats || '❌ MISSING'}`);
  console.log(`  Engine Size: ${vehicle.engine_size || '❌ MISSING'}`);
  console.log(`  Horsepower: ${vehicle.horsepower || '❌ MISSING'}`);
  console.log(`  Torque: ${vehicle.torque || '❌ MISSING'}`);

  console.log('\n📎 ORIGIN DATA:');
  console.log(`  Profile Origin: ${vehicle.profile_origin || '❌ MISSING'}`);
  console.log(`  Discovery URL: ${vehicle.discovery_url || '❌ MISSING'}`);
  console.log(`  BaT URL: ${vehicle.bat_auction_url || '❌ MISSING'}`);
  console.log(`  Origin Metadata: ${vehicle.origin_metadata ? '✅ Present' : '❌ MISSING'}`);

  // Check related data
  const [images, events, comments, docs, listings] = await Promise.all([
    supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    supabase.from('timeline_events').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    supabase.from('vehicle_comments').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    supabase.from('vehicle_documents').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    supabase.from('external_listings').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
  ]);

  console.log('\n📦 RELATED DATA:');
  console.log(`  Images: ${images.count || 0}`);
  console.log(`  Timeline Events: ${events.count || 0}`);
  console.log(`  Comments: ${comments.count || 0}`);
  console.log(`  Documents: ${docs.count || 0}`);
  console.log(`  External Listings: ${listings.count || 0}`);

  // Check for contamination
  console.log('\n🧹 DATA QUALITY:');
  const contaminatedFields = [];
  const fieldsToCheck = {
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    transmission: vehicle.transmission,
    engine: vehicle.engine,
  };

  Object.entries(fieldsToCheck).forEach(([key, value]) => {
    if (value && typeof value === 'string') {
      if (value.includes('Bring a Trailer') || value.includes('Lot #') || value.includes('sold for $')) {
        contaminatedFields.push(`${key}: BaT contamination`);
      }
      if (value.includes('{') || value.includes('}') || value.includes(';') || value.includes('/*')) {
        contaminatedFields.push(`${key}: CSS/JS contamination`);
      }
      if (value.includes(' - $') || (value.includes('(') && value.match(/\$[\d,]+/))) {
        contaminatedFields.push(`${key}: Listing title contamination`);
      }
    }
  });

  if (contaminatedFields.length > 0) {
    console.log('  ⚠️  CONTAMINATED FIELDS:');
    contaminatedFields.forEach(f => console.log(`    - ${f}`));
  } else {
    console.log('  ✅ No contamination detected');
  }

  // Calculate completeness score
  const coreFields = ['year', 'make', 'model', 'vin', 'color', 'mileage', 'transmission', 'engine', 'description'];
  const presentCoreFields = coreFields.filter(f => {
    const val = vehicle[f];
    if (f === 'description') return val && val.length > 20;
    return val !== null && val !== undefined && val !== '';
  }).length;

  const completenessScore = Math.round((presentCoreFields / coreFields.length) * 100);
  console.log(`\n📈 COMPLETENESS SCORE: ${completenessScore}% (${presentCoreFields}/${coreFields.length} core fields)`);

  // Recommendations
  console.log('\n💡 RECOMMENDATIONS:');
  if (!vehicle.year || !vehicle.make || !vehicle.model) {
    console.log('  - Re-extract basic vehicle info from discovery_url');
  }
  if (vehicle.discovery_url && !vehicle.origin_metadata) {
    console.log('  - Re-scrape discovery_url to extract origin_metadata');
  }
  if (images.count === 0 && vehicle.discovery_url) {
    console.log('  - Backfill images from discovery_url');
  }
  if (!vehicle.description || vehicle.description.length < 50) {
    console.log('  - Extract description from discovery_url or origin_metadata');
  }
  if (contaminatedFields.length > 0) {
    console.log('  - Clean contaminated fields');
  }
  if (completenessScore < 50) {
    console.log('  - Vehicle has minimal data - consider comprehensive re-extraction');
  }

  console.log('\n');
}

const vehicleId = process.argv[2];
if (!vehicleId) {
  console.error('Usage: node scripts/diagnose-vehicle-profile.js <vehicleId>');
  process.exit(1);
}

diagnoseVehicle(vehicleId).catch(console.error);

