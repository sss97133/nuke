#!/usr/bin/env node
/**
 * Comprehensive Site Audit with Playwright
 * Tests all major pages, counts errors, checks functionality
 */

const { chromium } = require('playwright');

const SITE_URL = 'https://n-zero.dev';

async function auditSite() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE SITE AUDIT                          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const results = {
    pages: [],
    totalErrors: 0,
    totalWarnings: 0
  };
  
  async function auditPage(name, path) {
    const page = await context.newPage();
    
    const errors = [];
    const warnings = [];
    const consoleErrors = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    
    page.on('response', response => {
      if (response.status() >= 400) {
        const url = response.url();
        if (url.includes('supabase') || url.includes('n-zero')) {
          errors.push(`${response.status()} - ${url.split('?')[0].split('/').pop()}`);
        }
      }
    });
    
    try {
      const startTime = Date.now();
      await page.goto(`${SITE_URL}${path}`, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      const loadTime = Date.now() - startTime;
      
      await page.waitForTimeout(3000); // Wait for React to settle
      
      const bodyText = await page.textContent('body');
      const hasContent = bodyText.length > 500;
      
      const uniqueErrors = [...new Set(errors)];
      const criticalConsoleErrors = consoleErrors.filter(e => 
        !e.includes('analytics') && 
        !e.includes('favicon') &&
        !e.includes('DevTools')
      );
      
      results.pages.push({
        name,
        path,
        loadTime,
        hasContent,
        networkErrors: uniqueErrors.length,
        consoleErrors: criticalConsoleErrors.length,
        status: uniqueErrors.length === 0 && hasContent ? 'PASS' : 'ISSUES'
      });
      
      results.totalErrors += uniqueErrors.length;
      results.totalWarnings += warnings.length;
      
      console.log(`${name.padEnd(30)} ${uniqueErrors.length === 0 ? '✅' : '❌'} (${loadTime}ms, ${uniqueErrors.length} errors)`);
      
      if (uniqueErrors.length > 0 && uniqueErrors.length <= 5) {
        uniqueErrors.forEach(e => console.log(`  - ${e}`));
      }
      
    } catch (error) {
      console.log(`${name.padEnd(30)} ❌ CRASH: ${error.message}`);
      results.pages.push({
        name,
        path,
        status: 'CRASH',
        error: error.message
      });
    } finally {
      await page.close();
    }
  }
  
  try {
    console.log('Testing major pages...\n');
    
    // Core pages
    await auditPage('Homepage', '/');
    await auditPage('Vehicles List', '/vehicles');
    await auditPage('Organizations List', '/organizations');
    await auditPage('Profile', '/profile');
    await auditPage('Dashboard', '/dashboard');
    await auditPage('Discovery', '/discovery');
    
    // Sample vehicle page
    await auditPage('Vehicle Profile', '/vehicle/79fe1a2b-9099-45b5-92c0-54e7f896089e');
    
    // Sample org page  
    await auditPage('Organization Profile', '/org/05f27cc4-914e-425a-8ed8-cfea35c1928d');
    
    // Notifications
    await auditPage('Notifications', '/notifications');
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║     AUDIT SUMMARY                                     ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    const passing = results.pages.filter(p => p.status === 'PASS').length;
    const failing = results.pages.filter(p => p.status === 'ISSUES').length;
    const crashed = results.pages.filter(p => p.status === 'CRASH').length;
    
    console.log(`Pages tested: ${results.pages.length}`);
    console.log(`  ✅ Passing: ${passing}`);
    console.log(`  ⚠️  Issues:  ${failing}`);
    console.log(`  ❌ Crashed: ${crashed}`);
    console.log(`\nTotal network errors: ${results.totalErrors}`);
    
    if (results.totalErrors === 0) {
      console.log('\n╔═══════════════════════════════════════════════════════╗');
      console.log('║  🎉 SITE IS CLEAN - NO ERRORS!                        ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');
    } else {
      console.log(`\n⚠️  Site has ${results.totalErrors} total errors across all pages\n`);
    }
    
    // Detailed report
    console.log('Page Details:\n');
    results.pages.forEach(p => {
      console.log(`${p.name}:`);
      console.log(`  Path: ${p.path}`);
      console.log(`  Status: ${p.status}`);
      if (p.loadTime) console.log(`  Load time: ${p.loadTime}ms`);
      if (p.networkErrors) console.log(`  Network errors: ${p.networkErrors}`);
      if (p.consoleErrors) console.log(`  Console errors: ${p.consoleErrors}`);
      console.log('');
    });
    
  } finally {
    await browser.close();
  }
}

auditSite().catch(error => {
  console.error('Audit failed:', error);
  process.exit(1);
});

