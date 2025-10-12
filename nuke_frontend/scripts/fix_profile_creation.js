import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function fixProfileSystem() {
  console.log('🔧 Fixing Profile System\n');
  
  try {
    // Step 1: Get all auth users
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) throw authError;
    
    console.log(`Found ${users?.length || 0} auth users`);
    
    // Step 2: Create missing profiles
    let fixed = 0;
    for (const user of users || []) {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();
      
      if (!existingProfile) {
        const { error } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            username: user.email?.split('@')[0] || 'user',
            full_name: user.user_metadata?.full_name || '',
            avatar_url: user.user_metadata?.avatar_url || null,
            created_at: user.created_at,
            updated_at: new Date().toISOString()
          });
        
        if (error) {
          console.error(`❌ Failed to create profile for ${user.email}:`, error.message);
        } else {
          console.log(`✅ Created profile for ${user.email}`);
          fixed++;
        }
      }
    }
    
    // Step 3: Verify final state
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\n📊 Final Status:`);
    console.log(`- Total profiles: ${count}`);
    console.log(`- Profiles created: ${fixed}`);
    
    // Step 4: Create sample vehicle data for testing
    if (users?.length > 0) {
      const testUser = users[0];
      console.log(`\n🚗 Creating test vehicle for ${testUser.email}...`);
      
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          owner_id: testUser.id,
          make: 'Porsche',
          model: '911 Turbo',
          year: 2022,
          vin: 'WP0AB2A98NS123456',
          color: 'Guards Red',
          mileage: 5000,
          ownership_status: 'owned',
          privacy_setting: 'private',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (vehicleError) {
        console.log(`⚠️ Could not create test vehicle: ${vehicleError.message}`);
      } else {
        console.log(`✅ Test vehicle created`);
      }
    }
    
    console.log('\n✅ Profile system fixed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixProfileSystem();
