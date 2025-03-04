
// Add these missing exports to fix the Twitch service errors

export const fetchTwitchStreams = async () => {
  // This would normally call the Twitch API
  // For now, return mock data
  return [];
};

export const fetchLiveStreams = async () => {
  // This would normally call the Twitch API
  // For now, return mock data
  return [];
};

export const getUserInfo = async () => {
  // This would normally call the Twitch API to get user info
  // For now, return mock data
  return {
    id: 'mock-user-id',
    login: 'mockuser',
    display_name: 'Mock User',
    profile_image_url: 'https://placehold.co/64'
  };
};
