
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { toast } from '@/hooks/use-toast';

// Fallback values in case env vars are not set
const SUPABASE_URL = "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

// Create supabase client with enhanced options for reliability
export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: {
      fetch: async (url, options) => {
        // Implement custom fetch with retry logic
        const MAX_RETRIES = 3;
        let retries = 0;
        let error;
        
        while (retries < MAX_RETRIES) {
          try {
            const response = await fetch(url, options);
            if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response;
          } catch (err) {
            error = err;
            retries++;
            console.warn(`Fetch attempt ${retries} failed: ${url}`, err);
            
            // Wait before retry (exponential backoff)
            if (retries < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retries)));
            }
          }
        }
        
        // All retries failed
        console.error(`Failed to fetch after ${MAX_RETRIES} attempts:`, error);
        
        // Return a valid Response object that will indicate the error
        return new Response(JSON.stringify({
          error: "Failed to connect to database",
          details: error?.message || "Network error"
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    }
  }
);

// Add helper function to handle Supabase errors
export const handleSupabaseError = (error: any, defaultMessage = "An error occurred") => {
  console.error("Supabase error:", error);
  
  const message = error?.message || defaultMessage;
  toast({
    title: "Database Error",
    description: message,
    variant: "destructive",
  });
  
  return null;
};

// Utility to perform queries with automatic error handling
export const safeQuery = async <T>(
  queryFn: () => Promise<{ data: T | null; error: any }>
): Promise<T | null> => {
  try {
    const { data, error } = await queryFn();
    if (error) {
      return handleSupabaseError(error);
    }
    return data;
  } catch (error) {
    return handleSupabaseError(error);
  }
};
