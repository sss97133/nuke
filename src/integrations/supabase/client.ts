import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { useToast } from '@/hooks/use-toast';

// Environment types
type Environment = 'development' | 'production' | 'test';

type RetryConfig = {
  maxRetries: number;
  retryDelay: number;
};

// Supabase configuration types
type SupabaseConfig = {
  url: string;
  anonKey: string;
  retryConfig: RetryConfig;
};

// Vite environment variable types
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_LOCAL_ANON_KEY?: string;
  readonly VITE_SUPABASE_SERVICE_KEY?: string;
  readonly MODE: string;
  readonly NODE_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Environment validation
const validateEnvironment = (env: string): Environment => {
  if (!['development', 'production', 'test'].includes(env)) {
    throw new Error(`Invalid environment: ${env}. Must be one of: development, production, test`);
  }
  return env as Environment;
};

// Get environment from Vite with fallback for SSR
const ENV = validateEnvironment(import.meta.env.MODE || process.env.NODE_ENV || 'development');

// Helper to safely get environment variables with fallback
const getEnvVar = <K extends keyof ImportMetaEnv>(key: K, fallback = ''): string => {
  const value = import.meta.env[key];
  
  // Production requires all environment variables
  if (ENV === 'production' && !value) {
    throw new Error(`Missing required environment variable in production: ${key}`);
  }
  
  // Test environment uses mock values
  if (ENV === 'test') {
    return 'mock-value';
  }
  
  return value || fallback;
};

// Helper function to handle image uploads with size validation
export const uploadVehicleImage = async (
  vehicleId: string,
  file: File,
  maxSizeMB: number = 2
) => {
  if (ENV === 'test') {
    console.log('Test environment: Mocking image upload');
    return new URL(`http://localhost:54321/storage/v1/object/mock-image-${Date.now()}`);
  }

  // Validate file size
  const maxSize = maxSizeMB * 1024 * 1024; // Convert to bytes
  if (file.size > maxSize) {
    throw new Error(`File size exceeds the maximum allowed size of ${maxSizeMB}MB`);
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed');
  }

  try {
    console.log(`Starting upload for vehicle ${vehicleId}, file: ${file.name}`);
    
    // Create a unique file name
    const fileExt = file.name.split('.').pop();
    const fileName = `${vehicleId}/${Date.now()}.${fileExt}`;
    const filePath = `vehicle-images/${fileName}`;

    console.log(`Generated file path: ${filePath}`);
    
    // Upload to Supabase Storage with retry
    const { data, error } = await withRetry<SupabaseUploadResponse>(
      () => supabase.storage
        .from('vehicles')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        }),
      DEFAULT_CONFIG[ENV].retryConfig
    );

    if (error) {
      console.error('Storage upload error:', error);
      throw error;
    }
    
    console.log('File uploaded successfully');

    // Get the public URL with the correct domain
    const { data: urlData } = supabase.storage.from('vehicles').getPublicUrl(filePath) as SupabaseStorageResponse;
    if (!urlData?.publicUrl) {
      throw new Error('Failed to generate public URL');
    }
    const publicUrl = new URL(urlData.publicUrl);
    
    // Ensure we're using the correct Supabase project URL
    publicUrl.host = new URL(ENVIRONMENTS[ENV].url).host;
    
    console.log('Generated public URL:', publicUrl.toString());

    // Add to vehicle_images table with retry
    const { error: dbError } = await withRetry<SupabaseInsertResponse>(
      () => supabase
        .from('vehicle_images')
        .insert({
          car_id: vehicleId,
          image_url: publicUrl.toString(),
          uploaded_at: new Date().toISOString(),
          file_name: file.name,
          file_path: filePath,
          is_primary: false // By default, not primary
        }),
      DEFAULT_CONFIG[ENV].retryConfig
    );

    if (dbError) {
      console.error('Database insert error:', dbError);
      throw dbError;
    }
    
    console.log('Database record created successfully');

    // Return the public URL
    return publicUrl;
  } catch (error) {
    console.error('Error in uploadVehicleImage:', error);
    throw error;
  }
};

// Default configurations
const DEFAULT_CONFIG = {
  development: {
    url: 'http://localhost:54321',
    anonKey: '',
    retryConfig: { maxRetries: 2, retryDelay: 1000 }
  },
  production: {
    url: '',
    anonKey: '',
    retryConfig: { maxRetries: 3, retryDelay: 2000 }
  },
  test: {
    url: 'http://localhost:54321',
    anonKey: 'mock-anon-key',
    retryConfig: { maxRetries: 0, retryDelay: 0 }
  }
} satisfies Record<Environment, SupabaseConfig>;

