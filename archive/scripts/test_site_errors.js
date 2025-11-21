#!/usr/bin/env node
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const networkErrors = [];
  
  page.on('response', response => {
    if (response.status() >= 400) {
      const url = response.url();
      const endpoint = url.split('?')[0].split('/').slice(-2).join('/');
      networkErrors.push(`${response.status()} - ${endpoint}`);
    }
  });
  
  try {
    console.log('Testing production for errors after RLS fixes...\n');
    
    await page.goto('https://n-zero.dev/vehicle/79fe1a2b-9099-45b5-92c0-54e7f896089e?nocache=' + Date.now(), { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });
    
    await page.waitForTimeout(5000);
    
    const uniqueErrors = [...new Set(networkErrors)];
    
    console.log(`Network Errors: ${networkErrors.length} total, ${uniqueErrors.length} unique\n`);
    
    if (uniqueErrors.length > 0) {
      console.log('Error breakdown:');
      const grouped = uniqueErrors.reduce((acc, err) => {
        const status = err.split(' - ')[0];
        if (!acc[status]) acc[status] = [];
        acc[status].push(err);
        return acc;
      }, {});
      
      Object.entries(grouped).forEach(([status, errors]) => {
        console.log(`  ${status} errors (${errors.length}):`);
        errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
      });
    } else {
      console.log('✅ NO NETWORK ERRORS!');
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    if (uniqueErrors.length === 0) {
      console.log('║  🎉 100% CLEAN! Users will have smooth experience     ║');
    } else if (uniqueErrors.length < 5) {
      console.log('║  ✅ MOSTLY CLEAN - Minor issues only                  ║');
    } else {
      console.log('║  ⚠️  STILL BUGGY - More fixes needed                  ║');
    }
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    process.exit(uniqueErrors.length > 0 ? 1 : 0);
    
  } finally {
    await browser.close();
  }
})();

