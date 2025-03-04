
import { fetchTwitchStreams } from './api/twitchApi';
import { fetchLiveStreams, getUserInfo } from './api/twitchApi';
import { StreamMetadata } from './types';

class TwitchService {
  async getStreams(): Promise<StreamMetadata[]> {
    try {
      return await fetchTwitchStreams();
    } catch (error) {
      console.error('Error fetching Twitch streams:', error);
      return [];
    }
  }
  
  // Add missing methods to fix the build errors
  async getCurrentUser() {
    try {
      return await getUserInfo();
    } catch (error) {
      console.error('Error fetching current user:', error);
      return null;
    }
  }
  
  async isCurrentlyStreaming(): Promise<boolean> {
    try {
      const streams = await fetchLiveStreams();
      return streams.length > 0;
    } catch (error) {
      console.error('Error checking stream status:', error);
      return false;
    }
  }
  
  async startStream() {
    // This would call the Twitch API to start streaming
    console.log('Starting stream...');
    return true;
  }
  
  async stopStream() {
    // This would call the Twitch API to stop streaming
    console.log('Stopping stream...');
    return true;
  }
}

export default new TwitchService();
