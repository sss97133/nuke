#!/usr/bin/env node
/**
 * Run SQL against remote Supabase database
 * Uses your existing credentials from STABLE_CONFIGURATION.md
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Your remote Supabase credentials
const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

async function runSQL(sqlFile) {
  console.log('🚀 Running SQL against remote Supabase...');
  console.log(`📄 File: ${sqlFile}`);
  
  try {
    // Read SQL file
    const sqlPath = path.resolve(sqlFile);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`SQL file not found: ${sqlPath}`);
    }
    
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    console.log(`📝 SQL content length: ${sqlContent.length} characters`);
    
    // Create Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // Execute SQL using RPC (for complex queries)
    console.log('⚡ Executing SQL...');
    
    // Split SQL into individual statements and execute them
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📊 Found ${statements.length} SQL statements to execute`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.length < 10) continue; // Skip very short statements
      
      try {
        console.log(`   ${i + 1}/${statements.length}: Executing...`);
        
        // Use rpc to execute raw SQL
        const { data, error } = await supabase.rpc('exec_sql', { 
          sql_query: statement + ';' 
        });
        
        if (error) {
          console.log(`   ❌ Error: ${error.message}`);
          errorCount++;
        } else {
          console.log(`   ✅ Success`);
          successCount++;
        }
      } catch (err) {
        console.log(`   ❌ Exception: ${err.message}`);
        errorCount++;
      }
    }
    
    console.log('\n📊 EXECUTION SUMMARY:');
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('🎉 ALL SQL EXECUTED SUCCESSFULLY!');
      console.log('\n🧪 Ready to test:');
      console.log('   • Browse Professionals: http://localhost:5173/browse-professionals');
      console.log('   • Vehicle Project Management: Go to any vehicle profile');
    } else {
      console.log('⚠️  Some statements failed - check Supabase Dashboard for details');
    }
    
  } catch (error) {
    console.error('❌ Script error:', error.message);
    console.log('\n💡 Alternative: Copy FINAL_SQL_SETUP.sql into Supabase Dashboard → SQL Editor');
    process.exit(1);
  }
}

// Get SQL file from command line argument
const sqlFile = process.argv[2] || './FINAL_SQL_SETUP.sql';

if (require.main === module) {
  runSQL(sqlFile)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runSQL };
