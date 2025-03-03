
export interface Vehicle {
  id: number;
  make: string;
  model: string;
  year: number;
  trim?: string;
  price?: number;
  market_value?: number;
  price_trend?: 'up' | 'down' | 'stable';
  mileage: number;
  image: string;
  location: string;
  added: string;
  tags?: string[];
  
  // Core specifications
  body_type?: string;
  engine_type?: string;
  transmission?: string;
  drivetrain?: string;
  
  // Condition and Status
  condition_rating: number; // 1-10 scale
  condition_description?: string;
  restoration_status?: 'original' | 'restored' | 'modified' | 'project';
  notable_issues?: string[];
  
  // History
  ownership_count?: number;
  accident_history?: boolean;
  service_history?: boolean;
  last_service_date?: string;
  
  // Classification
  vehicle_type: string;
  era?: string;
  special_edition?: boolean;
  rarity_score?: number; // 1-10 scale
  
  // Market Data
  market_trends?: {
    price_history: number[];
    similar_sales: number[];
    parts_availability: 'high' | 'medium' | 'low';
  };
  
  // Discovery
  relevance_score?: number;
  views_count?: number;
  saves_count?: number;
  interested_users?: number;
}

export interface VehicleActionHandlers {
  onVerify: (id: number) => void;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
}

export type SortDirection = 'asc' | 'desc';
export type SortField = 'make' | 'model' | 'year' | 'price' | 'mileage' | 'added' | 'location' | 'condition_rating' | 'rarity_score' | 'relevance_score';
