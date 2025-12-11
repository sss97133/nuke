// Inspect the remote database triggers and RLS policies
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectRemoteDatabase() {
  console.log('🔍 Inspecting Remote Database Triggers and Policies\n');
  
  // Check 1: Look for existing profiles structure
  console.log('1. Checking profiles table structure...');
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .limit(1);
    
    if (error) {
      console.log('❌ Cannot access profiles:', error.message);
    } else {
      console.log('✅ Profiles table accessible');
      if (profiles.length > 0) {
        console.log('   Sample profile columns:', Object.keys(profiles[0]));
      }
    }
  } catch (err) {
    console.log('❌ Profiles structure check failed:', err.message);
  }
  
  // Check 2: Try to check if our trigger function exists (via RPC if available)
  console.log('\n2. Checking for handle_new_user function...');
  try {
    // This will fail if the function doesn't exist
    const { data, error } = await supabase.rpc('handle_new_user');
    console.log('Function call result:', { data, error });
  } catch (err) {
    console.log('❌ Cannot call handle_new_user directly:', err.message);
  }
  
  // Check 3: Look at existing profiles to understand the schema
  console.log('\n3. Examining existing profiles...');
  try {
    const { data: allProfiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.log('❌ Cannot fetch profiles:', error.message);
    } else {
      console.log(`✅ Found ${allProfiles.length} profiles:`);
      allProfiles.forEach((profile, i) => {
        console.log(`   ${i+1}. ${profile.email || 'No email'} (${profile.created_at})`);
      });
    }
  } catch (err) {
    console.log('❌ Profile examination failed:', err.message);
  }
  
  // Check 4: Test manual profile creation to see RLS behavior
  console.log('\n4. Testing manual profile creation (RLS test)...');
  try {
    const testId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: testId,
        email: `manual-test-${Date.now()}@example.com`,
        full_name: 'Manual Test User'
      });
    
    if (error) {
      console.log('❌ Manual profile creation failed:', error.message);
      console.log('   This suggests RLS is blocking inserts');
    } else {
      console.log('✅ Manual profile creation succeeded');
      console.log('   RLS allows manual inserts');
    }
  } catch (err) {
    console.log('❌ Manual profile test error:', err.message);
  }
  
  console.log('\n🎯 Diagnosis:');
  console.log('The 500 "Database error saving new user" suggests:');
  console.log('1. The auth.users insert succeeds');
  console.log('2. But the trigger function fails when trying to create the profile');
  console.log('3. This could be due to:');
  console.log('   - Missing handle_new_user function');
  console.log('   - RLS blocking the trigger\'s insert');
  console.log('   - Wrong column names/types in the trigger');
  console.log('   - Missing permissions for the trigger function');
}

inspectRemoteDatabase();
