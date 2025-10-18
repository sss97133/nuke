#!/usr/bin/env node
/**
 * Execute SQL migration directly via Supabase Management API
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRef = supabaseUrl.split('//')[1].split('.')[0];

async function executeSQLDirect(sql) {
  // Use Supabase REST API to execute SQL
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ query: sql })
  });

  return response;
}

async function main() {
  console.log('🚀 Executing SQL Migration Directly\n');
  
  const sqlPath = path.join(__dirname, '../supabase/migrations/20251018_algorithmic_completion.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  // Try executing the entire SQL block
  console.log('📝 Executing SQL migration...\n');
  
  // Use pg library for direct connection
  const { Client } = require('pg');
  
  // Build connection string
  const connectionString = `postgresql://postgres.qkgaybvrernstplzjaam:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
  
  console.log('⚠️  Direct SQL execution requires database password.\n');
  console.log('Please execute the migration manually by running:\n');
  console.log('1. Copy the SQL file contents');
  console.log('2. Open Supabase Dashboard SQL Editor');
  console.log('3. Paste and execute\n');
  console.log('Or use psql if you have the database password:\n');
  console.log(`psql "postgresql://postgres.qkgaybvrernstplzjaam:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres" -f supabase/migrations/20251018_algorithmic_completion.sql\n`);
}

main().catch(console.error);

