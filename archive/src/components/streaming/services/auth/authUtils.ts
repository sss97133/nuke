
// Authentication utilities for Twitch

// Constants
const TWITCH_AUTH_TOKEN_KEY = 'twitch_auth_token';
const DEMO_MODE_ENABLED_KEY = 'twitch_demo_mode';

/**
 * Store the auth token in localStorage
 */
export const setAuthToken = (token: string) => {
  localStorage.setItem(TWITCH_AUTH_TOKEN_KEY, token);
  // Dispatch event for components to know authentication changed
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

/**
 * Get the stored auth token
 */
export const getAuthToken = (): string | null => {
  return localStorage.getItem(TWITCH_AUTH_TOKEN_KEY);
};

/**
 * Clear the stored auth token
 */
export const clearAuthToken = () => {
  localStorage.removeItem(TWITCH_AUTH_TOKEN_KEY);
  localStorage.removeItem(DEMO_MODE_ENABLED_KEY);
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
  return !!getAuthToken() || isDemoModeEnabled();
};

/**
 * Check URL for OAuth response and handle the authentication flow
 */
export const checkAuthResponse = () => {
  const hash = window.location.hash;
  if (hash.includes('access_token')) {
    // Parse the access token from URL fragment
    const accessToken = hash.split('&')[0].split('=')[1];
    if (accessToken) {
      // Store the token
      setAuthToken(accessToken);
      
      // Clear the URL fragment to avoid exposing the token
      window.history.replaceState(
        {}, 
        document.title, 
        window.location.pathname + window.location.search
      );
      
      console.log('Successfully authenticated with Twitch');
      return true;
    }
  }
  return false;
};

/**
 * Enable demo mode (for when real OAuth isn't available)
 */
export const enableDemoMode = () => {
  localStorage.setItem(DEMO_MODE_ENABLED_KEY, 'true');
  // Set a fake token to ensure other code works
  setAuthToken('demo_token_12345');
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

/**
 * Check if demo mode is enabled
 */
export const isDemoModeEnabled = (): boolean => {
  return localStorage.getItem(DEMO_MODE_ENABLED_KEY) === 'true';
};
