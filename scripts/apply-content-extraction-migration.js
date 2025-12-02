import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('🚀 Applying intelligent content extraction system migration...\n');
  
  try {
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20251202_intelligent_content_extraction_system.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql }).single();
    
    if (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
    
    console.log('✅ Migration applied successfully!');
    console.log('\n📊 New tables created:');
    console.log('  - content_extraction_queue');
    console.log('  - attributed_data_sources');
    console.log('  - user_contribution_scores');
    console.log('  - data_merge_conflicts');
    console.log('\n🎯 New functions created:');
    console.log('  - queue_content_extraction()');
    console.log('  - award_contribution_points()');
    console.log('  - update_contribution_scores() [trigger]');
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

applyMigration();

