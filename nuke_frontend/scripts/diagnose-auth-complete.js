// Comprehensive authentication diagnostic
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function comprehensiveDiagnosis() {
  console.log('🔍 Comprehensive Authentication Diagnosis\n');
  
  // Test 1: Check profiles table structure
  console.log('1. Checking profiles table structure...');
  try {
    const { data, error } = await supabase.from('profiles').select('*').limit(1);
    if (error) {
      console.log('❌ Profiles table error:', error.message);
      console.log('   Details:', error);
    } else {
      console.log('✅ Profiles table accessible');
      console.log('   Sample data structure:', Object.keys(data[0] || {}));
    }
  } catch (err) {
    console.log('❌ Profiles table exception:', err.message);
  }
  
  // Test 2: Try to manually insert a profile (this will test RLS)
  console.log('\n2. Testing manual profile insertion (RLS test)...');
  try {
    const testId = 'test-' + Date.now();
    const { data, error } = await supabase.from('profiles').insert({
      id: testId,
      email: `test-${testId}@example.com`,
      full_name: 'Test User',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    if (error) {
      console.log('❌ Manual profile insert failed:', error.message);
      console.log('   This suggests RLS policy issues');
    } else {
      console.log('✅ Manual profile insert successful');
    }
  } catch (err) {
    console.log('❌ Manual profile insert exception:', err.message);
  }
  
  // Test 3: Check if email confirmation is enabled
  console.log('\n3. Testing sign-up with detailed logging...');
  const testEmail = `diagnostic-${Date.now()}@example.com`;
  
  try {
    console.log(`   Attempting sign-up with: ${testEmail}`);
    
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!',
      options: {
        data: {
          full_name: 'Diagnostic User'
        }
      }
    });
    
    if (error) {
      console.log('❌ Sign-up failed:', error.message);
      console.log('   Error code:', error.status);
      console.log('   Full error:', JSON.stringify(error, null, 2));
      
      // Suggest the likely fix
      console.log('\n🔧 LIKELY SOLUTION:');
      console.log('The issue is probably that the profiles table has RLS enabled');
      console.log('but the trigger function needs SECURITY DEFINER privileges.');
      console.log('\nTry this SQL in Supabase:');
      console.log(`
-- Temporarily disable RLS to test
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Test sign-up now, then re-enable with proper policies:
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      `);
      
    } else {
      console.log('✅ SIGN-UP SUCCESSFUL!');
      console.log('   User ID:', data.user?.id);
      console.log('   Email:', data.user?.email);
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Created' : 'None (email confirmation required)');
      
      if (!data.session && data.user && !data.user.email_confirmed_at) {
        console.log('\n📧 EMAIL CONFIRMATION REQUIRED!');
        console.log('   Supabase WILL send an email confirmation link!');
        console.log('   Check your email:', testEmail);
        console.log('   This confirms your Supabase integration is working!');
      }
    }
    
  } catch (err) {
    console.log('❌ Sign-up exception:', err.message);
  }
  
  console.log('\n🎯 Next Steps:');
  console.log('1. If manual profile insert failed → RLS policy issue');
  console.log('2. If sign-up still fails → Try disabling RLS temporarily');
  console.log('3. If sign-up works → Check email for confirmation link!');
}

comprehensiveDiagnosis();
