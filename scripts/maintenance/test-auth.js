// Quick test to verify Supabase email confirmation is working
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

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
