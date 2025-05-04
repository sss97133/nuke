// Simple script to check if Supabase connection is working
import { createClient } from '@supabase/supabase-js';

// Get environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

// Exit with error if environment variables are missing
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase credentials. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkConnection() {
  try {
    console.log('🔍 Testing Supabase connection...');
    
    // Try a simple query that doesn't require auth
    const { data, error } = await supabase.from('_schema').select('*').limit(1);
    
    if (error) {
      console.error('❌ Connection failed:', error.message);
      process.exit(1);
    }
    
    console.log('✅ Successfully connected to Supabase!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

checkConnection();
