// Import the singleton Supabase client to avoid multiple GoTrueClient instances
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/types/database';

// Re-export the main client to avoid creating multiple instances
export const testSupabase = supabase;

// Test database connection using the singleton client
export const testConnection = async () => {
  try {
    if (!supabase) {
      console.error('Supabase client not initialized');
      return { success: false, error: new Error('Supabase client not initialized') };
    }
    
    const { data, error } = await supabase.from('vehicles').select('count(*)');
    if (error) {
      console.error('Error testing connection:', error);
      return { success: false, error };
    }
    console.log('Successfully connected to Supabase database');
    return { success: true, data };
  } catch (err) {
    console.error('Exception testing connection:', err);
    return { success: false, error: err };
  }
};
