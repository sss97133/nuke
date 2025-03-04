
interface TwitchAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string[];
}

export class TwitchService {
  // Use a fallback empty string but log an error if the env var is missing
  private static CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID || '';
  private static REDIRECT_URI = `${window.location.origin}/streaming`;
  private static API_BASE = 'https://api.twitch.tv/helix';
  
  private accessToken: string | null = null;
  private authWindow: Window | null = null;
  private authCheckInterval: number | null = null;
  
  constructor() {
    // Check if the client ID is missing and log an error
    if (!TwitchService.CLIENT_ID) {
      console.error('Twitch CLIENT_ID is missing! Please set VITE_TWITCH_CLIENT_ID in your environment variables.');
    }
    
    // Check if we have a token in localStorage
    this.accessToken = localStorage.getItem('twitch_access_token');
    
    // Check if we just got redirected from Twitch OAuth
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const token = urlParams.get('access_token');
    
    if (token) {
      console.log('Twitch auth token received');
      this.accessToken = token;
      localStorage.setItem('twitch_access_token', token);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // If we're in a popup, signal the parent window
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'TWITCH_AUTH_SUCCESS', token }, window.location.origin);
        window.close();
      }
    }
    
    // Listen for messages from popup window
    window.addEventListener('message', this.handleAuthMessage);
  }

  private handleAuthMessage = (event: MessageEvent) => {
    // Make sure message is from our origin
    if (event.origin !== window.location.origin) return;
    
    // Check if it's a Twitch auth success message
    if (event.data && event.data.type === 'TWITCH_AUTH_SUCCESS') {
      console.log('Received auth success message from popup');
      this.accessToken = event.data.token;
      localStorage.setItem('twitch_access_token', event.data.token);
      
      // Notify any listeners that auth state changed
      window.dispatchEvent(new Event('twitch_auth_changed'));
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  public getLoginUrl(): string {
    // Log warning if client ID is missing
    if (!TwitchService.CLIENT_ID) {
      console.error('Cannot generate login URL: Twitch CLIENT_ID is missing!');
      return '#';
    }
    
    const scopes = ['channel:read:stream_key', 'channel:manage:broadcast'];
    
    return `https://id.twitch.tv/oauth2/authorize?client_id=${TwitchService.CLIENT_ID}&redirect_uri=${encodeURIComponent(TwitchService.REDIRECT_URI)}&response_type=token&scope=${scopes.join(' ')}`;
  }

  public login(): void {
    // Validate client ID is present
    if (!TwitchService.CLIENT_ID) {
      console.error('Twitch login failed: CLIENT_ID is missing!');
      throw new Error('Twitch CLIENT_ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.');
    }
    
    // Close any existing auth window
    if (this.authWindow && !this.authWindow.closed) {
      this.authWindow.close();
    }
    
    // Clear any existing check interval
    if (this.authCheckInterval) {
      clearInterval(this.authCheckInterval);
      this.authCheckInterval = null;
    }
    
    const width = 600;
    const height = 700;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    this.authWindow = window.open(
      this.getLoginUrl(),
      'Twitch Login',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    
    if (!this.authWindow) {
      throw new Error('Failed to open login popup. Please check if popups are blocked by your browser.');
    }
    
    // Add a listener to detect when the popup is closed
    this.authCheckInterval = window.setInterval(() => {
      if (this.authWindow?.closed) {
        this.clearAuthCheck();
        
        // Check if we got a token after the popup was closed
        if (this.isAuthenticated()) {
          // Notify any listeners that authentication state has changed
          window.dispatchEvent(new Event('twitch_auth_changed'));
        }
      }
    }, 500);
  }
  
  private clearAuthCheck(): void {
    if (this.authCheckInterval) {
      clearInterval(this.authCheckInterval);
      this.authCheckInterval = null;
    }
  }

  public logout(): void {
    this.accessToken = null;
    localStorage.removeItem('twitch_access_token');
    // Dispatch event to notify components
    window.dispatchEvent(new Event('twitch_auth_changed'));
  }

  public async getStreamKey(): Promise<string> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!TwitchService.CLIENT_ID) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    try {
      const response = await fetch(`${TwitchService.API_BASE}/streams/key`, {
        headers: {
          'Client-ID': TwitchService.CLIENT_ID,
          'Authorization': `Bearer ${this.accessToken}`
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

  public async startStream(title: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!TwitchService.CLIENT_ID) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    // This would be the implementation to start a stream
    // In reality, the user would need to use OBS or similar software
    // to send the stream to Twitch using their stream key
    console.log('Starting Twitch stream with title:', title);
  }

  public async stopStream(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }
    
    if (!TwitchService.CLIENT_ID) {
      throw new Error('Twitch CLIENT_ID is missing');
    }

    // This would be the implementation to stop a stream
    // In reality, the user would need to stop broadcasting from their software
    console.log('Stopping Twitch stream');
  }
}

export const twitchService = new TwitchService();
