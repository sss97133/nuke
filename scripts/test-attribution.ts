import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function test() {
  // Check photographer_attribution in working image
  const { data: sample } = await supabase
    .from('vehicle_images')
    .select('photographer_attribution')
    .eq('source', 'bat_import')
    .limit(5);

  console.log('photographer_attribution in bat_import images:');
  sample?.forEach(s => console.log('  ', s.photographer_attribution));

  // Try insert with photographer_attribution set
  const testRow = {
    vehicle_id: 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d',
    image_url: 'https://media.carsandbids.com/test-attr-' + Date.now() + '.jpg',
    source: 'cab_import',
    is_external: true,
    is_approved: true,
    verification_status: 'approved',
    approval_status: 'auto_approved',
    redaction_level: 'none',
    image_type: 'general',
    category: 'general',
    optimization_status: 'pending',
    ai_processing_status: 'pending',
    organization_status: 'unorganized',
    position: 999,
    display_order: 999,
    photographer_attribution: 'Cars & Bids',  // Try setting this
  };

  console.log('\nTrying insert with photographer_attribution...');
  const { error } = await supabase.from('vehicle_images').insert(testRow);
  if (error) {
    console.log('Error:', error.message);
  } else {
    console.log('Success!');
    await supabase.from('vehicle_images').delete().eq('image_url', testRow.image_url);
  }
}
test();
