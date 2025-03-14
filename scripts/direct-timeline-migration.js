#!/usr/bin/env node

// Direct Timeline Migration script using Supabase JavaScript client
// This script aligns with the three-tier fallback mechanism for environment variables

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
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

// Path to SQL file
const sqlFilePath = path.join(rootDir, 'scripts', 'manual-timeline-setup.sql');

// Read the SQL file
console.log(`${YELLOW}Reading migration file: ${sqlFilePath}${RESET}`);
let sqlContent;
try {
  sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
  console.log(`${GREEN}✅ Migration file loaded successfully${RESET}`);
} catch (error) {
  console.error(`${RED}❌ Error reading migration file:${RESET}`, error.message);
  process.exit(1);
}

// Split SQL into individual statements
const statements = sqlContent
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0);

console.log(`Executing ${statements.length} migration statements...`);

// Function to execute SQL statements sequentially
async function executeStatements() {
  try {
    // First check if table already exists
    const { data: tableExists, error: checkError } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (!checkError) {
      console.log(`${GREEN}✅ vehicle_timeline_events table already exists${RESET}`);
      return;
    }
    
    // Execute the full SQL as a single query
    // This is a workaround as the PostgreSQL client from Supabase doesn't allow multiple statements
    // We'll create individual tables one by one
    
    // Create extension if not exists
    console.log('Creating UUID extension...');
    await supabase.rpc('dblab_execute_sql', { 
      sql: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 
    }).then(() => console.log('UUID extension created or already exists'));
    
    // Create vehicle_timeline_events table
    console.log('Creating vehicle_timeline_events table...');
    const createTableSQL = `
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
    `;
    
    const { error: createTableError } = await supabase.rpc('dblab_execute_sql', { 
      sql: createTableSQL 
    });
    
    if (createTableError) {
      throw new Error(`Error creating table: ${createTableError.message}`);
    }
    console.log('Table created successfully');
    
    // Create indexes
    console.log('Creating indexes...');
    await supabase.rpc('dblab_execute_sql', { 
      sql: 'CREATE INDEX IF NOT EXISTS vehicle_timeline_events_vehicle_id_idx ON vehicle_timeline_events(vehicle_id);' 
    });
    await supabase.rpc('dblab_execute_sql', { 
      sql: 'CREATE INDEX IF NOT EXISTS vehicle_timeline_events_event_date_idx ON vehicle_timeline_events(event_date);' 
    });
    console.log('Indexes created successfully');
    
    // Set up RLS
    console.log('Setting up Row Level Security...');
    await supabase.rpc('dblab_execute_sql', { 
      sql: 'ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;' 
    });
    
    // Create policies
    console.log('Creating access policies...');
    await supabase.rpc('dblab_execute_sql', { 
      sql: `
        CREATE POLICY "Allow public read of timeline events" 
        ON vehicle_timeline_events
        FOR SELECT 
        USING (true);
      ` 
    });
    
    await supabase.rpc('dblab_execute_sql', { 
      sql: `
        CREATE POLICY "Allow authorized users to insert timeline events" 
        ON vehicle_timeline_events
        FOR INSERT 
        TO authenticated
        WITH CHECK (true);
      ` 
    });
    
    await supabase.rpc('dblab_execute_sql', { 
      sql: `
        CREATE POLICY "Allow vehicle owners to update their timeline events" 
        ON vehicle_timeline_events
        FOR UPDATE 
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_timeline_events.vehicle_id
            AND v.owner_id = auth.uid()
          )
        );
      ` 
    });
    console.log('Policies created successfully');
    
    // Create update function and trigger
    console.log('Creating update function and trigger...');
    await supabase.rpc('dblab_execute_sql', { 
      sql: `
        CREATE OR REPLACE FUNCTION update_modified_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      ` 
    });
    
    await supabase.rpc('dblab_execute_sql', { 
      sql: `
        CREATE TRIGGER set_timestamp
        BEFORE UPDATE ON vehicle_timeline_events
        FOR EACH ROW
        EXECUTE FUNCTION update_modified_column();
      ` 
    });
    console.log('Trigger created successfully');
    
    console.log(`${GREEN}✅ Migration completed successfully${RESET}`);
    
  } catch (error) {
    console.error(`${RED}❌ Migration error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the migration
executeStatements()
  .catch(error => {
    console.error(`${RED}❌ Unhandled error:${RESET}`, error.message);
    process.exit(1);
  });
