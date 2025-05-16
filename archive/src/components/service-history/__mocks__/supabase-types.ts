/**
 * Mock Supabase types for service history components
 * This allows for isolated testing and development of service record features
 */

// A simplified version of Supabase's Json type
export type Json = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
