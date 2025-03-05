
import { getClientId, getRedirectUri, getRequiredScopes } from '../config/twitchConfig';
import { getAuthToken, setAuthToken, clearAuthToken, isAuthenticated } from './authUtils';
import { TwitchAuthData } from '../types';

/**
 * Initiate Twitch OAuth login flow
 */
export const login = () => {
  const clientId = getClientId();
  
  if (!clientId) {
    throw new Error('Twitch client ID is not configured');
  }
  
  // Build Twitch OAuth URL
  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.append('client_id', clientId);
  authUrl.searchParams.append('redirect_uri', getRedirectUri());
  authUrl.searchParams.append('response_type', 'token');
  authUrl.searchParams.append('scope', getRequiredScopes().join(' '));
  
  // Redirect to Twitch login
  window.location.href = authUrl.toString();
};

/**
 * Logout from Twitch
 */
export const logout = () => {
  clearAuthToken();
  console.log('Logged out from Twitch');
};

// Re-export auth utilities
export { getAuthToken, setAuthToken, clearAuthToken, isAuthenticated };
