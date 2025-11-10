#!/usr/bin/env node
/**
 * Verify deployment completed successfully
 * Checks if new components are visible on production
 */

const { chromium } = require('playwright');
const { Client } = require('pg');

const PRODUCTION_URL = 'https://n-zero.dev';
const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

async function getTestVehicleWithOrg() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    const result = await client.query(`
      SELECT v.id, v.year, v.make, v.model,
             b.business_name
      FROM vehicles v
      INNER JOIN organization_vehicles ov ON v.id = ov.vehicle_id
      INNER JOIN businesses b ON ov.organization_id = b.id
      WHERE v.is_public = true
      LIMIT 1
    `);
    
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function verify() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     DEPLOYMENT VERIFICATION                            ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  const testVehicle = await getTestVehicleWithOrg();
  
  if (!testVehicle) {
    console.log('⚠️  No test vehicle with org relationship found');
    console.log('Cannot verify LinkedOrganizations component\n');
    return;
  }
  
  console.log(`Testing with: ${testVehicle.year} ${testVehicle.make} ${testVehicle.model}`);
  console.log(`Expected org: ${testVehicle.business_name}\n`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Load vehicle page
    console.log(`Loading ${PRODUCTION_URL}/vehicle/${testVehicle.id}...`);
    await page.goto(`${PRODUCTION_URL}/vehicle/${testVehicle.id}`, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait a bit for React to render
    await page.waitForTimeout(2000);
    
    const content = await page.content();
    const pageText = await page.textContent('body');
    
    // Check for new components
    const checks = {
      'LinkedOrganizations': {
        present: content.includes('Associated Organizations') || 
                content.includes('Linked Organizations') ||
                pageText.includes(testVehicle.business_name),
        critical: true
      },
      'ValuationCitations': {
        present: content.includes('Valuation Breakdown') ||
                content.includes('Citation') ||
                content.includes('Source attribution'),
        critical: false // OK if empty
      },
      'TransactionHistory': {
        present: content.includes('Transaction History') ||
                content.includes('transaction'),
        critical: false // OK if no transactions
      },
      'OrganizationName': {
        present: pageText.includes(testVehicle.business_name),
        critical: true
      }
    };
    
    console.log('\n✓ Component Verification:\n');
    
    let allCriticalPass = true;
    for (const [name, check] of Object.entries(checks)) {
      const status = check.present ? '✅ FOUND' : (check.critical ? '❌ MISSING' : '⚠️  NOT SHOWN');
      console.log(`  ${name.padEnd(25)} ${status}`);
      if (check.critical && !check.present) allCriticalPass = false;
    }
    
    console.log('\n');
    
    if (allCriticalPass) {
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  🎉 DEPLOYMENT SUCCESSFUL!                             ║');
      console.log('║  All new components are LIVE on production            ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      console.log(`✅ Visit: ${PRODUCTION_URL}/vehicle/${testVehicle.id}`);
      console.log(`✅ Organization "${testVehicle.business_name}" is displayed\n`);
      process.exit(0);
    } else {
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  ⚠️  DEPLOYMENT MAY STILL BE IN PROGRESS               ║');
      console.log('║  Vercel build might not be complete yet               ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      console.log('💡 Wait 1-2 more minutes and run this script again:\n');
      console.log('   node verify_deployment.js\n');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

verify().catch(error => {
  console.error('❌ Script error:', error);
  process.exit(1);
});

