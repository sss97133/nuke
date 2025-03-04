
import { TwitchAuth } from "./auth/twitchAuth";
import { TwitchApi } from "./api/twitchApi";
import { TwitchServiceConfig } from "./types";

export class TwitchService {
  // Use a fallback empty string but log an error if the env var is missing
  private static CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID || '';
  private static API_BASE = 'https://api.twitch.tv/helix';
  
  private auth: TwitchAuth;
  private api: TwitchApi;
  private config: TwitchServiceConfig;
  
  constructor() {
    // Check if the client ID is missing and log an error
    if (!TwitchService.CLIENT_ID) {
      console.error('Twitch CLIENT_ID is missing! Please set VITE_TWITCH_CLIENT_ID in your environment variables.');
    }
    
    // Use the current window location to dynamically set the redirect URI
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    console.log('Setting Twitch redirect URI to:', redirectUri);
    
    this.config = {
      clientId: TwitchService.CLIENT_ID,
      redirectUri: redirectUri,
      apiBase: TwitchService.API_BASE
    };
    
    this.auth = new TwitchAuth(this.config);
    this.api = new TwitchApi(this.config);
  }

  public isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  public getLoginUrl(): string {
    return this.auth.getLoginUrl();
  }

  public login(): void {
    this.auth.login();
  }

  public logout(): void {
    this.auth.logout();
  }

  public async getStreamKey(): Promise<string> {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    return this.api.getStreamKey(token);
  }

  public async startStream(title: string): Promise<void> {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    return this.api.startStream(token, title);
  }

  public async stopStream(): Promise<void> {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    return this.api.stopStream(token);
  }
  
  public async getCurrentUser(): Promise<any> {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error('Not authenticated with Twitch');
    }
    
    return this.api.getCurrentUser(token);
  }
}

export const twitchService = new TwitchService();
