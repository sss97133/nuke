import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkVehicle() {
  console.log('🔍 Checking for imported vehicle...\n');

  // Check by discovery URL
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, condition_rating, created_at')
    .or('discovery_url.ilike.%classiccars.com%1985175%,discovery_url.ilike.%classiccars.com/listings/view/1985175%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('❌ No vehicle found yet. The import may still be running or failed.');
    console.log('\n💡 You can:');
    console.log('   1. Wait a few more minutes for the import to complete');
    console.log('   2. Check the function logs: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions/import-classiccars-listing/logs');
    console.log('   3. Try importing again using the ClassicCarsImporter component in the UI');
    return;
  }

  const vehicle = vehicles[0];
  console.log('✅ Found imported vehicle!\n');
  console.log('Vehicle Details:');
  console.log(`  ID: ${vehicle.id}`);
  console.log(`  Year: ${vehicle.year}`);
  console.log(`  Make: ${vehicle.make}`);
  console.log(`  Model: ${vehicle.model}`);
  console.log(`  Condition Rating: ${vehicle.condition_rating || 'N/A'}/10`);
  console.log(`  Created: ${new Date(vehicle.created_at).toLocaleString()}\n`);

  // Get images
  const { data: images, error: imgError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, metadata')
    .eq('vehicle_id', vehicle.id)
    .order('created_at', { ascending: true });

  if (!imgError && images) {
    console.log(`🖼️  Images (${images.length}):`);
    images.slice(0, 5).forEach((img, i) => {
      console.log(`  ${i + 1}. ${img.image_url.substring(0, 80)}...`);
      if (img.metadata?.ai_analysis) {
        console.log(`     Condition: ${img.metadata.ai_analysis.condition_score}/10`);
      }
    });
    if (images.length > 5) {
      console.log(`  ... and ${images.length - 5} more`);
    }
  }

  console.log(`\n🔗 View vehicle profile:`);
  console.log(`   https://n-zero.dev/vehicles/${vehicle.id}`);
  console.log(`\n✅ Done!`);
}

checkVehicle();

