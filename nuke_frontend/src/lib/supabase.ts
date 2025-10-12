import { createClient } from '@supabase/supabase-js';

// Define basic types for the database
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Optional environment debug logging
const ENABLE_DEBUG = (import.meta as any).env?.VITE_ENABLE_DEBUG === 'true';
if (ENABLE_DEBUG) {
  // Keep logs opt-in to avoid distracting normal testing
  console.log('Auth system initialized with Supabase configuration');
  console.log('VITE_SUPABASE_URL:', supabaseUrl);
  console.log('VITE_SUPABASE_ANON_KEY present:', !!supabaseAnonKey);
  if (!supabaseUrl) console.warn('Missing VITE_SUPABASE_URL - check your .env file');
  if (!supabaseAnonKey) console.warn('Missing VITE_SUPABASE_ANON_KEY - check your .env file');
}

// Validate required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  const missingVars = [];
  if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missingVars.push('VITE_SUPABASE_ANON_KEY');
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please check your .env file and ensure all Supabase configuration is properly set');
}

// Suppress 404 errors for missing optional tables
const originalError = console.error;
console.error = (...args) => {
  const message = args.join(' ');
  if (message.includes('image_tags') && (message.includes('404') || message.includes('relation') && message.includes('does not exist'))) {
    console.debug('Image tagging feature not available - table missing');
    return;
  }
  originalError.apply(console, args);
};

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