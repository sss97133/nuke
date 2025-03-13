import { getAuthToken, isDemoModeEnabled } from '../auth/authUtils';
import { getClientId, getMockTwitchUsername } from '../config/twitchConfig';

export interface TwitchUserData {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface StreamMetadata {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  is_mature: boolean;
}

export const getUserInfo = async (): Promise<TwitchUserData | null> => {
  // Check if we're in demo mode
  if (isDemoModeEnabled()) {
    // Return mock user data for demo
    return {
      id: 'demo_123456789',
      login: getMockTwitchUsername(),
      display_name: 'Demo Streamer',
      profile_image_url: 'https://placehold.co/100x100/purple/white?text=DS'
    };
  }
  
  // Normal API flow for real Twitch integration
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