export type UserRole = 'admin' | 'supervisor' | 'manager' | 'employee';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  shopId: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface AIClassification {
  category?: string;
  confidence?: number;
  tags?: string[];
  description?: string;
  attributes?: Record<string, string | number | boolean>;
  lastUpdated?: string;
}

export interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  notes?: string;
}

export interface APICredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string[];
}

export interface Asset {
  id: string;
  name: string;
  partNumber: string;
  quantity: number;
  location?: string;
  category?: string;
  notes?: string;
  department?: string;
  subDepartment?: string;
  assetType?: string;
  condition?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchasePrice?: string;
  warrantyExpiration?: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  building?: string;
  floor?: string;
  room?: string;
  shelf?: string;
  bin?: string;
  photoUrl?: string;
  aiClassification?: AIClassification;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  notes?: string;
  status?: string;
  historical_data?: VehicleHistoricalData;
  created_at: string;
  updated_at: string;
}

export interface VehicleHistoricalData {
  previousSales?: {
    date?: string;
    price?: string;
    source?: string;
    imageUrl?: string;
  }[];
  modifications?: string[];
  notableHistory?: string;
  conditionNotes?: string;
}

export interface InventoryItem {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  manufacturer?: string;
  supplierId?: string;
  unitPrice?: number;
  quantityInStock: number;
  reorderPoint?: number;
  location?: string;
  status?: string;
  lastOrderedAt?: string;
  integrationSource?: string;
  integrationId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceTicket {
  id: string;
  vehicleId: string;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  description: string;
  priority: 'low' | 'medium' | 'high';
  assignedTo?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactInfo?: ContactInfo;
  apiCredentials?: APICredentials;
  integrationType?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleInventoryItem {
  id: string;
  make: string;
  model: string;
  year: number;
  price: number;
  metadata: Record<string, unknown>;
}

export interface InventorySearchParams {
  make?: string;
  model?: string;
  year?: number;
  priceRange?: { min: number; max: number };
  metadata?: Record<string, unknown>;
}

export interface InventoryUpdatePayload {
  price?: number;
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface InventoryBulkUpdatePayload {
  ids: string[];
  updates: Record<string, unknown>;
}
