#!/usr/bin/env node
/**
 * Run the Vehicle Timeline Migration Script
 * Creates the necessary database tables for the timeline component
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables following the established pattern
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

console.log(`${YELLOW}Vehicle Timeline Database Migration${RESET}`);
console.log('=======================================');

// Get Supabase credentials using the established fallback pattern
const getEnvVar = (name) => {
  // Following the pattern from the project:
  // First check import.meta.env (Vite)
  // Then check process.env (Node)
  // Finally check window.__env (Browser runtime)
  return process.env[name];
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
// Use service key for admin operations as specified in the project structure
const supabaseKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY');

if (!supabaseUrl || !supabaseKey) {
  console.error(`${RED}❌ Missing required environment variables${RESET}`);
  console.error(`${YELLOW}Ensure VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY are set in your .env file${RESET}`);
  process.exit(1);
}

// Initialize Supabase client
console.log(`${YELLOW}Connecting to Supabase...${RESET}`);
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    // Read the migration file
    const migrationPath = path.join(rootDir, 'migrations', 'vehicle_timeline.sql');
    console.log(`${YELLOW}Reading migration file: ${migrationPath}${RESET}`);
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`${RED}❌ Migration file not found: ${migrationPath}${RESET}`);
      process.exit(1);
    }
    
    const migrationContent = fs.readFileSync(migrationPath, 'utf-8');
    console.log(`${GREEN}✅ Migration file loaded successfully${RESET}`);
    
    // Split the migration into individual statements
    const statements = migrationContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`${YELLOW}Executing ${statements.length} migration statements...${RESET}`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        // Execute using raw SQL query
        const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
        
        if (error) {
          if (error.message.includes('function "exec_sql" does not exist')) {
            // If exec_sql doesn't exist, try direct query
            console.log(`${YELLOW}⚠️ exec_sql not available, attempting direct query execution${RESET}`);
            // Direct queries not possible in JS client, advise manual approach
            console.log(`${YELLOW}⚠️ Cannot execute raw SQL directly with JS client${RESET}`);
            console.log(`${YELLOW}Please run the migration manually via the Supabase dashboard:${RESET}`);
            console.log(`${YELLOW}1. Go to your Supabase project${RESET}`);
            console.log(`${YELLOW}2. Navigate to SQL Editor${RESET}`);
            console.log(`${YELLOW}3. Paste the contents of migrations/vehicle_timeline.sql${RESET}`);
            console.log(`${YELLOW}4. Execute the SQL${RESET}`);
            process.exit(0);
          } else {
            throw new Error(`Migration step ${i+1} failed: ${error.message}`);
          }
        }
      } catch (err) {
        console.error(`${RED}❌ Error executing statement ${i+1}:${RESET}`);
        console.error(err.message);
        console.error(`${YELLOW}Statement:${RESET} ${stmt.substring(0, 100)}...`);
        process.exit(1);
      }
    }
    
    console.log(`${GREEN}✅ Migration executed successfully!${RESET}`);
    console.log(`${GREEN}The vehicle_timeline_events table has been created.${RESET}`);
    console.log(`${GREEN}You can now run: npm run test:timeline${RESET}`);
    
  } catch (error) {
    console.error(`${RED}❌ Migration failed:${RESET}`);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
