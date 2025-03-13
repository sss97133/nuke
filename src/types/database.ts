export interface Database {
  public: {
    Tables: {
      engagement_metrics: {
        Row: {
          id: string;
          user_id: string;
          content_id: string;
          content_type: string;
          interaction_type: string;
          interaction_weight: number;
          view_duration_seconds: number;
          interaction_time: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content_id: string;
          content_type: string;
          interaction_type: string;
          interaction_weight: number;
          view_duration_seconds: number;
          interaction_time?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          content_id?: string;
          content_type?: string;
          interaction_type?: string;
          interaction_weight?: number;
          view_duration_seconds?: number;
          interaction_time?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
          ai_analysis: {
            interests: string[];
            skills: string[];
            achievements: string[];
            engagement_patterns: {
              content_type: string;
              interaction_count: number;
            }[];
          } | null;
        };
        Insert: {
          id?: string;
          email: string;
          full_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
          ai_analysis?: {
            interests: string[];
            skills: string[];
            achievements: string[];
            engagement_patterns: {
              content_type: string;
              interaction_count: number;
            }[];
          } | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
          ai_analysis?: {
            interests: string[];
            skills: string[];
            achievements: string[];
            engagement_patterns: {
              content_type: string;
              interaction_count: number;
            }[];
          } | null;
        };
      };
      achievements: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          category: string;
          skills: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description: string;
          category: string;
          skills: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string;
          category?: string;
          skills?: string[];
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
