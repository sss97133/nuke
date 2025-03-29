import { supabase } from '../supabase';
import { UserRole } from '../auth/roles';

export const checkAdminStatus = async () => {
  try {
    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error('No authenticated user found');
      return { 
        isAdmin: false, 
        error: 'Authentication required'
      };
    }

    // Check if user is the system owner
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_system_owner')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      console.error('Error fetching profile:', profileError.message);
      return { 
        isAdmin: false, 
        error: 'Profile check failed'
      };
    }

    const isSystemOwner = profile?.is_system_owner === true;

    return { 
      isAdmin: isSystemOwner,
      error: isSystemOwner ? undefined : 'System owner access required'
    };

  } catch (error) {
    console.error('Error checking admin status:', error);
    return { 
      isAdmin: false, 
      error: 'Check failed'
    };
  }
}; 