import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function cleanup() {
  console.log('=== CLEANING UP BAD CAB IMAGES ===\n');

  // Delete in tiny batches due to Supabase timeout limits
  let deleted = 0;
  const BATCH_SIZE = 20;

  for (let round = 0; round < 500; round++) {
    try {
      // Fetch tiny batch
      const { data: batch, error: fetchErr } = await supabase
        .from('vehicle_images')
        .select('id')
        .contains('exif_data', { imported_from: 'Cars & Bids' })
        .limit(BATCH_SIZE);

      if (fetchErr) {
        console.log('\nFetch error:', fetchErr.message);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!batch || batch.length === 0) {
        console.log('\nNo more images to delete.');
        break;
      }

      // Delete one by one to avoid timeout
      for (const row of batch) {
        const { error: delErr } = await supabase
          .from('vehicle_images')
          .delete()
          .eq('id', row.id);

        if (!delErr) {
          deleted++;
          if (deleted % 50 === 0) {
            process.stdout.write(`\rDeleted: ${deleted}`);
          }
        }
      }

      // Brief pause
      await new Promise(r => setTimeout(r, 50));
    } catch (e: any) {
      console.log('\nError:', e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n\nCleanup complete. Deleted', deleted, 'bad images.');
}

cleanup();
