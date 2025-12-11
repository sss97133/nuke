// Test what happens when signing up through the browser
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBrowserSignup() {
  console.log('🧪 Testing Browser Sign-Up Flow\n');
  
  // Test with a real email format that you might use
  const testEmail = `skylar.test.${Date.now()}@gmail.com`;
  const testPassword = 'TestPassword123!';
  
  console.log(`📧 Testing with: ${testEmail}`);
  console.log(`🔐 Password: ${testPassword}\n`);
  
  try {
    console.log('🚀 Attempting sign-up...');
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword
    });
    
    if (error) {
      console.log('❌ Sign-up failed:', error.message);
      console.log('   Status:', error.status);
      console.log('   Code:', error.code || 'No code');
      
      // Check specific error types
      if (error.message.includes('Email not confirmed')) {
        console.log('   → This means user was created but email confirmation is required');
      } else if (error.message.includes('User already registered')) {
        console.log('   → This email is already in use');
      } else if (error.message.includes('Database error')) {
        console.log('   → Database/trigger issue');
      } else if (error.status === 422) {
        console.log('   → Validation error (email format, password strength, etc.)');
      }
    } else {
      console.log('✅ Sign-up request successful!');
      console.log('   User ID:', data.user?.id);
      console.log('   Email:', data.user?.email);
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Active session' : 'No session (email confirmation required)');
      
      if (data.user && !data.user.email_confirmed_at) {
        console.log('\n📧 EMAIL CONFIRMATION STATUS:');
        console.log('   ✅ User created successfully');
        console.log('   ❓ Email confirmation required');
        console.log('   📬 Check your email inbox for confirmation link');
        console.log('   📁 Also check spam/junk folder');
        console.log('   ⏰ Email may take a few minutes to arrive');
      }
    }
  } catch (err) {
    console.log('❌ Network/connection error:', err.message);
  }
  
  // Check if profile was created
  console.log('\n🔍 Checking if profile was created...');
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, created_at')
      .eq('email', testEmail)
      .single();
    
    if (error) {
      console.log('❌ No profile found:', error.message);
    } else {
      console.log('✅ Profile created successfully!');
      console.log('   Profile ID:', profile.id);
      console.log('   Email:', profile.email);
      console.log('   Created:', profile.created_at);
    }
  } catch (err) {
    console.log('❌ Profile check failed:', err.message);
  }
  
  console.log('\n🎯 DIAGNOSIS:');
  console.log('If you see "Sign-up request successful" but no email arrives:');
  console.log('1. Check spam/junk folder');
  console.log('2. Email service might be misconfigured in Supabase');
  console.log('3. Email might be delayed (can take 5-10 minutes)');
  console.log('4. Supabase email service might need configuration');
}

testBrowserSignup();
