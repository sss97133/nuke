// Execute the auth fix migration directly on Supabase
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixAuth() {
  console.log('🔧 Applying authentication fix...\n');
  
  // Note: We can't execute DDL statements with the anon key
  // This requires service_role key or direct database access
  console.log('❌ Cannot execute DDL statements with anon key');
  console.log('📋 You need to run this SQL manually in your Supabase dashboard:\n');
  
  const migrationSQL = `
-- Fix authentication by adding user creation trigger
-- This trigger automatically creates a profile when a user signs up

-- Function to handle new user creation
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
  
  -- Also create user preferences for Skynalysis if table exists
  INSERT INTO public.user_preferences (user_id, created_at, updated_at)
  VALUES (NEW.id, NOW(), NOW())
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger that fires when a new user is created in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update RLS policies to allow profile creation during signup
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Enable RLS on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
`;

  console.log(migrationSQL);
  console.log('\n📋 Steps to fix authentication:');
  console.log('1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql');
  console.log('2. Paste the SQL above');
  console.log('3. Click "Run"');
  console.log('4. Test sign-up again');
  
  // Test current state
  console.log('\n🧪 Testing current sign-up (should still fail):');
  const testEmail = `test-${Date.now()}@example.com`;
  try {
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!'
    });
    
    if (error) {
      console.log('❌ Still failing (expected):', error.message);
    } else {
      console.log('✅ Unexpectedly working!');
    }
  } catch (err) {
    console.log('❌ Still failing (expected):', err.message);
  }
}

fixAuth();
