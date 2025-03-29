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
            skills: string[];
            interests: string[];
            expertise: string[];
          } | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
          ai_analysis?: {
            skills: string[];
            interests: string[];
            expertise: string[];
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
            skills: string[];
            interests: string[];
            expertise: string[];
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
          make: string;
          model: string;
          year: number;
          vin?: string;
          notes?: string;
          current_value?: number;
          status?: string;
          user_id?: string;
          created_at: string;
          updated_at: string;
          trim?: string;
          color?: string;
          mileage?: number;
          engine_type?: string;
          purchase_date?: string;
          purchase_location?: string;
          doors?: number;
          seats?: number;
          weight?: number;
          top_speed?: number;
          tags?: string[];
        };
        Insert: {
          id?: string;
          make: string;
          model: string;
          year: number;
          vin?: string;
          notes?: string;
          current_value?: number;
          status?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          trim?: string;
          color?: string;
          mileage?: number;
          engine_type?: string;
          purchase_date?: string;
          purchase_location?: string;
          doors?: number;
          seats?: number;
          weight?: number;
          top_speed?: number;
          tags?: string[];
        };
        Update: {
          id?: string;
          make?: string;
          model?: string;
          year?: number;
          vin?: string;
          notes?: string;
          current_value?: number;
          status?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          trim?: string;
          color?: string;
          mileage?: number;
          engine_type?: string;
          purchase_date?: string;
          purchase_location?: string;
          doors?: number;
          seats?: number;
          weight?: number;
          top_speed?: number;
          tags?: string[];
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
          metadata?: Record<string, unknown>;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          url: string;
          is_primary?: boolean;
          source: 'upload' | 'craigslist' | 'icloud';
          created_at?: string;
          metadata?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          url?: string;
          is_primary?: boolean;
          source?: 'upload' | 'craigslist' | 'icloud';
          created_at?: string;
          metadata?: Record<string, unknown>;
        };
      };
      tokens: {
        Row: {
          id: string;
          name: string;
          symbol: string;
          total_supply: number;
          metadata: Record<string, unknown>;
          contract_address: string;
          created_at: string;
          decimals: number;
          description: string;
          owner_id: string;
          status: string;
          updated_at: string;
          vehicle_id?: string;
          current_price?: number;
          image_url?: string;
        };
        Insert: {
          id?: string;
          name: string;
          symbol: string;
          total_supply: number;
          metadata: Record<string, unknown>;
          contract_address: string;
          created_at?: string;
          decimals: number;
          description: string;
          owner_id: string;
          status: string;
          updated_at?: string;
          vehicle_id?: string;
          current_price?: number;
          image_url?: string;
        };
        Update: {
          id?: string;
          name?: string;
          symbol?: string;
          total_supply?: number;
          metadata?: Record<string, unknown>;
          contract_address?: string;
          created_at?: string;
          decimals?: number;
          description?: string;
          owner_id?: string;
          status?: string;
          updated_at?: string;
          vehicle_id?: string;
          current_price?: number;
          image_url?: string;
        };
      };
      stakes: {
        Row: {
          id: string;
          user_id: string;
          token_id: string;
          vehicle_id: string;
          amount: number;
          start_date: string;
          end_date: string;
          status: 'active' | 'completed' | 'cancelled';
          predicted_roi: number;
          actual_roi?: number;
          created_at: string;
          vehicle_name?: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_id: string;
          vehicle_id: string;
          amount: number;
          start_date: string;
          end_date: string;
          status: 'active' | 'completed' | 'cancelled';
          predicted_roi: number;
          actual_roi?: number;
          created_at?: string;
          vehicle_name?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          token_id?: string;
          vehicle_id?: string;
          amount?: number;
          start_date?: string;
          end_date?: string;
          status?: 'active' | 'completed' | 'cancelled';
          predicted_roi?: number;
          actual_roi?: number;
          created_at?: string;
          vehicle_name?: string;
        };
      };
      staking_stats: {
        Row: {
          total_staked: number;
          total_predicted_roi: number;
          active_stakes: number;
          completed_stakes: number;
          avg_roi_percent: number;
          vehicle_count: number;
          distribution_by_vehicle?: {
            vehicle_name: string;
            amount: number;
            percentage: number;
          }[];
        };
        Insert: {
          total_staked: number;
          total_predicted_roi: number;
          active_stakes: number;
          completed_stakes: number;
          avg_roi_percent: number;
          vehicle_count: number;
          distribution_by_vehicle?: {
            vehicle_name: string;
            amount: number;
            percentage: number;
          }[];
        };
        Update: {
          total_staked?: number;
          total_predicted_roi?: number;
          active_stakes?: number;
          completed_stakes?: number;
          avg_roi_percent?: number;
          vehicle_count?: number;
          distribution_by_vehicle?: {
            vehicle_name: string;
            amount: number;
            percentage: number;
          }[];
        };
      };
    };
  };
}
