#!/usr/bin/env node
/**
 * Setup Test Environment 
 * 
 * This script helps create or update a .env.test file with the proper credentials
 * needed for testing the Nuke platform.
 */

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
const CYAN = '\x1b[36m';

console.log(`${YELLOW}========================================${RESET}`);
console.log(`${YELLOW}        Test Environment Setup${RESET}`);
console.log(`${YELLOW}========================================${RESET}`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Check for existing .env.test file
const envTestPath = path.join(rootDir, '.env.test');
let existingEnv = {};

if (fs.existsSync(envTestPath)) {
  console.log(`${YELLOW}Found existing .env.test file${RESET}`);
  const envContent = fs.readFileSync(envTestPath, 'utf8');
  
  // Parse existing environment variables
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      existingEnv[key] = value;
    }
  });
}

// Required environment variables
const requiredVars = [
  {
    name: 'VITE_SUPABASE_URL',
    description: 'Supabase URL (from GitHub secrets)',
    placeholder: 'https://your-project.supabase.co'
  },
  {
    name: 'VITE_SUPABASE_ANON_KEY',
    description: 'Supabase Anonymous Key (from GitHub secrets)',
    placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  },
  {
    name: 'VITE_SUPABASE_SERVICE_KEY',
    description: 'Supabase Service Key (from GitHub secrets)',
    placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
];

// Recursively ask for variable values
function askForVariable(index) {
  if (index >= requiredVars.length) {
    writeEnvFile();
    return;
  }
  
  const variable = requiredVars[index];
  const existingValue = existingEnv[variable.name] || '';
  
  // Only ask if the existing value is empty or looks like a placeholder
  const needsInput = !existingValue || 
                     existingValue.includes('your-project') || 
                     existingValue.includes('your_supabase') ||
                     existingValue === variable.placeholder;
  
  if (needsInput) {
    console.log(`\n${CYAN}${variable.name}${RESET}`);
    console.log(`${variable.description}`);
    
    if (existingValue) {
      console.log(`Current value: ${existingValue}`);
    }
    
    rl.question(`Enter value for ${variable.name}: `, (value) => {
      if (value) {
        existingEnv[variable.name] = value;
      } else if (!existingValue) {
        existingEnv[variable.name] = variable.placeholder;
        console.log(`${YELLOW}Using placeholder value. Remember to update this before testing.${RESET}`);
      }
      
      askForVariable(index + 1);
    });
  } else {
    console.log(`${GREEN}✓ ${variable.name} already set${RESET}`);
    askForVariable(index + 1);
  }
}

// Write the environment file
function writeEnvFile() {
  try {
    let envContent = '';
    
    // Build env file content
    for (const variable of requiredVars) {
      envContent += `${variable.name}=${existingEnv[variable.name] || ''}\n`;
    }
    
    // Add any other existing variables that aren't in our required list
    for (const [key, value] of Object.entries(existingEnv)) {
      if (!requiredVars.some(v => v.name === key)) {
        envContent += `${key}=${value}\n`;
      }
    }
    
    // Write the file
    fs.writeFileSync(envTestPath, envContent);
    
    console.log(`\n${GREEN}✓ Successfully wrote .env.test file${RESET}`);
    console.log(`${YELLOW}File location: ${envTestPath}${RESET}`);
    console.log(`\n${CYAN}Next steps:${RESET}`);
    console.log(`1. Run the timeline migration: ${CYAN}node scripts/run-timeline-migration.js${RESET}`);
    console.log(`2. Test the timeline component: ${CYAN}npm run timeline:test${RESET}`);
    
    rl.close();
  } catch (error) {
    console.error(`${RED}❌ Error writing .env.test file:${RESET}`, error);
    rl.close();
    process.exit(1);
  }
}

// Start the process
console.log(`${YELLOW}Setting up test environment variables...${RESET}`);
console.log(`This will create or update your .env.test file with the credentials needed for testing.`);
console.log(`You can copy values from your GitHub secrets.`);

askForVariable(0);
