
import { 
  fetchTwitchStreams, 
  fetchLiveStreams, 
  getUserInfo, 
  setAuthToken, 
  getAuthToken, 
  clearAuthToken,
  startStream as apiStartStream,
  stopStream as apiStopStream
} from './api/twitchApi';
import { StreamMetadata, TwitchUserData } from './types';

class TwitchService {
  private clientId: string | null;
  private redirectUri: string;

  constructor() {
    // Get the client ID from environment variables
    this.clientId = import.meta.env.VITE_TWITCH_CLIENT_ID || null;
    
    // Set the redirect URI for OAuth
    this.redirectUri = `${window.location.origin}/streaming`;
    
    if (!this.clientId) {
      console.warn('Twitch client ID is not configured. Some streaming features may not work.');
    }
    
    // Check URL for OAuth response
    this.checkAuthResponse();
  }

  /**
   * Check URL for OAuth response and handle the authentication flow
   */
  private checkAuthResponse() {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      // Parse the access token from URL fragment
      const accessToken = hash.split('&')[0].split('=')[1];
      if (accessToken) {
        // Store the token
        setAuthToken(accessToken);
        
        // Clear the URL fragment to avoid exposing the token
        window.history.replaceState(
          {}, 
          document.title, 
          window.location.pathname + window.location.search
        );
        
        console.log('Successfully authenticated with Twitch');
      }
    }
  }

  /**
   * Initiate Twitch OAuth login flow
   */
  login() {
    if (!this.isConfigured()) {
      throw new Error('Twitch client ID is not configured');
    }
    
    // Define required scopes for streaming
    const scopes = [
      'user:read:email',
      'channel:read:stream_key',
      'channel:manage:broadcast',
      'channel:read:subscriptions'
    ];
    
    // Build Twitch OAuth URL
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.append('client_id', this.clientId as string);
    authUrl.searchParams.append('redirect_uri', this.redirectUri);
    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('scope', scopes.join(' '));
    
    // Redirect to Twitch login
    window.location.href = authUrl.toString();
  }

  /**
   * Logout from Twitch
   */
  logout() {
    clearAuthToken();
    console.log('Logged out from Twitch');
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
    return !!getAuthToken();
  }
  
  /**
   * Check if Twitch client ID is configured
   */
  isConfigured(): boolean {
    return !!this.clientId;
  }
  
  /**
   * Get the client ID
   */
  getClientId(): string | null {
    return this.clientId;
  }
  
  /**
   * Get the redirect URI
   */
  getRedirectUri(): string {
    return this.redirectUri;
  }
}

// Export the instance as default and as named export to support both import styles
const twitchService = new TwitchService();
export { twitchService };
export default twitchService;
