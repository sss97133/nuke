/**
 * Mock Supabase types for service history components
 * This allows for isolated testing and development of service record features
 */

// A simplified version of Supabase's Json type
export type Json = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Database schema types
export interface Database {
  public: {
    Tables: {
      service_records: {
        Row: {
          id: string;
          vehicle_id: string;
          technician_id: string;
          service_date: string;
          description: string;
          service_type: string;
          status: string;
          labor_hours: number | null;
          technician_notes: string | null;
          parts_used: Json | null;
          total_cost: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['service_records']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['service_records']['Row']>;
      };
      vehicles: {
        Row: {
          id: string;
          make: string;
          model: string;
          year: number;
          vin: string | null;
          owner_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['vehicles']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['vehicles']['Row']>;
      };
    };
  };
};
