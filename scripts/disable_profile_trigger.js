// Disable the problematic profile trigger that's interfering with vehicle creation
// This trigger is trying to create profiles automatically but failing due to username constraint

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

// Load credentials from environment
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

// Use service role key to execute admin operations
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function disableTrigger() {
  try {
    // First check what triggers exist
    const { data: triggers, error: triggerError } = await supabase
      .rpc('get_triggers', { schema_name: 'public', table_name: 'vehicles' });
    
    console.log('Existing triggers on vehicles table:', triggers);
    
    // Try to disable any profile-related trigger on vehicles table
    const { error: disableError } = await supabase
      .rpc('exec_sql', { 
        sql: `
          DROP TRIGGER IF EXISTS create_profile_on_vehicle_insert ON public.vehicles;
          DROP TRIGGER IF EXISTS ensure_profile_exists ON public.vehicles;
        `
      });
    
    if (disableError) {
      console.error('Error disabling triggers:', disableError);
    } else {
      console.log('Triggers disabled successfully');
    }
    
  } catch (err) {
    console.error('Failed to disable trigger:', err);
  }
}

// Alternative: Let's just check if the RPC functions exist
async function checkFunctions() {
  try {
    const { data, error } = await supabase
      .from('pg_proc')
      .select('proname')
      .like('proname', '%profile%');
    
    console.log('Profile-related functions:', data);
  } catch (err) {
    console.error('Error checking functions:', err);
  }
}

console.log('Checking database triggers and functions...');
disableTrigger().then(() => checkFunctions());
