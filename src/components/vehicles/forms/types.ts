export interface VehicleFormValues {
  make: string;
  model: string;
  year: string;
  vin?: string;
  license_plate?: string;
  color?: string;
  trim?: string;
  mileage?: string;
  purchase_date?: string;
  purchase_price?: string;
  location?: string;
  body_style?: string;
  fuel_type?: string;
  transmission?: string;
  drivetrain?: string;
  engine_type?: string;
  doors?: string;
  seats?: string;
  weight?: string;
  top_speed?: string;
  tags?: string;
  notes?: string;
  image: string | string[];
  
  // Ownership information
  ownership_status: 'owned' | 'claimed' | 'discovered';
  
  // Ownership document fields
  title_documents?: string[];
  identification_documents?: string[];
  
  // Claimed vehicle fields
  claim_relationship?: string;
  authorization_documents?: string[];
  
  // Discovery-specific fields
  discovery_source?: string;
  discovery_url?: string;
  discovery_date?: string;
  discovery_location?: string;
  discovery_notes?: string;
  discovery_evidence?: string[];
}

// Add validation schema for the form
export const formSchema = {
  // This could be expanded with Zod or other validation
};
