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

console.log('🚀 Processing ALL remaining images...\n');

async function processAll() {
  let totalProcessed = 0;
  let offset = 0;
  const BATCH_SIZE = 25;

  while (true) {
    // Check remaining
    const { count: remaining } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null);

    if (!remaining || remaining === 0) {
      console.log('\n✅ ALL IMAGES PROCESSED!');
      break;
    }

    console.log(`\n📦 Processing batch (${remaining} remaining)...`);

    const { data, error } = await supabase.functions.invoke('batch-analyze-all-images', {
      body: {
        batch_size: BATCH_SIZE,
        offset: offset,
        limit: BATCH_SIZE
      }
    });

    if (error) {
      console.log(`  ⚠️  Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    if (data) {
      const processed = data.analyzed || 0;
      totalProcessed += processed;
      
      console.log(`  ✅ Processed: ${processed}`);
      console.log(`  📊 Total processed: ${totalProcessed}`);
      console.log(`  ⏳ Remaining: ${data.total_remaining || remaining}`);

      if (data.total_remaining === 0) {
        console.log('\n✅ ALL IMAGES PROCESSED!');
        break;
      }

      offset = data.next_offset || offset + BATCH_SIZE;
    }

    // Wait before next batch
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log(`\n🎉 Complete! Total processed: ${totalProcessed}`);
}

processAll().catch(console.error);

