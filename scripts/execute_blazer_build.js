const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.supabase' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runBlazerBuild() {
  try {
    // Read the SQL file
    const sqlContent = fs.readFileSync(path.join(__dirname, 'blazer_build_complete.sql'), 'utf8');
    
    // Split into individual statements (remove comments and empty lines)
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'))
      .map(s => s.replace(/--.*$/gm, '').trim()) // Remove inline comments
      .filter(s => s);

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;
      
      console.log(`\nExecuting statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + '...');
      
      // Use RPC to execute raw SQL
      const { data, error } = await supabase.rpc('exec_sql', { 
        query: statement + ';' 
      }).single();
      
      if (error) {
        console.error('Error executing statement:', error);
        // Try direct approach for simpler statements
        if (statement.includes('INSERT INTO vehicle_builds')) {
          console.log('Trying direct insert approach...');
          const { data, error: insertError } = await supabase
            .from('vehicle_builds')
            .insert({
              vehicle_id: 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
              name: '1977 Blazer K5 - Complete Scott Performance Build',
              description: 'Frame-off restoration with LS3 swap, 6L90 transmission, Motec M130 ECU & PDM wiring',
              status: 'in_progress',
              total_budget: 150000.00,
              total_spent: 125840.33,
              total_hours_actual: 110,
              total_hours_estimated: 110,
              start_date: '2023-01-01'
            })
            .select();
          
          if (insertError) {
            console.error('Direct insert also failed:', insertError);
          } else {
            console.log('Direct insert successful:', data);
          }
        }
      } else {
        console.log('Success!');
      }
    }
    
    // Verify the data was inserted
    const { data: buildData, error: verifyError } = await supabase
      .from('vehicle_builds')
      .select('id, total_spent, total_budget')
      .eq('vehicle_id', 'e08bf694-970f-4cbe-8a74-8715158a0f2e')
      .single();
    
    if (buildData) {
      console.log('\n✅ Build data verified:');
      console.log('Build ID:', buildData.id);
      console.log('Total Spent:', buildData.total_spent);
      console.log('Total Budget:', buildData.total_budget);
    } else {
      console.log('\n⚠️ Could not verify build data');
    }

  } catch (error) {
    console.error('Script error:', error);
  }
}

runBlazerBuild();
