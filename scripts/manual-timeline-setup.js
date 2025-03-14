#!/usr/bin/env node
/**
 * Manual Timeline Setup Script
 * This script sets up the timeline database structure regardless of 
 * environment configuration issues.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

console.log(`${YELLOW}Manual Vehicle Timeline Database Setup${RESET}`);
console.log('=======================================');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt for Supabase credentials if needed
async function promptForCredentials() {
  return new Promise((resolve) => {
    // Check if we already have the env vars in GitHub secrets
    console.log(`${YELLOW}Checking for credentials in environment...${RESET}`);
    
    // Get from GitHub secrets if available
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.VITE_SUPABASE_SERVICE_KEY;
    
    if (url && serviceKey) {
      console.log(`${GREEN}✅ Found credentials in environment${RESET}`);
      resolve({ url, serviceKey });
      return;
    }
    
    console.log(`${YELLOW}Please enter your Supabase credentials:${RESET}`);
    
    rl.question('Supabase URL: ', (url) => {
      rl.question('Supabase Service Key: ', (serviceKey) => {
        resolve({ url, serviceKey });
        rl.close();
      });
    });
  });
}

async function runMigration() {
  try {
    const credentials = await promptForCredentials();
    
    // Initialize Supabase client
    console.log(`${YELLOW}Connecting to Supabase...${RESET}`);
    const supabase = createClient(credentials.url, credentials.serviceKey);
    
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
