/**
 * Mock Supabase Client
 * 
 * This provides a fully-featured mock implementation of the Supabase client
 * for local development and testing without needing a real Supabase instance.
 */

import { createClient } from '@supabase/supabase-js';

// Mock data for the 73-87 squarebody trucks you requested
const mockVehicles = [
  { 
    id: 'v1', 
    vin: 'CCE147S100001', 
    make: 'Chevrolet', 
    model: 'C10', 
    year: 1975,
    owner_id: 'user-123', 
    created_at: '2025-01-15T09:00:00-07:00',
    updated_at: '2025-03-20T14:30:00-07:00'
  },
  { 
    id: 'v2', 
    vin: 'TGS182S200002', 
    make: 'GMC', 
    model: 'Sierra', 
    year: 1982,
    owner_id: 'user-123', 
    created_at: '2025-02-10T11:15:00-07:00',
    updated_at: '2025-03-15T10:45:00-07:00'
  },
  { 
    id: 'v3', 
    vin: 'CCK207S300003', 
    make: 'Chevrolet', 
    model: 'K20', 
    year: 1979,
    owner_id: 'user-123', 
    created_at: '2025-01-30T16:20:00-07:00',
    updated_at: '2025-03-10T09:30:00-07:00'
  },
  { 
    id: 'v4', 
    vin: 'TGC157S400004', 
    make: 'GMC', 
    model: 'C15', 
    year: 1987,
    owner_id: 'user-456', 
    created_at: '2025-02-20T14:00:00-07:00',
    updated_at: '2025-03-25T13:15:00-07:00'
  }
];

const mockServiceRecords = [
  { 
    id: 'sr1',
    vehicle_id: 'v1',
    service_date: '2025-03-15',
    description: 'Oil change and carb rebuild',
    service_type: 'maintenance',
    status: 'completed',
    labor_hours: 3.5,
    technician_notes: 'Carb had significant varnish buildup, recommend more frequent fuel system cleaner use',
    parts_used: [
      { name: 'Oil filter', quantity: 1, cost: 8.99 },
      { name: 'Oil (10W40)', quantity: 5, cost: 7.49 },
      { name: 'Carb rebuild kit', quantity: 1, cost: 45.99 }
    ],
    total_cost: 92.42
  },
  { 
    id: 'sr2',
    vehicle_id: 'v2',
    service_date: '2025-02-20',
    description: 'Brake service',
    service_type: 'repair',
    status: 'completed',
    labor_hours: 4.0,
    technician_notes: 'Replaced front brake pads and rotors',
    parts_used: [
      { name: 'Front brake pads', quantity: 1, cost: 39.99 },
      { name: 'Front rotors', quantity: 2, cost: 45.99 }
    ],
    total_cost: 267.95
  }
];

const mockUsers = {
  'user-123': { 
    id: 'user-123', 
    email: 'test@example.com',
    user_metadata: { 
      full_name: 'Test User',
      phone: '555-123-4567'
    },
    created_at: '2025-01-01T10:00:00-07:00'
  },
  'user-456': { 
    id: 'user-456', 
    email: 'mechanic@example.com',
    user_metadata: { 
      full_name: 'Test Mechanic',
      phone: '555-987-6543'
    },
    created_at: '2025-01-02T11:00:00-07:00'
  }
};

// In-memory mock database tables
const mockDb = {
  vehicles: [...mockVehicles],
  service_records: [...mockServiceRecords],
  users: { ...mockUsers }
};

// Store the current user for auth state
let currentUser = null;
let authChangeCallbacks = [];

