import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY as ENV_SUPABASE_ANON_KEY, SUPABASE_URL as ENV_SUPABASE_URL } from './env';

// Define basic types for the database
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Initialize all variables in a single block to avoid TDZ issues
// This ensures the bundler doesn't reorder initialization
const initSupabase = (() => {
  // Get environment variables (supports both VITE_* and legacy SUPABASE_* names)
  const url = ENV_SUPABASE_URL?.trim() || '';
  const key = ENV_SUPABASE_ANON_KEY?.trim() || '';
  
  // Optional environment debug logging
  const ENABLE_DEBUG = (import.meta as any).env?.VITE_ENABLE_DEBUG === 'true';
  if (ENABLE_DEBUG) {
    console.log('Auth system initialized with Supabase configuration');
    console.log('VITE_SUPABASE_URL:', url);
    console.log('VITE_SUPABASE_ANON_KEY present:', !!key);
    if (!url) console.warn('Missing VITE_SUPABASE_URL - check your .env file');
    if (!key) console.warn('Missing VITE_SUPABASE_ANON_KEY - check your .env file');
  }

  // Validate required environment variables (fail fast if missing)
  if (!url || !key) {
    const missingVars: string[] = [];
    if (!url) missingVars.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
    if (!key) missingVars.push('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)');
    const message = `Missing required Supabase configuration: ${missingVars.join(', ')}`;
    console.error(message);
    throw new Error(`${message}. Configure these environment variables before running the app.`);
  }

  // Create Supabase client
  const client = createClient(
    url,
    key,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    }
  );

  return { url, key, client };
})();

// Export constants
export const SUPABASE_URL: string = initSupabase.url;
export const SUPABASE_ANON_KEY: string = initSupabase.key;
export const supabase = initSupabase.client;

// Utility to get Supabase Functions URL
export const getSupabaseFunctionsUrl = () => {
  if (!initSupabase.url) throw new Error('VITE_SUPABASE_URL is not defined');
  return `${initSupabase.url}/functions/v1`;
};

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