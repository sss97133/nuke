import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function test() {
  // Get a working image with all user-related fields
  const { data: sample } = await supabase
    .from('vehicle_images')
    .select('user_id, imported_by, approved_by, submitted_by, ghost_user_id, documented_by_user_id, user_confirmed_vehicle_by')
    .eq('source', 'bat_import')
    .limit(1)
    .single();

  console.log('User-related fields in working image:');
  console.log(sample);

  // Check if there's a system user we should be using
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email')
    .or('email.ilike.%system%,email.ilike.%import%,email.ilike.%bot%')
    .limit(5);

  console.log('\nSystem users:');
  console.log(users);
}
test();
