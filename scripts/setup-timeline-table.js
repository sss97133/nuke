#!/usr/bin/env node

/**
 * Direct Timeline Table Setup
 * This script executes the SQL statements directly using proper admin privileges
 * It aligns with the three-tier fallback mechanism for environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import readline from 'readline';

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
dotenv.config({ path: path.join(rootDir, '.env.development') });

console.log(`${YELLOW}========================================${RESET}`);
console.log(`${YELLOW}Vehicle Timeline Table Setup${RESET}`);
console.log(`${YELLOW}========================================${RESET}`);
console.log('Loading environment variables...');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to get environment variables with fallback mechanism
function getEnvVar(name) {
  // Try process.env first (Node.js)
  if (process.env[name]) {
    console.log(`✓ Found ${name} in environment variables`);
    return process.env[name];
  }
  
  console.error(`${RED}Error: ${name} environment variable is not set${RESET}`);
  return null;
}

// Helper function to prompt for input
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function setupTimelineTable() {
  try {
    // Get Supabase credentials
    let supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
    let supabaseServiceKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY');
    
    // If credentials are missing, prompt user
    if (!supabaseUrl) {
      supabaseUrl = await prompt(`Enter your Supabase URL: `);
    }
    
    if (!supabaseServiceKey) {
      supabaseServiceKey = await prompt(`Enter your Supabase Service Key: `);
      // Save to .env.test for future use
      const envTestPath = path.join(rootDir, '.env.test');
      let envContent = '';
      
      try {
        if (fs.existsSync(envTestPath)) {
          envContent = fs.readFileSync(envTestPath, 'utf8');
        }
        
        // Update or add the variables
        if (!envContent.includes('VITE_SUPABASE_URL')) {
          envContent += `\nVITE_SUPABASE_URL=${supabaseUrl}\n`;
        } else {
          envContent = envContent.replace(/VITE_SUPABASE_URL=.*\n/, `VITE_SUPABASE_URL=${supabaseUrl}\n`);
        }
        
        if (!envContent.includes('VITE_SUPABASE_SERVICE_KEY')) {
          envContent += `\nVITE_SUPABASE_SERVICE_KEY=${supabaseServiceKey}\n`;
        } else {
          envContent = envContent.replace(/VITE_SUPABASE_SERVICE_KEY=.*\n/, `VITE_SUPABASE_SERVICE_KEY=${supabaseServiceKey}\n`);
        }
        
        fs.writeFileSync(envTestPath, envContent);
        console.log(`${GREEN}✓ Updated .env.test with Supabase credentials${RESET}`);
      } catch (error) {
        console.error(`${RED}Failed to update .env.test: ${error.message}${RESET}`);
      }
    }
    
    // Initialize Supabase client with admin privileges
    console.log(`\nInitializing Supabase client...`);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Check if table already exists
    console.log(`\nChecking if vehicle_timeline_events table exists...`);
    const { data, error } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (!error) {
      console.log(`${GREEN}✓ vehicle_timeline_events table already exists${RESET}`);
      rl.close();
      return;
    }
    
    console.log(`\n${YELLOW}Creating vehicle_timeline_events table...${RESET}`);
    
    // Read the SQL file
    const sqlFilePath = path.join(rootDir, 'scripts', 'manual-timeline-setup.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
    
    // Split SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`Found ${statements.length} SQL statements to execute`);
    
    // Confirm with user
    const confirmation = await prompt(`\nThe vehicle_timeline_events table will be created with the proper structure for the Digital Vehicle Identity concept.\nProceed? (y/n): `);
    
    if (confirmation.toLowerCase() !== 'y') {
      console.log('Setup cancelled by user');
      rl.close();
      return;
    }
    
    // Try executing through stored procedure if available
    console.log(`\n${YELLOW}Attempting to create the table...${RESET}`);
    console.log(`This may take a moment...`);
    
    // First create extension and table
    try {
      // 1. Create extension
      await supabase.rpc('exec_sql', { 
        sql: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 
      });
      console.log(`${GREEN}✓ UUID extension enabled${RESET}`);
      
      // 2. Create table
      const createTableSQL = statements[1] + ';';
      await supabase.rpc('exec_sql', { sql: createTableSQL });
      console.log(`${GREEN}✓ vehicle_timeline_events table created${RESET}`);
      
      // 3. Create indexes
      await supabase.rpc('exec_sql', { sql: statements[2] + ';' });
      await supabase.rpc('exec_sql', { sql: statements[3] + ';' });
      console.log(`${GREEN}✓ Indexes created${RESET}`);
      
      // 4. Set up RLS
      await supabase.rpc('exec_sql', { sql: statements[4] + ';' });
      console.log(`${GREEN}✓ Row Level Security enabled${RESET}`);
      
      // 5. Create policies
      await supabase.rpc('exec_sql', { sql: statements[5] + ';' });
      await supabase.rpc('exec_sql', { sql: statements[6] + ';' });
      await supabase.rpc('exec_sql', { sql: statements[7] + ';' });
      console.log(`${GREEN}✓ Security policies created${RESET}`);
      
      // 6. Create update function and trigger
      await supabase.rpc('exec_sql', { sql: statements[8] + ';' });
      await supabase.rpc('exec_sql', { sql: statements[9] + ';' });
      console.log(`${GREEN}✓ Update timestamp trigger created${RESET}`);
      
      console.log(`\n${GREEN}✅ Vehicle timeline table setup complete!${RESET}`);
      console.log(`The table is ready for the Multi-Source Connector Framework integration.`);
      
    } catch (execError) {
      console.error(`${RED}❌ Error: ${execError.message}${RESET}`);
      console.log(`\n${YELLOW}The exec_sql function may not be available in your Supabase instance.${RESET}`);
      console.log(`Please follow these steps to set up the table manually:`);
      console.log(`1. Log in to your Supabase Dashboard at ${supabaseUrl.replace('https://', 'https://app.supabase.com/project/')}`);
      console.log(`2. Go to SQL Editor`);
      console.log(`3. Paste the content from scripts/manual-timeline-setup.sql`);
      console.log(`4. Run the SQL to create everything at once`);
      console.log(`\nAfter manual setup, run: npm run timeline:test`);
    }
    
    rl.close();
    
  } catch (error) {
    console.error(`${RED}❌ Unexpected error:${RESET}`, error.message);
    rl.close();
    process.exit(1);
  }
}

// Run the setup
setupTimelineTable();
