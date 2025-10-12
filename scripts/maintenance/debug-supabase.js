// Debug Supabase configuration and RLS policies
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSupabase() {
  console.log('🔍 Debugging Supabase configuration...\n');
  
  // Test 1: Check if we can connect to Supabase
  try {
    console.log('1. Testing basic connection...');
    const { data, error } = await supabase.from('profiles').select('count').limit(1);
    if (error) {
      console.log('❌ Profiles table access failed:', error.message);
    } else {
      console.log('✅ Basic connection working');
    }
  } catch (err) {
    console.log('❌ Connection test failed:', err.message);
  }
  
  // Test 2: Check auth configuration
  try {
    console.log('\n2. Testing auth configuration...');
    const { data, error } = await supabase.auth.getSession();
    console.log('✅ Auth client initialized');
  } catch (err) {
    console.log('❌ Auth client failed:', err.message);
  }
  
  // Test 3: Try a simple sign-up with more detailed error info
  try {
    console.log('\n3. Testing sign-up with detailed error...');
    const testEmail = `debug-${Date.now()}@test.com`;
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!'
    });
    
    if (error) {
      console.log('❌ Sign-up error details:');
      console.log('   Message:', error.message);
      console.log('   Status:', error.status);
      console.log('   Details:', error);
    } else {
      console.log('✅ Sign-up successful!');
      console.log('   User ID:', data.user?.id);
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Created' : 'None (email confirmation required)');
    }
  } catch (err) {
    console.log('❌ Sign-up test failed:', err);
  }
  
  // Test 4: Check if profiles table exists and is accessible
  try {
    console.log('\n4. Testing profiles table access...');
    const { data, error } = await supabase.from('profiles').select('*').limit(1);
    if (error) {
      console.log('❌ Profiles table error:', error.message);
      console.log('   This might indicate RLS policy issues');
    } else {
      console.log('✅ Profiles table accessible');
      console.log('   Records found:', data?.length || 0);
    }
  } catch (err) {
    console.log('❌ Profiles table test failed:', err.message);
  }
}

debugSupabase();
