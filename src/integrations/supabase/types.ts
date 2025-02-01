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
      vehicles: {
        Row: {
          created_at: string
          id: string
          make: string
          model: string
          notes: string | null
          updated_at: string
          user_id: string | null
          vin: string | null
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          make: string
          model: string
          notes?: string | null
          updated_at?: string
          user_id?: string | null
          vin?: string | null
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          make?: string
          model?: string
          notes?: string | null
          updated_at?: string
          user_id?: string | null
          vin?: string | null
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
