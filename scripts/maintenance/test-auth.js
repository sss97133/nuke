// Quick test to verify Supabase email confirmation is working
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSignUp() {
  console.log('Testing Supabase sign-up with email confirmation...');
  
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
    });
    
    if (error) {
      console.error('❌ Sign-up failed:', error.message);
      return;
    }
    
    console.log('✅ Sign-up response:', {
      user: data.user ? 'User created' : 'No user returned',
      session: data.session ? 'Session created' : 'No session (email confirmation required)',
      email: testEmail
    });
    
    if (!data.session && data.user) {
      console.log('📧 Email confirmation required - check if email was sent to:', testEmail);
      console.log('📧 This means Supabase email confirmation is ENABLED and working!');
    } else if (data.session) {
      console.log('⚠️  No email confirmation required - user signed in immediately');
    }
    
  } catch (err) {
    console.error('❌ Test failed:', err);
  }
}

// Run the test
testSignUp();
