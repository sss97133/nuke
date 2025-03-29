import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Create a direct client using the keys from `supabase status`
const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Create and export the supabase client for our test page
export const testSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Test database connection
export const testConnection = async () => {
  try {
    const { data, error } = await testSupabase.from('vehicles').select('count(*)');
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
