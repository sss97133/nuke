#!/usr/bin/env node

/**
 * Batch analyze organization facility images
 * Processes all unanalyzed facility images across all organizations
 */

import https from 'https';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjkxOTE5MDMsImV4cCI6MjA0NDc2NzkwM30.pVVB8b0qwHBY9jbDXj5nQQN3UWaJw-JsaaMi9U3-SAs';

async function getUnanalyzedOrganizations() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'qkgaybvrernstplzjaam.supabase.co',
      path: '/rest/v1/rpc/get_unanalyzed_orgs',
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify({}));
    req.end();
  });
}

async function analyzeOrganization(orgId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ organizationId: orgId, batch: true });
    
    const options = {
      hostname: 'qkgaybvrernstplzjaam.supabase.co',
      path: '/functions/v1/analyze-organization-images',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log(`Analyzing organization ${orgId}...`);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Response for ${orgId}:`, data);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`Error for ${orgId}:`, e.message);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('🚀 Starting batch organization image analysis...\n');
  
  // Hardcoded orgs from query
  const orgs = [
    { id: 'f26e26f9-78d6-4f73-820b-fa9015d9242b', count: 260, name: 'Unknown 1' },
    { id: 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', count: 98, name: 'Viva Las Vegas Autos' },
    { id: '1f76d43c-4dd6-4ee9-99df-6c46fd284654', count: 47, name: 'Unknown 2' },
    { id: 'e796ca48-f3af-41b5-be13-5335bb422b41', count: 30, name: 'Unknown 3' }
  ];

  console.log(`Found ${orgs.length} organizations with ${orgs.reduce((sum, o) => sum + o.count, 0)} total unanalyzed images\n`);

  for (const org of orgs) {
    console.log(`\n📊 Processing: ${org.name || org.id}`);
    console.log(`   Images to analyze: ${org.count}`);
    
    try {
      const result = await analyzeOrganization(org.id);
      console.log(`   ✅ Success:`, result);
      
      // Wait 2 seconds between orgs to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
    }
  }

  console.log('\n✅ Batch processing complete!');
}

main().catch(console.error);

