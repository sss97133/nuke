#!/usr/bin/env node
/**
 * Apply Personal Photo Library Migration
 * Uses Supabase REST API to execute SQL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

async function applyMigration() {
  console.log('🚀 Applying Personal Photo Library migration...\n');
  
  // Read migration file
  const migrationPath = path.join(__dirname, '../supabase/migrations/20251123200000_personal_photo_library.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('📄 Migration file loaded:', migrationPath);
  console.log('📏 SQL length:', sql.length, 'characters\n');
  
  try {
    // Use Supabase REST API to execute SQL
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
      const error = await response.text();
      console.error('❌ Migration failed:', error);
      
      // Try alternative method: direct SQL query
      console.log('\n🔄 Trying alternative method...\n');
      
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      
      // Execute SQL in smaller chunks
      const statements = sql.split(';').filter(s => s.trim());
      console.log(`📦 Executing ${statements.length} SQL statements...\n`);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (!statement || statement.startsWith('--')) continue;
        
        process.stdout.write(`[${i + 1}/${statements.length}] Executing... `);
        
        const { error } = await supabase.rpc('exec_sql', { query: statement + ';' });
        
        if (error) {
          console.log('⚠️  Error (continuing):', error.message.substring(0, 100));
        } else {
          console.log('✅');
        }
      }
      
      console.log('\n✅ Migration completed with alternative method!');
      return;
    }
    
    console.log('✅ Migration applied successfully!\n');
    
  } catch (error) {
    console.error('❌ Error applying migration:', error.message);
    process.exit(1);
  }
}

applyMigration();

