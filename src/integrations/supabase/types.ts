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
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory: {
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          reputation_score: number | null
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"] | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          reputation_score?: number | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"] | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          reputation_score?: number | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"] | null
          username?: string | null
        }
        Relationships: []
      }
      service_tickets: {
        Row: {
          created_at: string
          description: string
          id: string
          priority: string
          status: string
          updated_at: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          priority?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          priority?: string
          status?: string
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
      vehicles: {
        Row: {
          bulk_upload_batch_id: string | null
          created_at: string
          historical_data: Json | null
          id: string
          make: string
          model: string
          notes: string | null
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
          make: string
          model: string
          notes?: string | null
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
          make?: string
          model?: string
          notes?: string | null
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
      has_role: {
        Args: {
          role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
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
      skill_category:
        | "mechanical"
        | "electrical"
        | "bodywork"
        | "diagnostics"
        | "restoration"
        | "customization"
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
