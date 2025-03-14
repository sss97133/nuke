#!/usr/bin/env node

/**
 * Check Timeline Table Existence
 * A minimal script to verify the vehicle_timeline_events table and create it if missing
 */

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

// Load environment variables from all possible locations following three-tier fallback
dotenv.config({ path: path.join(rootDir, '.env.test') });
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env.development') });

console.log(`${YELLOW}Vehicle Timeline Table Check${RESET}`);
console.log(`========================================`);

// Helper function to get environment variables
function getEnvVar(name) {
  if (process.env[name]) {
    console.log(`✓ Found ${name}`);
    return process.env[name];
  }
  console.error(`${RED}❌ Missing ${name}${RESET}`);
  return null;
}

async function checkTimelineTable() {
  try {
    // Get Supabase credentials
    const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
    const supabaseKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY'); 
    
    if (!supabaseUrl || !supabaseKey) {
      console.error(`${RED}❌ Missing required Supabase credentials${RESET}`);
      process.exit(1);
    }

    // Initialize the Supabase client with admin privileges
    console.log(`\nInitializing Supabase client...`);
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Check direct connection
    console.log(`Testing connection to Supabase...`);
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.error(`${RED}❌ Connection error: ${authError.message}${RESET}`);
      return;
    }
    console.log(`${GREEN}✓ Connected to Supabase successfully${RESET}`);
    
    // List all tables in the public schema
    console.log(`\nListing all tables in the database...`);
    
    const { data: tableList, error: tableListError } = await supabase
      .from('pg_tables')
      .select('schemaname, tablename')
      .eq('schemaname', 'public');
    
    if (tableListError) {
      console.error(`${RED}❌ Error listing tables: ${tableListError.message}${RESET}`);
      console.log(`Attempting direct query for timeline table...`);
    } else {
      console.log(`${GREEN}Found ${tableList.length} tables in the public schema:${RESET}`);
      tableList.forEach(table => {
        console.log(`- ${table.tablename}`);
      });
      
      // Check if our table exists
      const timelineTable = tableList.find(table => table.tablename === 'vehicle_timeline_events');
      if (timelineTable) {
        console.log(`${GREEN}✓ vehicle_timeline_events table exists!${RESET}`);
      } else {
        console.log(`${RED}❌ vehicle_timeline_events table not found!${RESET}`);
      }
    }

    // Try a direct query against the vehicle_timeline_events table
    console.log(`\nTesting direct query against vehicle_timeline_events...`);
    const { data: timelineData, error: timelineError } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (timelineError) {
      console.error(`${RED}❌ Error querying timeline table: ${timelineError.message}${RESET}`);
      
      // Check if the error indicates the table doesn't exist
      if (timelineError.message.includes('does not exist')) {
        console.log(`\n${YELLOW}Would you like to create the vehicle_timeline_events table now? (y/n)${RESET}`);
        process.stdin.once('data', async (data) => {
          const answer = data.toString().trim().toLowerCase();
          if (answer === 'y' || answer === 'yes') {
            console.log(`\nCreating vehicle_timeline_events table...`);
            
            try {
              // Create table with minimal fields
              const { error: createError } = await supabase.rpc('exec_sql', {
                sql: `
                CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
                
                CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
                  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                  vehicle_id UUID NOT NULL,
                  event_type VARCHAR(50) NOT NULL,
                  source VARCHAR(100) NOT NULL,
                  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
                  title TEXT NOT NULL,
                  description TEXT,
                  confidence_score INT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
                  metadata JSONB DEFAULT '{}'::jsonb,
                  source_url TEXT,
                  image_urls TEXT[],
                  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
                );
                
                CREATE INDEX IF NOT EXISTS vehicle_timeline_events_vehicle_id_idx ON vehicle_timeline_events(vehicle_id);
                CREATE INDEX IF NOT EXISTS vehicle_timeline_events_event_date_idx ON vehicle_timeline_events(event_date);
                
                ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;
                
                CREATE POLICY "Allow public read of timeline events" 
                  ON vehicle_timeline_events
                  FOR SELECT 
                  USING (true);
                `
              });
              
              if (createError) {
                console.error(`${RED}❌ Table creation failed: ${createError.message}${RESET}`);
                console.log(`\nPlease use the Supabase SQL Editor to create the table manually using the scripts/manual-timeline-setup.sql file.`);
              } else {
                console.log(`${GREEN}✓ Table created successfully!${RESET}`);
                console.log(`\nRun timeline tests with: npm run timeline:test`);
              }
            } catch (err) {
              console.error(`${RED}❌ Error: ${err.message}${RESET}`);
              console.log(`\nPlease use the Supabase SQL Editor to create the table manually using the scripts/manual-timeline-setup.sql file.`);
            }
          } else {
            console.log(`Table creation cancelled.`);
          }
          process.exit(0);
        });
      }
    } else {
      console.log(`${GREEN}✓ Successfully queried vehicle_timeline_events table!${RESET}`);
      console.log(`${GREEN}✓ Table exists and is accessible${RESET}`);
      
      if (timelineData && timelineData.length > 0) {
        console.log(`${GREEN}✓ Found ${timelineData.length} records in the table${RESET}`);
      } else {
        console.log(`${YELLOW}Table exists but is empty${RESET}`);
        console.log(`Run timeline test helper to seed data: npm run timeline:test`);
      }
      
      process.exit(0);
    }

  } catch (error) {
    console.error(`${RED}❌ Unexpected error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the checker
checkTimelineTable();
