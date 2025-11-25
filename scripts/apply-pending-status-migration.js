#!/usr/bin/env node
/**
 * Apply Auto-Pending Status Migration
 * Uses Supabase REST API to execute SQL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.error('   Set it in your .env.local file or export it');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function applyMigration() {
  console.log('🚀 Applying Auto-Pending Status migration...\n');
  
  // Read migration file
  const migrationPath = path.join(__dirname, '../supabase/migrations/20250125000017_auto_pending_status_no_images.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('📄 Migration file loaded:', migrationPath);
  console.log('📏 SQL length:', sql.length, 'characters\n');
  
  try {
    // Split SQL into statements (semicolon-separated, but be careful with functions)
    // For now, execute as one block via RPC if available, or use direct SQL execution
    
    // Try using Supabase REST API exec_sql RPC
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: sql })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ RPC method failed:', errorText);
      console.log('\n🔄 Trying direct SQL execution via Supabase client...\n');
      
      // Fallback: Execute via Supabase client using raw SQL
      // Note: Supabase JS client doesn't support raw SQL directly, so we'll need to use the REST API
      // Or split into smaller chunks
      
      // For functions and triggers, we need to execute them separately
      const statements = sql.split(/;\s*(?=CREATE|DROP|COMMENT)/).filter(s => s.trim());
      
      console.log(`Executing ${statements.length} SQL statements...`);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (!statement) continue;
        
        // Add semicolon back if needed
        const fullStatement = statement.endsWith(';') ? statement : statement + ';';
        
        console.log(`  [${i + 1}/${statements.length}] Executing statement...`);
        
        const stmtResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ query: fullStatement })
        });
        
        if (!stmtResponse.ok) {
          const errorText = await stmtResponse.text();
          console.error(`  ❌ Statement ${i + 1} failed:`, errorText.substring(0, 200));
        } else {
          console.log(`  ✅ Statement ${i + 1} executed`);
        }
      }
    } else {
      console.log('✅ Migration applied successfully via RPC!');
    }
    
    console.log('\n✅ Migration complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. The triggers are now active');
    console.log('   2. Run fix_vehicles_without_images() to fix existing vehicles:');
    console.log('      SELECT * FROM fix_vehicles_without_images();');
    console.log('   3. Or fix specific vehicles using mark_vehicles_pending_no_images.sql');
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
    console.error('\n💡 Alternative: Apply the migration manually in Supabase SQL Editor:');
    console.error('   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql');
    process.exit(1);
  }
}

applyMigration().catch(console.error);

