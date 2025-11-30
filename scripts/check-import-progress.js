import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

async function checkProgress() {
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  const { data: images } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 IMPORT PROGRESS CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('VEHICLE:');
  console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.series ? ' ' + vehicle.series : ''}`);
  if (vehicle.vin) {
    console.log(`  VIN: ${vehicle.vin} ${vehicle.vin.length === 17 ? '✅' : '⚠️'}`);
  } else {
    console.log(`  VIN: Not found yet`);
  }
  if (vehicle.condition_rating) {
    console.log(`  Condition: ${vehicle.condition_rating}/10`);
  }
  console.log('');
  
  console.log('IMAGES:');
  console.log(`  Total imported: ${images?.length || 0}`);
  if (images && images.length > 0) {
    const sources = new Set(images.map(img => img.source));
    console.log(`  Sources: ${Array.from(sources).join(', ')}`);
    const recent = images.slice(-5);
    console.log(`  Latest 5:`);
    recent.forEach((img, i) => {
      const time = new Date(img.created_at).toLocaleTimeString();
      console.log(`    ${images.length - 5 + i + 1}. ${time} - ${img.category || 'exterior'}`);
    });
  }
  console.log('');
  
  console.log('🔗 Profile: https://n-zero.dev/vehicle/' + VEHICLE_ID);
  console.log('═══════════════════════════════════════════════════════════\n');
}

checkProgress().catch(console.error);

