
import { getAuthToken, isDemoModeEnabled } from '../auth/authUtils';
import { getClientId, getMockTwitchUsername } from '../config/twitchConfig';
import { StreamMetadata, TwitchUserData } from '../types';
import { getUserInfo } from './twitchApi';

// State management for demo mode
let demoStreamActive = false;
let demoStreamTitle = 'Demo Stream';
let demoStreamGame = 'Just Chatting';

/**
 * Check if the user is currently streaming
 */
export const isCurrentlyStreaming = async (): Promise<boolean> => {
  // If in demo mode, use our local state
  if (isDemoModeEnabled()) {
    return demoStreamActive;
  }
  
  // Standard flow for real API
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
  // If in demo mode, return mock data based on our state
  if (isDemoModeEnabled()) {
    if (!demoStreamActive) {
      return [];
    }
    
    return [{
      id: 'demo_stream_123',
      user_id: 'demo_123456789',
      user_login: getMockTwitchUsername(),
      user_name: 'Demo Streamer',
      game_id: '123456',
      game_name: demoStreamGame,
      type: 'live',
      title: demoStreamTitle,
      viewer_count: Math.floor(Math.random() * 100),
      started_at: new Date().toISOString(),
      language: 'en',
      thumbnail_url: 'https://placehold.co/1920x1080/purple/white?text=DEMO+STREAM',
      is_mature: false
    }];
  }
  
  // Standard API flow
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
  // If in demo mode, update our local state
  if (isDemoModeEnabled()) {
    demoStreamActive = true;
    demoStreamTitle = title || 'Demo Stream';
    demoStreamGame = gameId || 'Just Chatting';
    return true;
  }
  
  // Standard API flow
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
  // If in demo mode, update our local state
  if (isDemoModeEnabled()) {
    demoStreamActive = false;
    return true;
  }
  
  // Standard API flow
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
