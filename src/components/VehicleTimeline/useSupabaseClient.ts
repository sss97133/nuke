/**
 * Vehicle Timeline Supabase Client
 * 
 * This module provides a Supabase client that can be used by the vehicle timeline
 * component to access vehicle data with appropriate permissions.
 */

import { supabase } from '@/lib/supabase-client';
import { useAuth } from '@/providers/AuthProvider';

/**
 * Returns the Supabase client configured for vehicle timeline usage
 * with appropriate error handling for authentication state.
 */
export const getTimelineClient = () => {
  // Always use the centralized Supabase client
  return supabase;
};

/**
 * Hook to use within React components that need to know if
 * the timeline is in an authenticated context.
 */
export const useTimelineAuth = () => {
  const { isAuthenticated } = useAuth();
  
  return {
    isAuthenticated,
    canModifyTimeline: isAuthenticated,
    canViewTimeline: true // Public viewing is allowed, modifications require auth
  };
};
