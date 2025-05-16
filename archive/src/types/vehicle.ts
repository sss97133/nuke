export type VerificationLevel = 'unverified' | 'basic' | 'professional' | 'ptz' | 'blockchain';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  status?: string;
  trust_score?: number;
  verification_level?: VerificationLevel;
  verified_at?: string;
  metadata?: {
    description?: string;
    mileage?: number;
    color?: string;
    transmission?: string;
    engine?: string;
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
  user_id: string;
}

export interface VehicleTimeline {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  data: Record<string, any>;
  created_at?: string;
}

// For Supabase RPC function results
export interface VehicleOperationResult {
  success: boolean;
  vehicle_id?: string;
  error?: string;
}