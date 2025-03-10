
import { Json } from "@/integrations/supabase/types";

export interface ServiceRecord {
  id: string;
  description: string;
  status: 'completed' | 'in-progress' | 'pending';
  service_date: string;
  completion_date?: string;
  service_type?: string;
  technician_notes?: string;
  labor_hours?: number;
  parts_used?: {name: string; quantity: number; cost: number}[];
  vehicle_id: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
}

export type ServiceStatus = 'completed' | 'in-progress' | 'pending';

export interface PartItem {
  name: string;
  quantity: number;
  cost: number;
}

// Helper function to safely parse JSON parts data
export const parsePartsUsed = (partsJson: Json | null): {name: string; quantity: number; cost: number}[] => {
  if (!partsJson) return [];
  
  try {
    if (Array.isArray(partsJson)) {
      return partsJson as {name: string; quantity: number; cost: number}[];
    }
    return [];
  } catch (e) {
    console.error("Error parsing parts data:", e);
    return [];
  }
};

// Helper to normalize null to undefined
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

// Helper to provide default values for missing fields
export function withDefault<T>(value: T | null | undefined, defaultValue: T): T {
  return (value === null || value === undefined) ? defaultValue : value;
}
