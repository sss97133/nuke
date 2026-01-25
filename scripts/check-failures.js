#!/usr/bin/env node

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkFailures() {
  // First check import_queue schema
  const schemaRes = await fetch(`${SUPABASE_URL}/rest/v1/import_queue?limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const schemaData = await schemaRes.json();

  if (schemaData.code) {
    console.log('Error accessing import_queue:', schemaData.message);
    return;
  }

  if (Array.isArray(schemaData) && schemaData.length > 0) {
    console.log('import_queue columns:', Object.keys(schemaData[0]));
  }

  // Get sample of failed items
  const failedRes = await fetch(`${SUPABASE_URL}/rest/v1/import_queue?status=eq.failed&select=*&limit=10`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const failedData = await failedRes.json();

  if (failedData.code) {
    console.log('Error getting failed items:', failedData.message);
    return;
  }

  console.log('\nFailed import_queue sample:');
  if (Array.isArray(failedData)) {
    failedData.slice(0, 3).forEach((item, i) => {
      console.log(`\n[${i + 1}]`);
      Object.entries(item).forEach(([k, v]) => {
        if (v !== null) {
          const display = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80);
          console.log(`  ${k}: ${display}`);
        }
      });
    });
  }
}

checkFailures().catch(console.error);
