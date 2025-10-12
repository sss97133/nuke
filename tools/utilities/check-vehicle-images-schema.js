import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, 'nuke_frontend', '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkVehicleImagesSchema() {
  console.log('Checking vehicle_images table schema...\n');
  
  // Query the information schema to get column details
  const { data, error } = await supabase
    .rpc('get_table_columns', { 
      table_name_param: 'vehicle_images' 
    })
    .single();
    
  // If RPC doesn't exist, try a different approach
  if (error) {
    console.log('RPC not available, trying direct query...\n');
    const { data: columns, error: queryError } = await supabase
      .from('vehicle_images')
      .select('*')
      .limit(0);
      
    if (queryError) {
      console.error('Error checking schema:', queryError);
      return;
    }
    
    // This won't give us full schema but at least shows the query works
    console.log('vehicle_images table exists and is accessible');
    console.log('\nTrying to insert a test record to see actual field requirements...');
    
    // Try to get the actual columns by checking an existing row
    const { data: sampleRow, error: sampleError } = await supabase
      .from('vehicle_images')
      .select('*')
      .limit(1);
      
    if (sampleRow && sampleRow.length > 0) {
      console.log('\nColumns found in vehicle_images:');
      Object.keys(sampleRow[0]).forEach(col => {
        console.log(`  - ${col}: ${typeof sampleRow[0][col]}`);
      });
    } else {
      console.log('No rows found to sample column structure');
    }
  } else if (data) {
    console.log('Columns in vehicle_images table:');
    data.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required)' : ''}`);
    });
  }
}

checkVehicleImagesSchema().catch(console.error);
