import { supabase } from '../supabase';

export const checkAndUpdateAdminStatus = async () => {
  try {
    // First, sign in with the test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'skylar@nukemannerheim.com',
      password: '1bigCowboy'
    });

    if (authError) {
      console.error('Authentication failed:', authError);
      return;
    }

    console.log('Successfully authenticated as:', authData.user?.email);

    // Check current user metadata
    const { data: { user } } = await supabase.auth.getUser();
    console.log('Current user metadata:', user?.user_metadata);

    // Update user metadata to include admin flag
    const { data: updateData, error: updateError } = await supabase.auth.updateUser({
      data: { is_admin: true }
    });

    if (updateError) {
      console.error('Error updating user metadata:', updateError);
      return;
    }

    console.log('Updated user metadata:', updateData.user?.user_metadata);

    // Also update the profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .update({ user_type: 'professional' })
      .eq('id', user?.id)
      .select()
      .single();

    if (profileError) {
      console.error('Error updating profile:', profileError);
      return;
    }

    console.log('Updated profile:', profile);

  } catch (error) {
    console.error('Error during admin check/update:', error);
  }
}; 