// Validate configuration at runtime
Object.entries(DEFAULT_CONFIG).forEach(([env, config]) => {
  if (env === 'test') return; // Skip validation for test environment
  
  if (!config.url) {
    throw new Error(`Invalid configuration: missing URL for environment ${env}`);
  }
  
  try {
    new URL(config.url);
  } catch {
    throw new Error(`Invalid configuration: malformed URL for environment ${env}`);
  }
});

// Environment-specific Supabase configuration
const getEnvironmentConfig = (env: Environment): SupabaseConfig => {
  const config = DEFAULT_CONFIG[env];
  
  switch (env) {
    case 'development': {
      const url = getEnvVar('VITE_SUPABASE_URL', config.url);
      // Try local key first for development, then service key, then anon key
      const anonKey = 
        getEnvVar('VITE_SUPABASE_LOCAL_ANON_KEY') || 
        getEnvVar('VITE_SUPABASE_SERVICE_KEY') || 
        getEnvVar('VITE_SUPABASE_ANON_KEY', config.anonKey);
      return { url, anonKey, retryConfig: config.retryConfig };
    }
    
    case 'production': {
      // In production, we require both URL and key to be set
      const url = getEnvVar('VITE_SUPABASE_URL');
      const anonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');
      
      if (!url || !anonKey) {
        throw new Error('Missing required Supabase configuration in production');
      }
      
      return { url, anonKey, retryConfig: config.retryConfig };
    }
    
    case 'test':
      // Use mock configuration for test environment
      return config;
  }
};

const ENVIRONMENTS = {
  development: getEnvironmentConfig('development'),
  production: getEnvironmentConfig('production'),
  test: getEnvironmentConfig('test')
} as const;

// Environment type guard (for type checking)
const isValidEnvironment = (env: string): env is Environment => {
  return ['development', 'production', 'test'].includes(env);
};

// Additional runtime checks for environment-specific requirements
if (ENV === 'production') {
  // Validate production environment variables
  const requiredVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;
  const missingVars = requiredVars.filter(key => !import.meta.env[key]);
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missingVars.join(', ')}. ` +
      'Please check your deployment configuration.'
    );
  }
  
  // Validate URL format
  try {
    new URL(import.meta.env.VITE_SUPABASE_URL);
  } catch (e) {
    throw new Error('Invalid VITE_SUPABASE_URL format in production. Please check your deployment configuration.');
  }
} else if (ENV === 'test') {
  console.info('Running in test environment with mock data');
}

// Production environment validation
if (ENV === 'production') {
  const missingVars = [];
  
  if (!import.meta.env.VITE_SUPABASE_URL) {
    missingVars.push('VITE_SUPABASE_URL');
  }
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
    missingVars.push('VITE_SUPABASE_ANON_KEY');
  }
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missingVars.join(', ')}. ` +
      'Please check your deployment configuration.'
    );
  }
  
  // Validate URL format
  try {
    new URL(import.meta.env.VITE_SUPABASE_URL);
  } catch (e) {
    throw new Error('Invalid VITE_SUPABASE_URL format. Please check your deployment configuration.');
  }
}

// Get configuration from environment
const currentEnv = ENVIRONMENTS[ENV];
const supabaseUrl = currentEnv.url;
const supabaseAnonKey = currentEnv.anonKey;

// Validate configuration
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(`Invalid Supabase configuration for environment: ${ENV}`);
}

// Add additional logging for debugging
if (ENV !== 'test') {
  console.info(`Initializing Supabase client in ${ENV} environment`);
  console.info(`Using Supabase URL: ${supabaseUrl.split('://')[0]}://*****`);
  console.info(`Anon key present: ${!!supabaseAnonKey}`);
}

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

// Export interfaces for image upload functionality
export interface UploadProgress {
  file: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export type ProgressCallback = (progress: Record<string, UploadProgress>) => void;

// Type definitions for Supabase responses
type SupabaseStorageResponse = {
  data: { publicUrl: string } | null;
  error: Error | null;
};

type SupabaseUploadResponse = {
  data: unknown;
  error: Error | null;
};

type SupabaseInsertResponse = {
  error: Error | null;
};

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
              vehicle_id: vehicleId,
              file_name: file.name,
              file_path: filePath,
              image_type: category,
              public_url: publicUrl,
              uploaded_at: new Date().toISOString(),
              is_primary: category === VehicleImageCategory.PRIMARY,
              source: 'user_upload'
            });

          if (dbError) {
            const errorMsg = `Database insert error for ${file.name}: ${dbError.message}`;
            console.error(errorMsg);
            updateProgress(file.name, { status: 'error', error: errorMsg });
            // Delete the uploaded file since DB insert failed
            await supabase.storage.from('vehicles').remove([filePath]);
            throw new Error(errorMsg);
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

// Utility functions for handling retries and delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Custom error types for better error handling
class SupabaseNetworkError extends Error {
  readonly type = 'network';
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseNetworkError';
  }
}

