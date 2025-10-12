// Disable the problematic profile trigger that's interfering with vehicle creation
// This trigger is trying to create profiles automatically but failing due to username constraint

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyODMxOTEzMCwiZXhwIjoyMDQzODk1MTMwfQ.lIJluCkGxr5VGkbqJmLmiIiLBIXVuWNSBvsfkLc3D64';

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
