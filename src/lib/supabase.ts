import { createClient } from '@supabase/supabase-js';
import config from '@/config/environment';

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
  }
); 