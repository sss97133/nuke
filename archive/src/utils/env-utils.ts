/**
 * Environment Variable Utilities
 * 
 * Helper functions for accessing environment variables using the three-tier
 * fallback mechanism required for the Nuke application.
 */

// Get environment variables based on the current environment using the three-tier fallback mechanism
export const getEnvValue = (key: string): string => {
  let value = '';
  let source = '';
  
  // For Vite builds
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    value = import.meta.env[key];
    source = 'import.meta.env';
  }
  
  // For production builds where import.meta might not be available
  if (!value && typeof process !== 'undefined' && process.env && process.env[key]) {
    value = process.env[key];
    source = 'process.env';
  }
  
  // For browser environments where window.__env might be set
  if (!value && typeof window !== 'undefined' && window.__env && window.__env[key]) {
    value = window.__env[key];
    source = 'window.__env';
  }
  
  if (value) {
    console.log(`Environment variable ${key} found in ${source}`);
    return value;
  }
  
  console.warn(`Environment variable ${key} not found in any source`);
  return '';
};

// Add type definition for window.__env
declare global {
  interface Window {
    __env?: Record<string, string>;
  }
}

// Check if all required environment variables are available
export const checkRequiredEnvVars = (vars: string[]): boolean => {
  return vars.every(key => !!getEnvValue(key));
};

// Get environment variable status for all required variables
export const getEnvVarsStatus = (vars: string[]): Record<string, boolean> => {
  return vars.reduce((status, key) => {
    status[key] = !!getEnvValue(key);
    return status;
  }, {} as Record<string, boolean>);
};
