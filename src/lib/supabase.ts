import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '@/config/environment';

// Define vehicle types
export interface Vehicle {
  id?: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  license_plate?: string;
  ownership_status: 'owned' | 'claimed' | 'discovered';
  purchase_date?: string;
  purchase_price?: number;
  purchase_location?: string;
  claim_justification?: string;
  discovery_date?: string;
  discovery_location?: string;
  discovery_notes?: string;
  color?: string;
  trim?: string;
  body_style?: string;
  transmission?: string;
  engine?: string;
  fuel_type?: string;
  mileage?: number;
  condition?: string;
  category?: string;
  rarity?: string;
  significance?: string;
  public_notes?: string;
  private_notes?: string;
  image?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

// Define database error types
export interface DatabaseError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

// Initialize Supabase client with environment-specific configuration
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-application-name': 'nuke',
      },
    },
  }
);

// Add error event listener
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    console.log('User signed out');
  } else if (event === 'SIGNED_IN') {
    console.log('User signed in:', session?.user?.email);
  } else if (event === 'USER_UPDATED') {
    console.log('User updated:', session?.user?.email);
  }
});

// Export a helper function to handle Supabase errors
export const handleSupabaseError = (error: DatabaseError): string => {
  console.error('Supabase error:', error);
  
  const errorMessages: Record<string, string> = {
    'PGRST116': 'Invalid data format. Please check your input.',
    'PGRST301': 'Database connection error. Please try again.',
    '42501': 'You do not have permission to perform this action.',
    '23505': 'This record already exists.',
    '23503': 'This operation failed because it depends on another record that was not found.',
    '23514': 'The data violates a check constraint. Please verify your input.',
    '23502': 'A required field is missing.',
  };

  return errorMessages[error.code] || error.message || 'An unexpected error occurred. Please try again.';
};

// Vehicle-specific database functions
export const vehicleDb = {
  async create(vehicle: Omit<Vehicle, 'id'>): Promise<{ data: Vehicle | null; error: DatabaseError | null }> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) {
        throw { code: 'AUTH_ERROR', message: 'User not authenticated' };
      }

      const { data, error } = await supabase
        .from('vehicles')
        .insert([{ ...vehicle, user_id: user.user.id }])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error creating vehicle:', error);
      return { data: null, error };
    }
  },

  async getById(id: string): Promise<{ data: Vehicle | null; error: DatabaseError | null }> {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching vehicle:', error);
      return { data: null, error };
    }
  },

  async getUserVehicles(): Promise<{ data: Vehicle[] | null; error: DatabaseError | null }> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) {
        throw { code: 'AUTH_ERROR', message: 'User not authenticated' };
      }

      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', user.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching user vehicles:', error);
      return { data: null, error };
    }
  },
}; 