// Audit all users in the database (both auth.users and profiles)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditAllUsers() {
  console.log('👥 Auditing All Users in Database\n');
  
  // Check profiles table (we can access this)
  console.log('📋 PUBLIC.PROFILES TABLE:');
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.log('❌ Cannot access profiles:', error.message);
    } else {
      console.log(`   Total profiles: ${profiles.length}`);
      profiles.forEach((profile, i) => {
        console.log(`   ${i+1}. ${profile.email || 'No email'} (${profile.created_at})`);
        console.log(`      ID: ${profile.id}`);
        console.log(`      Name: ${profile.full_name || 'No name'}\n`);
      });
    }
  } catch (err) {
    console.log('❌ Profiles audit failed:', err.message);
  }
  
  // Note about auth.users
  console.log('🔐 AUTH.USERS TABLE:');
  console.log('   ❌ Cannot directly query auth.users with anon key');
  console.log('   ✅ But we know users exist if profiles exist');
  console.log('   ✅ Each profile.id corresponds to an auth.users.id');
  console.log('   ✅ To delete auth.users, you need service_role access in SQL Editor\n');
  
  console.log('🗑️  TO DELETE ALL USERS:');
  console.log('   1. Go to Supabase Dashboard → SQL Editor');
  console.log('   2. Run: DELETE FROM public.profiles;');
  console.log('   3. Run: DELETE FROM auth.users;');
  console.log('   4. This will remove ALL authentication data\n');
  
  console.log('⚠️  WARNING:');
  console.log('   This will delete ALL users, including any real accounts');
  console.log('   Only do this in development/testing environments');
}

auditAllUsers();
