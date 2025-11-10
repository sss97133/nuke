#!/usr/bin/env node
/**
 * Backfill BaT Images
 * 
 * For vehicles with VIVA- VINs (BaT imports):
 * 1. Find the original BaT listing URL
 * 2. Download all listing images
 * 3. Upload to Supabase storage
 * 4. Add to vehicle_images table
 * 
 * This gives us ORIGINAL auction photos instead of Dropbox dumps
 */

const { Client } = require('pg');
const { chromium } = require('playwright');

const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

const VIVA_MEMBER_URL = 'https://bringatrailer.com/member/vivalasvegasautos/';

async function findBaTListingURL(year, make, model) {
  // For now, return null - would need to scrape BaT to find URLs
  // This requires matching year/make/model to listing titles
  console.log(`  [TODO] Need to find BaT URL for ${year} ${make} ${model}`);
  return null;
}

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║     BaT IMAGE BACKFILL                                ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    // Get BaT vehicles without BaT images
    const vehicles = await client.query(`
      SELECT v.id, v.year, v.make, v.model
      FROM vehicles v
      WHERE v.vin LIKE 'VIVA-%'
        AND (v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR v.uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4')
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_images vi 
          WHERE vi.vehicle_id = v.id 
            AND vi.image_url LIKE '%bringatrailer%'
        )
      ORDER BY v.created_at DESC
      LIMIT 30
    `);
    
    console.log(`Found ${vehicles.rows.length} BaT vehicles needing original listing images\n`);
    
    if (vehicles.rows.length === 0) {
      console.log('✅ All BaT vehicles already have listing images!\n');
      return;
    }
    
    console.log('RECOMMENDATION:\n');
    console.log('Use existing script to download BaT images:');
    console.log('  node scripts/download-and-upload-bat-images.js\n');
    console.log('OR');
    console.log('Run BaT bulk import again with image download enabled:');
    console.log('  node scripts/import-all-bat-complete.js\n');
    
    console.log('These will:');
    console.log('  1. Find original BaT listing for each vehicle');
    console.log('  2. Download all listing photos');
    console.log('  3. Upload to Supabase storage');
    console.log('  4. Link to vehicle in database\n');
    
    console.log(`Vehicles needing BaT images:\n`);
    vehicles.rows.slice(0, 10).forEach(v => {
      console.log(`  ${v.year} ${v.make} ${v.model} (ID: ${v.id.substring(0, 8)}...)`);
    });
    
  } finally {
    await client.end();
  }
}

main();

