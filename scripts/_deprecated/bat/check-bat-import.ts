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
    .select('source, is_external, category, image_type, is_approved, approval_status, verification_status, redaction_level')
    .eq('source', 'bat_import')
    .limit(1)
    .single();

  console.log('bat_import image structure:');
  if (data) {
    Object.entries(data).forEach(([k, v]) => {
      if (v !== null) console.log(`  ${k}: ${v}`);
    });
  }
}
check();
