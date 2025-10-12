// Fix profile username issue
// Run this script to ensure your profile has a valid username

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjgzMTkxMzAsImV4cCI6MjA0Mzg5NTEzMH0.uDC_8Xpx9jqV-UrN0kxWqFTiLLZFCzXJigqLvLdstXU';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixProfile() {
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    console.error('No authenticated user:', userError);
    return;
  }
  
  console.log('Current user:', user.id, user.email);
  
  // Check if profile exists
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  if (profileError && profileError.code !== 'PGRST116') {
    console.error('Error checking profile:', profileError);
    return;
  }
  
  if (!profile) {
    // Create profile with valid username
    const username = user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '') || `user_${user.id.substring(0, 8)}`;
    
    console.log('Creating profile with username:', username);
    
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        username: username,
        full_name: '',
        is_public: false,
        is_professional: false
      })
      .select()
      .single();
    
    if (createError) {
      console.error('Error creating profile:', createError);
      return;
    }
    
    console.log('Profile created:', newProfile);
  } else if (!profile.username || profile.username === '') {
    // Update existing profile with valid username
    const username = user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '') || `user_${user.id.substring(0, 8)}`;
    
    console.log('Updating profile with username:', username);
    
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({ username })
      .eq('id', user.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating profile:', updateError);
      return;
    }
    
    console.log('Profile updated:', updatedProfile);
  } else {
    console.log('Profile already has valid username:', profile.username);
  }
  
  console.log('Profile fix complete!');
}

fixProfile().catch(console.error);
