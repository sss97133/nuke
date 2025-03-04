
import { TwitchServiceConfig } from "../types";

export class TwitchApi {
  private config: TwitchServiceConfig;
  
  constructor(config: TwitchServiceConfig) {
    this.config = config;
  }
  
  public async getStreamKey(token: string): Promise<string> {
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!this.config.clientId) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    try {
      const response = await fetch(`${this.config.apiBase}/streams/key`, {
        headers: {
          'Client-ID': this.config.clientId,
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch stream key');
      }

      const data = await response.json();
      return data.data[0]?.stream_key || '';
    } catch (error) {
      console.error('Error fetching stream key:', error);
      throw error;
    }
  }

  public async startStream(token: string, title: string): Promise<void> {
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!this.config.clientId) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    console.log('Starting Twitch stream with title:', title);
  }

  public async stopStream(token: string): Promise<void> {
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!this.config.clientId) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    console.log('Stopping Twitch stream');
  }
}
