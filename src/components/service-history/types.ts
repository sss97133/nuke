
import { Json } from "@/integrations/supabase/types";

export interface ServiceRecord {
  id: string;
  description: string;
  status: string;
  service_date: string;
  completion_date?: string;
  service_type?: string;
  technician_notes?: string;
  labor_hours?: number;
  parts_used?: {name: string; quantity: number; cost: number}[];
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
}

export type ServiceStatus = 'completed' | 'in-progress' | 'pending';

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