class SupabaseRateLimitError extends Error {
  readonly type = 'rate_limit';
  constructor(message: string, public retryAfter?: number) {
    super(message);
    this.name = 'SupabaseRateLimitError';
  }
}

class SupabaseServerError extends Error {
  readonly type = 'server';
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'SupabaseServerError';
  }
}

// Type guard functions
const isNetworkError = (error: unknown): error is SupabaseNetworkError => 
  error instanceof SupabaseNetworkError;

const isRateLimitError = (error: unknown): error is SupabaseRateLimitError =>
  error instanceof SupabaseRateLimitError;

const isServerError = (error: unknown): error is SupabaseServerError =>
  error instanceof SupabaseServerError;

// Enhanced retry logic with proper error handling
const withRetry = async <T>(
  fn: () => Promise<T>,
  config: SupabaseConfig['retryConfig']
): Promise<T> => {
  let lastError: Error | null = null;
  let attempts = 0;

  const handleError = (error: unknown) => {
    if (error instanceof Error) {
      if (isNetworkError(error) || isServerError(error)) {
        return true; // Always retry network and server errors
      }
      if (isRateLimitError(error)) {
        return error.retryAfter ? error.retryAfter * 1000 : config.retryDelay;
      }
    }
    return false; // Don't retry other errors
  };

  while (attempts < config.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts++;

      const shouldRetry = handleError(error);
      if (shouldRetry && attempts < config.maxRetries) {
        const backoff = typeof shouldRetry === 'number' ? 
          shouldRetry : 
          config.retryDelay * Math.pow(2, attempts - 1);
        
        if (ENV === 'production') {
          console.warn(`Request failed (attempt ${attempts}/${config.maxRetries}):`, {
            error: lastError.message,
            backoff,
            errorType: lastError.name
          });
        }

        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  if (ENV === 'production' && lastError) {
    console.error('Request failed permanently:', {
      error: lastError.message,
      attempts,
      errorType: lastError.name
    });
  }

  throw lastError || new Error('Request failed after all retry attempts');
};

// Create supabase client with enhanced options for reliability
export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: ENV === 'production' ? 'sb-prod-auth' : 'sb-auth'
    },
    global: {
      headers: {
        'x-client-info': 'nuke@0.1.0'
      },
      // Custom fetch implementation with retries and error handling
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const { maxRetries, retryDelay } = ENVIRONMENTS[ENV].retryConfig;
        let lastError: Error | null = null;
        let attempts = 0;

        while (attempts < maxRetries) {
          try {
            const url = typeof input === 'string' ? input : input.toString();
            
            // Handle admin operations
            if (url.includes('/auth/v1/admin')) {
              return await handleAdminOperation(url, init);
            }

            const response = await fetch(input, {
              ...init,
              headers: {
                ...init?.headers,
                'x-client-info': 'nuke@0.1.0'
              }
            });

            // Handle rate limiting
            if (response.status === 429) {
              const retryAfter = response.headers.get('Retry-After');
              const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay;
              await sleep(waitTime);
              attempts++;
              continue;
            }

            // Handle server errors
            if (response.status >= 500) {
              const backoff = retryDelay * Math.pow(2, attempts);
              await sleep(backoff);
              attempts++;
              continue;
            }

            // Success or non-retryable error
            return response;

          } catch (error: any) {
            lastError = error;
            attempts++;

            if (attempts < maxRetries) {
              const backoff = retryDelay * Math.pow(2, attempts - 1);
              console.warn(
                `Request failed (attempt ${attempts}/${maxRetries}). ` +
                `Retrying in ${backoff}ms...`, 
                error.message
              );
              await sleep(backoff);
            }
          }
        }

        // All retries exhausted
        const errorMessage = lastError?.message || 'Network request failed';
        
        if (ENV === 'production') {
          console.error('All retry attempts failed:', {
            url: typeof input === 'string' ? input : input.toString(),
            error: errorMessage,
            attempts
          });
        }

        throw new Error(`Request failed after ${maxRetries} attempts: ${errorMessage}`);
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
