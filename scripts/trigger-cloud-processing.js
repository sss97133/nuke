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

async function triggerCloudProcessing() {
  console.log('🚀 Triggering cloud image processing...\n');

  // Trigger the edge function
  const { data, error } = await supabase.functions.invoke('process-all-images-cron', {
    body: {
      max_images: 1000,  // Process 1000 images per run
      batch_size: 50
    }
  });

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('✅ Processing started in cloud!');
  console.log('\nResults:');
  console.log(`  Analyzed: ${data.analyzed || 0}`);
  console.log(`  Failed: ${data.failed || 0}`);
  console.log(`  Remaining: ${data.total_remaining || 0}`);
  console.log(`\n💡 This runs automatically via Supabase cron or GitHub Actions`);
  console.log(`   You can trigger it manually anytime with this script\n`);
}

triggerCloudProcessing().catch(console.error);

