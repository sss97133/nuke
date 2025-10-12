// Core vehicle type following the vehicle-centric architecture
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  license_plate?: string;
  color?: string;
  mileage?: number;
  engine_size?: string;
  transmission?: string;
  drivetrain?: string;
  status: 'active' | 'inactive' | 'pending' | 'archived';
  verified: boolean;
  owner_id?: string;
  notes?: string;
  is_public?: boolean;
  uploaded_by?: string;  // Updated field name - tracks who uploaded, NOT ownership
  user_id?: string;      // @deprecated - kept for backwards compatibility only
  import_source?: string;
  import_metadata?: any;
  uploaded_at?: string;
  metadata?: any;
  inserted_at: string;
  updated_at: string;
  timeline_events?: TimelineEvent[];
  images?: VehicleImage[];
}

// Timeline event type for immutable record-keeping
export interface TimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: 'purchase' | 'sale' | 'service' | 'repair' | 'restoration' | 
              'inspection' | 'modification' | 'registration' | 'accident' |
              'milestone' | 'custom';
  event_date: string;
  source?: string;
  confidence_score: number;
  title: string;
  description?: string;
  location?: string;
  creator_id?: string;
  verified: boolean;
  verifier_id?: string;
  metadata?: any;
  inserted_at: string;
  updated_at: string;
}

// Vehicle image type for visual documentation
export interface VehicleImage {
  id: string;
  vehicle_id: string;
  url: string;
  thumbnail_url?: string;
  category: 'exterior' | 'interior' | 'engine' | 'damage' | 'repair' | 
            'restoration' | 'document' | 'general';
  position: number;
  is_primary: boolean;
  caption?: string;
  description?: string;
  angle?: number;
  taken_at?: string;
  verified?: boolean;
  width?: number;
  height?: number;
  file_size?: number;
  file_type?: string;
  alt_text?: string;
  uploaded_by?: string;
  metadata?: any;
  inserted_at: string;
  updated_at: string;
}

// API response format
export interface ApiResponse<T> {
  data: T;
}
