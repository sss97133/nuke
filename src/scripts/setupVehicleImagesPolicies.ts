import { supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '@/config/environment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupVehicleImagesPolicies() {
  try {
    console.log(`Setting up vehicle images policies in ${config.environment} environment...`);

    // Read the SQL template file
    const templatePath = path.join(__dirname, 'setupVehicleImagesPolicies.sql.template');
    const sql = fs.readFileSync(templatePath, 'utf8');

    // Execute the SQL
    const { error } = await supabaseAdmin.rpc('exec_sql', {
      sql
    });

    if (error) {
      console.error('Error setting up vehicle_images policies:', error);
      process.exit(1);
    }

    console.log('Successfully set up vehicle_images policies');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the setup
setupVehicleImagesPolicies(); 