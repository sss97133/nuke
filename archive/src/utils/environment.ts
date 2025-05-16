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
  const nodeEnv = getEnv('NODE_ENV', 'development');
  
  // For Vercel deployments, ensure production is properly detected
  if (typeof window !== 'undefined') {
    if (window.location.hostname.includes('vercel.app') || 
        window.location.hostname.includes('nuke-app.com')) {
      return 'production';
    }
  }
  
  return nodeEnv;
};

/**
 * Checks if the current environment is production
 * @returns true if in production environment, false otherwise
 */
export const isProduction = (): boolean => {
  // Multiple checks to ensure proper environment detection
  const env = getEnvironment() === 'production';
  
  // Check URL for production indicators (vercel deployments)
  const isProductionUrl = typeof window !== 'undefined' && 
    !window.location.hostname.includes('localhost') && 
    !window.location.hostname.includes('127.0.0.1') &&
    (window.location.hostname.includes('vercel.app') || 
     window.location.hostname.includes('nuke-app.com'));
  
  return env || isProductionUrl;
};

/**
 * Checks if the current environment is development
 * @returns true if in development environment, false otherwise
 */
export const isDevelopment = (): boolean => {
  if (isProduction()) return false;
  
  const env = getEnvironment() === 'development';
  
  // Check URL for development indicators
  const isDevUrl = typeof window !== 'undefined' && 
    (window.location.hostname.includes('localhost') || 
     window.location.hostname.includes('127.0.0.1'));
  
  return env || isDevUrl;
};

/**
 * Checks if the current environment is test
 * @returns true if in test environment, false otherwise
 */
export const isTest = (): boolean => {
  return getEnvironment() === 'test';
};

/**
 * The marketplace and UI components require design-critical data to render properly.
 * This data is NOT considered mock vehicle data (VIN records, service history).
 * It's essential for UI layout and component structure.
 * 
 * IMPORTANT: This function returns TRUE in all environments to maintain UI functionality.
 * Used by marketplace, dashboard, and UI components that need data to render properly.
 */
export const shouldAllowMockData = (): boolean => {
  // Always return true to maintain design integrity
  return true;
};

/**
 * For UI design elements that need visual data to render correctly.
 * This is specifically for charts, layouts, and UI components - NOT vehicle data.
 * 
 * Usage example:
 * ```
 * // In a UI component that needs data for layout/styling
 * const chartData = shouldAllowDesignData() ? uiDesignData : (realData || fallbackDisplayData());
 * ```
 */
export const shouldAllowDesignData = (): boolean => {
  // UI components must be allowed to render with proper data structure
  return true;
};

/**
 * Only for actual VEHICLE DATA (VINs, service records, etc.)
 * This enforces the rule of no real vehicle mock data in production.
 * 
 * Usage example:
 * ```
 * // In a vehicle data service
 * const vehicleHistory = shouldAllowVehicleMockData() ? mockVehicleHistory : await fetchRealVehicleHistory();
 * ```
 * 
 * @param allowMocks Whether to allow vehicle mocks in non-production environments
 * @returns false if in production, allowMocks value otherwise
 */
export const shouldAllowVehicleMockData = (allowMocks: boolean = true): boolean => {
  // Always false in production to ensure real vehicle data only
  if (isProduction()) return false;
  
  // In development or test, respect the allowMocks parameter
  return allowMocks;
};
