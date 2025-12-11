require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://uxqjqgqvgdqxqxqxqxqx.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugVehicleCounts() {
  console.log('=== Vehicle Count Debug ===\n');

  try {
    // 1. Total vehicles in database
    const { data: allVehicles, error: allError, count: totalCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' });
    
    console.log(`1. Total vehicles in database: ${totalCount}`);
    if (allError) console.error('Error:', allError);

    // 2. Public vehicles only
    const { data: publicVehicles, error: publicError, count: publicCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' })
      .eq('is_public', true);
    
    console.log(`2. Public vehicles: ${publicCount}`);
    if (publicError) console.error('Error:', publicError);

    // 3. Vehicles with non-null user_id
    const { data: withUserVehicles, error: userError, count: userCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' })
      .eq('is_public', true)
      .not('user_id', 'is', null);
    
    console.log(`3. Public vehicles with user_id: ${userCount}`);
    if (userError) console.error('Error:', userError);

    // 4. Vehicles excluding null UUID (what the search service does)
    const { data: searchVehicles, error: searchError, count: searchCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' })
      .eq('is_public', true)
      .neq('user_id', '00000000-0000-0000-0000-000000000000');
    
    console.log(`4. Search service query result: ${searchCount}`);
    if (searchError) console.error('Error:', searchError);

    // 5. Show sample of vehicles with their user_id values
    console.log('\n=== Sample Vehicle Data ===');
    if (allVehicles && allVehicles.length > 0) {
      allVehicles.slice(0, 5).forEach((vehicle, index) => {
        console.log(`${index + 1}. ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        console.log(`   - ID: ${vehicle.id}`);
        console.log(`   - User ID: ${vehicle.user_id}`);
        console.log(`   - Is Public: ${vehicle.is_public}`);
        console.log(`   - Created: ${vehicle.created_at}`);
        console.log('');
      });
    }

    // 6. Check for vehicles with null user_id
    const { data: nullUserVehicles, error: nullError, count: nullCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' })
      .is('user_id', null);
    
    console.log(`6. Vehicles with null user_id: ${nullCount}`);
    if (nullError) console.error('Error:', nullError);

    // 7. Check for vehicles with the specific null UUID
    const { data: nullUuidVehicles, error: nullUuidError, count: nullUuidCount } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact' })
      .eq('user_id', '00000000-0000-0000-0000-000000000000');
    
    console.log(`7. Vehicles with null UUID: ${nullUuidCount}`);
    if (nullUuidError) console.error('Error:', nullUuidError);

  } catch (error) {
    console.error('Debug script error:', error);
  }
}

debugVehicleCounts();
