#!/usr/bin/env node
/**
 * Production E2E Test Suite
 * Tests that all November migrations are working in the live application
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

async function getTestData() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    // Get a vehicle with org relationship
    const vehicle = await client.query(`
      SELECT v.id, v.year, v.make, v.model,
             b.id as org_id, b.business_name
      FROM vehicles v
      INNER JOIN organization_vehicles ov ON v.id = ov.vehicle_id
      INNER JOIN businesses b ON ov.organization_id = b.id
      LIMIT 1
    `);
    
    // Get an organization
    const org = await client.query(`
      SELECT id, business_name FROM businesses LIMIT 1
    `);
    
    return {
      vehicle: vehicle.rows[0],
      org: org.rows[0]
    };
  } finally {
    await client.end();
  }
}

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     PRODUCTION E2E TEST SUITE                         ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  
  const testData = await getTestData();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  async function test(name, fn) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log('✓ PASS');
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
    } catch (error) {
      console.log(`✗ FAIL: ${error.message}`);
      results.failed++;
      results.tests.push({ name, status: 'FAIL', error: error.message });
    }
  }
  
  try {
    // Test 1: Homepage loads
    await test('Homepage loads successfully', async () => {
      const response = await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle', timeout: 30000 });
      if (!response || response.status() !== 200) {
        throw new Error(`Status: ${response?.status()}`);
      }
      await page.waitForSelector('body', { timeout: 5000 });
    });
    
    // Test 2: Navigation exists
    await test('Navigation elements present', async () => {
      const hasNav = await page.locator('nav, header, [role="navigation"]').count() > 0;
      if (!hasNav) throw new Error('No navigation found');
    });
    
    // Test 3: Vehicle profile page (if we have test data)
    if (testData.vehicle) {
      await test(`Vehicle profile page loads (${testData.vehicle.year} ${testData.vehicle.make})`, async () => {
        await page.goto(`${PRODUCTION_URL}/vehicle/${testData.vehicle.id}`, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Check for vehicle info
        const content = await page.content();
        const hasYear = content.includes(testData.vehicle.year);
        const hasMake = content.includes(testData.vehicle.make);
        
        if (!hasYear && !hasMake) {
          throw new Error('Vehicle data not found on page');
        }
      });
      
      // Test 4: Org link on vehicle page
      await test('Organization link appears on vehicle page', async () => {
        const content = await page.content();
        if (testData.vehicle.business_name && !content.includes(testData.vehicle.business_name)) {
          throw new Error(`Organization "${testData.vehicle.business_name}" not displayed`);
        }
      });
    }
    
    // Test 5: Organization page (if we have test data)
    if (testData.org) {
      await test(`Organization page loads (${testData.org.business_name})`, async () => {
        await page.goto(`${PRODUCTION_URL}/organization/${testData.org.id}`, { waitUntil: 'networkidle', timeout: 30000 });
        
        const content = await page.content();
        if (!content.includes(testData.org.business_name)) {
          throw new Error('Organization name not found on page');
        }
      });
    }
    
    // Test 6: No console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    
    await test('No critical console errors', async () => {
      await page.goto(PRODUCTION_URL, { waitUntil: 'load' });
      await page.waitForTimeout(2000); // Wait for any async errors
      
      const criticalErrors = consoleErrors.filter(err => 
        !err.includes('404') && // Ignore 404s
        !err.includes('favicon') && // Ignore favicon issues
        !err.includes('analytics') // Ignore analytics issues
      );
      
      if (criticalErrors.length > 0) {
        throw new Error(`Console errors: ${criticalErrors.join(', ')}`);
      }
    });
    
    // Test 7: API connectivity
    await test('Supabase API reachable', async () => {
      const response = await page.evaluate(async () => {
        try {
          const res = await fetch('https://tzorvvtvzrfqkdshcijr.supabase.co/rest/v1/', {
            headers: { 'apikey': 'public-anon-key-placeholder' }
          });
          return res.status;
        } catch (e) {
          return 0;
        }
      });
      
      if (response === 0) throw new Error('API not reachable');
    });
    
    // Test 8: Page renders without errors
    await test('Page renders completely', async () => {
      await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle' });
      
      const bodyHTML = await page.locator('body').innerHTML();
      if (bodyHTML.length < 1000) {
        throw new Error('Page seems incomplete (< 1000 chars)');
      }
    });
    
  } finally {
    await browser.close();
  }
  
  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     TEST RESULTS                                      ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  console.log(`  ✓ Passed: ${results.passed}`);
  console.log(`  ✗ Failed: ${results.failed}`);
  console.log(`  Total:    ${results.passed + results.failed}`);
  
  if (results.failed > 0) {
    console.log('\n  Failed tests:');
    results.tests.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`    - ${t.name}: ${t.error}`);
    });
  }
  
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  if (results.failed === 0) {
    console.log('║  🎉 ALL TESTS PASSED - PRODUCTION IS LIVE!            ║');
  } else {
    console.log('║  ⚠ SOME TESTS FAILED - REVIEW NEEDED                 ║');
  }
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('\n❌ Test suite crashed:', error);
  process.exit(1);
});

