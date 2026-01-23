import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function test() {
  // Get a working bat_import image
  const { data: sample } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('source', 'bat_import')
    .limit(1)
    .single();

  if (!sample) {
    console.log('No sample found');
    return;
  }

  console.log('Got sample, creating copy...');

  // Create copy with new ID and URL
  const copy = { ...sample };
  delete copy.id;
  copy.vehicle_id = 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d';
  copy.image_url = 'https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/test-' + Date.now() + '.jpg';
  copy.source = 'cab_import';

  const { data, error } = await supabase
    .from('vehicle_images')
    .insert(copy)
    .select('id');

  if (error) {
    console.log('Error:', error.message);
  } else {
    console.log('Success! ID:', data[0].id);
    // Clean up
    await supabase.from('vehicle_images').delete().eq('id', data[0].id);
    console.log('Cleaned up');
  }
}
test();
