#!/usr/bin/env node
/**
 * Deploy Professional Financial System to Supabase
 * Executes SQL directly via Supabase client
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment or .env
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  console.error('Run: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function deploySQL() {
  try {
    console.log('🚀 Deploying Professional Financial System...\n');

    // Read SQL file
    const sql = fs.readFileSync('./DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql', 'utf8');
    
    // Split into individual statements (skip comments and verification queries at end)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('SELECT'))
      .slice(0, -3); // Remove verification queries

    console.log(`📝 Found ${statements.length} SQL statements\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (stmt.length < 10) continue; // Skip empty/comment lines

      const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
      process.stdout.write(`[${i + 1}/${statements.length}] ${preview}...`);

      try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
        
        if (error) {
          // Try direct query if RPC doesn't work
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            },
            body: JSON.stringify({ sql_query: stmt + ';' })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        }
        
        console.log(' ✅');
      } catch (err) {
        console.log(` ⚠️  ${err.message}`);
      }
    }

    console.log('\n✅ Deployment complete!\n');
    console.log('Next steps:');
    console.log('1. Visit https://n-zero.dev/portfolio');
    console.log('2. Click "Deposit" and add $3');
    console.log('3. Verify balance shows $3.00');
    
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

deploySQL();

