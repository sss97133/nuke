
import { getAuthToken } from '../auth/authUtils';
import { getClientId } from '../config/twitchConfig';
import { StreamMetadata } from '../types';

/**
 * Fetch streams from Twitch API for display
 */
export const fetchTwitchStreams = async (): Promise<StreamMetadata[]> => {
  const authToken = getAuthToken();
  if (!authToken) return [];
  
  try {
    const response = await fetch('https://api.twitch.tv/helix/streams', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': getClientId() as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data.map((stream: any) => ({
      id: stream.id,
      title: stream.title,
      user_name: stream.user_name,
      user_login: stream.user_login,
      game_name: stream.game_name,
      viewer_count: stream.viewer_count,
      thumbnail_url: stream.thumbnail_url,
      started_at: stream.started_at,
      tags: stream.tags
    })) || [];
  } catch (error) {
    console.error('Error fetching Twitch streams:', error);
    throw error;
  }
};
