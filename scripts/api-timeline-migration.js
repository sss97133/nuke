#!/usr/bin/env node

// API-based Timeline Migration using Supabase JavaScript client's standard operations
// This script aligns with the three-tier fallback mechanism for environment variables

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Setup path resolution for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables following the established pattern
dotenv.config({ path: path.join(rootDir, '.env.test') });
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });

console.log(`${YELLOW}Environment loading:${RESET}`);
console.log(`Checking for variables in .env.test, .env, and .env.local`);

// Helper function to get environment variables with fallback mechanism
function getEnvVar(name) {
  // Try process.env first (Node.js)
  if (process.env[name]) {
    return process.env[name];
  }
  
  // Log error and exit if not found
  console.error(`${RED}Error: ${name} environment variable is not set${RESET}`);
  console.error(`Please set ${name} in .env.test or .env file`);
  process.exit(1);
}

console.log(`${YELLOW}Vehicle Timeline Database Migration${RESET}`);
console.log('=======================================');

// Get Supabase credentials
const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseServiceKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY');

console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Service Key available: ${supabaseServiceKey ? '✓' : '✗'}`);

// Initialize Supabase client with admin privileges
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Function to handle the migration using REST API operations
async function migrateTimeline() {
  try {
    // Step 1: Check if the table already exists
    console.log('Checking if vehicle_timeline_events table exists...');
    
    try {
      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .select('id')
        .limit(1);
      
      if (!error) {
        console.log(`${GREEN}✅ vehicle_timeline_events table already exists${RESET}`);
        return;
      }
    } catch (error) {
      // Table doesn't exist, continue with creation
      console.log('Table does not exist, proceeding with creation...');
    }
    
    // Step 2: Create the table through Supabase management API
    // Note: Since we don't have direct SQL execution, we'll need to use the Supabase Dashboard
    // or API to create the table. In this script, we'll provide detailed instructions.
    
    console.log(`${YELLOW}==============================================${RESET}`);
    console.log(`${YELLOW}Important: Manual Steps Required${RESET}`);
    console.log(`${YELLOW}==============================================${RESET}`);
    console.log(`\nThe vehicle_timeline_events table needs to be created manually through the Supabase Dashboard.`);
    console.log(`\nFollow these steps:`);
    console.log(`1. Log in to your Supabase Dashboard at: ${supabaseUrl.replace('https://', 'https://app.supabase.com/project/')}`);
    console.log(`2. Navigate to Table Editor and create a new table named 'vehicle_timeline_events' with the following columns:`);
    console.log(`\n   - id: UUID (primary key, default: uuid_generate_v4())
   - vehicle_id: UUID (not null)
   - event_type: VARCHAR(50) (not null)
   - source: VARCHAR(100) (not null)
   - event_date: TIMESTAMPTZ (not null)
   - title: TEXT (not null)
   - description: TEXT
   - confidence_score: INT (not null) with check (confidence_score >= 0 AND confidence_score <= 100)
   - metadata: JSONB (default: '{}'::jsonb)
   - source_url: TEXT
   - image_urls: TEXT[]
   - created_at: TIMESTAMPTZ (default: now())
   - updated_at: TIMESTAMPTZ (default: now())`);
    
    console.log(`\n3. Create indexes:
   - vehicle_timeline_events_vehicle_id_idx ON vehicle_timeline_events(vehicle_id)
   - vehicle_timeline_events_event_date_idx ON vehicle_timeline_events(event_date)`);
    
    console.log(`\n4. Set up Row Level Security (RLS):
   - Enable RLS on the table
   - Create policy "Allow public read of timeline events" FOR SELECT USING (true)
   - Create policy "Allow authorized users to insert timeline events" FOR INSERT TO authenticated WITH CHECK (true)
   - Create policy "Allow vehicle owners to update their timeline events" FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_timeline_events.vehicle_id AND v.owner_id = auth.uid()))`);
    
    console.log(`\n5. Create an update trigger:
   - Create function update_modified_column() RETURNS TRIGGER LANGUAGE plpgsql
   - Create trigger set_timestamp BEFORE UPDATE ON vehicle_timeline_events FOR EACH ROW EXECUTE FUNCTION update_modified_column()`);
    
    console.log(`\n${YELLOW}Alternatively, you can use the Supabase SQL Editor:${RESET}`);
    console.log(`1. Go to SQL Editor in the Supabase Dashboard`);
    console.log(`2. Paste the content from scripts/manual-timeline-setup.sql`);
    console.log(`3. Run the SQL to create everything at once`);
    
    console.log(`\n${YELLOW}After creating the table, run the timeline test helper:${RESET}`);
    console.log(`npm run timeline:test`);
    
    console.log(`\n${YELLOW}==============================================${RESET}`);
    
    // Optional: Try to create a test record to verify connectivity
    console.log(`\nTesting Supabase connectivity...`);
    const testVehicleId = '00000000-0000-0000-0000-000000000000'; // Test UUID
    
    const { error: connectionError } = await supabase
      .from('vehicles')
      .select('id')
      .limit(1);
    
    if (connectionError) {
      console.log(`${RED}❌ Supabase connection test failed:${RESET} ${connectionError.message}`);
      console.log(`This is expected if the vehicles table doesn't exist yet, but you should check your Supabase credentials.`);
    } else {
      console.log(`${GREEN}✅ Successfully connected to Supabase${RESET}`);
    }
    
    console.log(`\n${YELLOW}Preparing to verify the timeline table after manual creation...${RESET}`);
    console.log(`After creating the table in the Supabase Dashboard, run:`);
    console.log(`npm run timeline:test`);
    
  } catch (error) {
    console.error(`${RED}❌ Error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the migration
migrateTimeline()
  .catch(error => {
    console.error(`${RED}❌ Unhandled error:${RESET}`, error.message);
    process.exit(1);
  });
