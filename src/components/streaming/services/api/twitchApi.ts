
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
        ...options.headers
      };
      
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

  public async startStream(token: string, title: string): Promise<void> {
    // This would typically call the Twitch API to update stream information
    console.log('Starting Twitch stream with title:', title);
    
    // Simulate API call - in a real implementation, we would call the Twitch API
    // For example:
    // await this.makeRequest('/channels', token, {
    //   method: 'PATCH',
    //   body: JSON.stringify({ title }),
    //   headers: { 'Content-Type': 'application/json' }
    // });
  }

  public async stopStream(token: string): Promise<void> {
    // This would typically call the Twitch API to end a stream
    console.log('Stopping Twitch stream');
    
    // Simulate API call - in a real implementation, we would call the Twitch API
  }
  
  public async getCurrentUser(token: string): Promise<any> {
    try {
      const data = await this.makeRequest('/users', token);
      return data.data[0] || null;
    } catch (error) {
      console.error('Error fetching user data:', error);
      throw error;
    }
  }
}
