
import { TwitchServiceConfig, TwitchError } from "../types";

export class TwitchApi {
  private config: TwitchServiceConfig;
  
  constructor(config: TwitchServiceConfig) {
    this.config = config;
  }
  
  private async makeRequest(endpoint: string, token: string, options: RequestInit = {}): Promise<any> {
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!this.config.clientId) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    const url = `${this.config.apiBase}${endpoint}`;
    
    try {
      const headers = {
        'Client-ID': this.config.clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      };
      
      console.log(`Making request to Twitch API: ${endpoint}`);
      
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: TwitchError = {
          status: response.status,
          message: errorData.message || `Error ${response.status}: ${response.statusText}`
        };
        
        console.error('Twitch API error:', error);
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error(`Error in Twitch API call to ${endpoint}:`, error);
      throw error;
    }
  }
  
  public async getStreamKey(token: string): Promise<string> {
    try {
      const data = await this.makeRequest('/streams/key', token);
      return data.data[0]?.stream_key || '';
    } catch (error) {
      console.error('Error fetching stream key:', error);
      throw error;
    }
  }

  public async getCurrentBroadcast(token: string): Promise<any> {
    try {
      // Get user ID first
      const userData = await this.getCurrentUser(token);
      const userId = userData.id;
      
      // Then get current stream info
      const streamData = await this.makeRequest(`/streams?user_id=${userId}`, token);
      console.log("Current broadcast data:", streamData);
      return streamData.data[0] || null;
    } catch (error) {
      console.error('Error fetching current broadcast:', error);
      throw error;
    }
  }

  public async startStream(token: string, title: string): Promise<void> {
    try {
      // Get user ID first
      const userData = await this.getCurrentUser(token);
      const userId = userData.id;
      
      console.log('Starting stream for user:', userId);
      
      // Patch the channel information to update the title
      await this.makeRequest(`/channels?broadcaster_id=${userId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          game_id: '0', // Default game ID
        })
      });
      
      console.log('Stream title updated successfully');
    } catch (error) {
      console.error('Error starting stream:', error);
      throw error;
    }
  }

  public async stopStream(token: string): Promise<void> {
    try {
      // In Twitch's API, there isn't a direct "stop stream" endpoint
      // The stream is stopped from the broadcaster's streaming software
      // We can notify the user about this
      console.log('To stop streaming, please end the stream in your broadcasting software');
    } catch (error) {
      console.error('Error in stop stream operation:', error);
      throw error;
    }
  }
  
  public async getCurrentUser(token: string): Promise<any> {
    try {
      const data = await this.makeRequest('/users', token);
      console.log("Twitch user data:", data);
      return data.data[0] || null;
    } catch (error) {
      console.error('Error fetching user data:', error);
      throw error;
    }
  }

  public async checkStreamStatus(token: string): Promise<boolean> {
    try {
      const broadcast = await this.getCurrentBroadcast(token);
      console.log("Stream status check result:", broadcast ? "LIVE" : "OFFLINE");
      return !!broadcast;
    } catch (error) {
      console.error('Error checking stream status:', error);
      return false;
    }
  }
}
