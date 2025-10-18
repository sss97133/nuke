const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  // Get a real vehicle
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .limit(1);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles found');
    return;
  }
  
  const v = vehicles[0];
  console.log(`Testing with: ${v.year} ${v.make} ${v.model}`);
  console.log(`UUID: ${v.id}\n`);
  
  // Call the function
  const { data, error } = await supabase.rpc('calculate_vehicle_completion_algorithmic', {
    p_vehicle_id: v.id
  });
  
  if (error) {
    console.log('❌ Error:', error);
  } else {
    console.log('✅ Success!');
    console.log(JSON.stringify(data, null, 2));
  }
}

test();

