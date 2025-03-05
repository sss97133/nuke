
import { getAuthToken } from '../auth/authUtils';
import { getClientId } from '../config/twitchConfig';

/**
 * Fetch user's information
 */
export const getUserInfo = async () => {
  const authToken = getAuthToken();
  if (!authToken) return null;
  
  try {
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': getClientId() as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const userData = data.data[0];
      return {
        id: userData.id,
        login: userData.login,
        display_name: userData.display_name,
        profile_image_url: userData.profile_image_url
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching Twitch user info:', error);
    throw error;
  }
};

// Re-export auth functions from the API layer file
export { getAuthToken, setAuthToken, clearAuthToken } from '../auth/authUtils';
export { fetchTwitchStreams } from './contentApi';
export { fetchLiveStreams, startStream, stopStream } from './streamingApi';
