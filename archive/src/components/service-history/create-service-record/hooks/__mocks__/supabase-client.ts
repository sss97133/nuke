/**
 * Mock implementation of Supabase client for service history components
 * This allows for isolated testing and development of service record features
 */

import { PostgrestError } from '@supabase/supabase-js';

// Mock implementation that follows the vehicle-centric architecture
export const supabase = {
  // Auth methods
  auth: {
    getUser: async () => {
      return {
        data: {
          user: {
            id: 'mock-user-id',
            email: 'test@example.com'
          }
        },
        error: null
      };
    }
  },
  
  // Database methods
  from: (table: string) => {
    // Mock data for different tables following vehicle-centric architecture
    const mockData = {
      vehicles: [
        { id: 'mock-id-1', make: 'Chevrolet', model: 'C10', year: 1975 },
        { id: 'mock-id-2', make: 'GMC', model: 'Sierra', year: 1982 },
        { id: 'mock-id-3', make: 'Chevrolet', model: 'K20', year: 1979 },
        { id: 'mock-id-4', make: 'GMC', model: 'C15', year: 1987 }
      ],
      service_records: [
        { 
          id: 'sr-1', 
          vehicle_id: 'mock-id-1',
          service_date: '2025-03-15',
          description: 'Oil change',
          status: 'completed'
        }
      ]
    };
    
    return {
      select: (columns?: string) => {
        // This should return data directly for simple queries like in useVehiclesData
        return {
          data: mockData[table as keyof typeof mockData] || [],
          error: null,
          
          // Support for chaining methods
          eq: (column: string, value: any) => {
            return {
              single: async () => {
                const filtered = mockData[table as keyof typeof mockData]?.filter((item: any) => item[column] === value) || [];
                return {
                  data: filtered[0] || null,
                  error: null
                };
              },
              order: (column: string, options: any) => {
                return {
                  limit: (limit: number) => {
                    return {
                      then: async (callback: Function) => {
                        const filtered = mockData[table as keyof typeof mockData]?.filter((item: any) => item[column] === value) || [];
                        return callback({
                          data: filtered.slice(0, limit),
                          error: null
                        });
                      }
                    };
                  }
                };
              }
            };
          }
        };
      },
      insert: (data: any) => {
        return {
          select: () => {
            return {
              single: async () => {
                return {
                  data: { id: 'new-record-id', ...data },
                  error: null
                };
              }
            };
          }
        };
      }
    };
  }
};
