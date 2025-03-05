export interface VehicleFormValues {
  // Basic Information
  make: string;
  model: string;
  year: string | number;
  vin?: string;
  license_plate?: string;
  
  // Ownership Status
  ownership_status: 'owned' | 'claimed' | 'discovered';
  ownership_documents?: File[];
  
  // Owner specific fields
  purchase_date?: string;
  purchase_price?: string;
  purchase_location?: string;
  
  // Claimed specific fields
  claim_justification?: string;
  
  // Discovered specific fields
  discovery_date?: string;
  discovery_location?: string;
  discovery_notes?: string;
  
  // Additional Details
  color?: string;
  trim?: string;
  body_style?: string;
  transmission?: string;
  engine?: string;
  fuel_type?: string;
  mileage?: number | string;
  
  // Classification
  condition?: string;
  category?: string;
  rarity?: string;
  significance?: string;
  
  // Media & Tags
  image?: string | string[];
  tags?: string;
  
  // Notes
  private_notes?: string;
  public_notes?: string;
}
