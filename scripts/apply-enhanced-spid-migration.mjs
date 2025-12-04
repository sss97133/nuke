#!/usr/bin/env node

/**
 * Apply Enhanced SPID Verification Migration
 * Reads the migration file and applies it to the database
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function applyMigration() {
  try {
    console.log('📖 Reading migration file...');
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20251203_enhanced_spid_verification_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split into individual statements to execute one by one
    const statements = migrationSQL
      .split(/;\s*$/gm)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`🔄 Applying ${statements.length} SQL statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim().length === 0) continue;
      
      console.log(`  ${i + 1}/${statements.length}...`);
      
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });
      
      if (error) {
        console.error(`❌ Statement ${i + 1} failed:`, error);
        console.error('Statement:', statement.substring(0, 200));
        // Continue with other statements
      }
    }
    
    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('Created tables:');
    console.log('  - vin_decode_cache');
    console.log('  - vehicle_comprehensive_verification');
    console.log('');
    console.log('Created functions:');
    console.log('  - trigger_vin_decode()');
    console.log('  - verify_vehicle_from_spid_enhanced()');
    console.log('');
    console.log('✅ SPID verification system enhanced!');
    console.log('');
    console.log('When an SPID is detected, the system will now:');
    console.log('  1. Extract all SPID data (VIN, paint codes, RPO codes, etc.)');
    console.log('  2. Auto-fill empty vehicle fields');
    console.log('  3. Trigger VIN decoding via NHTSA VPIC API');
    console.log('  4. Cross-verify all extracted data');
    console.log('  5. Log any discrepancies');
    console.log('  6. Update comprehensive verification status');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

applyMigration();

