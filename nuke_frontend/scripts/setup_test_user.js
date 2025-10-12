import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Environment Check:');
console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Is Local: ${supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1')}\n`);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setupTestUser() {
  // Check current users
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*');
  
  console.log(`Current profiles: ${profiles?.length || 0}`);
  profiles?.forEach(p => console.log(`  - ${p.email}`));

  // Create a test user
  const testEmail = 'test@example.com';
  const testPassword = 'testpass123';
  
  console.log(`\n📝 Creating test user: ${testEmail}`);
  
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
    options: {
      data: {
        full_name: 'Test User'
      }
    }
  });

  if (signUpError) {
    if (signUpError.message?.includes('already registered')) {
      console.log('User already exists, trying to sign in...');
      
      const { data: signInData, error: signInError } = await supabase.auth.signIn({
        email: testEmail,
        password: testPassword
      });
      
      if (signInError) {
        console.error('Sign in error:', signInError);
      } else {
        console.log('✅ Signed in successfully!');
      }
    } else {
      console.error('Sign up error:', signUpError);
    }
  } else {
    console.log('✅ User created successfully!');
    console.log('User ID:', signUpData.user?.id);
    console.log('Email:', signUpData.user?.email);
  }

  // Check if profile was created
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for trigger
  
  const { data: newProfiles } = await supabase
    .from('profiles')
    .select('*');
  
  console.log(`\n📊 Final state:`);
  console.log(`Total profiles: ${newProfiles?.length || 0}`);
  newProfiles?.forEach(p => {
    console.log(`  - ${p.email} (${p.full_name})`);
  });

  // Try to get the current session
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    console.log('\n✅ Active session:');
    console.log(`  User: ${session.user.email}`);
    console.log(`  ID: ${session.user.id}`);
  }
}

setupTestUser()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
