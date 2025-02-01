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

export interface Vehicle {
  id: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  notes?: string;
  images?: string[];
  createdBy: string;
  updatedBy: string;
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

export interface InventoryItem {
  id: string;
  name: string;
  partNumber?: string;
  quantity: number;
  location?: string;
  category?: string;
  images?: string[];
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}