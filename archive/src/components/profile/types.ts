
export interface SocialLinks {
  twitter?: string;
  instagram?: string;
  linkedin?: string;
  github?: string;
}

export interface StreamingLinks {
  twitch?: string;
  youtube?: string;
  tiktok?: string;
}

export interface Achievement {
  id: string;
  achievement_type: string;
  earned_at: string;
  user_id?: string;
  achievement_data?: any;
}
