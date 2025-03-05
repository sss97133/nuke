
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
  // Additional fields can be added here
}
