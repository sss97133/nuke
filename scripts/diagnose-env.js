/* eslint-disable no-undef */
/**
 * Environment variables diagnostic script
 * Run this to check if your environment is properly configured for development and production
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as process from 'process';
import dotenv from 'dotenv';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env files
dotenv.config({ path: path.resolve(rootDir, '.env') });
dotenv.config({ path: path.resolve(rootDir, '.env.local') });

// Define critical environment variables
const CRITICAL_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_SERVICE_KEY'
];

console.log('=============================================');
console.log('🔍 ENVIRONMENT DIAGNOSTIC TOOL');
console.log('=============================================');

// Check environment files
const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];
console.log('\n📁 Checking environment files:');
envFiles.forEach(fileName => {
  const filePath = path.resolve(rootDir, fileName);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${fileName} exists`);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const vars = dotenv.parse(content);
      const foundVars = Object.keys(vars);
      console.log(`   Contains ${foundVars.length} variables`);
      
      // Check for critical vars
      const criticalFound = CRITICAL_VARS.filter(v => foundVars.includes(v));
      if (criticalFound.length > 0) {
        console.log(`   ✅ Contains ${criticalFound.length}/${CRITICAL_VARS.length} critical variables`);
      } else {
        console.log(`   ⚠️ No critical variables found`);
      }
    } catch (err) {
      console.error(`   ❌ Error reading file: ${err.message}`);
    }
  } else {
    console.log(`❌ ${fileName} does not exist`);
  }
});

// Check loaded environment variables
console.log('\n🔐 Checking loaded environment variables:');
let missingCriticalVars = [];
CRITICAL_VARS.forEach(varName => {
  if (process.env[varName]) {
    const value = process.env[varName];
    console.log(`✅ ${varName} is set (${value.length} characters)`);
  } else {
    console.log(`❌ ${varName} is NOT set`);
    missingCriticalVars.push(varName);
  }
});

// Check package.json scripts
const pkgJsonPath = path.resolve(rootDir, 'package.json');
console.log('\n📦 Checking package.json scripts:');
try {
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const { scripts = {} } = pkgJson;
  
  const buildScript = scripts['build:prod'] || 'Not defined';
  console.log(`Build script: ${buildScript}`);
  
  // Check for env-related scripts
  const envScripts = Object.entries(scripts).filter(([name]) => 
    name.includes('env') || name.includes('vercel')
  );
  
  if (envScripts.length > 0) {
    console.log('\nEnvironment-related scripts:');
    envScripts.forEach(([name, script]) => {
      console.log(`- ${name}: ${script}`);
    });
  }
} catch (err) {
  console.error(`❌ Error reading package.json: ${err.message}`);
}

// Generate report
console.log('\n=============================================');
console.log('📋 DIAGNOSTIC REPORT');
console.log('=============================================');

if (missingCriticalVars.length === 0) {
  console.log('✅ All critical environment variables are present');
  console.log('You should be able to run the application without issues');
} else {
  console.log(`⚠️ Missing ${missingCriticalVars.length} critical environment variables:`);
  missingCriticalVars.forEach(v => console.log(`   - ${v}`));
  console.log('\nTo fix this:');
  console.log('1. Create or update your .env file with the missing variables');
  console.log('2. Make sure GitHub secrets are properly set up for Vercel deployment');
  console.log('3. Check that the GitHub Actions workflow for syncing secrets is running');
}

// Create a sample .env file if none exists
if (!fs.existsSync(path.resolve(rootDir, '.env')) && missingCriticalVars.length > 0) {
  console.log('\n📝 Creating a sample .env file...');
  const sampleEnv = CRITICAL_VARS.map(v => `${v}=your_${v.toLowerCase()}_here`).join('\n');
  
  try {
    fs.writeFileSync(path.resolve(rootDir, '.env.sample'), sampleEnv);
    console.log('✅ Created .env.sample file. Rename to .env and add your values.');
  } catch (err) {
    console.error(`❌ Error creating sample env file: ${err.message}`);
  }
}

console.log('\n=============================================');
console.log('For testing production builds locally:');
console.log('1. Copy .env to .env.production.local');
console.log('2. Run: npm run build:prod && npm run preview');
console.log('=============================================');
