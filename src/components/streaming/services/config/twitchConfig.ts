
// Configuration for Twitch service

/**
 * Gets the Twitch client ID from environment variables
 */
export const getClientId = (): string | null => {
  return import.meta.env.VITE_TWITCH_CLIENT_ID || null;
};

/**
 * Gets the redirect URI for OAuth
 */
export const getRedirectUri = (): string => {
  return `${window.location.origin}/streaming`;
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
