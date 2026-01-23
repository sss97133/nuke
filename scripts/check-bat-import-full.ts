import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  const { data } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('source', 'bat_import')
    .limit(1)
    .single();

  if (data) {
    // Show non-null fields
    console.log('Non-null fields in bat_import image:');
    Object.entries(data).forEach(([k, v]) => {
      if (v !== null && v !== '' && v !== false && JSON.stringify(v) !== '{}' && JSON.stringify(v) !== '[]') {
        console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    });
  }
}
check();
