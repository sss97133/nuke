#!/usr/bin/env node
/**
 * Listing Quality Audit
 * Identifies shit listings vs good listings
 * Based on yes/no questions about data completeness
 */

const { Client } = require('pg');

const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

async function auditListingQuality() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    const userId = '0b9f107a-d124-49de-9ded-94698f63c1c4';
    
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║     LISTING QUALITY AUDIT                             ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    // Get all vehicles with quality metrics
    const vehicles = await client.query(`
      SELECT 
        v.id,
        v.year,
        v.make,
        v.model,
        v.vin,
        v.current_value,
        v.sale_price,
        v.mileage,
        (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
        (SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = v.id) as event_count,
        (SELECT COUNT(*) FROM work_orders WHERE vehicle_id = v.id) as work_order_count,
        (SELECT COUNT(*) FROM vehicle_contributors WHERE vehicle_id = v.id) as contributor_count
      FROM vehicles v
      WHERE v.user_id = $1 OR v.uploaded_by = $1
      ORDER BY v.created_at DESC
    `, [userId]);
    
    console.log(`Total vehicles: ${vehicles.rows.length}\n`);
    
    const results = {
      excellent: [],
      good: [],
      mediocre: [],
      poor: [],
      shit: []
    };
    
    // Quality scoring - YES/NO questions
    vehicles.rows.forEach(v => {
      let score = 0;
      const issues = [];
      
      // CRITICAL YES/NO QUESTIONS
      
      // 1. Has VIN? (CRITICAL)
      if (v.vin && v.vin.length >= 10) {
        score += 20;
      } else {
        issues.push('NO VIN');
      }
      
      // 2. Has price? (CRITICAL)
      if (v.current_value > 0 || v.sale_price > 0) {
        score += 20;
      } else {
        issues.push('NO PRICE');
      }
      
      // 3. Has images? (CRITICAL)
      if (v.image_count > 0) {
        score += 15;
        if (v.image_count >= 5) score += 10; // Bonus for 5+ images
        if (v.image_count >= 20) score += 10; // Bonus for 20+ images
      } else {
        issues.push('NO IMAGES');
      }
      
      // 4. Has timeline events? (Important)
      if (v.event_count > 0) {
        score += 10;
      } else {
        issues.push('NO EVENTS');
      }
      
      // 5. Has basic specs? (Mileage)
      if (v.mileage) score += 5;
      else issues.push('NO MILEAGE');
      
      // 6. Has work history?
      if (v.work_order_count > 0) {
        score += 5;
      }
      
      // 7. Has contributors? (community engagement)
      if (v.contributor_count > 0) {
        score += 5;
      }
      
      // Categorize
      const vehicleData = {
        id: v.id,
        name: `${v.year} ${v.make} ${v.model}`,
        score,
        issues,
        images: v.image_count,
        events: v.event_count,
        hasVin: !!v.vin,
        hasPrice: !!(v.current_value || v.sale_price),
        price: v.current_value || v.sale_price || 0
      };
      
      if (score >= 80) results.excellent.push(vehicleData);
      else if (score >= 60) results.good.push(vehicleData);
      else if (score >= 40) results.mediocre.push(vehicleData);
      else if (score >= 20) results.poor.push(vehicleData);
      else results.shit.push(vehicleData);
    });
    
    // Report
    console.log('QUALITY BREAKDOWN:\n');
    console.log(`  🏆 EXCELLENT (80-100): ${results.excellent.length} vehicles`);
    console.log(`  ✅ GOOD (60-79):       ${results.good.length} vehicles`);
    console.log(`  ⚠️  MEDIOCRE (40-59):  ${results.mediocre.length} vehicles`);
    console.log(`  ❌ POOR (20-39):       ${results.poor.length} vehicles`);
    console.log(`  💩 SHIT (<20):         ${results.shit.length} vehicles\n`);
    
    // Show shit listings
    if (results.shit.length > 0) {
      console.log('💩 SHIT LISTINGS (need immediate attention):\n');
      results.shit.slice(0, 10).forEach(v => {
        console.log(`  ${v.name} (score: ${v.score}/100)`);
        console.log(`    Issues: ${v.issues.join(', ')}`);
        console.log(`    Images: ${v.images}, Events: ${v.events}`);
        console.log(`    https://n-zero.dev/vehicle/${v.id}`);
        console.log('');
      });
    }
    
    // Show poor listings
    if (results.poor.length > 0) {
      console.log('❌ POOR LISTINGS (need work):\n');
      results.poor.slice(0, 10).forEach(v => {
        console.log(`  ${v.name} (score: ${v.score}/100)`);
        console.log(`    Issues: ${v.issues.join(', ')}`);
        console.log(`    Images: ${v.images}, Events: ${v.events}`);
        console.log('');
      });
    }
    
    // Action plan
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║     ACTION PLAN                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    const totalBad = results.shit.length + results.poor.length;
    const noImageCount = results.shit.filter(v => v.images === 0).length + results.poor.filter(v => v.images === 0).length;
    const noPriceCount = results.shit.filter(v => v.price === 0).length + results.poor.filter(v => v.price === 0).length;
    
    console.log(`1. DELETE ${results.shit.filter(v => v.images === 0).length} vehicles with 0 images (useless)`);
    console.log(`2. BACKFILL prices for ${noPriceCount} vehicles (BaT data or manual)`);
    console.log(`3. ADD missing VINs for vehicles with images but no VIN`);
    console.log(`4. IMPROVE ${results.mediocre.length} mediocre listings (add specs, events)`);
    console.log('');
    
  } finally {
    await client.end();
  }
}

auditListingQuality();

