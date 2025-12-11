// Test authentication with a simpler approach
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSimpleAuth() {
  console.log('🧪 Testing simplified authentication...\n');
  
  // Check if user_preferences table exists
  try {
    console.log('1. Checking user_preferences table...');
    const { data, error } = await supabase.from('user_preferences').select('*').limit(1);
    if (error) {
      console.log('❌ user_preferences table issue:', error.message);
      console.log('   This might be causing the trigger to fail');
    } else {
      console.log('✅ user_preferences table accessible');
    }
  } catch (err) {
    console.log('❌ user_preferences table error:', err.message);
  }
  
  // Test sign-up with a unique email
  const testEmail = `test-${Date.now()}@example.com`;
  console.log(`\n2. Testing sign-up with: ${testEmail}`);
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!'
    });
    
    if (error) {
      console.log('❌ Sign-up failed:', error.message);
      console.log('   Status:', error.status);
      
      // The issue might be in the trigger - let's suggest a fix
      console.log('\n🔧 Possible fix needed:');
      console.log('The trigger might be failing on the user_preferences insert.');
      console.log('Try running this SQL to fix the trigger:');
      console.log(`
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NOW(),
    NOW()
  );
  
  -- Skip user_preferences if table doesn't exist or has issues
  -- INSERT INTO public.user_preferences (user_id, created_at, updated_at)
  -- VALUES (NEW.id, NOW(), NOW())
  -- ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
      `);
      
    } else {
      console.log('✅ Sign-up successful!');
      console.log('   User created:', data.user?.id ? 'Yes' : 'No');
      console.log('   Email confirmed:', data.user?.email_confirmed_at ? 'Yes' : 'No');
      console.log('   Session created:', data.session ? 'Yes' : 'No (email confirmation required)');
      
      if (!data.session && data.user) {
        console.log('\n📧 EMAIL CONFIRMATION REQUIRED!');
        console.log('   This means Supabase IS working and WILL send email confirmation links!');
        console.log('   Check the email:', testEmail);
      }
    }
    
  } catch (err) {
    console.log('❌ Unexpected error:', err.message);
  }
}

testSimpleAuth();
