
// Twitch API response types and service interfaces

export interface TwitchUserData {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

export interface StreamMetadata {
  id: string;
  title: string;
  user_name: string;
  user_login: string;
  game_name: string;
  viewer_count: number;
  thumbnail_url: string;
  started_at: string;
  tags: string[];
}

export type ContentType = 'stream' | 'post' | 'video' | 'article';
