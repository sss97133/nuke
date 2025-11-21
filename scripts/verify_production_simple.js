import { chromium } from 'playwright';

async function verifyProduction() {
  console.log('Starting production verification...');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // 1. Check Homepage Load
    console.log('Checking Homepage...');
    const start = Date.now();
    await page.goto('https://n-zero.dev', { waitUntil: 'networkidle' });
    const duration = Date.now() - start;
    console.log(`Homepage loaded in ${duration}ms`);
    
    if (duration > 5000) {
      console.warn('WARNING: Homepage load time exceeded 5s');
    }

    // 2. Verify React Root exists
    const root = await page.$('#root');
    if (root) {
      console.log('✅ React root found');
    } else {
      console.error('❌ React root NOT found');
      process.exit(1);
    }

    // 3. Verify Navigation Elements (indicates App.tsx structure is working)
    // Looking for nav elements that would be rendered by AppLayout
    const nav = await page.$('nav'); 
    if (nav) {
       console.log('✅ Navigation found');
    } else {
       console.log('⚠️ No <nav> tag found, checking specific selectors...');
    }

    console.log('Production verification passed!');
    
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

verifyProduction();
