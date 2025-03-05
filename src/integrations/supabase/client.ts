
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { useToast } from '@/hooks/use-toast';

// Fallback values in case env vars are not set
const SUPABASE_URL = "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

// Track database errors to prevent duplicate notifications
const recentServerErrors = new Set<string>();
const SERVER_ERROR_DEBOUNCE_TIME = 10000; // 10 seconds

// Create a simple toast function for server-side or non-hook contexts
const showToast = (props: { title: string; description?: string; variant?: 'default' | 'destructive' | 'success' | 'warning' | 'info' }) => {
  // If running in browser context, log to console
  if (typeof window !== 'undefined') {
    console.error(`${props.title}: ${props.description}`);
  }
};

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
        const MAX_RETRIES = 2; // Reduced from 3 to 2
        let retries = 0;
        let error;
        
        // Progressive backoff delay calculation
        const getBackoffDelay = (attempt: number) => {
          return Math.min(1000 * Math.pow(2, attempt), 5000); // Cap at 5 seconds (reduced from 10)
        };
        
        while (retries < MAX_RETRIES) {
          try {
            const response = await fetch(url, options);
            
            // Handle rate limiting (429) with special retry logic
            if (response.status === 429) {
              retries++;
              const retryAfter = response.headers.get('Retry-After');
              const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : getBackoffDelay(retries);
              console.warn(`Rate limited. Retrying after ${waitTime}ms`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
            
            // For other server errors, check if we should retry
            if (response.status >= 500) {
              if (retries < MAX_RETRIES - 1) {
                retries++;
                console.warn(`Server error (${response.status}). Attempt ${retries}/${MAX_RETRIES}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, getBackoffDelay(retries)));
                continue;
              }
            }
            
            return response;
          } catch (err) {
            error = err;
            retries++;
            console.warn(`Network error on attempt ${retries}/${MAX_RETRIES}:`, err);
            
            // Wait before retry (exponential backoff)
            if (retries < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, getBackoffDelay(retries)));
            }
          }
        }
        
        // All retries failed
        console.error(`Failed to fetch after ${MAX_RETRIES} attempts:`, error);
        
        // Show a toast when all retries have failed, but only if we haven't shown this error recently
        if (typeof window !== 'undefined') {
          const errorMessage = error?.message || "Network error";
          
          if (!recentServerErrors.has(errorMessage)) {
            recentServerErrors.add(errorMessage);
            
            showToast({
              title: "Connection Error",
              description: "Could not connect to the database. Please try again later.",
              variant: "destructive",
            });
            
            // Remove from recent errors after debounce time
            setTimeout(() => {
              recentServerErrors.delete(errorMessage);
            }, SERVER_ERROR_DEBOUNCE_TIME);
          }
        }
        
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
  
  // Only show toast if we haven't shown this error recently
  if (!recentServerErrors.has(message)) {
    recentServerErrors.add(message);
    
    showToast({
      title: "Database Error",
      description: message,
      variant: "destructive",
    });
    
    // Remove from recent errors after debounce time
    setTimeout(() => {
      recentServerErrors.delete(message);
    }, SERVER_ERROR_DEBOUNCE_TIME);
  }
  
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

// Hook that combines supabase with toast notifications
export const useSupabaseWithToast = () => {
  const { toast } = useToast();

  // Enhanced error handler that uses the toast hook
  const handleError = (error: any, defaultMessage = "An error occurred") => {
    console.error("Supabase error:", error);
    
    const message = error?.message || defaultMessage;
    
    // Only show toast if we haven't shown this error recently
    if (!recentServerErrors.has(message)) {
      recentServerErrors.add(message);
      
      toast({
        title: "Database Error",
        description: message,
        variant: "destructive",
      });
      
      // Remove from recent errors after debounce time
      setTimeout(() => {
        recentServerErrors.delete(message);
      }, SERVER_ERROR_DEBOUNCE_TIME);
    }
    
    return null;
  };

  // Enhanced safe query that uses the toast hook
  const safeFetch = async <T>(
    queryFn: () => Promise<{ data: T | null; error: any }>
  ): Promise<T | null> => {
    try {
      const { data, error } = await queryFn();
      if (error) {
        return handleError(error);
      }
      return data;
    } catch (error) {
      return handleError(error);
    }
  };

  return {
    supabase,
    handleError,
    safeFetch
  };
};
