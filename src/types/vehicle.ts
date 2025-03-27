export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  status: string;
  metadata: {
    description?: string;
    mileage?: number;
    color?: string;
    transmission?: string;
    engine?: string;
    [key: string]: string | number | undefined;
  };
  created_at: string;
  updated_at: string;
  user_id: string;
} 