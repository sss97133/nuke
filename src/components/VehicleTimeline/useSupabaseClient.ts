/**
 * Vehicle Timeline Supabase Client
 * 
 * This module provides a Supabase client that can be used by the vehicle timeline
 * even when authentication is missing, using fallbacks when necessary.
 */

import { supabase as realSupabase } from '@/integrations/supabase/client';
import { getUsableClient } from '@/integrations/supabase/__mocks__/auth-fallback';

// Export a function that gets a usable client regardless of auth state
export const getTimelineClient = () => {
  try {
    // Try to use the real client first
    return realSupabase;
  } catch (error) {
    console.warn('Authentication error in timeline component, using fallback client:', error);
    // Use our fallback mechanism
    return getUsableClient();
  }
};
