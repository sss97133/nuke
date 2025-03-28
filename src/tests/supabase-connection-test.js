// Simple test to verify Supabase connection and data saving
import { supabase } from '../integrations/supabase/client.ts';

async function testSupabaseConnection() {
  console.log('Testing Supabase connection...');
  
  try {
    // Test authentication state
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Session exists:', !!session);
    
    if (session) {
      console.log('User is authenticated:', session.user.email);
    } else {
      console.log('No active session - testing public access');
    }
    
    // Test a simple read query that doesn't require authentication
    console.log('Testing public database read...');
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, make, model')
      .limit(1);
      
    if (vehiclesError) {
      console.error('Read Error:', vehiclesError.message);
      return false;
    }
    
    console.log('Successfully read from database:', vehicles ? 'Got data' : 'No data found');
    
    // Create a test record with timestamp to verify writing works
    // This uses a custom_test_logs table that should be publicly writable
    // for testing purposes
    console.log('Testing database write capability...');
    const testRecord = {
      event: 'connection_test',
      timestamp: new Date().toISOString(),
      environment: import.meta.env.MODE || 'unknown',
      success: true,
      details: 'Testing if Supabase client can write data'
    };
    
    const { data: insertData, error: insertError } = await supabase
      .from('custom_test_logs')
      .insert(testRecord)
      .select();
      
    if (insertError) {
      if (insertError.code === '42P01') {
        console.log('Test table does not exist - skipping write test');
      } else {
        console.error('Write Error:', insertError.message, insertError.details);
        return false;
      }
    } else {
      console.log('Successfully wrote test data to database:', insertData ? 'Data written' : 'No confirmation');
    }
    
    return true;
  } catch (e) {
    console.error('Unexpected error in Supabase test:', e);
    return false;
  }
}

// Run the test
testSupabaseConnection()
  .then(success => {
    console.log('Test completed. Connection working:', success);
  })
  .catch(err => {
    console.error('Test failed with error:', err);
  });
