const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for admin access
const supabase = createClient(supabaseUrl, supabaseKey);

async function updateBlazerTotals() {
  console.log('Updating Blazer build totals to correct Scott Performance values...');
  
  // First check what's there
  const { data: existing } = await supabase
    .from('vehicle_builds')
    .select('id, total_spent')
    .eq('vehicle_id', 'e08bf694-970f-4cbe-8a74-8715158a0f2e');
  
  console.log('Existing builds:', existing);
  
  // Update using the ID directly
  if (existing && existing.length > 0) {
    const buildId = existing[0].id;
    const { data, error } = await supabase
      .from('vehicle_builds')
      .update({
        total_spent: 125840.33,  // Correct total from Scott Performance
        name: '1977 Blazer K5 - Complete Scott Performance Build',
        description: 'Frame-off restoration with LS3 swap, 6L90 transmission, Motec M130 ECU & PDM wiring'
      })
      .eq('id', buildId)
      .select();
    
    if (error) {
      console.error('Error updating build:', error);
    } else {
      console.log('✅ Build updated successfully:', data);
    }
  }
  
  // Verify the update
  const { data: verify } = await supabase
    .from('vehicle_builds')
    .select('total_spent, total_budget, name')
    .eq('vehicle_id', 'e08bf694-970f-4cbe-8a74-8715158a0f2e')
    .single();
  
  console.log('\n📊 Final values:');
  console.log('Name:', verify.name);
  console.log('Total Spent:', verify.total_spent);
  console.log('Total Budget:', verify.total_budget);
}

updateBlazerTotals();
