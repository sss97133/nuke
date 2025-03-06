
// Configuration for Twitch service

/**
 * Gets the Twitch client ID from environment variables or fallback
 */
export const getClientId = (): string | null => {
  // First try to get from environment variables
  const envClientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
  if (envClientId) return envClientId;
  
  // Fallback to mock client ID for demo purposes
  // In a real app, you would never hardcode this
  // This is just for the demo to work when env vars aren't set
  return 'mock_client_id_123456789'; 
};

/**
 * Gets the redirect URI for OAuth
 * Uses a hardcoded URL for deployed environments to avoid lovable.ai redirect issues
 */
export const getRedirectUri = (): string => {
  // For local development
  if (window.location.hostname === 'localhost') {
    return `${window.location.origin}/streaming`;
  }
  
  // For production, use a hardcoded URL to nuke-kohl.vercel.app
  // This ensures the auth callback always goes to the right place
  return 'https://nuke-kohl.vercel.app/streaming';
};

/**
 * Checks if Twitch client ID is configured
 */
export const isConfigured = (): boolean => {
  return !!getClientId();
};

/**
 * Required scopes for Twitch OAuth
 */
export const getRequiredScopes = (): string[] => {
  return [
    'user:read:email',
    'channel:read:stream_key',
    'channel:manage:broadcast',
    'channel:read:subscriptions'
  ];
};

/**
 * Simulated Twitch username for demo
 * In a real app, this would come from Twitch authentication
 */
export const getMockTwitchUsername = (): string => {
  return 'demo_streamer';
};
