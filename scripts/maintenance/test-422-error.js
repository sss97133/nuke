// Diagnose the 422 error in detail
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose422Error() {
  console.log('🔍 Diagnosing 422 Error\n');
  
  const testEmail = `test422-${Date.now()}@example.com`;
  console.log(`Testing sign-up with: ${testEmail}`);
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!',
      options: {
        data: {
          full_name: 'Test User 422'
        }
      }
    });
    
    if (error) {
      console.log('❌ Sign-up failed with detailed error info:');
      console.log('   Message:', error.message);
      console.log('   Status:', error.status);
      console.log('   Code:', error.code);
      console.log('   Full error object:', JSON.stringify(error, null, 2));
      
      // Common 422 causes
      if (error.status === 422) {
        console.log('\n🔍 422 Error Analysis:');
        console.log('Common causes of 422 errors:');
        console.log('1. Email already exists');
        console.log('2. Password too weak');
        console.log('3. Invalid email format');
        console.log('4. Email confirmation disabled but expected');
        console.log('5. Custom validation rules failing');
        
        if (error.message.includes('email')) {
          console.log('\n💡 Likely cause: Email-related validation issue');
        }
        if (error.message.includes('password')) {
          console.log('\n💡 Likely cause: Password validation issue');
        }
        if (error.message.includes('User already registered')) {
          console.log('\n💡 Likely cause: Email already exists');
        }
      }
      
    } else {
      console.log('✅ SIGN-UP SUCCESSFUL!');
      console.log('   User ID:', data.user?.id);
      console.log('   Email:', data.user?.email);
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Created' : 'None (email confirmation required)');
      
      if (!data.session && data.user && !data.user.email_confirmed_at) {
        console.log('\n📧 EMAIL CONFIRMATION REQUIRED!');
        console.log('   ✅ Supabase WILL send an email confirmation link!');
        console.log('   ✅ Check your email:', testEmail);
        console.log('   ✅ Authentication is working with proper security!');
      }
    }
    
  } catch (err) {
    console.log('❌ Unexpected error:', err.message);
    console.log('   Full exception:', err);
  }
}

diagnose422Error();
