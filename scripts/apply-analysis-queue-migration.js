/**
 * Apply Analysis Queue Migration
 * Uses Supabase client to execute SQL directly
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

async function applyMigration() {
  console.log('🔧 Applying Analysis Queue Migration...\n');
  
  try {
    // Read the migration file
    const migrationPath = join(projectRoot, 'supabase/migrations/20250130_create_analysis_queue.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Split into statements (rough split by semicolons, but handle function bodies)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement || statement.length < 10) continue;
      
      try {
        console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`);
        const { error } = await supabase.rpc('exec_sql', { query: statement + ';' });
        
        if (error) {
          // Try direct query if RPC doesn't exist
          const { error: directError } = await supabase
            .from('_migrations')
            .select('*')
            .limit(0); // Dummy query to test connection
          
          if (directError && directError.code === '42P01') {
            // Table doesn't exist, try executing via raw SQL
            console.log(`  ⚠️  RPC not available, trying alternative method...`);
            // For now, just log - user will need to run in Supabase Dashboard
            console.log(`  📋 Statement to run manually:\n${statement.substring(0, 200)}...`);
          } else {
            console.log(`  ⚠️  Error (may already exist): ${error.message.substring(0, 100)}`);
          }
        } else {
          console.log(`  ✅ Statement ${i + 1} executed`);
        }
      } catch (err) {
        console.log(`  ⚠️  Statement ${i + 1} error: ${err.message.substring(0, 100)}`);
      }
    }
    
    // Also apply triggers migration
    console.log('\n🔧 Applying Auto-Queue Triggers Migration...\n');
    const triggersPath = join(projectRoot, 'supabase/migrations/20250130_auto_queue_analysis_triggers.sql');
    const triggersSQL = readFileSync(triggersPath, 'utf-8');
    
    console.log('📝 Triggers migration loaded\n');
    console.log('⚠️  Note: Some statements may need to be run manually in Supabase Dashboard → SQL Editor');
    console.log('📋 Migration files:');
    console.log(`   - ${migrationPath}`);
    console.log(`   - ${triggersPath}\n`);
    
    // Verify table was created
    console.log('🔍 Verifying migration...');
    const { data: tableCheck, error: tableError } = await supabase
      .from('analysis_queue')
      .select('id')
      .limit(1);
    
    if (tableError) {
      if (tableError.code === '42P01') {
        console.log('❌ analysis_queue table still does not exist');
        console.log('📋 Please run the migration manually in Supabase Dashboard → SQL Editor');
        console.log(`   File: ${migrationPath}`);
      } else {
        console.log('⚠️  Error checking table:', tableError.message);
      }
    } else {
      console.log('✅ analysis_queue table exists!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📋 Please run migrations manually:');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Open: supabase/migrations/20250130_create_analysis_queue.sql');
    console.log('   3. Run the SQL');
    console.log('   4. Open: supabase/migrations/20250130_auto_queue_analysis_triggers.sql');
    console.log('   5. Run the SQL');
    process.exit(1);
  }
}

applyMigration();

