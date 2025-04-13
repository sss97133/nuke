// Simple script to test Supabase connection with the correct credentials
import { createClient } from '@supabase/supabase-js';

// Use the direct values provided by Supabase CLI
const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  console.log('Testing Supabase connection...');
  
  try {
    // Attempt to get the user
    const { data: authData, error: authError } = await supabase.auth.getUser();
    console.log('Auth service:', authError ? '❌ Error' : '✅ Working');
    if (authError) console.error('Auth error:', authError.message);
    
    // Try a simple database query
    const { data: dbData, error: dbError } = await supabase.from('users').select('*').limit(1);
    console.log('Database connection:', dbError ? '❌ Error' : '✅ Working');
    if (dbError) console.error('Database error:', dbError.message);
    
    // Check storage service
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
    console.log('Storage service:', storageError ? '❌ Error' : '✅ Working');
    if (storageError) console.error('Storage error:', storageError.message);
    
    // If everything works, we're good to go
    if (!authError && !dbError && !storageError) {
      console.log('\n✅ All Supabase services working properly!');
    } else {
      console.log('\n❌ Some Supabase services have issues.');
      console.log('Check if your .env file has these values:');
      console.log(`VITE_SUPABASE_URL=${supabaseUrl}`);
      console.log(`VITE_SUPABASE_ANON_KEY=${supabaseAnonKey}`);
    }
  } catch (e) {
    console.error('Unexpected error:', e);
  }
}

testConnection();
