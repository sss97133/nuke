
import { getAuthToken } from '../auth/authUtils';
import { getClientId } from '../config/twitchConfig';
import { StreamMetadata, TwitchUserData } from '../types';
import { getUserInfo } from './twitchApi';

/**
 * Check if the user is currently streaming
 */
export const isCurrentlyStreaming = async (): Promise<boolean> => {
  try {
    const streams = await fetchLiveStreams();
    return streams.length > 0;
  } catch (error) {
    console.error('Error checking stream status:', error);
    return false;
  }
};

/**
 * Get user's live streams
 */
export const fetchLiveStreams = async (): Promise<any[]> => {
  const authToken = getAuthToken();
  if (!authToken) return [];
  
  try {
    const userData = await getUserInfo();
    if (!userData) return [];
    
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${userData.id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': getClientId() as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching Twitch live streams:', error);
    throw error;
  }
};

/**
 * Start a stream
 */
export const startStream = async (title: string, gameId: string): Promise<boolean> => {
  const authToken = getAuthToken();
  if (!authToken) throw new Error('Not authenticated with Twitch');
  
  try {
    const userData = await getUserInfo();
    if (!userData) throw new Error('Could not retrieve user data');
    
    console.log('Starting stream with title:', title, 'and game ID:', gameId);
    console.log('User ID:', userData.id);

    // In a real implementation, this would call the appropriate Twitch API endpoint
    // Since we can't actually start a stream through the API,
    // we're simulating a successful call
    return true;
  } catch (error) {
    console.error('Error starting Twitch stream:', error);
    throw error;
  }
};

/**
 * Stop a stream
 */
export const stopStream = async (): Promise<boolean> => {
  const authToken = getAuthToken();
  if (!authToken) throw new Error('Not authenticated with Twitch');
  
  try {
    console.log('Stopping stream...');
    // In a real implementation, this would call the appropriate Twitch API endpoint
    // The API can only update stream information
    return true;
  } catch (error) {
    console.error('Error stopping Twitch stream:', error);
    throw error;
  }
};
