import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Local database (port 54321 is the API, 54322 is the direct DB)
const localUrl = 'http://localhost:54321';
const localAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Remote database (production - currently commented out in .env)
const remoteUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const remoteAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

console.log('🔍 Database Environment Check\n');
console.log('Local URL:', localUrl);
console.log('Remote URL (from .env):', remoteUrl);
console.log('Are they the same?:', localUrl === remoteUrl ? 'YES (pointing to local)' : 'NO (different databases)');
console.log('');

async function checkDatabase(supabase, name) {
  console.log(`\n📊 ${name} Database Status:`);
  console.log('=' .repeat(50));
  
  try {
    // Check key tables
    const tables = [
      'profiles',
      'vehicles', 
      'vehicle_images',
      'vehicle_timeline_events',
      'timeline_event_types',
      'vehicle_verifications',
      'vehicle_extractions'
    ];

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        if (error) {
          console.log(`  ${table}: ❌ Error - ${error.message}`);
        } else {
          console.log(`  ${table}: ${count || 0} rows`);
        }
      } catch (e) {
        console.log(`  ${table}: ❌ Failed to query`);
      }
    }

    // Get sample data from profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, created_at')
      .limit(5);
    
    if (profiles && profiles.length > 0) {
      console.log('\n  Sample profiles:');
      profiles.forEach(p => {
        console.log(`    - ${p.email} (created: ${new Date(p.created_at).toLocaleDateString()})`);
      });
    }

    // Get sample vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('make, model, year, vin')
      .limit(5);
    
    if (vehicles && vehicles.length > 0) {
      console.log('\n  Sample vehicles:');
      vehicles.forEach(v => {
        console.log(`    - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (VIN: ${v.vin ? v.vin.slice(-6) : 'none'})`);
      });
    }

  } catch (error) {
    console.error(`Error checking ${name} database:`, error.message);
  }
}

async function main() {
  // Check local
  console.log('\n🔍 Checking LOCAL database (localhost:54321)...');
  const localSupabase = createClient(localUrl, localAnonKey);
  await checkDatabase(localSupabase, 'LOCAL');
  
  // Check remote
  console.log('\n🔍 Checking REMOTE/PRODUCTION database...');
  const remoteSupabase = createClient(remoteUrl, remoteAnonKey);
  await checkDatabase(remoteSupabase, 'REMOTE/PRODUCTION');
}

main()
  .then(() => {
    console.log('\n✨ Done!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
