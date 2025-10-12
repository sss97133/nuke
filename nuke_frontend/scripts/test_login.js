import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin() {
  console.log('🔐 Testing login flow...\n');

  // Try to sign in
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'testpass123'
  });

  if (error) {
    console.error('❌ Login failed:', error.message);
    return;
  }

  console.log('✅ Login successful!');
  console.log('User ID:', data.user.id);
  console.log('Email:', data.user.email);

  // Check if profile exists
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError) {
    console.error('\n❌ Profile fetch error:', profileError);
  } else {
    console.log('\n✅ Profile found:');
    console.log('  - Full Name:', profile.full_name);
    console.log('  - Email:', profile.email);
    console.log('  - Bio:', profile.bio || '(empty)');
  }

  // Check vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', data.user.id);

  if (vehiclesError) {
    console.error('\n❌ Vehicles fetch error:', vehiclesError);
  } else {
    console.log(`\n📋 Vehicles: ${vehicles?.length || 0} found`);
    vehicles?.forEach(v => {
      console.log(`  - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${v.vin || 'No VIN'})`);
    });
  }

  // Sign out
  await supabase.auth.signOut();
  console.log('\n👋 Signed out');
}

testLogin()
  .then(() => {
    console.log('\n✨ Test complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
