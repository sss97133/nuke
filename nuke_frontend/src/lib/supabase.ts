import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY as ENV_SUPABASE_ANON_KEY, SUPABASE_URL as ENV_SUPABASE_URL } from './env';

// Define basic types for the database
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Get environment variables (supports both VITE_* and legacy SUPABASE_* names)
const supabaseUrl = ENV_SUPABASE_URL?.trim();
const supabaseAnonKey = ENV_SUPABASE_ANON_KEY?.trim();

// Export constants after initialization to avoid TDZ
export const SUPABASE_URL: string = supabaseUrl || '';
export const SUPABASE_ANON_KEY: string = supabaseAnonKey || '';

// Utility to get Supabase Functions URL
export const getSupabaseFunctionsUrl = () => {
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not defined');
  return `${supabaseUrl}/functions/v1`;
};

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

// Validate required environment variables (fail fast if missing)
if (!supabaseUrl || !supabaseAnonKey) {
  const missingVars: string[] = [];
  if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
  if (!supabaseAnonKey) missingVars.push('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)');
  const message = `Missing required Supabase configuration: ${missingVars.join(', ')}`;
  console.error(message);
  throw new Error(`${message}. Configure these environment variables before running the app.`);
}

// Suppress non-critical errors (404s for optional tables, WebSocket connection failures)
const originalError = console.error;
console.error = (...args) => {
  const message = args.join(' ');
  // Suppress image_tags table missing errors
  if (message.includes('image_tags') && (message.includes('404') || message.includes('relation') && message.includes('does not exist'))) {
    console.debug('Image tagging feature not available - table missing');
    return;
  }
  // Suppress WebSocket connection failures (Supabase Realtime will retry automatically)
  if (message.includes('WebSocket connection') && message.includes('failed')) {
    // Only log at debug level - these are non-critical and Supabase handles retries
    console.debug('WebSocket connection attempt (will retry automatically)');
    return;
  }
  originalError.apply(console, args);
};

// Create and export the Supabase client
// Use function to ensure initialization happens after all const declarations
function createSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration not available');
  }
  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
      // Using default realtime settings to avoid compatibility issues
    }
  );
}

export const supabase = createSupabaseClient();

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