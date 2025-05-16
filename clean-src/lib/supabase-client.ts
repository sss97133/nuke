import { createClient } from '@supabase/supabase-js';

// Define basic types for the database
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Log environment status without constantly questioning the user
if (import.meta.env.DEV) {
  console.log('Auth system initialized with Supabase configuration');
  if (!supabaseUrl) console.warn('Missing VITE_SUPABASE_URL - check your .env file');
  if (!supabaseAnonKey) console.warn('Missing VITE_SUPABASE_ANON_KEY - check your .env file');
}

// Create and export the Supabase client
export const supabase = createClient(
  supabaseUrl || '',  // Fallback to empty string to prevent crashes 
  supabaseAnonKey || '', // Fallback to empty string to prevent crashes
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
    // Using default realtime settings to avoid compatibility issues
  }
);

// Helper function to get the current user ID
export const getCurrentUserId = async (): Promise<string | null> => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user?.id || null;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
};

// Helper to check if the user is authenticated
export const isAuthenticated = async (): Promise<boolean> => {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
};
