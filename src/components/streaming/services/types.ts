export interface TwitchAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string[];
}

export interface TwitchUserData {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
  email?: string;
}

export interface TwitchStreamData {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tags?: string[];
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
  tags?: string[];
}

export interface TwitchChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: string;
  color?: string;
  badges?: Record<string, string>;
  isAction?: boolean;
  isHighlighted?: boolean;
}
