
interface TwitchAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string[];
}

export class TwitchService {
  private static CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID || '';
  private static REDIRECT_URI = `${window.location.origin}/streaming`;
  private static API_BASE = 'https://api.twitch.tv/helix';
  
  private accessToken: string | null = null;
  
  constructor() {
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
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  public getLoginUrl(): string {
    const scopes = ['channel:read:stream_key', 'channel:manage:broadcast'];
    
    return `https://id.twitch.tv/oauth2/authorize?client_id=${TwitchService.CLIENT_ID}&redirect_uri=${encodeURIComponent(TwitchService.REDIRECT_URI)}&response_type=token&scope=${scopes.join(' ')}`;
  }

  public login(): void {
    const width = 600;
    const height = 700;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    const authWindow = window.open(
      this.getLoginUrl(),
      'Twitch Login',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    
    // Add a listener to detect when the popup is closed
    const checkClosed = setInterval(() => {
      if (authWindow?.closed) {
        clearInterval(checkClosed);
        // Check if we got a token after the popup was closed
        if (this.isAuthenticated()) {
          // Reload the page to refresh the state
          window.location.reload();
        }
      }
    }, 500);
  }

  public logout(): void {
    this.accessToken = null;
    localStorage.removeItem('twitch_access_token');
  }

  public async getStreamKey(): Promise<string> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
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

    // This would be the implementation to start a stream
    // In reality, the user would need to use OBS or similar software
    // to send the stream to Twitch using their stream key
    console.log('Starting Twitch stream with title:', title);
  }

  public async stopStream(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }

    // This would be the implementation to stop a stream
    // In reality, the user would need to stop broadcasting from their software
    console.log('Stopping Twitch stream');
  }
}

export const twitchService = new TwitchService();
