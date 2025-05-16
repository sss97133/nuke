/**
 * Mock Data Guard - Enforces the "no mock data in production" rule
 * 
 * This utility ensures that mock data is NEVER used in production environments,
 * aligning with our vehicle-centric architecture principles of using real data
 * for vehicle digital identities in production.
 */

import { isProduction, isDevelopment } from './environment';

/**
 * Conditionally imports mock data only in development environments.
 * In production, this will return an empty object or array to prevent mock data usage.
 * 
 * @param importFn - A function that dynamically imports mock data
 * @param fallback - Optional fallback to return in production (defaults to empty array)
 * @returns The mock data in development, or an empty replacement in production
 */
export async function safeMockImport<T>(
  importFn: () => Promise<T>,
  fallback: T | (() => T) = () => [] as unknown as T
): Promise<T> {
  // In production, never load mock data
  if (isProduction()) {
    return typeof fallback === 'function' 
      ? (fallback as () => T)() 
      : fallback;
  }
  
  // In development, load the mock data
  try {
    return await importFn();
  } catch (error) {
    console.error('Error importing mock data:', error);
    return typeof fallback === 'function'
      ? (fallback as () => T)()
      : fallback;
  }
}

/**
 * Safely provides mock data only in development environments.
 * In production, this will return the fallback to prevent mock data usage.
 * 
 * @param mockData - The mock data to conditionally use
 * @param fallback - Fallback to return in production (required)
 * @returns The mock data in development, or the fallback in production
 */
export function safeMockData<T>(mockData: T, fallback: T): T {
  return isProduction() ? fallback : mockData;
}

/**
 * Hook that provides development-only mock data with real data fallback for production.
 * 
 * @param mockDataFn - Function that returns mock data
 * @param realDataFn - Function that fetches real data
 * @returns The appropriate data based on environment
 */
export async function useEnvironmentAwareData<T>(
  mockDataFn: () => T,
  realDataFn: () => Promise<T>
): Promise<T> {
  if (isProduction()) {
    return realDataFn();
  }
  
  // For development, decide based on a potential flag or environment variable
  const forceMockData = process.env.FORCE_MOCK_DATA === 'true';
  
  if (isDevelopment() && forceMockData) {
    return mockDataFn();
  }
  
  // Default to real data if not forcing mock data
  try {
    return await realDataFn();
  } catch (error) {
    console.warn('Failed to load real data, falling back to mock data in development:', error);
    return mockDataFn();
  }
}

// Webpack/rollup plugin compatible mock-stripping function for build-time elimination
// This ensures mock data never makes it into production bundles
export const __MOCK_DATA__ = isProduction() ? null : { enabled: true };
