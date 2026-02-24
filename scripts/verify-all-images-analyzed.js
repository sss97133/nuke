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

async function verify() {
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata, ai_processing_status')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  if (!images || images.length === 0) {
    console.log('❌ No images found');
    return;
  }

  const total = images.length;
  const analyzed = images.filter(img => img.ai_scan_metadata?.appraiser?.primary_label).length;
  const missing = total - analyzed;
  const pending = images.filter(img => img.ai_processing_status === 'pending').length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 IMAGE ANALYSIS VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Total images: ${total}`);
  console.log(`✅ Analyzed: ${analyzed} (${Math.round(analyzed/total*100)}%)`);
  console.log(`⏳ Pending: ${pending}`);
  console.log(`❌ Missing: ${missing}`);
  
  if (missing > 0) {
    console.log(`\n⚠️  WARNING: ${missing} images still need analysis!`);
    const missingIds = images
      .filter(img => !img.ai_scan_metadata?.appraiser?.primary_label)
      .map(img => img.id);
    console.log(`   Missing IDs: ${missingIds.slice(0, 5).join(', ')}${missingIds.length > 5 ? '...' : ''}`);
  } else {
    console.log(`\n✅ SUCCESS: ALL ${total} images have been analyzed!`);
  }

  // Show breakdown by status
  const byStatus = images.reduce((acc, img) => {
    const status = img.ai_processing_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nStatus breakdown:`);
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });

  console.log(`\n🔗 Profile: https://nuke.ag/vehicle/${VEHICLE_ID}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

verify().catch(console.error);

