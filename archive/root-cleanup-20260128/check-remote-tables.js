require('dotenv').config({ path: '.env.local' });

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

async function getRemoteTables() {
  console.log('Fetching remote database tables...\n');

  // Query to get all tables from information_schema
  const query = `
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ sql: query })
    });

    if (!response.ok) {
      // Try alternative approach - list tables via REST endpoints
      console.log('Direct SQL not available, checking via REST endpoints...\n');

      // Common table names to check
      const tablesToCheck = [
        'vehicles', 'users', 'profiles', 'timeline_events',
        'shops', 'organizations', 'vehicle_images', 'receipts',
        'discovery_sources', 'duplicate_detections', 'shops_locations',
        'vehicle_location_observations', 'auction_events'
      ];

      console.log('Tables found in remote database:');
      console.log('================================');

      for (const table of tablesToCheck) {
        const testResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });

        if (testResponse.ok) {
          // Get count
          const countResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?select=count`, {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'count=exact',
              'Range': '0-0'
            }
          });

          const contentRange = countResponse.headers.get('content-range');
          const count = contentRange ? contentRange.split('/')[1] : '?';

          console.log(`✅ ${table.padEnd(30)} (${count} records)`);
        }
      }
    } else {
      const result = await response.json();
      console.log('Tables in remote database:', result);
    }

  } catch (error) {
    console.error('Error fetching tables:', error);
  }
}

getRemoteTables().catch(console.error);