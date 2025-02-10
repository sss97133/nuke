
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

export interface Asset {
  id: string;
  name: string;
  partNumber?: string;
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
  aiClassification?: any;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
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
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactInfo?: Record<string, any>;
  apiCredentials?: Record<string, any>;
  integrationType?: string;
  status?: string;
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
