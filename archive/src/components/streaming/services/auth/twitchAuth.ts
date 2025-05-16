
import { getClientId, getRedirectUri, getRequiredScopes } from '../config/twitchConfig';
import { 
  getAuthToken, 
  setAuthToken, 
  clearAuthToken, 
  isAuthenticated,
  enableDemoMode,
  isDemoModeEnabled
} from './authUtils';
import { TwitchAuthData } from '../types';

/**
 * Initiate Twitch OAuth login flow
 */
export const login = () => {
  const clientId = getClientId();
  
  if (!clientId) {
    throw new Error('Twitch client ID is not configured');
  }
  
  // For demo purposes, if using the mock client ID, enable demo mode instead of real OAuth
  if (clientId === 'mock_client_id_123456789') {
    console.log('Using mock Twitch client ID, enabling demo mode');
    enableDemoMode();
    return;
  }
  
  // Build Twitch OAuth URL for real OAuth flow
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
export { 
  getAuthToken, 
  setAuthToken, 
  clearAuthToken, 
  isAuthenticated,
  enableDemoMode,
  isDemoModeEnabled
};
