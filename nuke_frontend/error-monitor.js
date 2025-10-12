#!/usr/bin/env node

/**
 * Runtime Error Monitor
 * Automatically detects and reports browser runtime errors
 */

import puppeteer from 'puppeteer';

async function monitorErrors() {
  console.log('🔍 Starting automated error monitoring...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ RUNTIME ERROR:', msg.text());
    }
  });

  // Listen for uncaught exceptions
  page.on('pageerror', error => {
    console.log('💥 UNCAUGHT ERROR:', error.message);
  });

  try {
    // Test a vehicle profile page to see if images load
    await page.goto('http://localhost:5174/vehicle/95fbb5c3-568b-4ebd-b6dd-7f3adffd3e43', { waitUntil: 'networkidle0' });
    console.log('✅ Page loaded successfully');

    // Wait and monitor for 10 seconds
    await page.waitForSelector('body', { timeout: 30000 });

    // Check for image gallery and loading states
    const imageGallery = await page.$('.image-gallery, [class*="gallery"], [class*="image"]') !== null;
    const hasImageError = await page.$('[class*="text-red"], .error') !== null;

    console.log(`🖼️ Image gallery present: ${imageGallery}`);
    console.log(`❌ Image error present: ${hasImageError}`);

    // Check for loading indicators
    const hasLoader = await page.$('[class*="loading"], [class*="spinner"], [class*="animate-pulse"]') !== null;
    console.log(`⏳ Loading indicators present: ${hasLoader}`);

    // Check current URL and page content
    const currentUrl = page.url();
    const pageTitle = await page.title();
    const hasLoginForm = await page.$('form[action*="login"], input[type="email"], .login') !== null;

    console.log(`📍 Current URL: ${currentUrl}`);
    console.log(`📄 Page title: ${pageTitle}`);
    console.log(`🔐 Has login form: ${hasLoginForm}`);

    // Check localStorage for session data
    const authState = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const supabaseKeys = keys.filter(k => k.includes('supabase') || k.includes('auth'));
      const authData = {};
      supabaseKeys.forEach(key => {
        try {
          authData[key] = JSON.parse(localStorage.getItem(key) || 'null');
        } catch (e) {
          authData[key] = localStorage.getItem(key);
        }
      });
      return {
        hasSupabaseKeys: supabaseKeys.length > 0,
        supabaseKeys,
        authData
      };
    });
    console.log(`🔑 Auth state:`, authState);

    // Check console logs
    const logs = await page.evaluate(() => {
      return {
        hasDiscoveries: window.__debugDiscoveries || 'not_set',
        loadingState: window.__debugLoading || 'not_set'
      };
    });
    console.log(`🔧 Debug state:`, logs);

    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.log('🚨 PAGE LOAD ERROR:', error.message);
  }

  await browser.close();
}

monitorErrors().catch(console.error);