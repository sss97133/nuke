
import { TwitchUserData, TwitchStreamData } from '../types';

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

class TwitchApi {
  async getCurrentUser(accessToken: string): Promise<TwitchUserData | null> {
    try {
      console.log("TwitchApi: Fetching current user data");
      const response = await fetch(`${TWITCH_API_BASE}/users`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID || ''
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("TwitchApi: Error fetching user data", response.status, errorText);
        return null;
      }
      
      const data = await response.json();
      console.log("TwitchApi: User data response", data);
      
      if (data.data && data.data.length > 0) {
        return {
          id: data.data[0].id,
          login: data.data[0].login,
          displayName: data.data[0].display_name,
          profileImageUrl: data.data[0].profile_image_url,
          email: data.data[0].email
        };
      }
      
      console.log("TwitchApi: No user data found in response");
      return null;
    } catch (error) {
      console.error("TwitchApi: Error in getCurrentUser", error);
      return null;
    }
  }
  
  async isUserLive(username: string, accessToken: string): Promise<boolean> {
    try {
      console.log(`TwitchApi: Checking if ${username} is live`);
      const response = await fetch(`${TWITCH_API_BASE}/streams?user_login=${username}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID || ''
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`TwitchApi: Error checking stream status for ${username}`, response.status, errorText);
        return false;
      }
      
      const data = await response.json();
      console.log(`TwitchApi: Stream status for ${username}`, data);
      
      // If the data array contains any streams, the user is live
      const isLive = data.data && data.data.length > 0;
      console.log(`TwitchApi: ${username} is live:`, isLive);
      return isLive;
    } catch (error) {
      console.error(`TwitchApi: Error checking if ${username} is live`, error);
      return false;
    }
  }
  
  async getLiveStreams(accessToken: string, query = ''): Promise<TwitchStreamData[]> {
    try {
      let endpoint = `${TWITCH_API_BASE}/streams?first=20`;
      
      // Add search query if provided
      if (query) {
        // Try to search by game name or streamer name
        endpoint += `&game_name=${encodeURIComponent(query)}`;
      }
      
      console.log(`TwitchApi: Fetching live streams with endpoint: ${endpoint}`);
      
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID || ''
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("TwitchApi: Error fetching live streams", response.status, errorText);
        return [];
      }
      
      const data = await response.json();
      console.log("TwitchApi: Live streams response", data);
      
      if (!data.data || data.data.length === 0) {
        return [];
      }
      
      // If we have a query but didn't find results by game, try by streamer name
      if (query && data.data.length === 0) {
        return this.searchStreamsByUser(accessToken, query);
      }
      
      // Map the response to our TwitchStreamData interface
      return data.data.map((stream: any) => ({
        id: stream.id,
        user_id: stream.user_id,
        user_login: stream.user_login,
        user_name: stream.user_name,
        game_id: stream.game_id,
        game_name: stream.game_name,
        type: stream.type,
        title: stream.title,
        viewer_count: stream.viewer_count,
        started_at: stream.started_at,
        language: stream.language,
        thumbnail_url: stream.thumbnail_url,
        tags: stream.tags
      }));
    } catch (error) {
      console.error("TwitchApi: Error in getLiveStreams", error);
      return [];
    }
  }
  
  async searchStreamsByUser(accessToken: string, username: string): Promise<TwitchStreamData[]> {
    try {
      const endpoint = `${TWITCH_API_BASE}/streams?user_login=${encodeURIComponent(username)}`;
      
      console.log(`TwitchApi: Searching streams by username: ${username}`);
      
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID || ''
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("TwitchApi: Error searching streams by user", response.status, errorText);
        return [];
      }
      
      const data = await response.json();
      console.log(`TwitchApi: Streams for user ${username}`, data);
      
      if (!data.data || data.data.length === 0) {
        return [];
      }
      
      // Map the response to our TwitchStreamData interface
      return data.data.map((stream: any) => ({
        id: stream.id,
        user_id: stream.user_id,
        user_login: stream.user_login,
        user_name: stream.user_name,
        game_id: stream.game_id,
        game_name: stream.game_name,
        type: stream.type,
        title: stream.title,
        viewer_count: stream.viewer_count,
        started_at: stream.started_at,
        language: stream.language,
        thumbnail_url: stream.thumbnail_url,
        tags: stream.tags
      }));
    } catch (error) {
      console.error(`TwitchApi: Error searching streams for user ${username}`, error);
      return [];
    }
  }
  
  async getStreamInfo(username: string, accessToken: string): Promise<TwitchStreamData | null> {
    try {
      console.log(`TwitchApi: Getting stream info for ${username}`);
      const streams = await this.searchStreamsByUser(accessToken, username);
      
      if (streams.length > 0) {
        return streams[0];
      }
      
      return null;
    } catch (error) {
      console.error(`TwitchApi: Error getting stream info for ${username}`, error);
      return null;
    }
  }
}

export const twitchApi = new TwitchApi();
