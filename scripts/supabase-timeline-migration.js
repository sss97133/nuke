#!/usr/bin/env node

// This script uses the Supabase CLI to run the vehicle timeline SQL migration
// It handles the environment variable access pattern properly

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

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

// Get Supabase URL from env
const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');

// Parse the project reference from the Supabase URL
// Example: https://abcdefghijkl.supabase.co -> abcdefghijkl
function getProjectRef(url) {
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (match && match[1]) {
    return match[1];
  }
  console.error(`${RED}Error: Could not parse project ref from Supabase URL: ${url}${RESET}`);
  process.exit(1);
}

// Get project reference
const projectRef = getProjectRef(supabaseUrl);

console.log(`${YELLOW}Vehicle Timeline Database Migration${RESET}`);
console.log('=======================================');
console.log(`Using Supabase project ref: ${projectRef}`);

// Path to SQL file
const sqlFilePath = path.join(rootDir, 'scripts', 'manual-timeline-setup.sql');

try {
  console.log(`${YELLOW}Reading migration file: ${sqlFilePath}${RESET}`);
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
  console.log(`${GREEN}✅ Migration file loaded successfully${RESET}`);
  
  // Create a temporary file to use with supabase cli
  const tempSqlPath = path.join(rootDir, 'scripts', 'temp-migration.sql');
  fs.writeFileSync(tempSqlPath, sqlContent);
  
  try {
    console.log(`${YELLOW}Executing SQL via Supabase CLI...${RESET}`);
    
    // Execute the SQL using Supabase CLI (which has its own auth from the login step)
    const result = execSync(`supabase db execute --project-ref ${projectRef} --file ${tempSqlPath}`, { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    console.log(`${GREEN}✅ Migration executed successfully${RESET}`);
    console.log(result);
    
  } catch (execError) {
    console.error(`${RED}❌ Error executing SQL via Supabase CLI:${RESET}`);
    console.error(execError.message);
    if (execError.stdout) console.log(`STDOUT: ${execError.stdout}`);
    if (execError.stderr) console.error(`STDERR: ${execError.stderr}`);
  } finally {
    // Clean up the temp file
    fs.unlinkSync(tempSqlPath);
  }
  
} catch (error) {
  console.error(`${RED}❌ Error:${RESET}`, error.message);
  process.exit(1);
}
