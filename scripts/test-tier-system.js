#!/usr/bin/env node
/**
 * Test Tier System
 * Runs the tier system test SQL script via Supabase CLI or direct connection
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_SQL_PATH = path.join(__dirname, '..', 'supabase', 'sql', 'helpers', 'test_tier_system.sql');

async function runTests() {
  console.log('🧪 Testing Tier System...\n');
  
  if (!fs.existsSync(TEST_SQL_PATH)) {
    console.error('❌ Test SQL file not found:', TEST_SQL_PATH);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(TEST_SQL_PATH, 'utf8');
  
  // Check if we're using Supabase CLI
  try {
    execSync('which supabase', { stdio: 'ignore' });
    
    console.log('Using Supabase CLI to run tests...\n');
    
    // Try to run via Supabase CLI
    try {
      execSync(`supabase db execute --file "${TEST_SQL_PATH}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
    } catch (error) {
      console.error('\n❌ Failed to execute via Supabase CLI');
      console.error('You may need to:');
      console.error('  1. Link your project: supabase link --project-ref YOUR_PROJECT_REF');
      console.error('  2. Or run the SQL manually in your database');
      console.error('\nSQL file location:', TEST_SQL_PATH);
      process.exit(1);
    }
  } catch (error) {
    // Supabase CLI not found
    console.log('Supabase CLI not found. Please run the SQL manually:');
    console.log('\n  File:', TEST_SQL_PATH);
    console.log('\n  Or install Supabase CLI and link your project.');
    console.log('\n  You can also connect via psql:');
    console.log(`  psql $DATABASE_URL -f ${TEST_SQL_PATH}`);
    process.exit(0);
  }
}

runTests().catch(console.error);

