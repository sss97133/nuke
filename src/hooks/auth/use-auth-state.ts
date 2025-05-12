/**
 * AUTHENTICATION SYSTEM CONSOLIDATION
 * 
 * This is a compatibility layer for the useAuthState hook.
 * It redirects to our new consolidated authentication system
 * while maintaining the same API surface for backward compatibility.
 */

import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';
import type { User, Session } from '@supabase/supabase-js';

/**
 * This hook provides the same API as the original useAuthState hook
 * but redirects to the new consolidated auth system.
 */
export const useAuthState = () => {
  // Get authentication state from our new provider
  const { session, isLoading } = useAuth();
  
  // Get user data from our store
  const { user } = useUserStore();
  
  // Return the same interface as the original hook
  return {
    user: user, // This is our new user object from the store
    session, // This is from our new auth provider
    loading: isLoading // Renamed to match original property name
  };
};
