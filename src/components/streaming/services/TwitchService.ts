
import { fetchTwitchStreams } from './api/twitchApi';
import { fetchLiveStreams, getUserInfo } from './api/twitchApi';
import { StreamMetadata } from './types';

class TwitchService {
  private clientId: string | null;

  constructor() {
    // Get the client ID from environment variables
    this.clientId = import.meta.env.VITE_TWITCH_CLIENT_ID || null;
    
    if (!this.clientId) {
      console.warn('Twitch client ID is not configured. Some streaming features may not work.');
    }
  }

  async getStreams(): Promise<StreamMetadata[]> {
    try {
      if (!this.isConfigured()) {
        console.error('Twitch client ID is not configured');
        return [];
      }
      return await fetchTwitchStreams();
    } catch (error) {
      console.error('Error fetching Twitch streams:', error);
      return [];
    }
  }
  
  async getCurrentUser() {
    try {
      if (!this.isConfigured()) {
        console.error('Twitch client ID is not configured');
        return null;
      }
      return await getUserInfo();
    } catch (error) {
      console.error('Error fetching current user:', error);
      return null;
    }
  }
  
  async isCurrentlyStreaming(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        console.error('Twitch client ID is not configured');
        return false;
      }
      const streams = await fetchLiveStreams();
      return streams.length > 0;
    } catch (error) {
      console.error('Error checking stream status:', error);
      return false;
    }
  }
  
  async startStream() {
    if (!this.isConfigured()) {
      throw new Error('Twitch client ID is not configured');
    }
    // This would call the Twitch API to start streaming
    console.log('Starting stream...');
    return true;
  }
  
  async stopStream() {
    if (!this.isConfigured()) {
      throw new Error('Twitch client ID is not configured');
    }
    // This would call the Twitch API to stop streaming
    console.log('Stopping stream...');
    return true;
  }
  
  isAuthenticated() {
    // Check if we're properly authenticated with Twitch
    // This would normally check for auth tokens, etc.
    return this.isConfigured() && true; // Mock implementation
  }
  
  isConfigured() {
    return !!this.clientId;
  }
  
  getClientId() {
    return this.clientId;
  }
  
  getUserData() {
    if (!this.isConfigured()) {
      return null;
    }
    return {
      displayName: 'Mock User'
    };
  }
  
  getLiveStreams(searchTerm = '') {
    if (!this.isConfigured()) {
      console.error('Twitch client ID is not configured');
      return [];
    }
    console.log('Getting live streams with search term:', searchTerm);
    return []; // Mock implementation
  }
}

// Export the instance as default and as named export to support both import styles
const twitchService = new TwitchService();
export { twitchService };
export default twitchService;
