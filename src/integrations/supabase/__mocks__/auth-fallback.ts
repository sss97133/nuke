/**
 * Supabase Authentication Fallback
 * 
 * This file provides fallback functionality when authentication is missing,
 * allowing the application to continue working in development environments
 * without requiring a logged-in user.
 */

// Import the real Supabase client
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabase as realSupabase } from '../client';

// Function to create a fallback Supabase client that doesn't require authentication
export const createFallbackClient = () => {
  // Get Supabase URL and anon key from environment variables
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables for fallback client');
    return mockSupabaseClient;
  }
  
  try {
    // Create a fresh client with anonymous auth
    return createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false, // Don't persist the session
        autoRefreshToken: false, // Don't try to refresh tokens
        detectSessionInUrl: false // Don't look for tokens in URL
      }
    });
  } catch (error) {
    console.error('Error creating fallback Supabase client:', error);
    return mockSupabaseClient;
  }
};

// Function to determine if an error is an authentication error
export const isAuthError = (error: unknown): boolean => {
  // Check if error is an object and has relevant properties
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  
  // Type assertion to allow property access (use carefully)
  const potentialAuthError = error as Record<string, any>;
  
  return (
    potentialAuthError.__isAuthError === true ||
    potentialAuthError.name === 'AuthSessionMissingError' ||
    (typeof potentialAuthError.message === 'string' && potentialAuthError.message.includes('auth')) ||
    potentialAuthError.code === 401
  );
};

// Function to get a usable client regardless of auth state
export const getUsableClient = () => {
  try {
    return realSupabase;
  } catch (error) {
    console.warn('Authentication error, using fallback client:', error);
    if (isAuthError(error)) {
      return createFallbackClient();
    }
    return mockSupabaseClient;
  }
};

// Mock Supabase client as a final fallback option
const mockSupabaseClient = {
  from: (table: string) => {
    const queryBuilder = {
      select: (columns?: string) => ({
        eq: (field: string, value: any) => ({
          single: () => Promise.resolve({ data: null, error: null }),
          order: (column: string, options: any) => ({
            limit: (count: number) => Promise.resolve({ 
              data: table === 'vehicle_timeline_events' ? getMockVehicleTimelineEvents('demo') : [],
              error: null 
            })
          })
        }),
        order: (column: string, options: any) => ({
          limit: (count: number) => Promise.resolve({ 
            data: table === 'vehicle_timeline_events' ? getMockVehicleTimelineEvents('demo') : [],
            error: null 
          })
        })
      }),
      insert: (data: any) => Promise.resolve({ data, error: null }),
      update: (data: any) => ({
        eq: (field: string, value: any) => Promise.resolve({ data, error: null })
      }),
      delete: () => ({
        eq: (field: string, value: any) => Promise.resolve({ data: {}, error: null })
      })
    };
    
    return queryBuilder;
  },
  auth: {
    getUser: () => Promise.resolve({ data: { user: null }, error: null })
  },
  storage: {
    from: (bucket: string) => ({
      upload: (path: string, file: File) => Promise.resolve({ data: { path }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/${path}` } })
    })
  }
};

// Mock timeline event data
function getMockVehicleTimelineEvents(vehicleId: string) {
  return [
    {
      id: "d0c18271-fa5c-43ea-b545-6db5e54ebcf1",
      vehicle_id: vehicleId,
      event_type: "manufacture",
      source: "vin_database",
      event_date: "1988-01-01T00:00:00Z",
      title: "Vehicle Manufactured",
      description: "1988 GMC Suburban manufactured",
      confidence_score: 95,
      metadata: {
        year: 1988,
        make: "GMC",
        model: "Suburban",
        vin: "1GKEV16K4JF504317"
      },
      source_url: "https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    },
    {
      id: "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8",
      vehicle_id: vehicleId,
      event_type: "listing",
      source: "bat_auction",
      event_date: "2023-10-15T12:00:00Z",
      title: "Listed on Bring a Trailer",
      description: "1988 GMC Suburban 1500 Sierra Classic 4×4 listed on Bring a Trailer auction",
      confidence_score: 98,
      metadata: {
        auction_id: "123456",
        sold_price: null,
        title: "1988 GMC Suburban 1500 Sierra Classic 4×4"
      },
      source_url: "https://bringatrailer.com/listing/1988-gmc-suburban-1500-sierra-classic-4x4",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    },
    {
      id: "f8c12d45-a19b-4a23-9c5e-3b785f11e90a",
      vehicle_id: vehicleId,
      event_type: "sale",
      source: "bat_auction",
      event_date: "2023-10-22T19:30:00Z",
      title: "Sold on Bring a Trailer",
      description: "1988 GMC Suburban 1500 Sierra Classic 4×4 sold for $24,500 on Bring a Trailer",
      confidence_score: 98,
      metadata: {
        auction_id: "123456",
        sold_price: 24500
      },
      source_url: "https://bringatrailer.com/listing/1988-gmc-suburban-1500-sierra-classic-4x4",
      image_urls: [
        "https://bringatrailer.com/wp-content/uploads/2021/10/1988_gmc_suburban_16342987895dfc0156da11B3C98C6E-9F70-4DE5-8D2D-500ABBA3C399-scaled.jpeg?w=620&resize=620%2C465"
      ],
      created_at: "2023-03-14T06:28:02.207Z",
      updated_at: "2023-03-14T06:28:02.207Z"
    }
  ];
}
