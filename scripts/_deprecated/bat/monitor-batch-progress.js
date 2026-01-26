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

async function monitorProgress() {
  const { count: total } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true });

  const { count: analyzed } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .not('ai_scan_metadata->appraiser->primary_label', 'is', null);

  const { count: pending } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .is('ai_scan_metadata->appraiser->primary_label', null);

  const { count: completed } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'completed');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 BATCH ANALYSIS PROGRESS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Total images: ${total || 0}`);
  console.log(`✅ Analyzed: ${analyzed || 0} (${Math.round((analyzed / total) * 100) || 0}%)`);
  console.log(`⏳ Pending: ${pending || 0}`);
  console.log(`📝 Status: completed: ${completed || 0}`);
  console.log(`\nProgress: ${analyzed || 0}/${total || 0} (${Math.round((analyzed / total) * 100) || 0}%)`);
  
  if (pending === 0) {
    console.log('\n✅ ALL IMAGES ANALYZED!');
  } else {
    const remaining = pending;
    const estimatedTime = Math.ceil((remaining * 1.5) / 60); // ~1.5 seconds per image
    console.log(`\n⏳ Estimated time remaining: ~${estimatedTime} minutes`);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

monitorProgress().catch(console.error);

