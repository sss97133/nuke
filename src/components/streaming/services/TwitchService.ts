
import { getTwitchAuthConfig, getTwitchAuth, refreshTwitchToken } from './auth/twitchAuth';
import { fetchLiveStreams, getUserInfo } from './api/twitchApi';
import { TwitchAuthData, TwitchUserData, TwitchStreamData } from './types';

class TwitchService {
  private authData: TwitchAuthData | null = null;
  private userData: TwitchUserData | null = null;

  constructor() {
    // Try to load auth data from localStorage on initialization
    this.loadAuthData();
  }

  private loadAuthData() {
    try {
      const savedAuthData = localStorage.getItem('twitch_auth_data');
      if (savedAuthData) {
        this.authData = JSON.parse(savedAuthData);
        console.log('Loaded Twitch auth data from localStorage');
      }
    } catch (error) {
      console.error('Error loading Twitch auth data:', error);
    }
  }

  private saveAuthData() {
    try {
      if (this.authData) {
        localStorage.setItem('twitch_auth_data', JSON.stringify(this.authData));
      }
    } catch (error) {
      console.error('Error saving Twitch auth data:', error);
    }
  }

  async authenticate(code: string, redirectUri: string): Promise<boolean> {
    try {
      const authData = await getTwitchAuth(code, redirectUri);
      if (authData) {
        this.authData = authData;
        this.saveAuthData();
        
        // After auth, get user data
        await this.fetchUserData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Twitch authentication error:', error);
      return false;
    }
  }

  async fetchUserData(): Promise<TwitchUserData | null> {
    if (!this.authData?.accessToken) {
      console.error('No access token to fetch user data');
      return null;
    }

    try {
      const userData = await getUserInfo(this.authData.accessToken);
      if (userData) {
        this.userData = userData;
        return userData;
      }
      return null;
    } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
    }
  }

  async getLiveStreams(query?: string): Promise<TwitchStreamData[]> {
    if (!this.isAuthenticated()) {
      console.error('Cannot get streams - not authenticated');
      return [];
    }
    
    try {
      await this.ensureValidToken();
      if (!this.authData?.accessToken) return [];
      
      return await fetchLiveStreams(this.authData.accessToken, query);
    } catch (error) {
      console.error('Error fetching live streams:', error);
      return [];
    }
  }

  async ensureValidToken(): Promise<boolean> {
    if (!this.authData) return false;
    
    // Check if token is expired or about to expire
    const now = Date.now();
    const tokenExpiry = this.authData.expiresAt || 0;
    
    if (tokenExpiry <= now) {
      console.log('Twitch token expired, refreshing...');
      try {
        if (!this.authData.refreshToken) {
          console.error('No refresh token available');
          return false;
        }
        
        const newAuthData = await refreshTwitchToken(this.authData.refreshToken);
        if (newAuthData) {
          this.authData = newAuthData;
          this.saveAuthData();
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to refresh token:', error);
        return false;
      }
    }
    
    return true;
  }

  isAuthenticated(): boolean {
    return !!this.authData?.accessToken;
  }

  getAuthConfig() {
    return getTwitchAuthConfig();
  }

  getChannelName(): string | null {
    return this.userData?.login || null;
  }

  getUserData(): TwitchUserData | null {
    return this.userData;
  }

  logout(): void {
    this.authData = null;
    this.userData = null;
    localStorage.removeItem('twitch_auth_data');
  }
}

export const twitchService = new TwitchService();
