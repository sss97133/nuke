import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function fixMissingProfiles() {
  console.log('🔍 Checking for users without profiles...\n');

  // Get all users from auth.users
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
  
  if (usersError) {
    console.error('Error fetching users:', usersError);
    return;
  }

  console.log(`Found ${users.length} user(s) in auth.users\n`);

  // Get all profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id');

  if (profilesError) {
    console.error('Error fetching profiles:', profilesError);
    return;
  }

  const profileIds = new Set(profiles?.map(p => p.id) || []);
  console.log(`Found ${profileIds.size} profile(s) in profiles table\n`);

  // Find users without profiles
  const usersWithoutProfiles = users.filter(user => !profileIds.has(user.id));

  if (usersWithoutProfiles.length === 0) {
    console.log('✅ All users have profiles!');
    return;
  }

  console.log(`⚠️  Found ${usersWithoutProfiles.length} user(s) without profiles:\n`);

  // Create missing profiles
  for (const user of usersWithoutProfiles) {
    console.log(`Creating profile for user: ${user.email} (${user.id})`);
    
    const profileData = {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      avatar_url: user.user_metadata?.avatar_url || null,
      created_at: user.created_at,
      updated_at: new Date().toISOString()
    };

    const { error: insertError } = await supabase
      .from('profiles')
      .insert(profileData);

    if (insertError) {
      console.error(`  ❌ Error creating profile:`, insertError);
    } else {
      console.log(`  ✅ Profile created successfully!`);
    }
  }

  // Verify the fix
  console.log('\n📊 Final check:');
  
  const { data: finalProfiles } = await supabase
    .from('profiles')
    .select('id, email, full_name');

  console.log(`\nProfiles in database:`);
  finalProfiles?.forEach(profile => {
    console.log(`  - ${profile.email} (${profile.full_name})`);
  });
}

fixMissingProfiles()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
