// Test sign-up with proper email format after trigger fix
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testFixedAuth() {
  console.log('🧪 Testing Sign-Up After Trigger Fix\n');
  
  // Use a proper email format
  const testEmail = `test.user.${Date.now()}@gmail.com`;
  const testPassword = 'SecurePassword123!';
  
  console.log(`📧 Testing with: ${testEmail}`);
  console.log(`🔐 Password: ${testPassword}\n`);
  
  try {
    const startTime = Date.now();
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword
    });
    const endTime = Date.now();
    
    console.log(`⏱️  Request took: ${endTime - startTime}ms\n`);
    
    if (error) {
      console.log('❌ Sign-up failed:', error.message);
      console.log('   Status:', error.status);
      
      if (error.status === 400) {
        console.log('   400 = Bad request (email/password validation)');
      } else if (error.status === 422) {
        console.log('   422 = Unprocessable entity (business logic validation)');
      } else if (error.status === 500) {
        console.log('   500 = Database/trigger error (should be fixed now!)');
      }
    } else {
      console.log('✅ Sign-up successful!');
      console.log('   User ID:', data.user?.id);
      console.log('   Email:', data.user?.email);
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Active' : 'None (email confirmation required)');
      
      if (!data.session) {
        console.log('\n📧 Email confirmation required!');
        console.log('   Check your email for a confirmation link');
        console.log('   This is NORMAL and expected behavior');
      }
    }
  } catch (err) {
    console.log('❌ Network error:', err.message);
  }
  
  // Check if profile was created
  console.log('\n🔍 Checking if profile was created...');
  try {
    const { data: recentProfiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('email', testEmail);
    
    if (error) {
      console.log('❌ Cannot check profiles:', error.message);
    } else if (recentProfiles.length > 0) {
      console.log('✅ Profile created successfully!');
      console.log('   Profile ID:', recentProfiles[0].id);
      console.log('   Email:', recentProfiles[0].email);
      console.log('   Created:', recentProfiles[0].created_at);
    } else {
      console.log('❌ No profile found - trigger may have failed');
    }
  } catch (err) {
    console.log('❌ Profile check failed:', err.message);
  }
  
  console.log('\n🎯 Final Status:');
  console.log('If you see "Sign-up successful" and "Profile created successfully",');
  console.log('then your authentication pipeline is working perfectly! 🎉');
}

testFixedAuth();
