import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '@/config/environment';

// Create a Supabase client with admin privileges
const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupSkillStructure() {
  try {
    console.log(`Setting up skill structure in ${config.environment} environment...`);

    // Read the SQL files
    const structurePath = path.join(__dirname, 'setupSkillStructure.sql');
    const functionsPath = path.join(__dirname, 'setupSkillFunctions.sql');

    const structureSql = fs.readFileSync(structurePath, 'utf8');
    const functionsSql = fs.readFileSync(functionsPath, 'utf8');

    // Execute the SQL
    const { error: structureError } = await supabaseAdmin.rpc('exec_sql', {
  if (error) console.error("Database query error:", error);
      sql: structureSql
    });

    if (structureError) {
      console.error('Error setting up skill structure:', structureError);
      process.exit(1);
    }

    const { error: functionsError } = await supabaseAdmin.rpc('exec_sql', {
  if (error) console.error("Database query error:", error);
      sql: functionsSql
    });

    if (functionsError) {
      console.error('Error setting up skill functions:', functionsError);
      process.exit(1);
    }

    console.log('Successfully set up skill structure and functions');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the setup
setupSkillStructure(); 