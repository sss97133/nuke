const fetch = require('node-fetch');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.iCr_1fFe9u9VwseiVLCXdjsuMg_3rbtQSWgfh4cneVo';

async function applyDirectSchemaUpdate() {
  console.log('Applying schema updates using direct REST API...');
  
  // Core fields needed for the "Add Event" button to work
  const alterTableSql = `
  ALTER TABLE timeline_events 
  ADD COLUMN IF NOT EXISTS mileage_at_event INTEGER,
  ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS cost_currency TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS location_name TEXT,
  ADD COLUMN IF NOT EXISTS location_address TEXT,
  ADD COLUMN IF NOT EXISTS service_provider_name TEXT,
  ADD COLUMN IF NOT EXISTS service_provider_type TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS parts_used JSONB[],
  ADD COLUMN IF NOT EXISTS is_insurance_claim BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insurance_claim_number TEXT,
  ADD COLUMN IF NOT EXISTS next_service_due_date DATE,
  ADD COLUMN IF NOT EXISTS next_service_due_mileage INTEGER;
  `;

  try {
    console.log('Sending SQL query to add columns to timeline_events...');
    
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        sql: alterTableSql
      })
    });

    const result = await response.text();
    
    if (response.ok) {
      console.log('✅ Schema update successful');
      console.log(result);
    } else {
      console.error('❌ Schema update failed:', response.status, response.statusText);
      console.error(result);
    }

    // Verify the update worked
    console.log('\nVerifying schema update...');
    
    const testInsert = await fetch(`${supabaseUrl}/rest/v1/timeline_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        title: 'Schema Test Event',
        description: 'Testing enhanced schema fields',
        vehicle_id: '00000000-0000-0000-0000-000000000000', // Placeholder ID
        cost_amount: 123.45,
        service_provider_name: 'Test Provider'
      })
    });

    if (testInsert.ok) {
      console.log('✅ Test insert with new fields successful!');
    } else {
      const errorText = await testInsert.text();
      console.error('❌ Test insert failed:', testInsert.status, testInsert.statusText);
      console.error(errorText);
    }
    
  } catch (error) {
    console.error('❌ Error during schema update:', error);
  }
}

applyDirectSchemaUpdate().catch(console.error);
