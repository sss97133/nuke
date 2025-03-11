import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { useToast } from '@/hooks/use-toast';

// Environment-specific Supabase configuration
const ENVIRONMENTS = {
  development: {
    url: 'http://localhost:54321',
    anonKey: import.meta.env.VITE_SUPABASE_LOCAL_ANON_KEY || ''
  },
  production: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  },
  test: {
    url: 'mock',
    anonKey: 'mock'
  }
};

// Get environment from Vite
const ENV = import.meta.env.MODE || 'development';

// Use environment variables if provided, otherwise fall back to environment config
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ENVIRONMENTS[ENV].url;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ENVIRONMENTS[ENV].anonKey;

// Image categories for better organization
export enum VehicleImageCategory {
  PRIMARY = 'primary',
  EXTERIOR = 'exterior',
  INTERIOR = 'interior',
  DOCUMENTATION = 'documentation',
  TECHNICAL = 'technical'
}

// Position/type within each category
export enum ImagePosition {
  // Exterior positions
  FRONT_34 = 'front_34',
  SIDE_DRIVER = 'side_driver',
  SIDE_PASSENGER = 'side_passenger',
  REAR_34 = 'rear_34',
  FRONT_DIRECT = 'front_direct',
  REAR_DIRECT = 'rear_direct',
  
  // Interior positions
  DASHBOARD = 'dashboard',
  CENTER_CONSOLE = 'center_console',
  FRONT_SEATS = 'front_seats',
  REAR_SEATS = 'rear_seats',
  TRUNK = 'trunk',
  
  // Documentation types
  VIN = 'vin',
  ODOMETER = 'odometer',
  WINDOW_STICKER = 'window_sticker',
  TITLE = 'title',
  
  // Technical areas
  ENGINE = 'engine',
  UNDERCARRIAGE = 'undercarriage',
  WHEELS = 'wheels',
  FEATURES = 'features'
}

interface UploadProgress {
  file: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

type ProgressCallback = (progress: Record<string, UploadProgress>) => void;

// Helper function to handle single or batch image uploads
export const uploadVehicleImages = async (
  vehicleId: string,
  files: File[],
  category: VehicleImageCategory,
  positions: ImagePosition[],
  onProgress?: ProgressCallback,
  maxSizeMB: number = 10
): Promise<string[]> => {
  if (files.length !== positions.length) {
    throw new Error('Number of files must match number of positions');
  }

  const progress: Record<string, UploadProgress> = {};
  const results: string[] = [];

  // Initialize progress tracking
  files.forEach(file => {
    progress[file.name] = {
      file: file.name,
      progress: 0,
      status: 'pending'
    };
  });

  const updateProgress = (fileName: string, update: Partial<UploadProgress>) => {
    progress[fileName] = { ...progress[fileName], ...update };
    onProgress?.(progress);
  };

  try {
    // Process files in parallel with a concurrency limit
    const concurrencyLimit = 3;
    const chunks: File[][] = [];
    for (let i = 0; i < files.length; i += concurrencyLimit) {
      chunks.push(files.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (file) => {
        const position = positions[files.indexOf(file)];
        try {
          // Validate file size and type
          const maxSize = maxSizeMB * 1024 * 1024;
          if (file.size > maxSize) {
            throw new Error(`File size exceeds ${maxSizeMB}MB limit`);
          }
          if (!file.type.startsWith('image/')) {
            throw new Error('Only image files are allowed');
          }

          updateProgress(file.name, { progress: 25, status: 'uploading' });
          
          // Create an organized file name
          const fileExt = file.name.split('.').pop();
          const timestamp = Date.now();
          const fileName = `${category}/${position}_${timestamp}.${fileExt}`;
          const filePath = `vehicle-images/${vehicleId}/${fileName}`;

          updateProgress(file.name, { progress: 50, status: 'uploading' });

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from('vehicles')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) {
            updateProgress(file.name, { status: 'error', error: uploadError.message });
            throw uploadError;
          }
          // Get the public URL
          const { data: { publicUrl } } = supabase.storage
            .from('vehicles')
            .getPublicUrl(filePath);

          // Add to vehicle_images table
          const { error: dbError } = await supabase
            .from('vehicle_images')
            .insert({
              car_id: vehicleId,
              image_url: publicUrl,
              uploaded_at: new Date().toISOString(),
              file_name: file.name,
              file_path: filePath,
              category: category,
              position: position,
              is_primary: category === VehicleImageCategory.PRIMARY
            });

          if (dbError) {
            console.error(`Database insert error for ${file.name}:`, dbError);
            updateProgress(file.name, { status: 'error', error: dbError.message });
            throw dbError;
          }
          
          console.log(`Database record created successfully for ${file.name}`);
          updateProgress(file.name, { progress: 100, status: 'success' });
          results.push(publicUrl);
        } catch (error: any) {
          console.error(`Error processing ${file.name}:`, error);
          updateProgress(file.name, { status: 'error', error: error.message });
          throw error;
        }
      }));
    }

    return results;
  } catch (error) {
    console.error('Error in batch upload:', error);
    throw error;
  }
};

// Admin operations will use standard auth - no service role key needed
const handleAdminOperation = async (url: string, options: any) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated');
  }
  return fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      'Authorization': `Bearer ${session.access_token}`
    }
  });
};

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
        // Handle admin operations with user session
      if (url.includes('/auth/v1/admin')) {
        return handleAdminOperation(url, options);
      }
        
        // Otherwise use the default fetch with retry logic
        const MAX_RETRIES = 2;
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

/**
 * Utility function to safely create a select query with proper column formatting.
 * This prevents issues with malformed URL parameters like 'columns=id:1'
 */
export const safeSelect = <T>(
  query: any,
  columns: string | string[] = '*'
) => {
  // Create a base query from the table
  if (typeof columns === 'string') {
    // If columns is already a string, just use it directly
    return query.select(columns);
  }
  
  // If columns is an array, join it properly with commas
  // Make sure there are no spaces after the commas to prevent URL encoding issues
  return query.select(columns.join(','));
};
