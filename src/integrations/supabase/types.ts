export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_actions: {
        Row: {
          action_data: Json
          action_type: string
          agent_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          status: string | null
        }
        Insert: {
          action_data: Json
          action_type: string
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          action_data?: Json
          action_type?: string
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          agent_type: string
          behavior_config: Json | null
          created_at: string | null
          id: string
          last_action_at: string | null
          metadata: Json | null
          name: string
          personality: string | null
          profile_id: string | null
          role: string
          status: string | null
        }
        Insert: {
          agent_type: string
          behavior_config?: Json | null
          created_at?: string | null
          id?: string
          last_action_at?: string | null
          metadata?: Json | null
          name: string
          personality?: string | null
          profile_id?: string | null
          role: string
          status?: string | null
        }
        Update: {
          agent_type?: string
          behavior_config?: Json | null
          created_at?: string | null
          id?: string
          last_action_at?: string | null
          metadata?: Json | null
          name?: string
          personality?: string | null
          profile_id?: string | null
          role?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      algorithm_preferences: {
        Row: {
          content_weights: Json | null
          created_at: string | null
          geographic_radius_km: number | null
          id: string
          market_alert_threshold: number | null
          notification_preferences: Json | null
          preferred_categories: string[] | null
          professional_interests: string[] | null
          technical_level_preference: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content_weights?: Json | null
          created_at?: string | null
          geographic_radius_km?: number | null
          id?: string
          market_alert_threshold?: number | null
          notification_preferences?: Json | null
          preferred_categories?: string[] | null
          professional_interests?: string[] | null
          technical_level_preference?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content_weights?: Json | null
          created_at?: string | null
          geographic_radius_km?: number | null
          id?: string
          market_alert_threshold?: number | null
          notification_preferences?: Json | null
          preferred_categories?: string[] | null
          professional_interests?: string[] | null
          technical_level_preference?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          ai_classification: Json | null
          asset_type: string | null
          bin: string | null
          building: string | null
          category: string | null
          condition: string | null
          created_at: string
          department: string | null
          floor: string | null
          id: string
          last_maintenance_date: string | null
          location: string | null
          manufacturer: string | null
          model_number: string | null
          name: string
          next_maintenance_date: string | null
          notes: string | null
          part_number: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          quantity: number
          room: string | null
          serial_number: string | null
          shelf: string | null
          sub_department: string | null
          updated_at: string
          user_id: string | null
          warranty_expiration: string | null
        }
        Insert: {
          ai_classification?: Json | null
          asset_type?: string | null
          bin?: string | null
          building?: string | null
          category?: string | null
          condition?: string | null
          created_at?: string
          department?: string | null
          floor?: string | null
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model_number?: string | null
          name: string
          next_maintenance_date?: string | null
          notes?: string | null
          part_number?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          quantity?: number
          room?: string | null
          serial_number?: string | null
          shelf?: string | null
          sub_department?: string | null
          updated_at?: string
          user_id?: string | null
          warranty_expiration?: string | null
        }
        Update: {
          ai_classification?: Json | null
          asset_type?: string | null
          bin?: string | null
          building?: string | null
          category?: string | null
          condition?: string | null
          created_at?: string
          department?: string | null
          floor?: string | null
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model_number?: string | null
          name?: string
          next_maintenance_date?: string | null
          notes?: string | null
          part_number?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          quantity?: number
          room?: string | null
          serial_number?: string | null
          shelf?: string | null
          sub_department?: string | null
          updated_at?: string
          user_id?: string | null
          warranty_expiration?: string | null
        }
        Relationships: []
      }
      auction_bids: {
        Row: {
          amount: number
          auction_id: string | null
          bidder_id: string | null
          created_at: string | null
          id: string
        }
        Insert: {
          amount: number
          auction_id?: string | null
          bidder_id?: string | null
          created_at?: string | null
          id?: string
        }
        Update: {
          amount?: number
          auction_id?: string | null
          bidder_id?: string | null
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_comments: {
        Row: {
          auction_id: string | null
          comment: string
          created_at: string | null
          id: string
          parent_comment_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auction_id?: string | null
          comment: string
          created_at?: string | null
          id?: string
          parent_comment_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auction_id?: string | null
          comment?: string
          created_at?: string | null
          id?: string
          parent_comment_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auction_comments_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "auction_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      auctions: {
        Row: {
          created_at: string | null
          current_price: number | null
          end_time: string
          id: string
          reserve_price: number | null
          seller_id: string | null
          start_time: string
          starting_price: number
          status: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_price?: number | null
          end_time: string
          id?: string
          reserve_price?: number | null
          seller_id?: string | null
          start_time: string
          starting_price: number
          status?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_price?: number | null
          end_time?: string
          id?: string
          reserve_price?: number | null
          seller_id?: string | null
          start_time?: string
          starting_price?: number
          status?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      automotive_locations: {
        Row: {
          contact_info: Json | null
          created_at: string
          id: string
          location: Json
          name: string
          rating: number | null
          type: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_info?: Json | null
          created_at?: string
          id?: string
          location: Json
          name: string
          rating?: number | null
          type: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_info?: Json | null
          created_at?: string
          id?: string
          location?: Json
          name?: string
          rating?: number | null
          type?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      certifications: {
        Row: {
          created_at: string
          description: string | null
          id: string
          issuing_authority: string
          name: string
          required_skills: string[] | null
          updated_at: string
          validity_period: unknown | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          issuing_authority: string
          name: string
          required_skills?: string[] | null
          updated_at?: string
          validity_period?: unknown | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          issuing_authority?: string
          name?: string
          required_skills?: string[] | null
          updated_at?: string
          validity_period?: unknown | null
        }
        Relationships: []
      }
      content_analytics: {
        Row: {
          content_id: string | null
          created_at: string
          engagement_metrics: Json | null
          id: string
          platform_metrics: Json | null
          updated_at: string
          views: number | null
        }
        Insert: {
          content_id?: string | null
          created_at?: string
          engagement_metrics?: Json | null
          id?: string
          platform_metrics?: Json | null
          updated_at?: string
          views?: number | null
        }
        Update: {
          content_id?: string | null
          created_at?: string
          engagement_metrics?: Json | null
          id?: string
          platform_metrics?: Json | null
          updated_at?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_analytics_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      content_schedules: {
        Row: {
          content_type: string
          created_at: string
          distribution_channels: Json | null
          id: string
          metadata: Json | null
          scheduled_time: string
          status: string | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          content_type: string
          created_at?: string
          distribution_channels?: Json | null
          id?: string
          metadata?: Json | null
          scheduled_time: string
          status?: string | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string
          distribution_channels?: Json | null
          id?: string
          metadata?: Json | null
          scheduled_time?: string
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      dao_proposals: {
        Row: {
          created_at: string | null
          description: string
          end_time: string
          id: string
          proposer_id: string | null
          start_time: string
          status: string | null
          title: string
          updated_at: string | null
          votes_against: number | null
          votes_for: number | null
        }
        Insert: {
          created_at?: string | null
          description: string
          end_time: string
          id?: string
          proposer_id?: string | null
          start_time: string
          status?: string | null
          title: string
          updated_at?: string | null
          votes_against?: number | null
          votes_for?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string
          end_time?: string
          id?: string
          proposer_id?: string | null
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          votes_against?: number | null
          votes_for?: number | null
        }
        Relationships: []
      }
      dao_votes: {
        Row: {
          created_at: string | null
          id: string
          proposal_id: string | null
          user_id: string | null
          vote_type: string
          voting_power: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          proposal_id?: string | null
          user_id?: string | null
          vote_type: string
          voting_power?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          proposal_id?: string | null
          user_id?: string | null
          vote_type?: string
          voting_power?: number
        }
        Relationships: [
          {
            foreignKeyName: "dao_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "dao_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      derivatives: {
        Row: {
          created_at: string | null
          current_price: number | null
          expiration_date: string | null
          id: string
          status: string | null
          strike_price: number | null
          type: string
          updated_at: string | null
          vehicle_token_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_price?: number | null
          expiration_date?: string | null
          id?: string
          status?: string | null
          strike_price?: number | null
          type: string
          updated_at?: string | null
          vehicle_token_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_price?: number | null
          expiration_date?: string | null
          id?: string
          status?: string | null
          strike_price?: number | null
          type?: string
          updated_at?: string | null
          vehicle_token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "derivatives_vehicle_token_id_fkey"
            columns: ["vehicle_token_id"]
            isOneToOne: false
            referencedRelation: "vehicle_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      development_goals: {
        Row: {
          ai_recommendations: Json | null
          created_at: string | null
          description: string | null
          id: string
          status: string | null
          target_date: string | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ai_recommendations?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string | null
          target_date?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ai_recommendations?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string | null
          target_date?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "development_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_metrics: {
        Row: {
          created_at: string | null
          feed_item_id: string
          id: string
          interaction_type: string
          interaction_weight: number | null
          user_id: string
          view_duration_seconds: number | null
        }
        Insert: {
          created_at?: string | null
          feed_item_id: string
          id?: string
          interaction_type: string
          interaction_weight?: number | null
          user_id: string
          view_duration_seconds?: number | null
        }
        Update: {
          created_at?: string | null
          feed_item_id?: string
          id?: string
          interaction_type?: string
          interaction_weight?: number | null
          user_id?: string
          view_duration_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_metrics_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_interactions: {
        Row: {
          amount: number | null
          content: string | null
          created_at: string | null
          feed_item_id: string | null
          id: string
          interaction_type: string
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          content?: string | null
          created_at?: string | null
          feed_item_id?: string | null
          id?: string
          interaction_type: string
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          content?: string | null
          created_at?: string | null
          feed_item_id?: string | null
          id?: string
          interaction_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_interactions_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_items: {
        Row: {
          content: string | null
          created_at: string | null
          expiration_time: string | null
          geographic_relevance: Json | null
          id: string
          importance: Database["public"]["Enums"]["feed_importance"] | null
          item_id: string
          item_type: string
          market_impact_score: number | null
          metadata: Json | null
          relevance_score: number | null
          technical_level: number | null
          trending_score: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          expiration_time?: string | null
          geographic_relevance?: Json | null
          id?: string
          importance?: Database["public"]["Enums"]["feed_importance"] | null
          item_id: string
          item_type: string
          market_impact_score?: number | null
          metadata?: Json | null
          relevance_score?: number | null
          technical_level?: number | null
          trending_score?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          expiration_time?: string | null
          geographic_relevance?: Json | null
          id?: string
          importance?: Database["public"]["Enums"]["feed_importance"] | null
          item_id?: string
          item_type?: string
          market_impact_score?: number | null
          metadata?: Json | null
          relevance_score?: number | null
          technical_level?: number | null
          trending_score?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      garage_members: {
        Row: {
          created_at: string
          garage_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          garage_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          garage_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garage_members_garage_id_fkey"
            columns: ["garage_id"]
            isOneToOne: false
            referencedRelation: "garages"
            referencedColumns: ["id"]
          },
        ]
      }
      garages: {
        Row: {
          address: string | null
          created_at: string
          google_place_id: string | null
          id: string
          location: Json | null
          name: string
          rating: number | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          google_place_id?: string | null
          id?: string
          location?: Json | null
          name: string
          rating?: number | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          google_place_id?: string | null
          id?: string
          location?: Json | null
          name?: string
          rating?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      governance_proposals: {
        Row: {
          created_at: string
          creator_id: string | null
          description: string
          end_date: string
          id: string
          metadata: Json | null
          required_votes: number | null
          start_date: string
          status: string | null
          title: string
          token_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id?: string | null
          description: string
          end_date: string
          id?: string
          metadata?: Json | null
          required_votes?: number | null
          start_date: string
          status?: string | null
          title: string
          token_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string | null
          description?: string
          end_date?: string
          id?: string
          metadata?: Json | null
          required_votes?: number | null
          start_date?: string
          status?: string | null
          title?: string
          token_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_proposals_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          integration_id: string | null
          integration_source: string | null
          last_ordered_at: string | null
          location: string | null
          manufacturer: string | null
          metadata: Json | null
          name: string
          quantity_in_stock: number
          reorder_point: number | null
          sku: string | null
          status: string | null
          supplier_id: string | null
          unit_price: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          integration_id?: string | null
          integration_source?: string | null
          last_ordered_at?: string | null
          location?: string | null
          manufacturer?: string | null
          metadata?: Json | null
          name: string
          quantity_in_stock?: number
          reorder_point?: number | null
          sku?: string | null
          status?: string | null
          supplier_id?: string | null
          unit_price?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          integration_id?: string | null
          integration_source?: string | null
          last_ordered_at?: string | null
          location?: string | null
          manufacturer?: string | null
          metadata?: Json | null
          name?: string
          quantity_in_stock?: number
          reorder_point?: number | null
          sku?: string | null
          status?: string | null
          supplier_id?: string | null
          unit_price?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      live_streams: {
        Row: {
          created_at: string | null
          description: string | null
          ended_at: string | null
          id: string
          settings: Json | null
          started_at: string | null
          status: string | null
          stream_key: string | null
          title: string
          updated_at: string | null
          user_id: string
          viewer_count: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          ended_at?: string | null
          id?: string
          settings?: Json | null
          started_at?: string | null
          status?: string | null
          stream_key?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          viewer_count?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          ended_at?: string | null
          id?: string
          settings?: Json | null
          started_at?: string | null
          status?: string | null
          stream_key?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          viewer_count?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          home_location: Json | null
          id: string
          last_name: string | null
          onboarding_completed: boolean | null
          onboarding_step: number | null
          reputation_score: number | null
          skills: string[] | null
          social_links: Json | null
          streaming_links: Json | null
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"] | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          home_location?: Json | null
          id: string
          last_name?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          reputation_score?: number | null
          skills?: string[] | null
          social_links?: Json | null
          streaming_links?: Json | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"] | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          home_location?: Json | null
          id?: string
          last_name?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          reputation_score?: number | null
          skills?: string[] | null
          social_links?: Json | null
          streaming_links?: Json | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"] | null
          username?: string | null
        }
        Relationships: []
      }
      project_collaborators: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string | null
          project_id: string
          status: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string | null
          project_id: string
          status?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string | null
          project_id?: string
          status?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          project_id: string
          update_type: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id: string
          update_type: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string
          update_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_completion_date: string | null
          budget: number | null
          client_data: Json | null
          created_at: string
          current_spend: number | null
          description: string | null
          id: string
          metadata: Json | null
          priority: string | null
          social_media_schedule: Json | null
          sponsorship_data: Json | null
          start_date: string | null
          status: string | null
          target_completion_date: string | null
          title: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_completion_date?: string | null
          budget?: number | null
          client_data?: Json | null
          created_at?: string
          current_spend?: number | null
          description?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          social_media_schedule?: Json | null
          sponsorship_data?: Json | null
          start_date?: string | null
          status?: string | null
          target_completion_date?: string | null
          title: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_completion_date?: string | null
          budget?: number | null
          client_data?: Json | null
          created_at?: string
          current_spend?: number | null
          description?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          social_media_schedule?: Json | null
          sponsorship_data?: Json | null
          start_date?: string | null
          status?: string | null
          target_completion_date?: string | null
          title?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_votes: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          proposal_id: string | null
          vote_amount: number
          vote_type: string
          voter_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          proposal_id?: string | null
          vote_amount: number
          vote_type: string
          voter_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          proposal_id?: string | null
          vote_amount?: number
          vote_type?: string
          voter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "governance_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tickets: {
        Row: {
          completion_date: string | null
          created_at: string
          description: string
          diagnostic_results: string | null
          id: string
          labor_hours: number | null
          parts_used: Json | null
          priority: string
          service_date: string | null
          service_type: Database["public"]["Enums"]["service_type"] | null
          status: string
          technician_notes: string | null
          updated_at: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          completion_date?: string | null
          created_at?: string
          description: string
          diagnostic_results?: string | null
          id?: string
          labor_hours?: number | null
          parts_used?: Json | null
          priority?: string
          service_date?: string | null
          service_type?: Database["public"]["Enums"]["service_type"] | null
          status?: string
          technician_notes?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          completion_date?: string | null
          created_at?: string
          description?: string
          diagnostic_results?: string | null
          id?: string
          labor_hours?: number | null
          parts_used?: Json | null
          priority?: string
          service_date?: string | null
          service_type?: Database["public"]["Enums"]["service_type"] | null
          status?: string
          technician_notes?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_tickets_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: Database["public"]["Enums"]["skill_category"]
          created_at: string
          description: string | null
          id: string
          name: string
          prerequisites: string[] | null
        }
        Insert: {
          category: Database["public"]["Enums"]["skill_category"]
          created_at?: string
          description?: string | null
          id?: string
          name: string
          prerequisites?: string[] | null
        }
        Update: {
          category?: Database["public"]["Enums"]["skill_category"]
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          prerequisites?: string[] | null
        }
        Relationships: []
      }
      stream_comments: {
        Row: {
          created_at: string | null
          id: string
          message: string
          stream_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          stream_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          stream_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_comments_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "live_streams"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_tips: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          message: string | null
          recipient_id: string
          sender_id: string
          stream_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          message?: string | null
          recipient_id: string
          sender_id: string
          stream_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          message?: string | null
          recipient_id?: string
          sender_id?: string
          stream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_tips_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "live_streams"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_configurations: {
        Row: {
          audio_config: Json | null
          camera_config: Json | null
          created_at: string
          fixed_cameras: Json | null
          id: string
          lighting_config: Json | null
          name: string
          ptz_configurations: Json | null
          updated_at: string
          user_id: string | null
          workspace_dimensions: Json | null
        }
        Insert: {
          audio_config?: Json | null
          camera_config?: Json | null
          created_at?: string
          fixed_cameras?: Json | null
          id?: string
          lighting_config?: Json | null
          name: string
          ptz_configurations?: Json | null
          updated_at?: string
          user_id?: string | null
          workspace_dimensions?: Json | null
        }
        Update: {
          audio_config?: Json | null
          camera_config?: Json | null
          created_at?: string
          fixed_cameras?: Json | null
          id?: string
          lighting_config?: Json | null
          name?: string
          ptz_configurations?: Json | null
          updated_at?: string
          user_id?: string | null
          workspace_dimensions?: Json | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          api_credentials: Json | null
          contact_info: Json | null
          created_at: string
          id: string
          integration_type: string | null
          name: string
          status: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          api_credentials?: Json | null
          contact_info?: Json | null
          created_at?: string
          id?: string
          integration_type?: string | null
          name: string
          status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          api_credentials?: Json | null
          contact_info?: Json | null
          created_at?: string
          id?: string
          integration_type?: string | null
          name?: string
          status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string | null
          department: string | null
          end_date: string | null
          id: string
          member_type: Database["public"]["Enums"]["team_member_type"]
          position: string | null
          profile_id: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          end_date?: string | null
          id?: string
          member_type: Database["public"]["Enums"]["team_member_type"]
          position?: string | null
          profile_id?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          end_date?: string | null
          id?: string
          member_type?: Database["public"]["Enums"]["team_member_type"]
          position?: string | null
          profile_id?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      token_analytics: {
        Row: {
          created_at: string
          id: string
          market_cap: number | null
          price_usd: number | null
          timestamp: string
          token_id: string | null
          volume_24h: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          market_cap?: number | null
          price_usd?: number | null
          timestamp?: string
          token_id?: string | null
          volume_24h?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          market_cap?: number | null
          price_usd?: number | null
          timestamp?: string
          token_id?: string | null
          volume_24h?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "token_analytics_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      token_holdings: {
        Row: {
          balance: number
          created_at: string | null
          id: string
          last_transaction_at: string | null
          token_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          balance?: number
          created_at?: string | null
          id?: string
          last_transaction_at?: string | null
          token_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          balance?: number
          created_at?: string | null
          id?: string
          last_transaction_at?: string | null
          token_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_holdings_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "token_management"
            referencedColumns: ["id"]
          },
        ]
      }
      token_management: {
        Row: {
          contract_address: string | null
          created_at: string
          decimals: number
          id: string
          metadata: Json | null
          network: string
          token_name: string
          token_symbol: string
          token_type: string
          total_supply: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          contract_address?: string | null
          created_at?: string
          decimals?: number
          id?: string
          metadata?: Json | null
          network?: string
          token_name: string
          token_symbol: string
          token_type?: string
          total_supply?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          contract_address?: string | null
          created_at?: string
          decimals?: number
          id?: string
          metadata?: Json | null
          network?: string
          token_name?: string
          token_symbol?: string
          token_type?: string
          total_supply?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      token_transactions: {
        Row: {
          amount: number
          created_at: string
          from_address: string | null
          id: string
          metadata: Json | null
          status: string | null
          to_address: string | null
          token_id: string | null
          transaction_hash: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          from_address?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          to_address?: string | null
          token_id?: string | null
          transaction_hash?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          from_address?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          to_address?: string | null
          token_id?: string | null
          transaction_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_transactions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          contract_address: string | null
          created_at: string
          decimals: number
          description: string | null
          id: string
          metadata: Json | null
          name: string
          owner_id: string | null
          status: string | null
          symbol: string
          total_supply: number
          updated_at: string
        }
        Insert: {
          contract_address?: string | null
          created_at?: string
          decimals?: number
          description?: string | null
          id?: string
          metadata?: Json | null
          name: string
          owner_id?: string | null
          status?: string | null
          symbol: string
          total_supply: number
          updated_at?: string
        }
        Update: {
          contract_address?: string | null
          created_at?: string
          decimals?: number
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          owner_id?: string | null
          status?: string | null
          symbol?: string
          total_supply?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_data: Json | null
          achievement_type: string
          earned_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          achievement_data?: Json | null
          achievement_type: string
          earned_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          achievement_data?: Json | null
          achievement_type?: string
          earned_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_certifications: {
        Row: {
          certification_id: string | null
          completed_at: string | null
          created_at: string
          evidence_urls: string[] | null
          expires_at: string | null
          id: string
          started_at: string | null
          status: Database["public"]["Enums"]["certification_status"] | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          certification_id?: string | null
          completed_at?: string | null
          created_at?: string
          evidence_urls?: string[] | null
          expires_at?: string | null
          id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["certification_status"] | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          certification_id?: string | null
          completed_at?: string | null
          created_at?: string
          evidence_urls?: string[] | null
          expires_at?: string | null
          id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["certification_status"] | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_certifications_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_certifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_interactions: {
        Row: {
          created_at: string
          id: string
          interaction_data: Json | null
          interaction_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_data?: Json | null
          interaction_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          interaction_data?: Json | null
          interaction_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          auto_save_enabled: boolean | null
          compact_view_enabled: boolean | null
          created_at: string
          id: string
          notifications_enabled: boolean | null
          theme: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          auto_save_enabled?: boolean | null
          compact_view_enabled?: boolean | null
          created_at?: string
          id?: string
          notifications_enabled?: boolean | null
          theme?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          auto_save_enabled?: boolean | null
          compact_view_enabled?: boolean | null
          created_at?: string
          id?: string
          notifications_enabled?: boolean | null
          theme?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_skills: {
        Row: {
          completed_at: string | null
          created_at: string
          experience_points: number | null
          id: string
          level: number | null
          skill_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          experience_points?: number | null
          id?: string
          level?: number | null
          skill_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          experience_points?: number | null
          id?: string
          level?: number | null
          skill_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_skills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_probability_zones: {
        Row: {
          confidence_level: number
          created_at: string | null
          data_sources: Json
          estimated_count: number
          id: string
          last_updated: string | null
          location_bounds: Json
          metadata: Json | null
          probability_score: number
          search_query: string
          vehicle_type: string
          year_range: unknown | null
        }
        Insert: {
          confidence_level: number
          created_at?: string | null
          data_sources: Json
          estimated_count: number
          id?: string
          last_updated?: string | null
          location_bounds: Json
          metadata?: Json | null
          probability_score: number
          search_query: string
          vehicle_type: string
          year_range?: unknown | null
        }
        Update: {
          confidence_level?: number
          created_at?: string | null
          data_sources?: Json
          estimated_count?: number
          id?: string
          last_updated?: string | null
          location_bounds?: Json
          metadata?: Json | null
          probability_score?: number
          search_query?: string
          vehicle_type?: string
          year_range?: unknown | null
        }
        Relationships: []
      }
      vehicle_sales_data: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          listing_url: string | null
          metadata: Json | null
          sale_date: string | null
          sale_price: number | null
          source: string
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          listing_url?: string | null
          metadata?: Json | null
          sale_date?: string | null
          sale_price?: number | null
          source: string
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          listing_url?: string | null
          metadata?: Json | null
          sale_date?: string | null
          sale_price?: number | null
          source?: string
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_sales_data_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_tokens: {
        Row: {
          contract_uri: string | null
          created_at: string | null
          current_price: number | null
          id: string
          metadata: Json | null
          token_address: string
          total_supply: number
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          contract_uri?: string | null
          created_at?: string | null
          current_price?: number | null
          id?: string
          metadata?: Json | null
          token_address: string
          total_supply: number
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          contract_uri?: string | null
          created_at?: string | null
          current_price?: number | null
          id?: string
          metadata?: Json | null
          token_address?: string
          total_supply?: number
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_tokens_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          bulk_upload_batch_id: string | null
          created_at: string
          historical_data: Json | null
          id: string
          location: Json | null
          make: string
          model: string
          notes: string | null
          source: string | null
          source_url: string | null
          status: string | null
          updated_at: string
          user_id: string | null
          vin: string | null
          vin_image_url: string | null
          vin_processing_status: string | null
          vin_verification_data: Json | null
          year: number
        }
        Insert: {
          bulk_upload_batch_id?: string | null
          created_at?: string
          historical_data?: Json | null
          id?: string
          location?: Json | null
          make: string
          model: string
          notes?: string | null
          source?: string | null
          source_url?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string | null
          vin?: string | null
          vin_image_url?: string | null
          vin_processing_status?: string | null
          vin_verification_data?: Json | null
          year: number
        }
        Update: {
          bulk_upload_batch_id?: string | null
          created_at?: string
          historical_data?: Json | null
          id?: string
          location?: Json | null
          make?: string
          model?: string
          notes?: string | null
          source?: string | null
          source_url?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string | null
          vin?: string | null
          vin_image_url?: string | null
          vin_processing_status?: string | null
          vin_verification_data?: Json | null
          year?: number
        }
        Relationships: []
      }
      verified_locations: {
        Row: {
          approved_by: string | null
          bin: string | null
          building: string | null
          created_at: string
          created_by: string | null
          floor: string | null
          id: string
          room: string | null
          shelf: string | null
          status: Database["public"]["Enums"]["location_status"] | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          bin?: string | null
          building?: string | null
          created_at?: string
          created_by?: string | null
          floor?: string | null
          id?: string
          room?: string | null
          shelf?: string | null
          status?: Database["public"]["Enums"]["location_status"] | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          bin?: string | null
          building?: string | null
          created_at?: string
          created_by?: string | null
          floor?: string | null
          id?: string
          room?: string | null
          shelf?: string | null
          status?: Database["public"]["Enums"]["location_status"] | null
          updated_at?: string
        }
        Relationships: []
      }
      vin_processing_jobs: {
        Row: {
          batch_data: Json | null
          created_at: string
          failed_vins: number
          id: string
          processed_vins: number
          status: string
          total_vins: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          batch_data?: Json | null
          created_at?: string
          failed_vins?: number
          id?: string
          processed_vins?: number
          status?: string
          total_vins?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          batch_data?: Json | null
          created_at?: string
          failed_vins?: number
          id?: string
          processed_vins?: number
          status?: string
          total_vins?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cube:
        | {
            Args: {
              "": number[]
            }
            Returns: unknown
          }
        | {
            Args: {
              "": number
            }
            Returns: unknown
          }
      cube_dim: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      cube_in: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      cube_is_point: {
        Args: {
          "": unknown
        }
        Returns: boolean
      }
      cube_out: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      cube_recv: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      cube_send: {
        Args: {
          "": unknown
        }
        Returns: string
      }
      cube_size: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      earth: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      gc_to_sec: {
        Args: {
          "": number
        }
        Returns: number
      }
      has_role: {
        Args: {
          role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      latitude: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      longitude: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      sec_to_gc: {
        Args: {
          "": number
        }
        Returns: number
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "system_admin"
        | "business_admin"
        | "moderator"
        | "expert"
        | "dealer"
        | "professional"
        | "garage_admin"
      certification_status: "pending" | "in_progress" | "completed" | "expired"
      feed_importance: "low" | "medium" | "high" | "urgent"
      location_status: "pending" | "approved" | "rejected"
      service_type:
        | "routine_maintenance"
        | "repair"
        | "inspection"
        | "modification"
        | "emergency"
        | "recall"
      skill_category:
        | "mechanical"
        | "electrical"
        | "bodywork"
        | "diagnostics"
        | "restoration"
        | "customization"
      team_member_type:
        | "employee"
        | "contractor"
        | "intern"
        | "partner"
        | "collaborator"
      user_type: "viewer" | "professional"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
