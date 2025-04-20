// Simple script to view table structure from Supabase
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';
const supabase = createClient(supabaseUrl, supabaseKey);

// Query to get table structure
async function getTableStructure(tableName) {
  console.log(`\n--- Structure for table ${tableName} ---`);
  const { data, error } = await supabase
    .rpc('get_table_columns', { table_name: tableName });
    
  if (error) {
    console.error('Error fetching table structure:', error);
    return;
  }
  
  data.forEach(col => {
    console.log(`${col.column_name} - ${col.data_type}`);
  });
}

// Get captures table to examine recent data
async function getCaptures() {
  console.log('\n--- Recent captures ---');
  const { data, error } = await supabase
    .from('captures')
    .select('id, url, meta, user_id, captured_at')
    .order('captured_at', { ascending: false })
    .limit(3);
    
  if (error) {
    console.error('Error fetching captures:', error);
    return;
  }
  
  console.log(JSON.stringify(data, null, 2));
}

// Get vehicles table structure
async function getVehicles() {
  console.log('\n--- Sample vehicles ---');
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .limit(1);
    
  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }
  
  console.log(JSON.stringify(data, null, 2));
}

// Create a custom function to examine the database schema
async function createSchemaFunction() {
  const { error } = await supabase.rpc('create_schema_function');
  
  if (error) {
    // Function probably already exists
    console.log('Schema function exists or error creating it:', error.message);
  } else {
    console.log('Created schema function successfully');
  }
}

// Main execution
async function main() {
  try {
    // Create function to get column info if it doesn't exist
    await supabase.rpc('create_schema_function').catch(() => {
      // Function might exist, continue
    });
    
    // View tables
    await getTableStructure('vehicles');
    await getVehicles();
    await getTableStructure('captures');
    await getCaptures();
  } catch (err) {
    console.error('Error in main execution:', err);
  }
}

// Run the script
main();
