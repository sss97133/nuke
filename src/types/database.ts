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
      content_interactions: {
        Row: {
          id: string;
          content_id: string;
          user_id: string;
          interaction_type: 'view' | 'like' | 'share' | 'save';
          content_type: string;
          interaction_time: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          content_id: string;
          user_id: string;
          interaction_type: 'view' | 'like' | 'share' | 'save';
          content_type: string;
          interaction_time: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          content_id?: string;
          user_id?: string;
          interaction_type?: 'view' | 'like' | 'share' | 'save';
          content_type?: string;
          interaction_time?: string;
          created_at?: string;
        };
      };
      auctions: {
        Row: {
          id: string;
          vehicle_id: string;
          seller_id: string;
          starting_price: number;
          current_price: number;
          end_time: string;
          status: 'active' | 'ended' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          seller_id: string;
          starting_price: number;
          current_price: number;
          end_time: string;
          status: 'active' | 'ended' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          seller_id?: string;
          starting_price?: number;
          current_price?: number;
          end_time?: string;
          status?: 'active' | 'ended' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
      };
      live_streams: {
        Row: {
          id: string;
          title: string;
          description: string;
          stream_url: string;
          thumbnail_url: string;
          viewer_count: number;
          user_id: string;
          status: 'live' | 'ended' | 'scheduled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          stream_url: string;
          thumbnail_url: string;
          viewer_count: number;
          user_id: string;
          status: 'live' | 'ended' | 'scheduled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          stream_url?: string;
          thumbnail_url?: string;
          viewer_count?: number;
          user_id?: string;
          status?: 'live' | 'ended' | 'scheduled';
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicles: {
        Row: {
          id: string;
          user_id: string;
          make: string;
          model: string;
          year: number;
          vin?: string;
          color?: string;
          purchase_date?: string;
          purchase_price?: number;
          current_value?: number;
          mileage?: number;
          condition?: string;
          location?: string;
          license_plate?: string;
          insurance_policy?: string;
          notes?: string;
          status: 'active' | 'inactive' | 'maintenance' | 'sold';
          created_at: string;
          updated_at: string;
          collection_id?: string;
          is_discovered: boolean;
          source?: string; // e.g., 'craigslist', 'manual', 'import'
          source_url?: string;
          source_data?: Record<string, any>;
        };
        Insert: {
          id?: string;
          user_id: string;
          make: string;
          model: string;
          year: number;
          vin?: string;
          color?: string;
          purchase_date?: string;
          purchase_price?: number;
          current_value?: number;
          mileage?: number;
          condition?: string;
          location?: string;
          license_plate?: string;
          insurance_policy?: string;
          notes?: string;
          status?: 'active' | 'inactive' | 'maintenance' | 'sold';
          created_at?: string;
          updated_at?: string;
          collection_id?: string;
          is_discovered?: boolean;
          source?: string;
          source_url?: string;
          source_data?: Record<string, any>;
        };
        Update: {
          id?: string;
          user_id?: string;
          make?: string;
          model?: string;
          year?: number;
          vin?: string;
          color?: string;
          purchase_date?: string;
          purchase_price?: number;
          current_value?: number;
          mileage?: number;
          condition?: string;
          location?: string;
          license_plate?: string;
          insurance_policy?: string;
          notes?: string;
          status?: 'active' | 'inactive' | 'maintenance' | 'sold';
          created_at?: string;
          updated_at?: string;
          collection_id?: string;
          is_discovered?: boolean;
          source?: string;
          source_url?: string;
          source_data?: Record<string, any>;
        };
      };
      vehicle_collections: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description?: string;
          created_at: string;
          updated_at: string;
          is_private: boolean;
          tags: string[];
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string;
          created_at?: string;
          updated_at?: string;
          is_private?: boolean;
          tags?: string[];
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string;
          created_at?: string;
          updated_at?: string;
          is_private?: boolean;
          tags?: string[];
        };
      };
      vehicle_shop_associations: {
        Row: {
          id: string;
          vehicle_id: string;
          shop_id: string;
          role: 'owner' | 'service' | 'storage' | 'custom';
          notes?: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          shop_id: string;
          role: 'owner' | 'service' | 'storage' | 'custom';
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          shop_id?: string;
          role?: 'owner' | 'service' | 'storage' | 'custom';
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicle_images: {
        Row: {
          id: string;
          vehicle_id: string;
          url: string;
          is_primary: boolean;
          source: 'upload' | 'craigslist' | 'icloud';
          created_at: string;
          metadata?: Record<string, any>;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          url: string;
          is_primary?: boolean;
          source: 'upload' | 'craigslist' | 'icloud';
          created_at?: string;
          metadata?: Record<string, any>;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          url?: string;
          is_primary?: boolean;
          source?: 'upload' | 'craigslist' | 'icloud';
          created_at?: string;
          metadata?: Record<string, any>;
        };
      };
    };
  };
}
