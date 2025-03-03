
export interface Vehicle {
  id: number;
  make: string;
  model: string;
  year: number;
  price: number;
  mileage: number;
  image: string;
  location: string;
  added: string;
  tags: string[];
}

export interface VehicleActionHandlers {
  onVerify: (id: number) => void;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
}

export type SortDirection = 'asc' | 'desc';
export type SortField = 'make' | 'model' | 'year' | 'price' | 'mileage' | 'added' | 'location';
