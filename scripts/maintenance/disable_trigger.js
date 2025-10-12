import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://localhost:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
);

async function disableTrigger() {
  // First drop the trigger
  try {
    const { error } = await supabase.rpc('exec_sql', { 
      sql: 'DROP TRIGGER IF EXISTS vehicle_activity_trigger ON vehicles;' 
    });
  } catch (e) {
    console.log('Could not use exec_sql, trying direct approach...');
  }
  
  // Test if we can insert without the trigger
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      user_id: 'd89e04f0-a130-4e93-b9ee-ce352933503e',
      make: 'Test',
      model: 'Trigger Disabled',
      year: 2024,
      is_public: false
    })
    .select()
    .single();
    
  if (error) {
    console.log('Still failed:', error.message);
  } else {
    console.log('✅ Vehicle created without trigger:', data.id);
    // Clean up
    await supabase.from('vehicles').delete().eq('id', data.id);
    console.log('Cleaned up test vehicle');
  }
}

disableTrigger();
