import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkAndFixProfile() {
  console.log('🔍 Checking profiles...\n');

  // First, try to sign in to get the current user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  if (!session) {
    console.log('No active session. You need to login first.');
    console.log('\nTrying to get any profiles from the database...');
  }

  // Check all profiles
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('*');

  if (profilesError) {
    console.error('Error fetching profiles:', profilesError);
  } else {
    console.log(`Found ${profiles?.length || 0} profile(s):`);
    profiles?.forEach(p => {
      console.log(`  - ${p.email} (ID: ${p.id})`);
    });
  }

  // If you have a session but no profile, create one
  if (session && (!profiles || profiles.length === 0)) {
    console.log('\n⚠️  You have a session but no profile. Creating one...');
    
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
        avatar_url: session.user.user_metadata?.avatar_url || null
      });

    if (insertError) {
      console.error('Error creating profile:', insertError);
    } else {
      console.log('✅ Profile created successfully!');
    }
  }

  // Run a raw SQL query to check auth.users and create missing profiles
  console.log('\n📊 Running comprehensive check via RPC...');
  
  // Create an RPC function to check and fix profiles
  const { data: fixResult, error: rpcError } = await supabase.rpc('fix_missing_profiles', {});
  
  if (rpcError) {
    console.log('RPC function not available, creating it...');
    
    // Let's just try to create a profile based on the current session if we have one
    if (session) {
      const { data: profile, error: getError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      
      if (getError && getError.code === 'PGRST116') {
        // Profile doesn't exist, create it
        console.log(`Creating profile for current user: ${session.user.email}`);
        
        const { error: createError } = await supabase
          .from('profiles')
          .insert({
            id: session.user.id,
            email: session.user.email,
            full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User'
          });
        
        if (createError) {
          console.error('Failed to create profile:', createError);
        } else {
          console.log('✅ Profile created for current user!');
        }
      } else if (!getError && profile) {
        console.log('✅ Profile already exists for current user');
      }
    }
  } else {
    console.log('Fix result:', fixResult);
  }

  // Final check
  const { data: finalProfiles } = await supabase
    .from('profiles')
    .select('*');
  
  console.log('\n✅ Final state:');
  console.log(`Total profiles: ${finalProfiles?.length || 0}`);
  finalProfiles?.forEach(p => {
    console.log(`  - ${p.email} (${p.full_name})`);
  });
}

checkAndFixProfile()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
