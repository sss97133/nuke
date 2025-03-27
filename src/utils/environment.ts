/**
 * Environment utilities for handling variables using the three-tier fallback system
 * 1. First checks import.meta.env (Vite)
 * 2. Then checks process.env (Node)
 * 3. Finally checks window.__env (Browser runtime)
 */

// Type definition for window.__env
declare global {
  interface Window {
    __env?: Record<string, string>;
  }
}

/**
 * Gets an environment variable using the three-tier fallback system
 * @param key The environment variable key
 * @param defaultValue Optional fallback value if not found in any tier
 * @returns The environment variable value or defaultValue if not found
 */
export const getEnv = (key: string, defaultValue: string = ''): string => {
  // 1. Check Vite environment (import.meta.env)
  if (import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }

  // 2. Check Node environment (process.env)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }

  // 3. Check Browser runtime environment (window.__env)
  if (typeof window !== 'undefined' && window.__env && window.__env[key]) {
    return window.__env[key];
  }

  // Return the default value if not found in any tier
  return defaultValue;
};

/**
 * Gets the Supabase URL using the three-tier fallback system
 * @returns The Supabase URL
 */
export const getSupabaseUrl = (): string => {
  return getEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
};

/**
 * Gets the Supabase anonymous key using the three-tier fallback system
 * @returns The Supabase anonymous key
 */
export const getSupabaseAnonKey = (): string => {
  return getEnv('VITE_SUPABASE_ANON_KEY', '');
};

/**
 * Gets the Supabase service key using the three-tier fallback system
 * @returns The Supabase service key
 */
export const getSupabaseServiceKey = (): string => {
  return getEnv('VITE_SUPABASE_SERVICE_KEY', '');
};

/**
 * Checks if all required Supabase environment variables are available
 * @returns true if all required variables are available, false otherwise
 */
export const hasSupabaseCredentials = (): boolean => {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  
  return !!url && !!anonKey;
};

/**
 * Gets the current environment (development, test, production)
 * @returns The current environment
 */
export const getEnvironment = (): string => {
  return getEnv('NODE_ENV', 'development');
};

/**
 * Checks if the current environment is production
 * @returns true if in production environment, false otherwise
 */
export const isProduction = (): boolean => {
  return getEnvironment() === 'production';
};

/**
 * Checks if the current environment is development
 * @returns true if in development environment, false otherwise
 */
export const isDevelopment = (): boolean => {
  return getEnvironment() === 'development';
};

/**
 * Checks if the current environment is test
 * @returns true if in test environment, false otherwise
 */
export const isTest = (): boolean => {
  return getEnvironment() === 'test';
};