// Create a mock Supabase client with realistic behavior
export const supabase = {
  // Auth methods
  auth: {
    getUser: async () => {
      return { data: { user: currentUser }, error: currentUser ? null : new Error('No user logged in') };
    },
    getSession: async () => {
      return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
    },
    signUp: async ({ email, password, options }) => {
      // Simulate creating a new user
      const newUser = { 
        id: `user-${Date.now()}`, 
        email, 
        user_metadata: options?.data || {}
      };
      
      mockDb.users[newUser.id] = newUser;
      currentUser = newUser;
      
      // Notify listeners
      authChangeCallbacks.forEach(callback => 
        callback('SIGNED_IN', { user: newUser, session: { user: newUser } })
      );
      
      return { data: { user: newUser, session: { user: newUser } }, error: null };
    },
    signInWithPassword: async ({ email, password }) => {
      // Find user by email (simple mock)
      const user = Object.values(mockDb.users).find(u => u.email === email);
      
      if (user) {
        currentUser = user;
        
        // Notify listeners
        authChangeCallbacks.forEach(callback => 
          callback('SIGNED_IN', { user, session: { user } })
        );
        
        return { data: { user, session: { user } }, error: null };
      }
      
      return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
    },
    signOut: async () => {
      currentUser = null;
      
      // Notify listeners
      authChangeCallbacks.forEach(callback => 
        callback('SIGNED_OUT', { user: null, session: null })
      );
      
      return { error: null };
    },
    onAuthStateChange: (callback) => {
      authChangeCallbacks.push(callback);
      
      // Return unsubscribe function
      return {
        data: { subscription: { unsubscribe: () => {
          authChangeCallbacks = authChangeCallbacks.filter(cb => cb !== callback);
        }}},
        error: null
      };
    }
  },
  
  // Database methods
  from: (table) => {
    // Make sure the table exists in our mock DB
    if (!mockDb[table]) {
      mockDb[table] = [];
    }
    
    // Query builder with chainable methods
    return {
      select: (columns = '*') => {
        return {
          eq: (field, value) => {
            return {
              single: async () => {
                const result = mockDb[table].find(item => item[field] === value);
                return { data: result || null, error: null };
              },
              order: (orderField, { ascending = true } = {}) => {
                return {
                  limit: async (limit) => {
                    const filtered = mockDb[table].filter(item => item[field] === value);
                    const sorted = [...filtered].sort((a, b) => {
                      return ascending 
                        ? String(a[orderField]).localeCompare(String(b[orderField])) 
                        : String(b[orderField]).localeCompare(String(a[orderField]));
                    });
                    const limited = sorted.slice(0, limit);
                    return { data: limited, error: null };
                  }
                };
              },
              limit: async (limit) => {
                const filtered = mockDb[table].filter(item => item[field] === value);
                const limited = filtered.slice(0, limit);
                return { data: limited, error: null };
              }
            };
          },
          match: (criteria) => {
            return {
              limit: async (limit) => {
                const filtered = mockDb[table].filter(item => {
                  for (const [key, value] of Object.entries(criteria)) {
                    if (item[key] !== value) return false;
                  }
                  return true;
                });
                const limited = filtered.slice(0, limit);
                return { data: limited, error: null };
              }
            };
          },
          order: (orderField, { ascending = true } = {}) => {
            return {
              limit: async (limit) => {
                const sorted = [...mockDb[table]].sort((a, b) => {
                  return ascending 
                    ? String(a[orderField]).localeCompare(String(b[orderField])) 
                    : String(b[orderField]).localeCompare(String(a[orderField]));
                });
                const limited = sorted.slice(0, limit);
                return { data: limited, error: null };
              }
            };
          },
          limit: async (limit) => {
            const limited = mockDb[table].slice(0, limit);
            return { data: limited, error: null };
          }
        };
      },
      insert: (newItem) => {
        return {
          select: async () => {
            const id = newItem.id || `${table.slice(0, 2)}-${Date.now()}`;
            const itemWithId = { ...newItem, id };
            
            // Apply RLS - Only allow inserts for current user's data
            if (table === 'vehicles' || table === 'service_records') {
              if (!currentUser) {
                return { data: null, error: new Error('Not authenticated') };
              }
              
              // For vehicles, enforce owner_id
              if (table === 'vehicles' && !itemWithId.owner_id) {
                itemWithId.owner_id = currentUser.id;
              }
              
              // For service records, check vehicle ownership
              if (table === 'service_records') {
                const vehicle = mockDb.vehicles.find(v => v.id === itemWithId.vehicle_id);
                if (!vehicle || vehicle.owner_id !== currentUser.id) {
                  return { data: null, error: new Error('No permission to add service records to this vehicle') };
                }
              }
            }
            
            // Add timestamps
            const now = new Date().toISOString();
            itemWithId.created_at = itemWithId.created_at || now;
            itemWithId.updated_at = now;
            
            mockDb[table].push(itemWithId);
            return { data: itemWithId, error: null };
          }
        };
      },
      update: (updates) => {
        return {
          eq: (field, value) => {
            return {
              select: async () => {
                const index = mockDb[table].findIndex(item => item[field] === value);
                
                if (index === -1) {
                  return { data: null, error: new Error('Item not found') };
                }
                
                // Apply RLS - Only allow updates for current user's data
                if (table === 'vehicles' || table === 'service_records') {
                  if (!currentUser) {
                    return { data: null, error: new Error('Not authenticated') };
                  }
                  
                  const item = mockDb[table][index];
                  
                  // For vehicles, check ownership
                  if (table === 'vehicles' && item.owner_id !== currentUser.id) {
                    return { data: null, error: new Error('No permission to update this vehicle') };
                  }
                  
                  // For service records, check vehicle ownership
                  if (table === 'service_records') {
                    const vehicle = mockDb.vehicles.find(v => v.id === item.vehicle_id);
                    if (!vehicle || vehicle.owner_id !== currentUser.id) {
                      return { data: null, error: new Error('No permission to update service records for this vehicle') };
                    }
                  }
                }
                
                // Update timestamp
                updates.updated_at = new Date().toISOString();
                
                // Update the item
                mockDb[table][index] = { ...mockDb[table][index], ...updates };
                
                return { data: mockDb[table][index], error: null };
              }
            };
          }
        };
      },
      delete: () => {
        return {
          eq: (field, value) => {
            return {
              select: async () => {
                const index = mockDb[table].findIndex(item => item[field] === value);
                
                if (index === -1) {
                  return { data: null, error: new Error('Item not found') };
                }
                
                // Apply RLS - Only allow deletions for current user's data
                if (table === 'vehicles' || table === 'service_records') {
                  if (!currentUser) {
                    return { data: null, error: new Error('Not authenticated') };
                  }
                  
                  const item = mockDb[table][index];
                  
                  // For vehicles, check ownership
                  if (table === 'vehicles' && item.owner_id !== currentUser.id) {
                    return { data: null, error: new Error('No permission to delete this vehicle') };
                  }
                  
                  // For service records, check vehicle ownership
                  if (table === 'service_records') {
                    const vehicle = mockDb.vehicles.find(v => v.id === item.vehicle_id);
                    if (!vehicle || vehicle.owner_id !== currentUser.id) {
                      return { data: null, error: new Error('No permission to delete service records for this vehicle') };
                    }
                  }
                }
                
                // Remove the item
                const removed = mockDb[table].splice(index, 1)[0];
                
                return { data: removed, error: null };
              }
            };
          }
        };
      }
    };
  },
  
  // Real-time subscriptions (simplified mock)
  channel: (name) => {
    return {
      on: (event, filter, callback) => {
        console.log(`Mock subscription created: ${name}, ${event}`);
        return {
          subscribe: (onError) => {
            console.log('Mock subscription active');
            return Promise.resolve();
          }
        };
      }
    };
  }
};

// Export as default and named export
export default supabase;
