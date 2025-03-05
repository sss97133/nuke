
// Authentication utilities for Twitch

/**
 * Store the auth token in localStorage
 */
export const setAuthToken = (token: string) => {
  localStorage.setItem('twitch_auth_token', token);
  // Dispatch event for components to know authentication changed
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

/**
 * Get the stored auth token
 */
export const getAuthToken = (): string | null => {
  return localStorage.getItem('twitch_auth_token');
};

/**
 * Clear the stored auth token
 */
export const clearAuthToken = () => {
  localStorage.removeItem('twitch_auth_token');
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
  return !!getAuthToken();
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
