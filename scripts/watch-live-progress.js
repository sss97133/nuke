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

let lastCount = 0;
let startTime = Date.now();

async function watchProgress() {
  while (true) {
    try {
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

      const percent = Math.round((analyzed / total) * 100);
      const processed = analyzed - lastCount;
      const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
      const rate = analyzed / elapsed; // images per minute
      const remaining = pending;
      const eta = remaining / rate; // minutes remaining

      // Clear screen and show progress
      console.clear();
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📊 LIVE IMAGE ANALYSIS PROGRESS');
      console.log('═══════════════════════════════════════════════════════════\n');
      
      // Progress bar
      const barWidth = 50;
      const filled = Math.round((percent / 100) * barWidth);
      const empty = barWidth - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      console.log(`[${bar}] ${percent}%`);
      console.log('');
      
      console.log(`✅ Analyzed: ${analyzed.toLocaleString()} / ${total.toLocaleString()}`);
      console.log(`⏳ Remaining: ${pending.toLocaleString()}`);
      console.log(`📈 Rate: ${rate.toFixed(1)} images/minute`);
      console.log(`⏱️  Elapsed: ${elapsed.toFixed(1)} minutes`);
      console.log(`🎯 ETA: ${eta.toFixed(1)} minutes`);
      
      if (processed > 0) {
        console.log(`\n⚡ Last update: +${processed} images processed`);
      }
      
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('Press Ctrl+C to stop monitoring');
      console.log('═══════════════════════════════════════════════════════════\n');

      lastCount = analyzed;

      if (pending === 0) {
        console.log('✅ ALL IMAGES COMPLETE!');
        break;
      }

      // Update every 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      console.error('Error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

watchProgress().catch(console.error);

