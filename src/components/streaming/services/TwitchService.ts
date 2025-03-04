
import { TwitchAuthData, TwitchUserData, TwitchStreamData } from './types';
import { twitchApi } from './api/twitchApi';
import { twitchAuth } from './auth/twitchAuth';

class TwitchService {
  private authData: TwitchAuthData | null = null;
  private userData: TwitchUserData | null = null;
  
  constructor() {
    // Load auth data from localStorage if available
    try {
      const storedAuthData = localStorage.getItem('twitch_auth_data');
      if (storedAuthData) {
        this.authData = JSON.parse(storedAuthData);
        console.log("TwitchService: Loaded auth data from localStorage");
      }
    } catch (error) {
      console.error("TwitchService: Failed to load auth data from localStorage", error);
    }
  }
  
  async authenticate(): Promise<boolean> {
    try {
      console.log("TwitchService: Starting authentication process");
      const authData = await twitchAuth.getAuthData();
      
      if (authData) {
        this.authData = authData;
        
        // Store auth data in localStorage for persistence
        localStorage.setItem('twitch_auth_data', JSON.stringify(authData));
        console.log("TwitchService: Authentication successful");
        return true;
      }
      
      console.log("TwitchService: Authentication failed - no auth data returned");
      return false;
    } catch (error) {
      console.error("TwitchService: Authentication error", error);
      return false;
    }
  }
  
  async getCurrentUser(): Promise<TwitchUserData | null> {
    if (!this.isAuthenticated()) {
      console.log("TwitchService: Not authenticated, can't get user data");
      return null;
    }
    
    try {
      // Return cached user data if available
      if (this.userData) {
        return this.userData;
      }
      
      console.log("TwitchService: Fetching current user data from Twitch API");
      const userData = await twitchApi.getCurrentUser(this.authData!.accessToken);
      
      if (userData) {
        this.userData = userData;
        console.log("TwitchService: User data fetched successfully", userData);
        return userData;
      }
      
      console.log("TwitchService: Failed to fetch user data");
      return null;
    } catch (error) {
      console.error("TwitchService: Error fetching user data", error);
      return null;
    }
  }
  
  async isCurrentlyStreaming(): Promise<boolean> {
    if (!this.isAuthenticated()) {
      console.log("TwitchService: Not authenticated, can't check stream status");
      return false;
    }
    
    try {
      const userData = await this.getCurrentUser();
      
      if (!userData) {
        console.log("TwitchService: No user data available to check stream status");
        return false;
      }
      
      console.log("TwitchService: Checking if user is streaming:", userData.login);
      const isStreaming = await twitchApi.isUserLive(
        userData.login,
        this.authData!.accessToken
      );
      
      console.log("TwitchService: Stream status check result:", isStreaming);
      return isStreaming;
    } catch (error) {
      console.error("TwitchService: Error checking stream status", error);
      return false;
    }
  }
  
  async getLiveStreams(searchQuery = ''): Promise<TwitchStreamData[]> {
    if (!this.isAuthenticated()) {
      console.log("TwitchService: Not authenticated, can't get live streams");
      return [];
    }
    
    try {
      console.log("TwitchService: Fetching live streams from Twitch API");
      const streams = await twitchApi.getLiveStreams(
        this.authData!.accessToken,
        searchQuery
      );
      
      console.log(`TwitchService: Found ${streams.length} live streams`);
      return streams;
    } catch (error) {
      console.error("TwitchService: Error fetching live streams", error);
      return [];
    }
  }
  
  async getStreamInfo(username: string): Promise<TwitchStreamData | null> {
    if (!this.isAuthenticated()) {
      console.log("TwitchService: Not authenticated, can't get stream info");
      return null;
    }
    
    try {
      console.log(`TwitchService: Fetching stream info for ${username}`);
      return await twitchApi.getStreamInfo(
        username,
        this.authData!.accessToken
      );
    } catch (error) {
      console.error("TwitchService: Error fetching stream info", error);
      return null;
    }
  }
  
  isAuthenticated(): boolean {
    return !!this.authData && !this.isTokenExpired();
  }
  
  private isTokenExpired(): boolean {
    if (!this.authData || !this.authData.expiresAt) {
      return true;
    }
    
    // Check if the token has expired
    return Date.now() >= this.authData.expiresAt;
  }
  
  logout(): void {
    this.authData = null;
    this.userData = null;
    localStorage.removeItem('twitch_auth_data');
    console.log("TwitchService: Logged out successfully");
  }
}

export const twitchService = new TwitchService();
