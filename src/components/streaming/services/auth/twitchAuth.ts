
import { TwitchServiceConfig } from "../types";

export class TwitchAuth {
  private accessToken: string | null = null;
  private authWindow: Window | null = null;
  private authCheckInterval: number | null = null;
  private config: TwitchServiceConfig;
  
  constructor(config: TwitchServiceConfig) {
    this.config = config;
    
    // Check if we have a token in localStorage
    this.accessToken = localStorage.getItem('twitch_access_token');
    
    // Check if we just got redirected from Twitch OAuth
    this.checkForRedirectToken();
    
    // Listen for messages from popup window
    window.addEventListener('message', this.handleAuthMessage);
  }

  private checkForRedirectToken(): void {
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
  }

  private handleAuthMessage = (event: MessageEvent): void => {
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
    if (!this.config.clientId) {
      console.error('Cannot generate login URL: Twitch CLIENT_ID is missing!');
      return '#';
    }
    
    // Add console log to help debug the login URL
    console.log('Using Twitch Client ID:', this.config.clientId);
    console.log('Using redirect URI:', this.config.redirectUri);
    
    const scopes = ['channel:read:stream_key', 'channel:manage:broadcast'];
    
    const loginUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(this.config.redirectUri)}&response_type=token&scope=${scopes.join(' ')}`;
    console.log('Generated login URL:', loginUrl);
    
    return loginUrl;
  }

  public login(): void {
    // Validate client ID is present
    if (!this.config.clientId) {
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
  
  public getToken(): string | null {
    return this.accessToken;
  }
}
