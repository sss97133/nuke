
import { 
  fetchTwitchStreams, 
  fetchLiveStreams, 
  getUserInfo, 
  startStream as apiStartStream,
  stopStream as apiStopStream
} from './api/twitchApi';
import { 
  login as twitchLogin, 
  logout as twitchLogout, 
  isAuthenticated
} from './auth/twitchAuth';
import { 
  getClientId, 
  getRedirectUri, 
  isConfigured 
} from './config/twitchConfig';
import { StreamMetadata, TwitchUserData } from './types';

class TwitchService {
  constructor() {
    // Check URL for OAuth response
    this.checkAuthFromUrl();
  }

  /**
   * Check for auth response in the URL
   */
  private checkAuthFromUrl() {
    // This function replaces the missing checkAuthResponse
    // Extract token from URL if present
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const expiresIn = params.get('expires_in');
      
      if (accessToken) {
        // Save the token
        localStorage.setItem('twitch_auth_token', accessToken);
        
        // Clear the URL hash
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        
        // Dispatch event for auth change
        window.dispatchEvent(new Event('twitch_auth_changed'));
        
        console.log('Authenticated with Twitch');
      }
    }
  }

  /**
   * Initiate Twitch OAuth login flow
   */
  login() {
    twitchLogin();
  }

  /**
   * Logout from Twitch
   */
  logout() {
    twitchLogout();
  }

  /**
   * Get streams from Twitch API
   */
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
  
  /**
   * Get current user information
   */
  async getCurrentUser(): Promise<TwitchUserData | null> {
    try {
      if (!this.isConfigured() || !this.isAuthenticated()) {
        console.error('Twitch client ID is not configured or not authenticated');
        return null;
      }
      
      const userData = await getUserInfo();
      if (!userData) return null;
      
      // Format to match TwitchUserData interface
      return {
        id: userData.id,
        login: userData.login,
        displayName: userData.display_name,
        profileImageUrl: userData.profile_image_url
      };
    } catch (error) {
      console.error('Error fetching current user:', error);
      return null;
    }
  }
  
  /**
   * Get user's live streams
   */
  async getLiveStreams(): Promise<any[]> {
    try {
      if (!this.isConfigured() || !this.isAuthenticated()) {
        console.error('Twitch not configured or not authenticated');
        return [];
      }
      return await fetchLiveStreams();
    } catch (error) {
      console.error('Error fetching live streams:', error);
      return [];
    }
  }
  
  /**
   * Check if the user is currently streaming
   */
  async isCurrentlyStreaming(): Promise<boolean> {
    try {
      if (!this.isConfigured() || !this.isAuthenticated()) {
        console.error('Twitch not configured or not authenticated');
        return false;
      }
      const streams = await fetchLiveStreams();
      return streams.length > 0;
    } catch (error) {
      console.error('Error checking stream status:', error);
      return false;
    }
  }
  
  /**
   * Start a stream
   */
  async startStream(title?: string, gameId?: string): Promise<boolean> {
    if (!this.isConfigured() || !this.isAuthenticated()) {
      throw new Error('Twitch not configured or not authenticated');
    }
    
    console.log('Starting stream with title:', title, 'and game ID:', gameId);
    return await apiStartStream(title || 'Live Stream', gameId || '');
  }
  
  /**
   * Stop a stream
   */
  async stopStream(): Promise<boolean> {
    if (!this.isConfigured() || !this.isAuthenticated()) {
      throw new Error('Twitch not configured or not authenticated');
    }
    return await apiStopStream();
  }
  
  /**
   * Check if the user is authenticated with Twitch
   */
  isAuthenticated(): boolean {
    return isAuthenticated();
  }
  
  /**
   * Check if Twitch client ID is configured
   */
  isConfigured(): boolean {
    return isConfigured();
  }
  
  /**
   * Get the client ID
   */
  getClientId(): string | null {
    return getClientId();
  }
  
  /**
   * Get the redirect URI
   */
  getRedirectUri(): string {
    return getRedirectUri();
  }
}

// Export the instance as default and as named export to support both import styles
const twitchService = new TwitchService();
export { twitchService };
export default twitchService;
