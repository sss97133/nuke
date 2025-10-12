const https = require('https');

const supabaseUrl = 'qkgaybvrernstplzjaam.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

async function checkSchema() {
  console.log('Checking actual timeline_events columns via direct API...\n');

  // Query to get column info
  const query = `?select=*&limit=0`;
  
  const options = {
    hostname: supabaseUrl,
    path: `/rest/v1/timeline_events${query}`,
    method: 'GET',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'count=exact'
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('Response Status:', res.statusCode);
        console.log('Headers:', JSON.stringify(res.headers, null, 2));
        
        if (res.statusCode === 200) {
          console.log('\n✅ Table exists and is accessible');
          
          // Check for specific headers that indicate column issues
          const contentRange = res.headers['content-range'];
          if (contentRange) {
            console.log('Content-Range:', contentRange);
          }
        } else {
          console.log('Response:', data);
        }
        
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('Request error:', e);
      resolve();
    });
    
    req.end();
  });
}

async function testSimpleInsert() {
  console.log('\nTesting simple insert with basic fields only...\n');

  const eventData = {
    vehicle_id: 'ef802d86-0b17-46f1-b4f9-525726aa1d3e',
    title: 'Basic maintenance',
    event_type: 'maintenance',
    event_date: '2025-01-31'
  };

  const options = {
    hostname: supabaseUrl,
    path: '/rest/v1/timeline_events',
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('Insert Response Status:', res.statusCode);
        
        if (res.statusCode === 201) {
          console.log('✅ Event created successfully');
          const event = JSON.parse(data);
          console.log('Event ID:', event.id);
        } else if (res.statusCode === 403) {
          console.log('✅ RLS properly blocks anonymous insert');
        } else {
          console.log('Response:', data);
        }
        
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('Request error:', e);
      resolve();
    });
    
    req.write(JSON.stringify(eventData));
    req.end();
  });
}

async function main() {
  await checkSchema();
  await testSimpleInsert();
  
  console.log('\n' + '='.repeat(50));
  console.log('NEXT STEPS:');
  console.log('1. Create event_images table');
  console.log('   SQL: /Users/skylar/nuke/simple_event_images_table.sql');
  console.log('2. Create vehicle-images storage bucket');
  console.log('3. Test the VehicleTimelineMinimal component');
  console.log('='.repeat(50));
}

main();
