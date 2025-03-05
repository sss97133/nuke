
/**
 * Feature Flag Utility
 * 
 * Central place to manage feature flags for gradual migration from mock to real data.
 * This makes it easy to toggle features on and off during development and testing.
 */

// Master feature flag - when false, all mock data is used regardless of individual settings
export const USE_REAL_DATA_MASTER = true;

/**
 * Feature Flags
 * 
 * Set each flag to true to use real data from Supabase
 * Set to false to continue using mock data
 */
export const featureFlags = {
  // Vehicle data (in the Discovery and Detail views)
  vehicles: true,
  
  // Marketplace listings and details
  marketplace: true,
  marketplaceDetail: true,
  
  // Fuel tracking data
  fuel: true,
  
  // iCloud photo integration
  icloudImages: true,
  
  // Marketplace auctions (Edge Function)
  auctions: true,
  
  // User profile and preferences
  userProfile: true,
  
  // Admin dashboard functionality
  adminDashboard: false
};

/**
 * Get Feature Flag
 * 
 * Helper to get a feature flag value, respecting the master switch.
 * If the master switch is off, all features return false.
 */
export function getFeatureFlag(flagName: keyof typeof featureFlags): boolean {
  if (!USE_REAL_DATA_MASTER) {
    return false;
  }
  
  return featureFlags[flagName] || false;
}

/**
 * Check if a feature is enabled
 * 
 * Use this function to check if a feature is enabled in components and hooks.
 * Example: if (isFeatureEnabled('vehicles')) { ... }
 */
export function isFeatureEnabled(flagName: keyof typeof featureFlags): boolean {
  return getFeatureFlag(flagName);
}

export default {
  getFeatureFlag,
  isFeatureEnabled,
  featureFlags,
  USE_REAL_DATA_MASTER
};
