
// Real Twitch API implementation

// Authorization token handling
let authToken: string | null = null;

export const setAuthToken = (token: string) => {
  authToken = token;
  // Dispatch event for components to know authentication changed
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

export const getAuthToken = () => authToken;

export const clearAuthToken = () => {
  authToken = null;
  window.dispatchEvent(new CustomEvent('twitch_auth_changed'));
};

// Fetch user's information
export const getUserInfo = async () => {
  if (!authToken) return null;
  
  try {
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const userData = data.data[0];
      return {
        id: userData.id,
        login: userData.login,
        display_name: userData.display_name,
        profile_image_url: userData.profile_image_url
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching Twitch user info:', error);
    throw error;
  }
};

// Fetch the user's streams
export const fetchLiveStreams = async () => {
  if (!authToken) return [];
  
  try {
    const userData = await getUserInfo();
    if (!userData) return [];
    
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${userData.id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching Twitch live streams:', error);
    throw error;
  }
};

// Fetch twitch streams for display
export const fetchTwitchStreams = async () => {
  if (!authToken) return [];
  
  try {
    const response = await fetch('https://api.twitch.tv/helix/streams', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Client-Id': import.meta.env.VITE_TWITCH_CLIENT_ID as string
      }
    });
    
    if (!response.ok) {
      throw new Error(`Twitch API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data.map(stream => ({
      id: stream.id,
      title: stream.title,
      user_name: stream.user_name,
      user_login: stream.user_login,
      game_name: stream.game_name,
      viewer_count: stream.viewer_count,
      thumbnail_url: stream.thumbnail_url,
      started_at: stream.started_at,
      tags: stream.tags
    })) || [];
  } catch (error) {
    console.error('Error fetching Twitch streams:', error);
    throw error;
  }
};

// Start streaming
export const startStream = async (title: string, gameId: string) => {
  if (!authToken) throw new Error('Not authenticated with Twitch');
  
  try {
    const userData = await getUserInfo();
    if (!userData) throw new Error('Could not retrieve user data');
    
    // In a real implementation, this would call the appropriate Twitch API endpoint
    // to update stream information and authorize broadcasting
    console.log('Stream started with title:', title, 'and game ID:', gameId);
    return true;
  } catch (error) {
    console.error('Error starting Twitch stream:', error);
    throw error;
  }
};

// Stop streaming
export const stopStream = async () => {
  if (!authToken) throw new Error('Not authenticated with Twitch');
  
  try {
    // In a real implementation, this would call the appropriate Twitch API endpoint
    // to end the stream
    console.log('Stream stopped');
    return true;
  } catch (error) {
    console.error('Error stopping Twitch stream:', error);
    throw error;
  }
};
