import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setupStorage() {
  try {
    // Read the SQL file
    const sqlPath = path.join(process.cwd(), 'src', 'scripts', 'setupStoragePolicies.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) console.error("Database query error:", error);

    if (error) {
      console.error('Error setting up storage policies:', error);
      return;
    }

    console.log('Storage policies set up successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

setupStorage(); 